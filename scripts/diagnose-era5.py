"""Read the status of existing ERA5 requests; never submit or cancel a request."""
import base64
import json
import os
from pathlib import Path
import requests

repo='matthewhugo81-arch/stratoscope'
gh=requests.Session()
gh.headers.update({'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
def github(path):
    r=gh.get('https://api.github.com/repos/'+repo+path,timeout=30)
    r.raise_for_status()
    return r.json()

commit=github('/git/ref/heads/forecast-data-seasonal')['object']['sha']
tree=github('/git/trees/'+commit+'?recursive=1')
assert not tree.get('truncated')
files={entry['path']:entry['sha'] for entry in tree['tree'] if entry['type']=='blob'}
seeds=json.loads(Path('scripts/era5-resume.json').read_text())
cds=requests.Session()
cds.headers['PRIVATE-TOKEN']=os.environ['CDSAPI_KEY']
for year in range(1993,2017):
    if f'checkpoints/era5/{year}.json' in files:
        print(year,'checkpoint complete',flush=True)
        continue
    saved=files.get(f'requests/era5-{year}.json')
    request_id=json.loads(base64.b64decode(github('/git/blobs/'+saved)['content']))['id'] if saved else seeds.get(str(year))
    if not request_id:
        print(year,'not submitted',flush=True)
        continue
    r=cds.get('https://cds.climate.copernicus.eu/api/retrieve/v1/jobs/'+request_id,timeout=60)
    if not r.ok:
        print(year,'status unavailable; HTTP',r.status_code,flush=True)
        continue
    data=r.json()
    print(year,json.dumps({k:data[k] for k in ['status','created','updated','finished'] if k in data}),flush=True)
