"""Retain complete published Stratoscope runs for prospective verification.

Website diagnostics are a distinct source tier from independently decoded GRIB.
Nothing here publishes to Pages or changes production branches.
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen
import numpy as np

ROOT = 'https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/'
MODELS = {'gefs': (31,384), 'ifs_ens': (51,360), 'aifs_ens': (51,360)}

def require(ok, message):
    if not ok: raise ValueError(message)

def sha(blob): return hashlib.sha256(blob).hexdigest()
def utc(text):
    value = datetime.fromisoformat(text.replace('Z','+00:00'))
    require(value.tzinfo is not None and value.utcoffset()==timedelta(0), 'UTC timestamp required')
    return value

def fetch(url):
    with urlopen(Request(url,headers={'User-Agent':'Stratoscope-research-archive'}),timeout=60) as response:
        return response.read()

def validate(d, m, manifest_bytes, now):
    model=d['model']; count,last=MODELS[model]
    require(d['version']==1 and d['complete'] is True and d['level']==10 and d['count']==count and d['maxHour']==last, 'Incomplete diagnostic identity')
    require(m['model']==model and m['run']==d['run'] and m['complete'] is True and m['count']==count and m['maxHour']==last and m['step']==6, 'Catalogue/diagnostic mismatch')
    run=utc(d['run'])
    require(run<=now and run.hour in (0,6,12,18) and not any((run.minute,run.second,run.microsecond)), 'Invalid/future run')
    require(d['inputSha256']==sha(manifest_bytes), 'Diagnostics lag or differ from published catalogue; retry later')
    require(d['windBasis']=='native 60N full longitude circle', 'Unknown wind definition')
    require([p['hour'] for p in d['points']]==list(range(0,last+1,6)), 'Incomplete/duplicate lead sequence')
    require(set(m['panels'])=={str(h) for h in range(0,last+1,6)}, 'Incomplete panel sequence')
    for p in d['points']:
        for variable in ('wind','temperature'):
            values=np.asarray(p[variable],dtype=float)
            require(values.shape==(count,) and np.isfinite(values).all(), 'Missing diagnostic member')
            require((np.abs(values)<200).all(), 'Implausible diagnostic')
        entry=m['panels'][str(p['hour'])]
        require(entry['path']==f"{run:%Y%m%d%H}/10/{p['hour']}.members.bin.gz" and entry['bytes']>0 and re.fullmatch('[a-f0-9]{64}',entry['sha256']), 'Invalid panel receipt')
    return run

def archive(output, diagnostics_bytes, manifest_bytes, now, source_url):
    d=json.loads(diagnostics_bytes); m=json.loads(manifest_bytes)
    run=validate(d,m,manifest_bytes,now)
    # Same-cycle corrections are retained separately. Nothing overwrites a forecast.
    target=output/d['model']/run.strftime('%Y%m%d%H')/sha(diagnostics_bytes)
    target.mkdir(parents=True,exist_ok=True)
    receipt=target/'receipt.json'
    if receipt.exists():
        require((target/'diagnostics.json').read_bytes()==diagnostics_bytes and (target/'catalogue.json').read_bytes()==manifest_bytes, 'Archive integrity failure')
        return json.loads(receipt.read_text()),False
    (target/'diagnostics.json').write_bytes(diagnostics_bytes)
    (target/'catalogue.json').write_bytes(manifest_bytes)
    record=dict(version=1,model=d['model'],run=d['run'],firstSeenAt=now.isoformat(),
        diagnosticsSha256=sha(diagnostics_bytes),catalogueSha256=sha(manifest_bytes),url=source_url,
        sourceClass='ensemble_forecast',verificationTier='published_diagnostics_catalogue_hash_matched',
        nativeGribIndependentlyDecoded=False,count=d['count'],firstLead=0,lastLead=d['maxHour'],cadenceHours=6,
        memberIdentity='publisher array order; no cross-cycle pairing',
        temperatureBasis=d['temperatureBasis'],path=str(target.resolve()))
    receipt.write_text(json.dumps(record,indent=2),encoding='utf-8')
    return record,True

def matched_changes(old,new):
    require(old['model']==new['model'], 'Cannot compare different models as run changes')
    require(utc(old['run'])<utc(new['run']), 'Previous run must precede current')
    previous={utc(old['run'])+timedelta(hours=p['hour']):p for p in old['points']}
    rows=[]
    for p in new['points']:
        valid=utc(new['run'])+timedelta(hours=p['hour'])
        if valid in previous:
            rows.append(dict(validTime=valid.isoformat(),meanWindChange=float(np.mean(p['wind'])-np.mean(previous[valid]['wind'])),units='m/s'))
    return rows

def continuous_score(members, truth):
    x=np.asarray(members,dtype=float)
    require(x.ndim==1 and len(x)>0 and np.isfinite(x).all() and np.isfinite(truth), 'Finite complete score inputs required')
    return dict(meanError=float(x.mean()-truth),absoluteError=float(abs(x.mean()-truth)),
        squaredError=float((x.mean()-truth)**2),
        crps=float(np.mean(abs(x-truth))-.5*np.mean(abs(x[:,None]-x[None,:]))))

def verify_wind(d, receipt, truth):
    """Score only forecasts captured BEFORE valid time against supplied reanalysis.

    First-seen is deliberately conservative: a late archive cannot demonstrate
    operational predictive skill, even when its nominal initialization is earlier.
    """
    require(receipt['model']==d['model'] and utc(receipt['run'])==utc(d['run']), 'Forecast receipt mismatch')
    require(truth['sourceClass']=='reanalysis' and truth['variable']=='u10_60N' and truth['units']=='m/s', 'Independent reanalysis wind required')
    require(truth['dataset']=='reanalysis-era5-complete' and re.fullmatch('[a-f0-9]{64}',truth['inputSha256']), 'Reanalysis provenance required')
    records={utc(p['validTime']):p for p in truth['points']}
    require(len(records)==len(truth['points']), 'Duplicate verifying times')
    rows=[]
    for p in d['points']:
        valid=utc(d['run'])+timedelta(hours=p['hour'])
        match=records.get(valid)
        if match is None or valid<=utc(receipt['firstSeenAt']): continue
        require(str(match['expver']) in ('1','5'), 'Unknown ERA5 version')
        rows.append(dict(model=d['model'],run=d['run'],validTime=valid.isoformat(),leadHours=p['hour'],
            expver=str(match['expver']),preliminary=str(match['expver'])=='5',
            **continuous_score(p['wind'],match['value'])))
    return dict(version=1,variable='u10_60N',units='m/s',truthSha256=truth['inputSha256'],
        scores=rows,skillClaim=False,note='Individual errors/CRPS only; skill needs independent cases and reference forecasts')

def collect(output):
    now=datetime.now(timezone.utc); records=[]; errors=[]
    for model in MODELS:
        url=ROOT+'forecast-data-diagnostics/'+model+'.json'
        try:
            db=fetch(url); mb=fetch(ROOT+'forecast-data-'+model.replace('_','-')+'/latest.json')
            rec,new=archive(output,db,mb,datetime.now(timezone.utc),url)
            prior=[]
            for path in (output/model).glob('*/*/receipt.json'):
                r=json.loads(path.read_text())
                require(utc(r['run'])<=utc(rec['run']), 'Published cycle regressed behind retained archive; do not downgrade')
                if utc(r['run'])<utc(rec['run']): prior.append((utc(r['run']),utc(r['firstSeenAt']),path))
            if prior:
                previous=max(prior)[2]
                changes=matched_changes(json.loads(previous.with_name('diagnostics.json').read_text()),json.loads(db))
            else: changes=[]
            records.append(dict(**rec,newlyArchived=new,matchedRunChanges=changes))
        except Exception as error:
            errors.append(dict(model=model,error=str(error),status='not_admitted'))
    result=dict(version=1,checkedAt=now.isoformat(),runs=records,errors=errors,
        scope='Published full-horizon ensemble U10 and cap temperature; native PV/H500/heat-flux acquisition remains separately qualified')
    output.mkdir(parents=True,exist_ok=True)
    tmp=output/'latest-check.json.tmp';tmp.write_text(json.dumps(result,indent=2),encoding='utf-8');tmp.replace(output/'latest-check.json')
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__); p.add_argument('--output',type=Path,required=True)
    a=p.parse_args(); result=collect(a.output)
    print(json.dumps(dict(runs=[{k:r[k] for k in ('model','run','newlyArchived','lastLead')} for r in result['runs']],errors=result['errors']),indent=2))
    if result['errors']: raise SystemExit(1)
