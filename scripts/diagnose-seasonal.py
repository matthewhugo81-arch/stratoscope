import os,requests,eccodes as ec
from pathlib import Path
key=os.environ['CDSAPI_KEY']
s=requests.Session();s.headers['PRIVATE-TOKEN']=key
for label,jid in [('era5','d57c41a7-0838-47b1-9828-750b678448bd'),('bom','6d923b7f-8da8-41af-907c-670c6a6115dc')]:
 r=s.get('https://cds.climate.copernicus.eu/api/retrieve/v1/jobs/'+jid,timeout=60)
 d=r.json();print(label,r.status_code,'keys',list(d));
 r2=s.get('https://cds.climate.copernicus.eu/api/retrieve/v1/jobs/'+jid+'/results',timeout=60);print('result',r2.status_code,r2.text.replace(key,'[redacted]')[:2500])
 for k in ['status','message','error','exception']:
  if k in d:print(k,str(d[k]).replace(key,'[redacted]')[:2500])
