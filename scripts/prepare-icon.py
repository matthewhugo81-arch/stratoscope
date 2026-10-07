"""Prepare ICON pressure-level maps from DWD's anonymous official open feed."""
import argparse,bz2,gzip,hashlib,json,re,time,urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone,timedelta
from pathlib import Path
from threading import Lock
import eccodes as ec
import numpy as np
from scipy.spatial import cKDTree

ORIGIN='https://opendata.dwd.de/weather/nwp/icon/grib'
LEVELS=[30,50,70,100]
FIELDS={'t':'temperature','fi':'height','u':'u','v':'v'}
LOCK=Lock()

def request(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Stratoscope-DWD-open-data/1'}),timeout=60) as r:
                return r.read()
        except Exception:
            if attempt==3: raise
            time.sleep(2**attempt)

def filename(run,hour,level,key):
    return f'icon_global_icosahedral_pressure-level_{run:%Y%m%d%H}_{hour:03}_{level}_{key.upper()}.grib2.bz2'

def discover():
    start=datetime.now(timezone.utc)-timedelta(hours=8)
    start=start.replace(hour=12 if start.hour>=12 else 0,minute=0,second=0,microsecond=0)
    for back in range(4):
        run=start-timedelta(hours=12*back)
        try:
            for key in FIELDS:
                listing=request(f'{ORIGIN}/{run:%H}/{key}/').decode()
                names=set(re.findall(r'href="([^"]+)"',listing))
                assert all(filename(run,h,l,key) in names for h in range(0,181,6) for l in LEVELS)
            return run
        except Exception: pass
    raise RuntimeError('No complete DWD ICON 180-hour run is available')

def decode(data,run,key,hour=None,level=None,identity=None):
    with LOCK:
        g=ec.codes_new_from_message(bz2.decompress(data))
        try:
            assert ec.codes_get(g,'gridType')=='unstructured_grid'
            grid=(ec.codes_get(g,'uuidOfHGrid'),ec.codes_get_long(g,'numberOfDataPoints'))
            assert identity is None or grid==identity,'ICON coordinate/field grids differ'
            assert ec.codes_get_long(g,'dataDate')==int(run.strftime('%Y%m%d'))
            assert ec.codes_get_long(g,'dataTime')==run.hour*100
            assert ec.codes_get_long(g,'bitmapPresent')==0
            if level is not None:
                assert ec.codes_get(g,'typeOfLevel')=='isobaricInhPa' and ec.codes_get_long(g,'level')==level
                valid=run+timedelta(hours=hour)
                assert ec.codes_get_long(g,'validityDate')==int(valid.strftime('%Y%m%d')) and ec.codes_get_long(g,'validityTime')==valid.hour*100
            expected={'clat':('tlat','Degree N'),'clon':('tlon','Degree E'),'t':('t','K'),'fi':('z','m**2 s**-2'),'u':('u','m s**-1'),'v':('v','m s**-1')}
            assert (ec.codes_get(g,'shortName'),ec.codes_get(g,'units'))==expected[key]
            values=ec.codes_get_values(g)
            assert values.size==grid[1] and np.isfinite(values).all()
            return values,grid
        finally: ec.codes_release(g)

def xyz(lat,lon):
    lat,lon=np.deg2rad(lat),np.deg2rad(lon)
    return np.column_stack((np.cos(lat)*np.cos(lon),np.cos(lat)*np.sin(lon),np.sin(lat)))

def nearest_indices(lat,lon):
    assert lat.shape==lon.shape and np.isfinite(lat).all() and np.isfinite(lon).all()
    assert (np.abs(lat)<=90).all() and (np.abs(lon)<=180).all()
    target_lat=np.repeat(np.arange(90,-1,-1),360)
    target_lon=np.tile(np.arange(360),91)
    distances,indices=cKDTree(xyz(lat,lon)).query(xyz(target_lat,target_lon))
    assert distances.max()<.005,'Unexpectedly distant ICON sampling cell'
    return indices

def convert(values,key,indices):
    result=values[indices]
    if key=='t': result=result-273.15
    if key=='fi': result=result/9.80665
    assert np.isfinite(result).all()
    return np.round(result,2).tolist()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);parser.add_argument('--hours',type=int,nargs='+');args=parser.parse_args()
    run=discover();stamp=run.isoformat(timespec='milliseconds').replace('+00:00','Z');run_key=run.strftime('%Y%m%d%H')
    coords={};identity=None
    for key in ['clat','clon']:
        url=f'{ORIGIN}/{run:%H}/{key}/icon_global_icosahedral_time-invariant_{run_key}_{key.upper()}.grib2.bz2'
        coords[key],identity=decode(request(url),run,key,identity=identity)
    indices=nearest_indices(coords['clat'],coords['clon']);del coords
    hours=args.hours if args.hours is not None else list(range(0,181,6))
    assert all(h in range(0,181,6) for h in hours)
    prepared=datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
    manifest={'version':1,'model':'icon','run':stamp,'maxHour':180,'levels':LEVELS,'step':6,'complete':hours==list(range(0,181,6)),'preparedAt':prepared,'files':{}}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for hour in hours:
            for level in LEVELS:
                def field(key):
                    url=f'{ORIGIN}/{run:%H}/{key}/{filename(run,hour,level,key)}'
                    values,_=decode(request(url),run,key,hour,level,identity)
                    return FIELDS[key],convert(values,key,indices)
                frame=dict(pool.map(field,FIELDS))
                frame.update(model='icon',run=stamp,hour=hour,level=level,valid=(run+timedelta(hours=hour)).isoformat(timespec='milliseconds').replace('+00:00','Z'),grid={'nx':360,'ny':91,'lat0':90,'lon0':0,'dx':1,'dy':-1},runKind='cycle',source=ORIGIN,preparedAt=prepared)
                packed=gzip.compress(json.dumps(frame,separators=(',',':'),allow_nan=False).encode(),mtime=0)
                path=f'{run_key}/{level}/{hour}.json.gz';out=args.output/path;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(packed)
                manifest['files'][f'{level}/{hour}']={'path':path,'bytes':len(packed),'sha256':hashlib.sha256(packed).hexdigest()}
            print('PREPARED',stamp,hour,len(manifest['files']),flush=True)
    (args.output/'latest.json').write_text(json.dumps(manifest,separators=(',',':')),encoding='utf-8')
    print('COMPLETE',len(manifest['files']),flush=True)
if __name__=='__main__': main()
