"""GEFS PV-contour geometry, derived from complete ensemble-mean fields.

13 pressure levels; pressure-coordinate Ertel PV with spherical derivatives.
Contours enclose high-PV area equivalent to a 70N polar cap. This is a fixed
equivalent-area diagnostic, NOT a Nash vortex-edge diagnosis. PV of mean fields
is not mean member PV. First complete forecast geometry is published early;
later checkpoints contain additional complete 31-member forecast times.
"""
import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import urllib.error
import numpy as np
context_spec=importlib.util.spec_from_file_location('vortex_context',Path(__file__).with_name('vortex_context.py'))
context=importlib.util.module_from_spec(context_spec);context_spec.loader.exec_module(context)
load_reference,prepare_context=context.load_reference,context.prepare_context

spec=importlib.util.spec_from_file_location('ensemble_preparation',Path(__file__).with_name('prepare-ensembles.py'))
prep=importlib.util.module_from_spec(spec);spec.loader.exec_module(prep)
ROOT='https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/'
PRESSURES=[1,2,3,5,7,10,20,30,50,70,100,150,200]
EXTRA=[1,2,3,5,7,150,200]
THETA=list(range(400,1201,25))

def mean_frame(packed,run,hour,level):
    b=gzip.decompress(packed)
    assert b[:8]==b'STRAT001'
    n=struct.unpack_from('<I',b,8)[0];h=json.loads(b[12:12+n])
    assert all(h[k]==v for k,v in dict(version=1,model='gefs',run=run,hour=hour,level=level,count=31,scale=100,planes=7).items())
    assert h['grid']==dict(nx=360,ny=91,lat0=90,lon0=0,dx=1,dy=-1)
    assert h['source']==prep.NOAA_ORIGIN and len(b)==12+n+7*91*360*4
    values=np.cumsum(np.frombuffer(b,dtype='<i4',offset=12+n).reshape(7,91,360),axis=2)/100
    assert np.isfinite(values).all()
    return values[:4]

def pressure_pv(temperature,u,v,pressures=PRESSURES):
    assert temperature.shape==u.shape==v.shape==(len(pressures),91,360)
    p=np.asarray(pressures,dtype=float)*100
    assert np.all(np.diff(p)>0) and np.isfinite(temperature).all() and np.isfinite(u).all() and np.isfinite(v).all()
    theta=(temperature+273.15)*(100000/p[:,None,None])**(287.05/1004)
    phi=np.deg2rad(90-np.arange(91));cos=np.maximum(np.cos(phi),1e-6)[None,:,None]
    a=6371000.;omega=7.292115e-5;rad=np.pi/180
    dl=lambda z:(np.roll(z,-1,axis=2)-np.roll(z,1,axis=2))/(2*rad)
    dp=lambda z:np.gradient(z,p,axis=0,edge_order=2)
    dy=lambda z:np.gradient(z,phi,axis=1,edge_order=2)/a
    tx=dl(theta)/(a*cos);ty=dy(theta)
    relative=(dl(v)/a-dy(u*cos))/cos
    pv=-9.80665*(dp(theta)*(relative+2*omega*np.sin(phi)[None,:,None])+dp(u)*ty-dp(v)*tx)*1e6
    # Longitude winds are coordinate-singular at the exact pole. It is not
    # used for derivatives at the diagnosed ~70N contours; fill its PV by the
    # adjacent latitude-circle mean before drawing the closed cap.
    pv[:,0,:]=pv[:,1,:].mean(axis=1)[:,None]
    return theta,pv

def on_theta(theta,pv,target):
    out=np.full((91,360),np.nan)
    for i in range(len(PRESSURES)-1):
        upper,lower=theta[i],theta[i+1]
        match=(upper>=target)&(lower<=target)&np.isnan(out)
        weight=np.divide(target-lower,upper-lower,out=np.zeros_like(upper),where=upper!=lower)
        out[match]=(pv[i+1]+weight*(pv[i]-pv[i+1]))[match]
    return out

