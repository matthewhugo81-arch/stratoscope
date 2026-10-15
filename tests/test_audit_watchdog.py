from datetime import datetime, timezone, timedelta
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

spec=importlib.util.spec_from_file_location('watchdog',Path(__file__).parents[1]/'scripts/ensure-pipeline-audit.py')
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
NOW=datetime(2026,10,15,10,tzinfo=timezone.utc)

class WatchdogTests(unittest.TestCase):
    def api(self,age=4,runs=None,report=None):
        def github(endpoint,payload=None):
            if '/git/ref/' in endpoint:return {'object':{'sha':'a'*40}}
            if endpoint.endswith('/dispatches'):return None
            return {'workflow_runs':runs or []}
        return SimpleNamespace(github=Mock(side_effect=github),public=Mock(return_value=report if report is not None else {'version':1,'checkedAt':(NOW-timedelta(hours=age)).isoformat()}))
    def dispatched(self,api):return [c for c in api.github.call_args_list if c.args[0].endswith('/dispatches')]
    def test_recent_report_never_dispatches_or_reads_workflow_history(self):
        api=self.api(age=2)
        self.assertEqual(w.ensure(api,NOW),'recent');self.assertEqual(api.github.call_count,1)
        api.public.assert_called_once_with('a'*40)
    def test_overdue_report_dispatches_one_full_audit(self):
        api=self.api();self.assertEqual(w.ensure(api,NOW),'dispatched')
        self.assertEqual(len(self.dispatched(api)),1)
        self.assertEqual(self.dispatched(api)[0].args,('/actions/workflows/check-pipelines.yml/dispatches',{'ref':'main'}))
    def test_every_active_state_prevents_duplicates(self):
        for state in w.ACTIVE:
            api=self.api(runs=[{'status':state}]);self.assertEqual(w.ensure(api,NOW),'active');self.assertFalse(self.dispatched(api))
    def test_recent_completion_observes_cooldown(self):
        api=self.api(runs=[{'status':'completed','updated_at':(NOW-timedelta(minutes=10)).isoformat()}])
        self.assertEqual(w.ensure(api,NOW),'cooldown');self.assertFalse(self.dispatched(api))
    def test_invalid_missing_and_future_reports_cannot_hide_staleness(self):
        for report in [{},{'version':1,'checkedAt':'bad'},{'version':1,'checkedAt':(NOW+timedelta(hours=1)).isoformat()}]:
            api=self.api(report=report);self.assertEqual(w.ensure(api,NOW),'dispatched')
    def test_unknown_workflow_state_does_not_blindly_dispatch(self):
        api=self.api();api.github.side_effect=[{'object':{'sha':'a'*40}},TimeoutError('unknown active jobs')]
        with self.assertRaises(TimeoutError):w.ensure(api,NOW)
        self.assertFalse(self.dispatched(api))
    def test_post_failure_is_not_retried(self):
        api=self.api();api.github.side_effect=[{'object':{'sha':'a'*40}},{'workflow_runs':[]},TimeoutError('outcome unknown')]
        with self.assertRaises(TimeoutError):w.ensure(api,NOW)
        self.assertEqual(len(self.dispatched(api)),1)

if __name__=='__main__':unittest.main()
