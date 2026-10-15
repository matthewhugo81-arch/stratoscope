"""Derive small NH diagnostic series from already published member panels.

No fresh model/CDS downloads: verify the existing panel hashes, then average
temperature with spherical latitude-band areas. Wind is the stored native-grid
60N signed zonal mean. Only complete ensembles and timelines are published.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import subprocess
import time
import urllib.request

ROOT = 'https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/'
MODELS = {'gefs': (31, 384), 'ifs_ens': (51, 360), 'aifs_ens': (51, 360)}

def snapshot_base(branch):
    """Resolve the Git ref, then read only that immutable published snapshot.

    Raw branch URLs can still serve the preceding catalogue immediately after
    publication, even with a unique query string and Cache-Control: no-cache.
    Git's ref advertisement and a commit URL avoid accepting that stale copy.
    """
    assert branch in {'forecast-data-gefs', 'forecast-data-ifs-ens',
                      'forecast-data-aifs-ens', 'forecast-data-diagnostics'}
    ref = 'refs/heads/' + branch
    advertised = subprocess.check_output(
        ['git', 'ls-remote', 'https://github.com/matthewhugo81-arch/stratoscope.git', ref],
        text=True, timeout=45).strip().split()
    if len(advertised) != 2 or advertised[1] != ref or not re.fullmatch(r'[a-f0-9]{40}', advertised[0]):
        raise ValueError('Could not resolve the published snapshot for ' + branch)
    return ROOT + advertised[0] + '/', advertised[0]

def fetch(url, fresh=False):
    # Completion-triggered jobs must not mistake a CDN-cached previous
    # catalogue for the model snapshot that has just been published.
    if fresh:
        url += ('&' if '?' in url else '?') + '_fresh=' + str(time.time_ns())
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache'} if fresh else {})
    with urllib.request.urlopen(request, timeout=60) as r:
        return r.read()

def cap_weights(step=2):
    # Clip each latitude-centred cell to the requested 60–90N cap, including
    # half cells at the pole and the 60N boundary. Longitude cells are equal.
    return [math.sin(math.radians(min(90, 90-y*step+step/2))) -
            math.sin(math.radians(max(60, 90-y*step-step/2)))
            for y in range(int(30/step)+1)]

def decode_panel(packed, model, run, hour):
    b = gzip.decompress(packed)
    assert b[:8] == b'STRATP01'
    length = struct.unpack_from('<I', b, 8)[0]
    assert 0 < length < 8192
    h = json.loads(b[12:12+length])
    count, _ = MODELS[model]
    assert all(h[k] == v for k,v in dict(version=1,model=model,run=run,hour=hour,level=10,count=count,scale=100,planes=3).items())
    assert h['grid'] == dict(nx=180,ny=46,lat0=90,lon0=0,dx=2,dy=-2)
    assert h['source'] == ('https://noaa-gefs-pds.s3.amazonaws.com' if model=='gefs' else 'https://data.ecmwf.int/forecasts')
    assert h['samples'] == (720 if model=='gefs' else 1440)
    assert len(b) == 12+length+count*3*46*180*4
    assert len(h['zonal']) == count and all(math.isfinite(v) and abs(v)<200 for v in h['zonal'])
    weights = cap_weights()
    temperature = []
    for member in range(count):
        offset = 12+length+member*3*46*180*4
        total = 0
        for y,w in enumerate(weights):
            value = 0
            row = 0
            for x in range(180):
                value += struct.unpack_from('<i',b,offset+(y*180+x)*4)[0]
                assert -15000 <= value <= 10000
                row += value/100
            total += row/180*w
        temperature.append(round(total/sum(weights),4))
    return {'hour':hour,'wind':h['zonal'],'temperature':temperature}

def validate_manifest(m, model):
    count, last = MODELS[model]
    assert m['model']==model and m['complete'] is True and m['count']==count and m['maxHour']==last and m['step']==6
    run = datetime.fromisoformat(m['run'].replace('Z','+00:00'))
    assert run.tzinfo and run.hour in [0,6,12,18] and run.minute==0
    key=run.strftime('%Y%m%d%H')
    for hour in range(0,last+1,6):
        e=m['panels'][str(hour)]
        assert e['path']==f'{key}/10/{hour}.members.bin.gz' and 0<e['bytes']<8000000 and len(e['sha256'])==64
    return run

def prepare(model, output):
    base, commit=snapshot_base('forecast-data-'+model.replace('_','-'))
    manifest_bytes=fetch(base+'latest.json')
    m=json.loads(manifest_bytes); run=validate_manifest(m,model)
    fingerprint=hashlib.sha256(manifest_bytes).hexdigest()
    try:
        previous=json.loads(fetch(ROOT+'forecast-data-diagnostics/'+model+'.json', fresh=True))
        if (previous.get('inputSha256')==fingerprint and previous.get('complete') is True
                and previous.get('model')==model and previous.get('run')==m['run']):
            print('UNCHANGED',model,m['run'],flush=True);return
    except urllib.error.HTTPError as e:
        if e.code!=404: raise
    def one(hour):
        e=m['panels'][str(hour)]; packed=fetch(base+e['path']+'?sha='+e['sha256'])
        assert len(packed)==e['bytes'] and hashlib.sha256(packed).hexdigest()==e['sha256'], 'Panel integrity failure'
        return decode_panel(packed,model,m['run'],hour)
    with ThreadPoolExecutor(max_workers=4) as pool:
        points=list(pool.map(one,range(0,MODELS[model][1]+1,6)))
    data=dict(version=1,model=model,run=m['run'],level=10,count=MODELS[model][0],maxHour=MODELS[model][1],complete=True,inputSha256=fingerprint,inputCommit=commit,
              preparedAt=datetime.now(timezone.utc).isoformat(),source=m['panels']['0']['path'],windBasis='native 60N full longitude circle',temperatureBasis='area-weighted 2 degree display grid, 60–90N',points=points)
    output.mkdir(parents=True,exist_ok=True)
    (output/(model+'.json')).write_text(json.dumps(data,separators=(',',':'),allow_nan=False))
    print('COMPLETE',model,m['run'],len(points),flush=True)

def prepare_models(models, output):
    failed=[]
    for model in models:
        try:prepare(model,output)
        except Exception as error:
            failed.append(model)
            print('FAILED',model,type(error).__name__,str(error),flush=True)
    return failed


def verify_publication(output):
    files=list(output.glob('*.json'))
    if not files:return
    base, _=snapshot_base('forecast-data-diagnostics')
    for file in files:
        expected=json.loads(file.read_text())
        actual=json.loads(fetch(base+file.name))
        if actual != expected:
            raise ValueError('Published diagnostics do not match the verified output: '+file.name)
        print('VERIFIED',actual['model'],actual['run'],flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--model',choices=MODELS);p.add_argument('--verify-published',action='store_true');a=p.parse_args()
    if a.verify_published:verify_publication(a.output)
    elif prepare_models([a.model] if a.model else MODELS,a.output):raise SystemExit(1)
