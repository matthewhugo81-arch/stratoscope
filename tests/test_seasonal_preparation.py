import importlib.util,sys,unittest
from pathlib import Path
from datetime import datetime,timedelta,timezone
import numpy as np
from unittest.mock import patch,Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from seasonal_config import *
spec=importlib.util.spec_from_file_location('seasonal',Path(__file__).resolve().parents[1]/'scripts/prepare-seasonal.py');s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
N=datetime(2026,9,1,tzinfo=timezone.utc)
class SeasonalTests(unittest.TestCase):
 def test_ready_era5_years_are_collected_before_queued_earlier_year(self):
  client=Mock()
  client.client.get_remote.side_effect=lambda request_id:Mock(status='accepted' if request_id=='queued' else 'successful')
  def saved(name):
   if name=='checkpoints/era5/1993.json':return {'year':1993}
   if name=='requests/era5-1994.json':return {'id':'queued'}
   if name=='requests/era5-1995.json':return {'id':'ready'}
   return None
  with patch.object(s,'YEARS',[1993,1994,1995]),patch.object(s,'load',side_effect=saved):
   self.assertEqual(s.era5_year_order(client),[1995,1993,1994])
  self.assertEqual([c.args[0] for c in client.client.get_remote.call_args_list],['queued','ready'])
  client.client.submit.assert_not_called()

 def test_resume_uses_existing_job_without_submitting(self):
  request={'year':['2002']};remote=Mock(collection_id='test',request=request,status='successful')
  remote.download.side_effect=lambda target:Path(target).write_bytes(b'data')
  client=Mock();client.client.get_remote.return_value=remote
  with patch.object(s,'load',return_value={'id':'existing','dataset':'test','request':request}),patch.object(s,'publish'):
   file=s.retrieve(client,'test',request,'test-resume');file.unlink()
  client.client.submit.assert_not_called()
 def test_only_queue_rejections_retry_and_save_new_request(self):
  request={'year':['2002']};remote=Mock(request_id='new')
  remote.download.side_effect=lambda target:Path(target).write_bytes(b'data')
  client=Mock();client.client.submit.side_effect=[RuntimeError('Number queued requests for this dataset is temporarily limited'),remote]
  with patch.object(s,'load',return_value=None),patch.object(s,'publish') as publish,patch.object(s.time,'sleep') as sleep:
   file=s.retrieve(client,'test',request,'test-retry');file.unlink()
   sleep.assert_called_once_with(90);self.assertEqual(publish.call_args.args[1]['id'],'new')
  client.client.submit.side_effect=ValueError('wrong data')
  with patch.object(s,'load',return_value=None),patch.object(s.time,'sleep') as sleep:
   with self.assertRaisesRegex(ValueError,'wrong data'):s.retrieve(client,'test',request,'test-invalid')
   sleep.assert_not_called()
 def test_era_reference_only_publishes_after_all_years_and_handles_leap_days(self):
  def checkpoint(name):
   if not name.startswith('checkpoints/'):return None
   year=int(name.split('/')[-1].split('.')[0]);start=datetime(year,1,1)
   days=(datetime(year+1,1,1)-start).days
   return dict(version=2,year=year,daily={(start+timedelta(days=i)).strftime('%m-%d'):year-1992 for i in range(days)})
  with patch.object(s,'load',side_effect=checkpoint),patch.object(s,'publish') as publish:
   s.era5(None,aggregate_only=True)
   payload=publish.call_args.args[1]
   self.assertEqual(len(payload['daily']),366)
   self.assertEqual(payload['daily']['01-01'],12.5)
   self.assertEqual(payload['daily']['02-29'],14)
   self.assertEqual(payload['counts']['02-29'],6)
  with patch.object(s,'load',return_value=None),patch.object(s,'publish') as publish:
   with self.assertRaisesRegex(ValueError,'still requires year'):s.era5(None,aggregate_only=True)
   publish.assert_not_called()
  with patch.object(s,'load',side_effect=checkpoint),patch.object(s,'publish') as publish:
   s.era5(None,selected_year=1993);publish.assert_not_called()
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
 def test_bom_requires_all_55_members_and_all_180_daily_dates(self):
  records=[(start,member,date,10.) for start in starts_for('ammc',N) for member in range(11) for date in forecast_dates('ammc',N)]
  result=s.ensemble(records,'ammc',N)
  self.assertEqual(len(result),55);self.assertEqual(len(result[0]['values']),180)
  with self.assertRaises(ValueError):s.ensemble(records[:-1],'ammc',N)
  with self.assertRaises(ValueError):s.ensemble(records+[records[0]],'ammc',N)
 def test_bom_reuses_exact_accepted_12h_request(self):
  requests=requests_for('ammc',N)
  legacy=[{**r,'leadtime_hour':[str(h) for h in range(12,int(r['leadtime_hour'][-1])+1,12)]} for r in requests]
  with patch.object(s,'load',side_effect=[{'request':r} for r in legacy]),patch.object(s,'retrieve',return_value=Mock()) as retrieve,patch.object(s,'read_grib',return_value=[]),patch.object(s,'ensemble',return_value=[]) as ensemble:
   s.prepare_ensemble(Mock(),'ammc',N)
   self.assertEqual([c.args[2] for c in retrieve.call_args_list],legacy)
   ensemble.assert_called_once()
 def test_request_has_12h_resolution_and_native_system(self):
  for model,cfg in MODELS.items():
   req=requests_for(model,N)
   self.assertEqual(req[-1]['system'],cfg['system']);self.assertEqual(req[-1]['leadtime_hour'][:2],['24','48'] if model=='ammc' else ['12','24'])
   self.assertGreaterEqual(int(req[0]['leadtime_hour'][-1]),4320)
if __name__=='__main__':unittest.main()
