"""Validate and publish compact seasonal series; resume historical work per year."""
import argparse,calendar,json,os,subprocess,sys,time
from pathlib import Path
from datetime import datetime,timedelta,timezone
import numpy as np
import eccodes as ec
from seasonal_config import *
BRANCH='forecast-data-seasonal';ROOT=Path('work/seasonal-publish')
def git(*args,check=True):
 return subprocess.run(['git',*args],cwd=ROOT,check=check,capture_output=True,text=True)
def setup():
 assert os.environ['GITHUB_REPOSITORY']=='matthewhugo81-arch/stratoscope'
 assert os.environ.get('GITHUB_REPOSITORY_VISIBILITY')=='public'
 ROOT.mkdir(parents=True,exist_ok=False)
 git('init','-b',BRANCH);git('remote','add','origin','https://github.com/matthewhugo81-arch/stratoscope.git')
 git('config','user.name','github-actions[bot]');git('config','user.email','41898282+github-actions[bot]@users.noreply.github.com')
 if git('ls-remote','--exit-code','origin','refs/heads/'+BRANCH,check=False).returncode==0:
  git('fetch','--depth=1','origin',BRANCH);git('checkout','-B',BRANCH,'FETCH_HEAD')
def publish(name,data):
 target=ROOT/name;target.parent.mkdir(parents=True,exist_ok=True)
 raw=json.dumps(data,separators=(',',':'),allow_nan=False)
 if len(raw)>2_000_000:raise ValueError('Compact file exceeds 2MB limit')
 target.write_text(raw,encoding='utf-8');git('add','--',name)
 if git('diff','--cached','--quiet',check=False).returncode==0:return
 git('commit','-m','Prepare seasonal data '+name)
 for attempt in range(8):
  if git('push','origin','HEAD:refs/heads/'+BRANCH,check=False).returncode==0:
   print('Published',name,len(raw),'bytes',flush=True);return
  git('fetch','origin',BRANCH);git('rebase','FETCH_HEAD');time.sleep(2)
 raise ValueError('Concurrent publication did not settle; no history overwritten')
def load(name):
 p=ROOT/name
 return json.loads(p.read_text()) if p.exists() else None
def zonal_mean(lat,lon,values):
 lat,lon,values=(np.asarray(a,dtype=float) for a in (lat,lon,values))
 if not(lat.ndim==1 and lat.shape==lon.shape==values.shape and all(np.isfinite(a).all() for a in (lat,lon,values)) and np.all(np.abs(values)<300)):raise ValueError('Invalid wind field')
 rows=np.unique(lat);lower=rows[rows<=60];upper=rows[rows>=60]
 if not len(lower) or not len(upper):raise ValueError('Latitude does not bracket 60N')
 lo,hi=lower[-1],upper[0]
 if hi-lo>1.251:raise ValueError('Unsupported latitude spacing')
 means=[]
 for row in [lo,hi]:
  mask=np.isclose(lat,row,atol=1e-6);x=lon[mask]%360;v=values[mask];order=np.argsort(x);x=x[order];v=v[order]
  dup=np.where(np.diff(x)<1e-5)[0]
  if len(dup)==1:
   k=int(dup[0])
   if abs(v[k]-v[k+1])>1e-5:raise ValueError('Conflicting longitude seam')
   x=np.delete(x,k);v=np.delete(v,k)
  if len(x) not in [288,360,1440]:raise ValueError('Unsupported longitude grid')
  step=360/len(x)
  if not np.allclose(np.diff(np.r_[x,x[0]+360]),step,atol=1e-4):raise ValueError('Incomplete longitude circle')
  means.append(float(v.mean()))
 return means[0] if lo==hi else means[0]+(means[1]-means[0])*(60-lo)/(hi-lo)
def read_grib(file,model=None):
 with file.open('rb') as f:
  while (g:=ec.codes_grib_new_from_file(f)) is not None:
   try:
    get=lambda k:ec.codes_get(g,k)
    if not(get('shortName')=='u' and get('level')==10 and get('typeOfLevel')=='isobaricInhPa' and get('units')=='m s**-1' and get('gridType')=='regular_ll' and get('bitmapPresent')==0 and get('stepType')=='instant'):raise ValueError('Unexpected GRIB field, units or grid')
    if model and (get('centre')!=model or str(get('systemNumber'))!=MODELS[model]['system']):raise ValueError('Unexpected model or system')
    if not model and get('centre')!='ecmf':raise ValueError('Unexpected ERA5 centre')
    stamp=lambda a,b:datetime.strptime(f'{get(a):08}{get(b):04}','%Y%m%d%H%M').replace(tzinfo=timezone.utc)
    start=stamp('dataDate','dataTime');valid=stamp('validityDate','validityTime')
    if model and (start.hour!=0 or start.minute or valid.hour not in [0,12] or valid.minute):raise ValueError('Unexpected initialization or valid hour')
    value=zonal_mean(ec.codes_get_array(g,'latitudes'),ec.codes_get_array(g,'longitudes'),ec.codes_get_values(g))
    yield start,int(get('number')) if model else 0,valid,value
   finally:ec.codes_release(g)
