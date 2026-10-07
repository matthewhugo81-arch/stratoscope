import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest
import numpy as np

spec=importlib.util.spec_from_file_location('glosea',Path(__file__).resolve().parents[1]/'scripts/prepare-glosea.py')
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
N=datetime(2026,9,1,tzinfo=timezone.utc)

def records():
    for lag in range(25):
        for member in [0,1]:
            for day in range(1,181):
                yield N-timedelta(days=lag),member,N+timedelta(days=day),day/10-lag+member

class GloSeaTests(unittest.TestCase):
    def test_latest_released_month_and_request_boundary(self):
        self.assertEqual(g.nominal_month(datetime(2026,10,7,tzinfo=timezone.utc)).month,9)
        self.assertEqual(g.nominal_month(datetime(2026,10,11,tzinfo=timezone.utc)).month,10)
        a,b=g.requests_for(N)
        self.assertEqual(a['month'],['08']);self.assertEqual(len(a['day']),24)
        self.assertEqual(b['day'],['01']);self.assertEqual(b['system'],'610')
        self.assertEqual(b['leadtime_hour'][-1],str(204*24))
    def test_zonal_mean_interpolation_seam_and_missing_longitudes(self):
        lat=np.repeat([59.5,60.5],360);lon=np.tile(np.arange(360)+.5,2)
        values=np.repeat([-12.,4.],360)
        self.assertEqual(g.zonal_mean(lat,lon,values),-4.)
        self.assertEqual(g.zonal_mean(np.full(361,60.),np.arange(-180,181),np.full(361,-7.)),-7.)
        with self.assertRaises(ValueError):g.zonal_mean(lat[:-1],lon[:-1],values[:-1])
        with self.assertRaises(ValueError):g.zonal_mean(lat,lon,np.full(720,np.nan))
    def test_align_by_valid_date_not_lead_time(self):
        data=g.assemble(records(),N,N+timedelta(days=10))
        self.assertEqual(data['memberCount'],50)
        self.assertAlmostEqual(data['mean'][0],.1-12+.5)
        self.assertEqual(data['dates'][0],'2026-09-02T00:00:00.000Z')
        self.assertEqual(data['dates'][-1],'2027-02-28T00:00:00.000Z')
        self.assertAlmostEqual(data['easterlyFraction'][0],47/50)
    def test_partial_or_duplicate_ensemble_rejected(self):
        rows=list(records())
        with self.assertRaises(ValueError):g.assemble(rows[:-1],N,N)
        with self.assertRaises(ValueError):g.assemble(rows+[rows[0]],N,N)
        with self.assertRaises(ValueError):g.assemble([r for r in rows if r[1]==0],N,N)

if __name__=='__main__':unittest.main()
