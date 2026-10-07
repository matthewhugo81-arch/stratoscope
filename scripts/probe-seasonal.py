"""Small authenticated access checks; no credentials or API response bodies logged."""
import os,sys
from pathlib import Path
import cdsapi
import eccodes as ec
kind=sys.argv[1]
client=cdsapi.Client(url='https://cds.climate.copernicus.eu/api',key=os.environ['CDSAPI_KEY'],quiet=False,debug=False,timeout=60)
if kind=='era5':
 dataset='reanalysis-era5-pressure-levels'
 request=dict(product_type=['reanalysis'],variable=['u_component_of_wind'],pressure_level=['10'],year=['1993'],month=['09'],day=['01'],time=['00:00'],area=[61,-180,59,180],data_format='grib',download_format='unarchived')
else:
 dataset='seasonal-original-pressure-levels'
 centre,system,year,month,day={'hindcast':('ecmwf','51','1993','09','01'),'jma':('jma','4','2026','09','01'),'bom':('bom','2','2026','09','01')}[kind]
 request=dict(originating_centre=centre,system=system,variable=['u_component_of_wind'],pressure_level=['10'],year=[year],month=[month],day=[day],leadtime_hour=['24'],area=[61,-180,59,180],data_format='grib')
try:
 Path('work').mkdir(exist_ok=True);dest=Path('work/access-'+kind+'.grib')
 client.retrieve(dataset,request,str(dest))
 with dest.open('rb') as f:
  n=0
  while (g:=ec.codes_grib_new_from_file(f)) is not None:
   n+=1
   if n==1:
    print('Metadata:',{k:ec.codes_get(g,k) for k in ['centre','shortName','level','gridType','Ni','Nj','units','dataDate','validityDate']},flush=True)
   ec.codes_release(g)
 print('ACCESS CHECK PASSED:',kind,n,'fields',dest.stat().st_size,'bytes')
except Exception as e:
 print('ACCESS CHECK FAILED:',kind,type(e).__name__,flush=True)
 r=getattr(e,'response',None)
 if r is not None:
  print('HTTP status:',r.status_code)
  if any(w in r.text.lower() for w in ['licence','license','terms']):print('Dataset terms require acceptance:',dataset)
 sys.exit(1)