def ensemble(records,model,nominal,hindcast=False):
 cfg=MODELS[model];starts=set(starts_for(model,nominal,hindcast));dates=[nominal+HALF*(i+1) for i in range(STEPS)];indices={d:i for i,d in enumerate(dates)};series={}
 for start,member,valid,value in records:
  if start not in starts or member<0:raise ValueError('Unexpected ensemble start or member')
  if valid not in indices:continue
  if not np.isfinite(value) or abs(value)>=200:raise ValueError('Invalid zonal mean')
  key=(start,member);values=series.setdefault(key,[None]*STEPS);i=indices[valid]
  if values[i] is not None:raise ValueError('Duplicate member/time field')
  values[i]=round(value,4)
 expected=cfg['hindcast' if hindcast else 'forecast'];per=cfg['hc_per_start' if hindcast else 'per_start']
 if len(series)!=expected or any(sum(k[0]==start for k in series)!=per for start in starts) or any(None in v for v in series.values()):raise ValueError(f'Incomplete ensemble: expected {expected} complete members')
 return [dict(id=f'{s:%Y%m%d}-{n}',start=iso(s),values=series[(s,n)]) for s,n in sorted(series)]
def retrieve(client,dataset,request,label):
 folder=Path('work/seasonal-downloads');folder.mkdir(parents=True,exist_ok=True);file=folder/(label+'.grib')
 print('Retrieving',label,flush=True);client.retrieve(dataset,request,str(file));print('Downloaded',label,file.stat().st_size,'bytes',flush=True);return file
def prepare_ensemble(client,model,nominal,hindcast=False):
 records=[]
 for i,request in enumerate(requests_for(model,nominal,hindcast)):
  file=retrieve(client,'seasonal-original-pressure-levels',request,f'{model}-{nominal:%Y%m}-{i}')
  records.extend(read_grib(file,model));file.unlink()
 return ensemble(records,model,nominal,hindcast)
def forecast(client,model,nominal):
 name=f'forecast/{model}.json';cfg=MODELS[model];old=load(name)
 if old and old['nominal']==iso(nominal) and old['system']==cfg['system']:
  print('Forecast already prepared:',model,iso(nominal));return
 members=prepare_ensemble(client,model,nominal);array=np.array([m['values'] for m in members])
 data=dict(version=2,complete=True,model=model,name=cfg['name'],system=cfg['system'],nominal=iso(nominal),preparedAt=iso(datetime.now(timezone.utc)),latitude=60,level=10,units='m/s',sampling='12-hourly instantaneous',dates=[iso(nominal+HALF*(i+1)) for i in range(STEPS)],members=members,memberCount=len(members),mean=np.round(array.mean(axis=0),4).tolist(),easterlyFraction=np.round((array<0).mean(axis=0),6).tolist(),source=SOURCE,climateKey=f"{model}-{cfg['system']}-{nominal.month:02}",attribution='Contains modified Copernicus Climate Change Service information (2026). '+cfg['name']+'. Source terms and attribution: '+SOURCE)
 publish(name,data)
def climate(client,model,nominal):
 cfg=MODELS[model];key=f"{model}-{cfg['system']}-{nominal.month:02}";final=f'climate/{key}.json'
 if load(final):print('Model climate already prepared:',key);return
 pooled=[]
 for year in YEARS:
  name=f'checkpoints/{key}/{year}.json';part=load(name)
  if part is None:
   members=prepare_ensemble(client,model,nominal.replace(year=year),True)
   part=dict(version=2,model=model,system=cfg['system'],month=nominal.month,year=year,values=[m['values'] for m in members]);publish(name,part)
  if part['year']!=year or part['system']!=cfg['system'] or part['month']!=nominal.month or len(part['values'])!=cfg['hindcast'] or any(len(v)!=STEPS for v in part['values']):raise ValueError('Invalid historical checkpoint')
  pooled.extend(part['values'])
 array=np.asarray(pooled,dtype=float)
 if not np.isfinite(array).all() or np.max(np.abs(array))>=200:raise ValueError('Invalid historical values')
 quantiles=np.quantile(array,[0,.1,.25,.75,.9,1],axis=0,method='linear')
 payload=dict(version=2,complete=True,model=model,system=cfg['system'],month=nominal.month,period=[1993,2016],years=YEARS,sampleCount=len(pooled),steps=STEPS,sampling='12-hourly instantaneous',mean=np.round(array.mean(axis=0),4).tolist(),source=SOURCE,method='Equal-weight qualified hindcast members across 1993–2016, aligned by 12-hour lead from each nominal first-of-month. Linear sample quantiles; no bias correction. Leap years retain their native lead-time calendar.')
 for name,values in zip(['min','p10','p25','p75','p90','max'],quantiles):payload[name]=np.round(values,4).tolist()
 publish(final,payload)
