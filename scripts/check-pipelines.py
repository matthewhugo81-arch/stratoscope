"""Small independent freshness audit. No raw fields, CDS requests or paid services.

Compare terminal provider inventories with complete published catalogues. Recovery
dispatches only idle workflows; partial data never becomes the public latest run.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
import http.client
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

REPO = 'matthewhugo81-arch/stratoscope'
RAW = f'https://raw.githubusercontent.com/{REPO}/'
MODELS = ['gfs', 'ecmwf_direct', 'gefs', 'ifs_ens', 'aifs_ens', 'icon']
WORKFLOWS = {'gefs':'prepare-gefs.yml', 'ifs_ens':'prepare-ensembles.yml',
             'aifs_ens':'prepare-ensembles.yml', 'icon':'prepare-icon.yml',
             'diagnostics':'prepare-diagnostics.yml', 'vortex':'prepare-vortex.yml',
             'era5':'prepare-era5.yml'}
ACTIVE = {'queued', 'in_progress', 'waiting', 'pending', 'requested'}
TRANSIENT_HTTP = {408, 429, 500, 502, 503, 504}

def stamp(d):
    return d.isoformat(timespec='milliseconds').replace('+00:00', 'Z')

def fetch(url, headers=None, timeout=25, attempts=3):
    """Retry idempotent reads only. Missing files and invalid data fail promptly."""
    request_headers = {'User-Agent':'Stratoscope-pipeline-health', **(headers or {})}
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers=request_headers)
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.IncompleteRead) as error:
            if isinstance(error, urllib.error.HTTPError) and error.code not in TRANSIENT_HTTP:
                raise
            if attempt == attempts - 1:
                raise
            delay = 2 ** attempt
            if isinstance(error, urllib.error.HTTPError):
                if error.code in {429, 503}:
                    delay = 60 * 2 ** attempt
                value = error.headers.get('Retry-After', '') if error.headers else ''
                try:
                    requested = float(value)
                except ValueError:
                    try:
                        requested = (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds()
                    except (TypeError, ValueError, OverflowError):
                        requested = 0
                # Do not retry earlier than the server asks, or exceed the audit's
                # bounded execution budget. The next scheduled audit can retry.
                if not math.isfinite(requested) or requested > 120:
                    raise
                delay = max(delay, requested)
                error.close()
            print(f'Retrying read after {delay:g}s: {error_description(error)}', flush=True)
            time.sleep(delay)

def error_description(error):
    detail = f'{type(error).__name__}: {str(error)[:180]}'
    if isinstance(error, urllib.error.HTTPError):
        url = urllib.parse.urlsplit(error.filename or '')
        detail += f' [{url.netloc}{url.path}]'
    return detail

def public(branch, file='latest.json'):
    return json.loads(fetch(RAW+branch+'/'+file))

def github(endpoint, payload=None):
    token = os.environ['GH_TOKEN']
    url = 'https://api.github.com/repos/'+REPO+endpoint
    headers = {'Authorization':'Bearer '+token, 'Accept':'application/vnd.github+json',
               'User-Agent':'Stratoscope-pipeline-health'}
    if payload is None:
        body = fetch(url, headers=headers, timeout=30)
    else:
        # Never automatically retry a dispatch POST: a lost response may still
        # mean the workflow was created. Recovery/cooldown will check next time.
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers)
        with urllib.request.urlopen(req, timeout=30) as response:
            body = response.read()
    return json.loads(body) if body else None

def preparation():
    spec=importlib.util.spec_from_file_location('ensemble_preparation',Path(__file__).with_name('prepare-ensembles.py'))
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    return mod

def direct_latest(model, now):
    interval=6 if model=='gfs' else 12
    start=datetime.fromtimestamp(int(now.timestamp())//(interval*3600)*(interval*3600),timezone.utc)
    for back in range(5):
        run=start-timedelta(hours=interval*back);day=run.strftime('%Y%m%d');cycle=run.strftime('%H')
        try:
            if model=='gfs':
                base=f'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{day}/{cycle}/atmos/gfs.t{cycle}z.pgrb2.1p00.f240.idx'
                entries=[line.split(':') for line in fetch(base).decode().splitlines()]
                assert all(any(p[3]==field and p[4]==f'{level} mb' for p in entries) for level in [10,20,30,50,70,100] for field in ['TMP','HGT','UGRD','VGRD'])
            elif model=='ecmwf_direct':
                base=f'https://data.ecmwf.int/forecasts/{day}/{cycle}z/ifs/0p25/oper/{day}{cycle}0000-240h-oper-fc.index'
                entries=[json.loads(line) for line in fetch(base).decode().splitlines()]
                assert all(any(p.get('levtype')=='pl' and str(p.get('levelist'))==str(level) and p['param']==field and p['date']==day and int(p['step'])==240 for p in entries) for level in [10,50,100] for field in ['t','gh','u','v'])
            else:
                for field in ['t','fi','u','v']:
                    listing=fetch(f'https://opendata.dwd.de/weather/nwp/icon/grib/{cycle}/{field}/').decode()
                    names=set(re.findall(r'href="([^"]+)"',listing))
                    assert all(f'icon_global_icosahedral_pressure-level_{day}{cycle}_{h:03}_{level}_{field.upper()}.grib2.bz2' in names for h in range(0,181,6) for level in [30,50,70,100])
            return stamp(run)
        except urllib.error.HTTPError as error:
            # A service outage is not evidence that a newer model run is absent.
            if error.code not in {404, 410}:
                raise
        except AssertionError:
            continue
    raise ValueError('No complete provider inventory available')

def validate_catalogue(model, m):
    count,last,levels=(31,384,[10,20,30,50,70,100]) if model=='gefs' else (51,360,[10,50,100])
    if model=='icon':count,last,levels=None,180,[30,50,70,100]
    assert m['model']==model and m['complete'] is True and m['maxHour']==last and m['step']==6 and m['levels']==levels
    if count:assert m['count']==count
    key=datetime.fromisoformat(m['run'].replace('Z','+00:00')).strftime('%Y%m%d%H')
    assert len(m['files'])==len(levels)*(last//6+1)
    for level in levels:
        for hour in range(0,last+1,6):
            e=m['files'][f'{level}/{hour}']
            assert e['path'].startswith(f'{key}/{level}/{hour}.') and e['bytes']>0 and re.fullmatch('[a-f0-9]{64}',e['sha256'])
    if count:
        assert len(m['panels'])==last//6+1
        for hour in range(0,last+1,6):
            e=m['panels'][str(hour)]
            assert e['path']==f'{key}/10/{hour}.members.bin.gz' and e['bytes']>0 and re.fullmatch('[a-f0-9]{64}',e['sha256'])

def audit(model, now, prep):
    """Validate publication independently of provider reachability.

