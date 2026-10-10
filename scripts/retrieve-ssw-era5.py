"""Secret-backed, resumable ERA5 case retrieval. Never publishes forecast data."""
import argparse
from datetime import date
import importlib.util
import json
import os
from pathlib import Path
from ssw_era5_requests import requests

def find_existing(client, wanted):
    """Exhaust the job catalogue before submitting; fail closed on lookup errors."""
    found={}; jobs=client.get_jobs(sortby='-created');seen=0
    while jobs is not None:
        for request_id in jobs.request_ids:
            seen+=1
            if seen>2000:raise ValueError('Job catalogue too large; supply verified request checkpoint instead')
            remote=client.get_remote(request_id)
            if remote.collection_id!='reanalysis-era5-complete':continue
            for name,entry in wanted.items():
                if remote.request==entry['request'] and name not in found:
                    if remote.status in ('failed','dismissed','deleted'):
                        raise ValueError('Matching request is not reusable; investigate before explicit resubmission')
                    found[name]=dict(id=remote.request_id,**entry)
        jobs=jobs.next
    return found

def submit(client, end, output):
    wanted=requests(end); output.mkdir(parents=True,exist_ok=True); checkpoint=output/'requests.json'
    saved=json.loads(checkpoint.read_text()) if checkpoint.exists() else find_existing(client,wanted)
    for name,entry in wanted.items():
        if name in saved:
            if saved[name]['dataset']!=entry['dataset'] or saved[name]['request']!=entry['request']:
                raise ValueError('Checkpoint differs from requested case')
            remote=client.get_remote(saved[name]['id'])
            if remote.collection_id!=entry['dataset'] or remote.request!=entry['request']:
                raise ValueError('Remote identity mismatch')
        else:
            remote=client.submit(collection_id=entry['dataset'],request=entry['request'])
            saved[name]=dict(id=remote.request_id,**entry)
        checkpoint.write_text(json.dumps(saved,indent=2),encoding='utf-8')
        print(name,remote.request_id,remote.status,flush=True)
    return saved

def download(client,end,output):
    saved=json.loads((output/'requests.json').read_text());parts=[];statuses={}
    for name,entry in requests(end).items():
        record=saved[name]
        if record['dataset']!=entry['dataset'] or record['request']!=entry['request']:raise ValueError('Checkpoint mismatch')
        remote=client.get_remote(record['id'])
        if remote.collection_id!=entry['dataset'] or remote.request!=entry['request']:raise ValueError('Remote identity mismatch')
        status=remote.status;statuses[name]=dict(id=record['id'],status=status)
        if status in ('failed','dismissed','deleted'):raise ValueError(f'{name} request is {status}; investigate before resubmission')
        if status!='successful':continue
        target=output/(name+'.grib');remote.download(str(target));parts.append(target)
    state=dict(endDate=end.isoformat(),status='ready_to_validate' if len(parts)==len(saved) else 'pending',requests=statuses)
    (output/'case-status.json').write_text(json.dumps(state,indent=2),encoding='utf-8')
    if state['status']=='pending':
        print('ERA5 case pending; completed downloads and accepted IDs retained. Resume on a later check.',flush=True)
        return state
    combined=output/'combined.grib'
    with combined.open('wb') as handle:
        for part in parts:
            with part.open('rb') as source:
                import shutil
                shutil.copyfileobj(source,handle)
    request=output/'combined.request.json'
    request.write_text(json.dumps(dict(dataset='reanalysis-era5-complete',request=dict(parts=list(saved.values()))),indent=2),encoding='utf-8')
    spec=importlib.util.spec_from_file_location('era5_import',Path(__file__).with_name('import-ssw-reanalysis.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    module.import_history(combined,request,output/'validated',end,20,(315,330,350))
    state['status']='validated'
    (output/'case-status.json').write_text(json.dumps(state,indent=2),encoding='utf-8')
    print('Validated independent ERA5 case',end,flush=True)
    return state

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--phase',choices=['submit','download'],required=True)
    p.add_argument('--end-date',type=date.fromisoformat,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    import cdsapi
    client=cdsapi.Client(url='https://cds.climate.copernicus.eu/api',key=os.environ['CDSAPI_KEY'],quiet=True,debug=False,timeout=60).client
    try:(submit if a.phase=='submit' else download)(client,a.end_date,a.output)
    except Exception as error:
        # Provider error bodies can contain request URLs; never print credentials.
        print('ERA5 case operation failed:',type(error).__name__,flush=True)
        if isinstance(error,ValueError):print(str(error),flush=True)
        raise SystemExit(1)
