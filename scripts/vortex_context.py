"""Complete GEFS 500 hPa mean minus a stored, source-qualified daily reference."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import hashlib
import json
from pathlib import Path
import numpy as np

REFERENCE_ID = 'ncep-ncar-r1-1991-2020-daily'
SOURCE = 'https://psl.noaa.gov/thredds/dodsC/Datasets/ncep.reanalysis/Monthlies/pressure/hgt.day.ltm.1991-2020.nc'

def load_reference():
    path=Path(__file__).parent/'data'/'height-500-ncep-1991-2020.npz'
    meta=json.loads(path.with_suffix('.json').read_text())
    assert hashlib.sha256(path.read_bytes()).hexdigest()==meta['sha256']
    assert meta['id']==REFERENCE_ID and meta['source']==SOURCE and meta['period']==[1991,2020]
    assert meta['samplesPerDay']==30 and meta['pressure']==500 and meta['dailyMean'] is True
    assert meta['units']=='m' and meta['grid']==dict(nx=144,ny=25,lat0=90,lon0=0,dx=2.5,dy=-2.5)
    dates=[(datetime(2001,1,1)+timedelta(days=i)).strftime('%m-%d') for i in range(365)]
    assert meta['calendarDays']==dates
    with np.load(path,allow_pickle=False) as file: height=file['height'].copy()
    assert height.shape==(365,25,144) and np.isfinite(height).all() and height.min()>4500 and height.max()<6200
    return height,meta

def daily_reference(reference,valid):
    """Calendar day, not ordinal day: leap years cannot shift March onward."""
    if (valid.month,valid.day)==(2,29): return (reference[58]+reference[59])/2
    index=(datetime(2001,valid.month,valid.day)-datetime(2001,1,1)).days
    return reference[index]

def interpolate_reference(field):
    """Bilinear 2.5-degree climatology to the same 1-degree forecast display grid."""
    assert field.shape==(25,144) and np.isfinite(field).all()
    y=np.arange(61)/2.5;x=np.arange(360)/2.5
    y0=np.floor(y).astype(int);y1=np.minimum(y0+1,24);fy=(y-y0)[:,None]
    x0=np.floor(x).astype(int);x1=(x0+1)%144;fx=(x-x0)[None,:]
    return ((1-fy)*((1-fx)*field[np.ix_(y0,x0)]+fx*field[np.ix_(y0,x1)])+
            fy*((1-fx)*field[np.ix_(y1,x0)]+fx*field[np.ix_(y1,x1)]))

def complete_mean(fields):
    assert set(fields)==set(range(31)), '500 hPa requires all 31 unique members'
    values=np.stack([fields[m] for m in range(31)])
    assert values.shape==(31,91,360) and np.isfinite(values).all()
    assert values.min()>3500 and values.max()<6500, 'Unphysical 500 hPa geopotential height'
    return values.mean(axis=0)[:61]

def prepare_context(prep,run,hour,reference,meta):
    when=datetime.fromisoformat(run.replace('Z','+00:00'))
    entries=[e for e in prep.noaa_entries(when,hour,[500],4) if e[-1]=='height']
    identities=[e[3] for e in entries]
    assert len(identities)==31 and set(identities)==set(range(31)), 'Incomplete 500 hPa inventory'
    def download(entry):
        url,start,length,member,level,key=entry
        value,_=prep.decode(prep.request(url,start,length),'gefs',when,hour,member,level,key)
        return member,value
    with ThreadPoolExecutor(max_workers=4) as pool: fields=dict(pool.map(download,entries))
    valid=when+timedelta(hours=hour)
    anomaly=complete_mean(fields)-interpolate_reference(daily_reference(reference,valid))
    assert np.isfinite(anomaly).all() and np.abs(anomaly).max()<1500
    return dict(version=1,model='gefs',run=run,hour=hour,validTime=valid.isoformat(timespec='milliseconds').replace('+00:00','Z'),
        count=31,pressure=500,units='m',method='ensemble-mean-height-minus-daily-climatology',
        source=prep.NOAA_ORIGIN,reference=REFERENCE_ID,referenceSha256=meta['sha256'],
        calendarDay=valid.strftime('%m-%d'),grid=dict(nx=360,ny=61,lat0=90,lon0=0,dx=1,dy=-1),
        values=np.round(anomaly,1).reshape(-1).tolist())
