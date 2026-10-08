"""C3S system definitions, verified against official documentation in October 2026."""
from datetime import datetime,timedelta,timezone
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
def iso(d):return d.strftime('%Y-%m-%dT%H:%M:%S.000Z')
def latest(model,now):
 first=now.replace(day=1,hour=0,minute=0,second=0,microsecond=0)
 return first if now.day >= (7 if model=='ecmf' else 11) else (first-timedelta(days=1)).replace(day=1)
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
  result.append(dict(originating_centre=cfg['centre'],system=cfg['system'],variable=['u_component_of_wind'],pressure_level=['10'],year=[str(year)],month=[f'{month:02}'],day=[f'{s.day:02}' for s in sorted(starts)],leadtime_hour=[str(h) for h in range(12,STEPS*12+maxlag+1,12)],area=[61.25,-180,58.75,180],data_format='grib'))
 return result