def era5(client):
 final='climate/era5-1993-2016.json'
 if load(final):print('ERA5 reference already prepared');return
 sums={};counts={}
 for year in YEARS:
  name=f'checkpoints/era5/{year}.json';part=load(name)
  if part is None:
   request=dict(product_type=['reanalysis'],variable=['u_component_of_wind'],pressure_level=['10'],year=[str(year)],month=[f'{m:02}' for m in range(1,13)],day=[f'{d:02}' for d in range(1,32)],time=[f'{h:02}:00' for h in range(24)],area=[60,-180,60,180],data_format='grib',download_format='unarchived')
   file=retrieve(client,'reanalysis-era5-pressure-levels',request,f'era5-{year}');hours={}
   for _,_,valid,value in read_grib(file):
    if valid.year!=year or valid.minute or valid in hours:raise ValueError('Unexpected or duplicate ERA5 valid hour')
    hours[valid]=value
   expected=8784 if calendar.isleap(year) else 8760
   if len(hours)!=expected:raise ValueError('Incomplete ERA5 year')
   daily={}
   for day in range(expected//24):
    start=datetime(year,1,1,tzinfo=timezone.utc)+timedelta(days=day)
    daily[start.strftime('%m-%d')]=round(sum(hours[start+timedelta(hours=h)] for h in range(24))/24,4)
   part=dict(version=2,year=year,daily=daily);publish(name,part);file.unlink()
  if part['year']!=year or len(part['daily'])!=(366 if calendar.isleap(year) else 365):raise ValueError('Incomplete ERA5 checkpoint')
  for day,value in part['daily'].items():
   if not isinstance(value,(float,int)) or not np.isfinite(value) or abs(value)>=200:raise ValueError('Invalid ERA5 value')
   sums[day]=sums.get(day,0)+value;counts[day]=counts.get(day,0)+1
 if len(sums)!=366 or any(n!=(6 if day=='02-29' else 24) for day,n in counts.items()):raise ValueError('Incomplete ERA5 climate')
 publish(final,dict(version=2,complete=True,period=[1993,2016],latitude=60,level=10,units='m/s',source=ERA_SOURCE,method='Daily mean of all 24 hourly 60N zonal means; calendar-day average over 1993–2016. February 29 uses the six leap years.',daily={d:round(sums[d]/counts[d],4) for d in sums},counts=counts))
def main():
 p=argparse.ArgumentParser();p.add_argument('--model',choices=MODELS,default='egrr');p.add_argument('--phase',choices=['forecast','climate','era5','update'],required=True);p.add_argument('--month');args=p.parse_args()
 nominal=datetime.strptime(args.month,'%Y-%m').replace(tzinfo=timezone.utc) if args.month else latest(args.model,datetime.now(timezone.utc))
 if not datetime(2026,4,1,tzinfo=timezone.utc)<=nominal<datetime(2027,1,1,tzinfo=timezone.utc):raise ValueError('Model versions must be reviewed for this issue date')
 setup()
 import cdsapi
 client=cdsapi.Client(url='https://cds.climate.copernicus.eu/api',key=os.environ['CDSAPI_KEY'],quiet=False,debug=False,timeout=60)
 if args.phase=='era5':era5(client)
 elif args.phase in ['forecast','update']:
  forecast(client,args.model,nominal)
  if args.phase=='update':climate(client,args.model,nominal)
 else:climate(client,args.model,nominal)
if __name__=='__main__':
 try:main()
 except Exception as e:
  print('Seasonal preparation failed:',type(e).__name__,file=sys.stderr)
  r=getattr(e,'response',None)
  if r is not None:
   print('CDS HTTP status:',r.status_code,file=sys.stderr)
   if any(w in r.text.lower() for w in ['licence','license','terms']):print('Dataset terms must be accepted in the CDS account.',file=sys.stderr)
  if isinstance(e,ValueError):print(str(e),file=sys.stderr)
  sys.exit(1)
