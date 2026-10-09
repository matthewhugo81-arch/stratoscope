"""Validate a separately retrieved ERA5/ERA5T GRIB history; never use forecast f000.

Does not submit CDS jobs or use existing seasonal requests. Supply an explicit
CDS/MARS GRIB download plus its original request JSON. No credentials are logged.
"""
import argparse
from datetime import datetime, timezone, timedelta, date
import json
from pathlib import Path
import eccodes as ec
import numpy as np
from ssw_sources import require, digest, stamp, regular_samples


def import_history(path, request_path, output, end_date):
    request_bytes=request_path.read_bytes();request=json.loads(request_bytes)
    require(request.get('dataset')=='reanalysis-era5-complete' and isinstance(request.get('request'),dict), 'Original ERA5-complete request required')
    records={};identities=[]
    with path.open('rb') as file:
        while True:
            h=ec.codes_grib_new_from_file(file)
            if h is None:break
            try:
                get=lambda k,t=None:ec.codes_get(h,k,t)
                require(get('centre',int)==98 and get('class')=='ea' and get('dataType')=='an' and get('endStep')==0, 'Not ERA5 analysis')
                experiment=str(get('expver')).strip().lstrip('0')
                require(experiment in ('1','5'), 'Unsupported reanalysis version')
                when=datetime.strptime(f'{get("dataDate")}{get("dataTime"):04}','%Y%m%d%H%M').replace(tzinfo=timezone.utc)
                short,level_type=get('shortName'),get('typeOfLevel')
                if short=='z' and level_type=='isobaricInhPa' and get('level')==500:
                    require(get('units')=='m**2 s**-2', 'Wrong height units');key='h500';scale=1/9.80665
                elif level_type=='theta' and short in ('pv','u','v'):
                    require(get('units')==('K m**2 kg**-1 s**-1' if short=='pv' else 'm s**-1'), 'Wrong isentropic units')
                    key=f'{short}_{get("level")}K';scale=1e6 if short=='pv' else 1
                else:continue
                values,_=regular_samples(ec.codes_get_values(h)*scale,get,30)
                require(not get('bitmapPresent') and np.isfinite(values).all(), 'Missing reanalysis cells')
                identity=(stamp(when),key)
                require(identity not in records, 'Duplicate or mixed ERA5/ERA5T field')
                records[identity]=values
                identities.append(dict(validTime=identity[0],field=key,expver=experiment,preliminary=experiment=='5',sourceClass='reanalysis'))
            finally:ec.codes_release(h)
    start=datetime.combine(end_date-timedelta(days=6),datetime.min.time(),tzinfo=timezone.utc)
    times=[stamp(start+timedelta(hours=h)) for h in range(0,7*24,6)]
    require(all((t,'h500') in records for t in times), 'Need all 28 six-hour H500 analyses in requested week')
    require(all(t in times for t,_ in records), 'Fields outside requested verification week')
    output.mkdir(parents=True,exist_ok=True)
    files=[]
    for time in times:
        fields={k:v for (t,k),v in records.items() if t==time}
        path_out=output/(time.replace(':','').replace('-','')+'.npz')
        np.savez_compressed(path_out,**fields)
        files.append(dict(validTime=time,path=path_out.name,sha256=digest(path_out.read_bytes()),fields=sorted(fields)))
    result=dict(version=1,completeH500History=True,sourceClass='reanalysis',observations=False,
        provider='ECMWF/Copernicus Climate Data Store',dataset='reanalysis-era5-complete',
        inputSha256=digest(path.read_bytes()),requestSha256=digest(request_bytes),records=identities,files=files,
        preparedAt=stamp(datetime.now(timezone.utc)),rwbStatus='not_validated',
        note='ERA5T expver 5 is preliminary; source delay means this is not a current seven-day observation history')
    temporary=output/'reanalysis.json.tmp';temporary.write_text(json.dumps(result,indent=2),encoding='utf-8');temporary.replace(output/'reanalysis.json')
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input',type=Path,required=True);p.add_argument('--request',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--end-date',type=date.fromisoformat,required=True)
    a=p.parse_args();import_history(a.input,a.request,a.output,a.end_date)
