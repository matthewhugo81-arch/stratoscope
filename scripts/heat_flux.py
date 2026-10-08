"""Member-wise 100 hPa v'T', zonal then area mean over 45–75N.

Primes are departures from each member's instantaneous latitude-circle mean,
not departures from climatology. Compute the product BEFORE ensemble averaging.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import numpy as np

METHOD = 'member-zonal-eddy-heat-flux-area-45-75N'


def member_heat_flux(v, temperature):
    assert v.shape == temperature.shape == (31, 91, 360), 'All 31 members required'
    assert np.isfinite(v).all() and np.isfinite(temperature).all()
    assert np.max(np.abs(v)) < 250 and np.min(temperature) > -150 and np.max(temperature) < 100
    lat = np.arange(75, 44, -1, dtype=float)
    weights = np.sin(np.deg2rad(np.minimum(75, lat+.5))) - np.sin(np.deg2rad(np.maximum(45, lat-.5)))
    v = v[:, 15:46, :]
    t = temperature[:, 15:46, :]
    zonal = ((v-v.mean(axis=2, keepdims=True)) * (t-t.mean(axis=2, keepdims=True))).mean(axis=2)
    return np.round((zonal*weights).sum(axis=1)/weights.sum(), 6).tolist()


def point(run, hour, members):
    result = dict(version=1, model='gefs', run=run, hour=hour, count=31,
                  pressure=100, latitudeBand=[45,75], units='K m/s', gridDegrees=1,
                  method=METHOD, source='https://noaa-gefs-pds.s3.amazonaws.com', members=members)
    validate_point(result, run, hour)
    return result


def validate_point(p, run, hour):
    assert all(p.get(k) == v for k,v in dict(version=1,model='gefs',run=run,hour=hour,count=31,
        pressure=100,latitudeBand=[45,75],units='K m/s',gridDegrees=1,method=METHOD,
        source='https://noaa-gefs-pds.s3.amazonaws.com').items())
    assert len(p['members']) == 31 and all(type(v) in (int,float) and np.isfinite(v) and abs(v)<10000 for v in p['members'])
    return p


def raw_point(prep, run, hour):
    """One-time compatibility backfill: fetch only T and V from NOAA."""
    when = datetime.fromisoformat(run.replace('Z','+00:00'))
    entries = [e for e in prep.noaa_entries(when,hour,[100],3) if e[5] in ['temperature','v']]
    identities = [tuple(e[3:]) for e in entries]
    assert len(identities)==62 and set(identities)=={(m,100,k) for m in range(31) for k in ['temperature','v']}
    def read(e):
        url,start,size,member,level,key=e
        values,_=prep.decode(prep.request(url,start,size),'gefs',when,hour,member,level,key)
        return (member,key),values
    with ThreadPoolExecutor(max_workers=3) as pool:
        fields = dict(pool.map(read,entries))
    return point(run,hour,member_heat_flux(np.stack([fields[m,'v'] for m in range(31)]),np.stack([fields[m,'temperature'] for m in range(31)])))


def prepare_series(prep, manifest, output):
    run=manifest['run']; key=run[:10].replace('-','')+run[11:13]
    root='https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/forecast-data-gefs/'
    def one(hour):
        checkpoint=output/'heat-flux-checkpoints'/f'{key}-{hour}.json'
        if checkpoint.exists():
            p=validate_point(json.loads(checkpoint.read_text()),run,hour)
        elif str(hour) in manifest.get('heatFlux',{}):
            e=manifest['heatFlux'][str(hour)]
            assert e['path']==f'{key}/100/{hour}.heat-flux.json'
            b=prep.request(root+e['path'])
            assert len(b)==e['bytes'] and hashlib.sha256(b).hexdigest()==e['sha256']
            p=validate_point(json.loads(b),run,hour)
        else:
            p=raw_point(prep,run,hour)
        checkpoint.parent.mkdir(parents=True,exist_ok=True)
        checkpoint.write_text(json.dumps(p,separators=(',',':'),allow_nan=False))
        print('HEAT FLUX',run,hour,'31/31 members',flush=True)
        return dict(hour=hour,members=p['members'])
    # At most six NOAA transfers; native decoding remains protected by prep's lock.
    with ThreadPoolExecutor(max_workers=2) as pool:
        points=list(pool.map(one,range(0,385,12)))
    data=dict(version=1,model='gefs',run=run,count=31,complete=True,pressure=100,latitudeBand=[45,75],
              units='K m/s',gridDegrees=1,method=METHOD,source='https://noaa-gefs-pds.s3.amazonaws.com',
              step=12,maxHour=384,preparedAt=datetime.now(timezone.utc).isoformat(),points=points)
    packed=json.dumps(data,separators=(',',':'),allow_nan=False).encode(); digest=hashlib.sha256(packed).hexdigest()
    filename=f'{key}/gefs/heat-flux-{digest}.json'
    target=output/filename;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(packed)
    return dict(path=filename,bytes=len(packed),sha256=digest)
