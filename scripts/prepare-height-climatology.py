"""One-time NOAA PSL 500 hPa daily reference extraction (requires netCDF4).

The checked-in subset is reused by every forecast preparation. No climate
downloads are made by the recurring forecast workflow.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import netCDF4
import numpy as np

SOURCE = 'https://psl.noaa.gov/thredds/dodsC/Datasets/ncep.reanalysis/Monthlies/pressure/hgt.day.ltm.1991-2020.nc'
OUT = Path(__file__).parent / 'data'

def main():
    with netCDF4.Dataset(SOURCE) as ds:
        assert ds.dataset_title == 'NCEP-NCAR Reanalysis 1'
        assert ds['time'].climo_period == '1991/01/01 - 2020/12/31'
        assert ds['hgt'].units == 'm'
        assert np.array_equal(ds['level'][:], [1000,925,850,700,600,500,400,300,250,200,150,100,70,50,30,20,10])
        assert np.array_equal(ds['lat'][:25], np.arange(90,29,-2.5))
        assert np.array_equal(ds['lon'][:], np.arange(0,360,2.5))
        dates = netCDF4.num2date(ds['time'][:], ds['time'].units)
        calendar = [(datetime(2001,1,1)+timedelta(days=i)).strftime('%m-%d') for i in range(365)]
        assert [d.strftime('%m-%d') for d in dates] == calendar
        # Request only the level and region used by the viewer, including the
        # provider's counts so an incomplete climate reference is rejected.
        height = ds['hgt'][:,5,:25,:]
        counts = ds['valid_yr_count'][:,5,:25,:]
        assert height.shape == counts.shape == (365,25,144)
        assert not np.ma.getmaskarray(height).any() and not np.ma.getmaskarray(counts).any()
        assert np.all(counts == 30), 'Reference must include all 30 years at every point'
        assert np.isfinite(height).all() and height.min()>4500 and height.max()<6200
        OUT.mkdir(exist_ok=True)
        target = OUT/'height-500-ncep-1991-2020.npz'
        np.savez_compressed(target, height=np.asarray(height,dtype='<f4'))
        meta = dict(version=1,id='ncep-ncar-r1-1991-2020-daily',source=SOURCE,
            dataset='NCEP-NCAR Reanalysis 1',period=[1991,2020],pressure=500,units='m',
            grid=dict(nx=144,ny=25,lat0=90,lon0=0,dx=2.5,dy=-2.5),calendarDays=calendar,
            samplesPerDay=30,dailyMean=True,leapDay='mean of February 28 and March 1',
            sha256=hashlib.sha256(target.read_bytes()).hexdigest(),
            extractedAt=datetime.now(timezone.utc).isoformat())
        target.with_suffix('.json').write_text(json.dumps(meta,indent=2)+'\n')
        print('Stored verified daily reference:',height.shape,'30 years at every point;',target.stat().st_size,'bytes')

if __name__=='__main__': main()
