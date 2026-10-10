"""Documented C3S ACCESS-S2 gaps: retain the 55 most recent available members.
Source: https://confluence.ecmwf.int/spaces/CKB/pages/87853536/C3S+Seasonal+Forecast+known+issues
Issue I2, reviewed 10 October 2026. No synthetic substitution is permitted.
"""
from datetime import datetime,timezone,timedelta
import importlib.util
from pathlib import Path
import sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import seasonal_config as c
spec=importlib.util.spec_from_file_location('bom_gap_importer',Path(__file__).resolve().parents[1]/'scripts/prepare-seasonal.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
OCT=datetime(2026,10,1,tzinfo=timezone.utc)
class BomGaps(unittest.TestCase):
 def test_october_uses_most_recent_available_five_starts(self):
  self.assertEqual([d.strftime('%Y-%m-%d') for d in c.starts_for('ammc',OCT)],['2026-10-01','2026-09-30','2026-09-28','2026-09-27','2026-09-26'])
  self.assertEqual(c.MODELS['ammc']['forecast'],55)
  self.assertEqual(c.MODELS['ammc']['per_start'],11)
 def test_documented_april_gap(self):
  self.assertEqual([d.strftime('%Y-%m-%d') for d in c.starts_for('ammc',OCT.replace(month=4))],['2026-04-01','2026-03-31','2026-03-30','2026-03-28','2026-03-27'])
 def test_unaffected_month_and_other_models_unchanged(self):
  sep=OCT.replace(month=9)
  self.assertEqual(c.starts_for('ammc',sep),[sep-timedelta(days=i) for i in range(5)])
  self.assertEqual(c.starts_for('egrr',OCT),[OCT-timedelta(days=i) for i in range(25)])
 def test_hindcast_selection_is_not_changed_by_forecast_gap(self):
  self.assertIn(OCT-timedelta(days=2),c.starts_for('ammc',OCT,True))
  self.assertEqual(len(c.starts_for('ammc',OCT,True)),9)
 def test_changed_request_has_new_checkpoint_but_unchanged_october_group_is_reused(self):
  self.assertEqual(c.forecast_request_label('ammc',OCT,0,False),'ammc-202610-0-c3s-i2-v1')
  self.assertEqual(c.forecast_request_label('ammc',OCT,1,False),'ammc-202610-1')
  self.assertEqual(c.forecast_request_label('ammc',OCT,0,True),'ammc-202610-0')
  self.assertEqual(c.forecast_request_label('ammc',OCT.replace(month=9),0,False),'ammc-202609-0')
 def test_request_extends_lead_alignment_without_repeating_data(self):
  req=c.requests_for('ammc',OCT)
  self.assertEqual(req[0]['day'],['26','27','28','30'])
  self.assertEqual(req[1]['day'],['01'])
  self.assertEqual(int(req[0]['leadtime_hour'][-1]),4440)
  self.assertEqual(req[0]['leadtime_hour'][:2],['24','48'])
 def test_every_real_member_and_date_remains_required(self):
  records=[(start,m,date,8.0+m*.01) for start in c.starts_for('ammc',OCT) for m in range(11) for date in c.forecast_dates('ammc',OCT)]
  valid=p.ensemble(records,'ammc',OCT)
  self.assertEqual(len(valid),55)
  self.assertTrue(all(len(m['values'])==180 for m in valid))
  with self.assertRaises(ValueError):p.ensemble(records[11*180:],'ammc',OCT)
  with self.assertRaises(ValueError):p.ensemble(records[:-1],'ammc',OCT)
  with self.assertRaises(ValueError):p.ensemble(records+[records[0]],'ammc',OCT)
if __name__=='__main__':unittest.main()