def area_threshold(values,high=True,equivalent_lat=70):
    lat=90-np.arange(values.shape[0])
    weight=np.sin(np.deg2rad(np.minimum(90,lat+.5)))-np.sin(np.deg2rad(np.maximum(30,lat-.5)))
    weights=np.broadcast_to(weight[:,None]/360,values.shape)
    mask=np.isfinite(values);q=values[mask];w=weights[mask]
    assert q.size>5000
    order=np.argsort(q);order=order[::-1] if high else order
    cumulative=np.cumsum(w[order]);target=1-np.sin(np.deg2rad(equivalent_lat))
    assert cumulative[-1]>target*3
    return float(q[order[min(np.searchsorted(cumulative,target),len(q)-1)]])

def contour_segments(values,threshold):
    segments=[]
    for y in range(values.shape[0]-1):
        lat=90-y
        for x in range(360):
            corners=[(x,lat,values[y,x]),(x+1,lat,values[y,(x+1)%360]),(x+1,lat-1,values[y+1,(x+1)%360]),(x,lat-1,values[y+1,x])]
            if not all(np.isfinite(c[2]) for c in corners):continue
            points=[]
            for k in range(4):
                a,b=corners[k],corners[(k+1)%4]
                if (a[2]>=threshold)!=(b[2]>=threshold):
                    f=(threshold-a[2])/(b[2]-a[2]);points.append([a[0]+f*(b[0]-a[0]),a[1]+f*(b[1]-a[1])])
            # Four crossings are a saddle; pick the pairing from the cell's
            # centre value instead of drawing crossing contour segments.
            if len(points)==4 and (sum(c[2] for c in corners)/4>=threshold)!=(corners[0][2]>=threshold):points=points[1:]+points[:1]
            for k in range(0,len(points)-1,2):segments.append([round(v,4) for p in points[k:k+2] for v in p])
    return segments

def geometry(fields,run,hour):
    t=np.stack([fields[p][0] for p in PRESSURES]);u=np.stack([fields[p][2] for p in PRESSURES]);v=np.stack([fields[p][3] for p in PRESSURES])
    theta,pv=pressure_pv(t,u,v)
    layers=[]
    for target in THETA:
        q=on_theta(theta,pv,target)[:61]
        assert np.isfinite(q[:41]).all(),f'Incomplete {target}K coverage north of 50N'
        threshold=area_threshold(q)
        lines=contour_segments(q,threshold)
        assert lines and len(lines)<15000
        layers.append(dict(theta=target,pv=round(threshold,4),segments=lines))
    return dict(version=1,model='gefs',run=run,hour=hour,count=31,method='mean-field-pv-equivalent-area-70N',source=prep.NOAA_ORIGIN,pressureLevels=PRESSURES,gridDegrees=1,layers=layers)

def publish(output,hour):
    stage=output.parent/f'vortex-publish-{hour}'
    assert not stage.exists()
    shutil.copytree(output,stage)
    subprocess.run([sys.executable,str(Path(__file__).with_name('publish-ensemble-data.py')),'--model','vortex','--output',str(stage)],check=True)

