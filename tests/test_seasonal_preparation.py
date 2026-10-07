import importlib.util,sys,unittest
from pathlib import Path
from datetime import datetime,timedelta,timezone
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from seasonal_config import *
spec=importlib.util.spec_from_file_location('seasonal',Path(__file__).resolve().parents[1]/'scripts/prepare-seasonal.py');s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
N=datetime(2026,9,1,tzinfo=timezone.utc)
class SeasonalTests(unittest.TestCase):
 def test_qualified_lagged_members_and_year_boundary(self):
  for model,cfg in MODELS.items():
   for hc in [False,True]:
    starts=starts_for(model,N,hc)
    self.assertEqual(len(starts)*cfg['hc_per_start' if hc else 'per_start'],cfg['hindcast' if hc else 'forecast'])
  self.assertEqual(starts_for('rjtd',N,True),[N.replace(month=8,day=14),N.replace(month=8,day=29)])
  january=N.replace(month=1);self.assertEqual(min(starts_for('egrr',january,True)).year,2025)
  march=N.replace(year=2000,month=3);self.assertNotIn(29,[d.day for d in starts_for('ammc',march,True) if d.month==2])
 def test_native_grids_and_seam(self):
  for step in [.25,1,1.25]:
   lon=np.arange(0,360,step);lat=np.full(len(lon),60.)
   self.assertAlmostEqual(s.zonal_mean(lat,lon,np.full(len(lon),-8.5)),-8.5)
   with self.assertRaises(ValueError):s.zonal_mean(lat[:-1],lon[:-1],np.ones(len(lon)-1))
  lon=np.tile(np.arange(360),2);lat=np.repeat([59.5,60.5],360);val=np.repeat([-20,10],360)
  self.assertEqual(s.zonal_mean(lat,lon,val),-5)
 def test_valid_date_alignment_completeness_and_duplicates(self):
  records=[]
  for start in starts_for('rjtd',N):
   for member in range(5):
    for i in range(STEPS):records.append((start,member,N+HALF*(i+1),float(i-member)))
  # Keep test values physically bounded.
  records=[(a,b,c,d/10) for a,b,c,d in records]
  result=s.ensemble(records,'rjtd',N)
  self.assertEqual(len(result),55);self.assertEqual(result[0]['values'][0],0)
  with self.assertRaises(ValueError):s.ensemble(records[:-1],'rjtd',N)
  with self.assertRaises(ValueError):s.ensemble(records+[records[0]],'rjtd',N)
 def test_request_has_12h_resolution_and_native_system(self):
  for model,cfg in MODELS.items():
   req=requests_for(model,N)
   self.assertEqual(req[-1]['system'],cfg['system']);self.assertEqual(req[-1]['leadtime_hour'][:2],['12','24'])
   self.assertGreaterEqual(int(req[0]['leadtime_hour'][-1]),4320)
if __name__=='__main__':unittest.main()