A transient source failure must not erase the valid run/frames already served,
nor make the derived diagnostics disappear from the audit. An unverified source
still reports error, never current, and keeps the audit non-zero.
"""
    result = dict(model=model)
    prepared = model not in ['gfs', 'ecmwf_direct']
    if prepared:
        try:
            manifest = public('forecast-data-'+model.replace('_','-'))
            validate_catalogue(model, manifest)
            result.update(publishedRun=manifest['run'], preparedAt=manifest['preparedAt'],
                          frames=len(manifest['files']), catalogueStatus='valid')
        except Exception as error:
            result.update(catalogueStatus='error', catalogueError=error_description(error))
    try:
        available = stamp(prep.discover(model,now)) if model in prep.CONFIG else direct_latest(model,now)
        result.update(availableRun=available, sourceStatus='verified')
    except Exception as error:
        result.update(status='error', sourceStatus='unavailable', failureStage='provider',
                      message=error_description(error))
        return result
    if prepared and result.get('catalogueStatus') != 'valid':
        result.update(status='error', failureStage='catalogue', message=result['catalogueError'])
    elif not prepared:
        result.update(status='direct', message='Browser reads the newest complete provider run')
    else:
        published = datetime.fromisoformat(result['publishedRun'].replace('Z','+00:00'))
        latest = datetime.fromisoformat(available.replace('Z','+00:00'))
        result.update(status='current' if published >= latest else 'behind',
                      lagHours=max(0, (latest-published).total_seconds()/3600))
    return result

def matching_jobs(model, run, active_only=True):
    if model not in ['ifs_ens','aifs_ens']:
        return run['status'] in ACTIVE if active_only else True
    jobs=github(f"/actions/runs/{run['id']}/jobs")['jobs']
    if not jobs:
        return run['status'] in ACTIVE  # A dispatch has not expanded its matrix yet.
    return any(job['name']==f'prepare ({model})' and
               (job['status'] in ACTIVE if active_only else job.get('conclusion')!='skipped')
               for job in jobs)

def recovery(model, recover, now):
    workflow=WORKFLOWS[model]
    # A long preparation can be older than the last twelve scheduled dispatches.
    runs=github('/actions/workflows/'+workflow+'/runs?per_page=100&branch=main')['workflow_runs']
    if model=='era5':
        # The older seasonal workflow can also prepare ERA5. Never overlap it.
        legacy=github('/actions/workflows/prepare-seasonal.yml/runs?per_page=100&branch=main')['workflow_runs']
        for run in legacy:
            if run['status'] not in ACTIVE:continue
            jobs=github(f"/actions/runs/{run['id']}/jobs")['jobs']
            if not jobs or any(j['name']=='prepare (era5)' and j['status'] in ACTIVE for j in jobs):
                return 'updating',run['html_url']
    for run in runs:
        if run['status'] in ACTIVE and matching_jobs(model,run):
            return 'updating',run['html_url']
    # Apply cooldown to this model, not a different member of the shared matrix.
    # Measure completed attempts from completion/update, not their start time.
    recent=next((r for r in runs if
        (now-datetime.fromisoformat(r.get('updated_at',r['created_at']).replace('Z','+00:00'))).total_seconds()<900
        and matching_jobs(model,r,active_only=False)),None)
    if recent:return 'behind',recent['html_url']
    if recover:
        payload={'ref':'main'}
        if model in ['ifs_ens','aifs_ens']:payload['inputs']={'model':model}
        github('/actions/workflows/'+workflow+'/dispatches',payload)
        return 'updating',f'https://github.com/{REPO}/actions/workflows/{workflow}'
    return 'behind',f'https://github.com/{REPO}/actions/workflows/{workflow}'

def era_reference(recover, now):
    """Report saved years and recover an idle import without submitting CDS jobs."""
    result=dict(period=[1993,2016],totalYears=24,status='error')
    try:
        # Read one immutable snapshot so progress and final validation agree.
        commit=github('/git/ref/heads/forecast-data-seasonal')['object']['sha']
        tree=github('/git/trees/'+commit+'?recursive=1')
        if tree.get('truncated'):raise ValueError('Incomplete data inventory')
        paths={p['path'] for p in tree['tree'] if p['type']=='blob'}
        years=[y for y in range(1993,2017) if f'checkpoints/era5/{y}.json' in paths]
        result['completedYears']=years
        final='climate/era5-1993-2016.json'
        if final in paths:
            data=public(commit,final)
            assert data['version']==2 and data['complete'] is True and data['period']==[1993,2016]
            assert data['latitude']==60 and data['level']==10 and data['units']=='m/s'
            assert data['source']=='https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels'
            expected={(datetime(2000,1,1)+timedelta(days=i)).strftime('%m-%d') for i in range(366)}
            assert set(data['daily'])==expected and set(data['counts'])==expected
            assert all(type(v) in (int,float) and math.isfinite(v) and abs(v)<200 for v in data['daily'].values())
            assert all(data['counts'][d]==(6 if d=='02-29' else 24) for d in expected)
            result['status']='complete'
        else:
            result['nextYear']=next((y for y in range(1993,2017) if y not in years),None)
            result['status'],result['workflowUrl']=recovery('era5',recover,now)
    except Exception:
        result['status']='error'
    return result

def derived(results):
    out=[]
    for model in ['gefs','ifs_ens','aifs_ens']:
        expected=next((d.get('publishedRun') for d in results if d['model']==model),None)
        if not expected:continue
        try:
            d=public('forecast-data-diagnostics',model+'.json')
            current=d.get('complete') is True and d['run']==expected
            out.append(dict(model='diagnostics',sourceModel=model,status='current' if current else 'behind',publishedRun=d.get('run'),availableRun=expected))
        except Exception:out.append(dict(model='diagnostics',sourceModel=model,status='behind',availableRun=expected))
    try:
        v=public('forecast-data-vortex');expected=next(d['publishedRun'] for d in results if d['model']=='gefs')
        context_hours=v.get('contextHours',[])
        context_complete=v.get('contextComplete') is True and len(context_hours)==33 and set(context_hours)==set(range(0,385,12))
        heat=v.get('heatFlux',{})
        key=v['run'][:10].replace('-','')+v['run'][11:13]
        heat_complete=bool(re.fullmatch(r'[a-f0-9]{64}',heat.get('sha256',''))) and heat.get('path')==f"{key}/gefs/heat-flux-{heat.get('sha256')}.json" and 0<heat.get('bytes',0)<100000
        current=v['run']==expected and v['timelineComplete'] and v['count']==31 and len(v['files'])==33 and context_complete and heat_complete
        out.append(dict(model='vortex',status='current' if current else 'behind',publishedRun=v['run'],availableRun=expected,frames=len(v['files']),anomalyFrames=len(context_hours)))
    except Exception:out.append(dict(model='vortex',status='error'))
    return out

def publish(data):
    root=Path('work/pipeline-status');root.mkdir(parents=True,exist_ok=True)
    def git(*args):return subprocess.check_output(['git',*args],cwd=root,text=True).strip()
    git('init','-b','forecast-status');git('remote','add','origin',f'https://github.com/{REPO}.git')
    old=git('ls-remote','origin','refs/heads/forecast-status');sha=old.split()[0] if old else ''
    (root/'latest.json').write_text(json.dumps(data,separators=(',',':')),encoding='utf8')
    git('config','user.name','github-actions[bot]');git('config','user.email','41898282+github-actions[bot]@users.noreply.github.com')
    git('add','latest.json');git('commit','-m','Forecast pipeline health check')
    git('push',f'--force-with-lease=refs/heads/forecast-status:{sha}','origin','HEAD:refs/heads/forecast-status')

def recover_results(results, recover, now):
    recovered={}
    for result in results:
        if result['status']!='behind':continue
        model=result['model']
        if model not in recovered:
            try:
                recovered[model]=recovery(model,recover,now)
            except Exception as error:
                recovered[model]=error
        outcome=recovered[model]
        if isinstance(outcome, Exception):
            result.update(status='error', failureStage='recovery', message=error_description(outcome))
        else:
            result['status'],result['workflowUrl']=outcome

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--recover',action='store_true');parser.add_argument('--publish',action='store_true');args=parser.parse_args()
    assert os.environ.get('GITHUB_REPOSITORY',REPO)==REPO
    now=datetime.now(timezone.utc);prep=preparation()
    spec=importlib.util.spec_from_file_location('pipeline_freshness',Path(__file__).with_name('pipeline_freshness.py'))
    health=importlib.util.module_from_spec(spec);spec.loader.exec_module(health)
    try:previous=public('forecast-status')
    except Exception:previous=None
    with ThreadPoolExecutor(max_workers=6) as pool:results=list(pool.map(lambda m:audit(m,now,prep),MODELS))
    results+=derived(results)
    if os.environ.get('GH_TOKEN'):
        recover_results(results,args.recover,now)
    health.record_health(results,previous,now,github if os.environ.get('GH_TOKEN') else None,WORKFLOWS)
    seasonal=health.seasonal_health(public,now)
    reference=era_reference(args.recover,now) if os.environ.get('GH_TOKEN') else None
    data=dict(version=1,checkedAt=stamp(datetime.now(timezone.utc)),models=results,era5=reference,seasonal=seasonal,scheduledIntervalHours=3)
    last=health.parsed(previous.get('checkedAt')) if isinstance(previous,dict) else None
    if last:data['previousCheckGapMinutes']=round(max(0,(now-last).total_seconds()/60),1)
    print(json.dumps(data,indent=2),flush=True)
    if args.publish:publish(data)
    if any(d['status']=='error' for d in results+seasonal) or reference and reference['status']=='error':raise SystemExit(1)

if __name__=='__main__':main()