def main():
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--hours',nargs='+',type=int);p.add_argument('--publish',action='store_true');p.add_argument('--context-only',action='store_true',help='Enrich the published vortex run without recalculating PV');args=p.parse_args()
    base=ROOT+'forecast-data-gefs/'
    m=json.loads(prep.request(base+'latest.json'));assert m['complete'] and m['count']==31 and m['maxHour']==384
    if args.context_only:
        m=json.loads(prep.request(ROOT+'forecast-data-vortex/latest.json'))
        assert m['count']==31 and m['complete']
    run=m['run'];when=datetime.fromisoformat(run.replace('Z','+00:00'));key=when.strftime('%Y%m%d%H')
    reference,reference_meta=load_reference()
    catalogue=dict(version=1,model='vortex',run=run,count=31,complete=True,timelineComplete=False,targetHour=384,step=12,method='mean-field-pv-equivalent-area-70N',files={})
    output=args.output;output.mkdir(parents=True,exist_ok=True)
    try:
        previous=json.loads(prep.request(ROOT+'forecast-data-vortex/latest.json',attempts=1))
        if previous['run']==run and previous.get('method')==catalogue['method']:
            for h,e in previous['files'].items():
                b=prep.request(ROOT+'forecast-data-vortex/'+e['path']);assert len(b)==e['bytes'] and hashlib.sha256(b).hexdigest()==e['sha256']
                f=output/e['path'];f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(b)
            catalogue['files']=previous['files']
            if previous.get('heatFlux'):
                e=previous['heatFlux'];assert len(e['sha256'])==64 and all(c in '0123456789abcdef' for c in e['sha256'])
                assert e['path']==f"{key}/gefs/heat-flux-{e['sha256']}.json" and 0<e['bytes']<100000
                b=prep.request(ROOT+'forecast-data-vortex/'+e['path']);assert len(b)==e['bytes'] and hashlib.sha256(b).hexdigest()==e['sha256']
                series=json.loads(b)
                assert series['run']==run and series['complete'] is True and len(series['points'])==33
                assert [p['hour'] for p in series['points']]==list(range(0,385,12))
                for p in series['points']:prep.heat_module.validate_point({**series,**p},run,p['hour'])
                f=output/e['path'];f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(b)
                catalogue['heatFlux']=e
    except urllib.error.HTTPError as e:
        if e.code!=404:raise
    wanted=args.hours if args.hours is not None else list(range(0,385,12))
    assert wanted and all(h in range(0,385,12) for h in wanted)
    for hour in wanted:
        if str(hour) in catalogue['files']:
            frame=json.loads((output/catalogue['files'][str(hour)]['path']).read_text())
            if frame.get('baseMap',{}).get('referenceSha256')==reference_meta['sha256']:continue
        else:
            if args.context_only:continue
            fields={}
            for level in [10,20,30,50,70,100]:
                e=m['files'][f'{level}/{hour}'];b=prep.request(base+e['path'])
                assert len(b)==e['bytes'] and hashlib.sha256(b).hexdigest()==e['sha256']
                fields[level]=mean_frame(b,run,hour,level)
            extra=prep.calculate('gefs',when,hour,EXTRA,6)
            for level,(planes,_) in extra.items():fields[level]=np.stack(planes[:4])
            frame=geometry(fields,run,hour)
        frame['baseMap']=prepare_context(prep,run,hour,reference,reference_meta)
        packed=json.dumps(frame,separators=(',',':'),allow_nan=False).encode()
        digest=hashlib.sha256(packed).hexdigest()
        # Immutable asset names prevent a cached catalogue from pairing with
        # a replaced frame during incremental context backfills.
        filename=f'{key}/gefs/{hour}-{digest}.json';f=output/filename;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(packed)
        catalogue['files'][str(hour)]=dict(path=filename,bytes=len(packed),sha256=digest)
        catalogue['timelineComplete']=all(str(h) in catalogue['files'] for h in range(0,385,12))
        catalogue['contextHours']=[int(h) for h,e in catalogue['files'].items() if json.loads((output/e['path']).read_text()).get('baseMap',{}).get('referenceSha256')==reference_meta['sha256']]
        catalogue['contextComplete']=len(catalogue['contextHours'])==33
        catalogue['preparedAt']=datetime.now(timezone.utc).isoformat()
        (output/'latest.json').write_text(json.dumps(catalogue,separators=(',',':')))
        print('COMPLETE FORECAST GEOMETRY',run,hour,len(frame['layers']),len(catalogue['files']),flush=True)
        if args.publish and (hour==0 or hour%48==0 or hour==wanted[-1]):publish(output,hour)
    if not args.context_only and not args.hours and not catalogue.get('heatFlux'):
        catalogue['heatFlux']=prep.heat_module.prepare_series(prep,m,output)
        catalogue['timelineComplete']=all(str(h) in catalogue['files'] for h in range(0,385,12))
        catalogue['contextHours']=[int(h) for h,e in catalogue['files'].items() if json.loads((output/e['path']).read_text()).get('baseMap',{}).get('referenceSha256')==reference_meta['sha256']]
        catalogue['contextComplete']=len(catalogue['contextHours'])==33
        catalogue['preparedAt']=datetime.now(timezone.utc).isoformat()
        (output/'latest.json').write_text(json.dumps(catalogue,separators=(',',':')))
        if args.publish:publish(output,'heat-flux')
    print('GEOMETRY READY',run,len(catalogue['files']),flush=True)

if __name__=='__main__':main()
