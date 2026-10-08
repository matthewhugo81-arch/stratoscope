import os,requests,eccodes as ec
from pathlib import Path
key=os.environ['CDSAPI_KEY']
s=requests.Session();s.headers['PRIVATE-TOKEN']=key
for label,jid in [('era5','d57c41a7-0838-47b1-9828-750b678448bd'),('bom','6d923b7f-8da8-41af-907c-670c6a6115dc')]:
 r=s.get('https://cds.climate.copernicus.eu/api/retrieve/v1/jobs/'+jid,timeout=60)
 d=r.json();print(label,r.status_code)
 for k in ['status','message','error','exception']:
  if k in d:print(k,str(d[k]).replace(key,'[redacted]')[:2500])
import cdsapi
from seasonal_config import requests_for
from datetime import datetime,timezone
client=cdsapi.Client(url='https://cds.climate.copernicus.eu/api',key=key)
f=Path('cmcc.grib')
client.retrieve('seasonal-original-pressure-levels',requests_for('cmcc',datetime(2026,9,1,tzinfo=timezone.utc))[0],str(f))
with f.open('rb') as stream:
 g=ec.codes_grib_new_from_file(stream)
 for k in ['centre','centreDescription','origin','systemNumber','shortName','level','gridType','Ni','Nj']:
  try:print(k,ec.codes_get(g,k))
  except:pass
 ec.codes_release(g)
