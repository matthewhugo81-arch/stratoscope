"""Write bounded ERA5-complete case-study requests; no submission or secret access."""
import argparse
from datetime import date,timedelta
import json
from pathlib import Path

def requests(end):
    dates=f'{end-timedelta(days=6):%Y-%m-%d}/to/{end:%Y-%m-%d}'
    common=dict(date=dates,time='00/06/12/18',type='an',stream='oper',grid='1/1',area='90/0/0/359',format='grib')
    # Isentropic PV and collocated winds are different from theta on +2 PVU.
    return {
        'h500':dict(dataset='reanalysis-era5-complete',request=dict(common,levtype='pl',levelist='500',param='129')),
        'wind10':dict(dataset='reanalysis-era5-complete',request=dict(common,levtype='pl',levelist='10',param='131')),
        'isentropic':dict(dataset='reanalysis-era5-complete',request=dict(common,levtype='pt',levelist='315/330/350',param='54/131/132')),
    }

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--end-date',type=date.fromisoformat,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
    for name,request in requests(a.end_date).items():
        (a.output/(name+'.request.json')).write_text(json.dumps(request,indent=2),encoding='utf-8')
    print('Prepared three seven-day requests; not submitted. Inspect CDS availability and resume existing request IDs before submitting.')
