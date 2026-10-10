"""C3S system definitions, verified against official documentation in October 2026."""
from datetime import datetime,timedelta,timezone
import math
MODELS={
 'egrr':dict(name='Met Office · GloSea',centre='ukmo',system='610',forecast=50,hindcast=28,per_start=2,hc_per_start=7),
 'ecmf':dict(name='ECMWF',centre='ecmwf',system='51',forecast=51,hindcast=25,per_start=51,hc_per_start=25),
 'lfpw':dict(name='Météo-France',centre='meteo_france',system='9',forecast=51,hindcast=31,per_start=51,hc_per_start=31),
 'edzw':dict(name='DWD',centre='dwd',system='22',forecast=50,hindcast=30,per_start=50,hc_per_start=30),
 'cmcc':dict(name='CMCC',grib_centre='cnmc',centre='cmcc',system='4',forecast=50,hindcast=30,per_start=50,hc_per_start=30),
 'rjtd':dict(name='JMA',centre='jma',system='4',forecast=55,hindcast=10,per_start=5,hc_per_start=5),
 'ammc':dict(name='BOM',centre='bom',system='2',forecast=55,hindcast=27,per_start=11,hc_per_start=3),
}
JMA_DAYS={1:[16,31],2:[10,25],3:[12,27],4:[11,26],5:[16,31],6:[15,30],7:[15,30],8:[14,29],9:[13,28],10:[13,28],11:[12,27],12:[12,27]}
YEARS=list(range(1993,2017));STEPS=360;HALF=timedelta(hours=12)
SOURCE='https://cds.climate.copernicus.eu/datasets/seasonal-original-pressure-levels'
ERA_SOURCE='https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels'
# CDS live constraints for BOM system 2 expose only 24-hour leads (verified 2026-10-08).
def forecast_interval(model):return 24 if model=='ammc' else 12
def forecast_steps(model):return 4320//forecast_interval(model)
def forecast_dates(model,nominal):return [nominal+timedelta(hours=forecast_interval(model)*(i+1)) for i in range(forecast_steps(model))]

def iso(d):return d.strftime('%Y-%m-%dT%H:%M:%S.000Z')
def latest(model,now):
 """Latest nominal issue due under the C3S publication schedule, not a claim
 that every provider file is already available. Downloads still validate data.
 https://climate.copernicus.eu/c3s-seasonal-forecast-spring-updates
 """
 if model not in MODELS:raise ValueError('Unknown seasonal model')
 if now.tzinfo is None or now.utcoffset() is None:raise ValueError('Timezone-aware release time required')
 now=now.astimezone(timezone.utc)
 first=now.replace(day=1,hour=0,minute=0,second=0,microsecond=0)
 release=first.replace(day=6 if model=='ecmf' else 10,hour=12)
 return first if now>=release else (first-timedelta(days=1)).replace(day=1)

def current_forecast(data,model,nominal):
 """Dependency-free guard for already validated compact publications.
 Used by both the lightweight scheduler and importer; never skip partial data
 or overwrite a newer complete issue with an older scheduled target.
 """
 try:
  cfg=MODELS[model];n=forecast_steps(model)
  if not isinstance(data,dict) or data.get('version')!=2 or data.get('complete') is not True:return False
  if data['model']!=model or data['system']!=cfg['system'] or data['name']!=cfg['name'] or data['source']!=SOURCE:return False
  if data['latitude']!=60 or data['level']!=10 or data['units']!='m/s' or data['sampling']!=f'{forecast_interval(model)}-hourly instantaneous':return False
  issue=datetime.fromisoformat(data['nominal'].replace('Z','+00:00'))
  if issue.tzinfo is None or issue<nominal or iso(issue)!=data['nominal'] or issue.day!=1 or issue.hour!=0 or issue.minute or issue.second:return False
  if data['dates']!=[iso(d) for d in forecast_dates(model,issue)]:return False
  def values(a):return isinstance(a,list) and len(a)==n and all(type(v) in (int,float) and math.isfinite(v) and abs(v)<200 for v in a)
  if data['memberCount']!=cfg['forecast'] or len(data['members'])!=cfg['forecast'] or not values(data['mean']) or not values(data['easterlyFraction']):return False
  if len({m['id'] for m in data['members']})!=cfg['forecast'] or not all(values(m['values']) for m in data['members']):return False
  starts=[m['start'] for m in data['members']]
  if set(starts)!={iso(s) for s in starts_for(model,issue)} or any(starts.count(start)!=cfg['per_start'] for start in set(starts)):return False
  for i in range(n):
   if abs(data['mean'][i]-sum(m['values'][i] for m in data['members'])/cfg['forecast'])>=.00011:return False
   if abs(data['easterlyFraction'][i]-sum(m['values'][i]<0 for m in data['members'])/cfg['forecast'])>=.0000011:return False
  return True
 except (KeyError,TypeError,ValueError,OverflowError):return False

def starts_for(model,nominal,hindcast=False):
 prev=nominal-timedelta(days=1)
 if hindcast:
  if model=='egrr':return [prev.replace(day=d) for d in [9,17,25]]+[nominal]
  if model=='rjtd':return [prev.replace(day=d) for d in JMA_DAYS[prev.month]]
  if model=='ammc':
   end=prev.replace(day=28) if prev.month==2 else prev
   return [end-timedelta(days=d) for d in range(8)]+[nominal]
  return [nominal]
 count={'egrr':25,'rjtd':11,'ammc':5}.get(model,1)
 return [nominal-timedelta(days=d) for d in range(count)]
def requests_for(model,nominal,hindcast=False):
 cfg=MODELS[model];groups={}
 for start in starts_for(model,nominal,hindcast):groups.setdefault((start.year,start.month),[]).append(start)
 result=[]
 for (year,month),starts in sorted(groups.items()):
  maxlag=max(int((nominal-s).total_seconds()/3600) for s in starts)
  result.append(dict(originating_centre=cfg['centre'],system=cfg['system'],variable=['u_component_of_wind'],pressure_level=['10'],year=[str(year)],month=[f'{month:02}'],day=[f'{s.day:02}' for s in sorted(starts)],leadtime_hour=[str(h) for h in range(12 if hindcast else forecast_interval(model),STEPS*12+maxlag+1,12 if hindcast else forecast_interval(model))],area=[61.25,-180,58.75,180],data_format='grib'))
 return result
