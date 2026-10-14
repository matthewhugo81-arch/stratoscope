"""Offline release pickup and source-status regression tests; no downloads."""
from datetime import datetime, timezone, timedelta
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock
import urllib.error

ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,ROOT/path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module
watch=load('watch','scripts/watch-delivery.py')
state=load('state','scripts/delivery_state.py')
NOW=datetime(2026,10,11,7,tzinfo=timezone.utc)
RUN='2026-10-11T00:00:00.000Z'
OLD='2026-10-10T12:00:00.000Z'
def rows(run=RUN):
    dt=state.parse(run)
    return '\n'.join(json.dumps(dict(date=dt.strftime('%Y%m%d'),time=dt.hour*100,step=240,levtype='pl',levelist=level,param=field)) for level in [10,50,100] for field in ['t','gh','u','v']).encode()
def http(code):return urllib.error.HTTPError('https://example.invalid/index',code,'test',{},None)

class WatchTests(unittest.TestCase):
    def audit(self,fail=None):
        def inspect(model,now,prep):
            if model==fail:raise TimeoutError('offline')
            return dict(model=model,status='behind',publishedRun=OLD,availableRun=RUN)
        return SimpleNamespace(audit=Mock(side_effect=inspect),recover_results=Mock(),github=Mock(),stamp=state.stamp)
    def test_all_four_independent_pipelines_are_checked(self):
        audit=self.audit();reports=watch.check_once(audit,object(),NOW)
        self.assertEqual({r['model'] for r in reports},set(watch.MODELS))
        audit.recover_results.assert_called_once_with(reports,True,NOW)
    def test_one_source_failure_does_not_stop_other_recoveries(self):
        audit=self.audit('ifs_ens');reports=watch.check_once(audit,None,NOW)
        self.assertEqual(next(r for r in reports if r['model']=='ifs_ens')['status'],'error')
        self.assertEqual(sum(r['status']=='behind' for r in reports),3)
        audit.recover_results.assert_called_once()
    def test_dry_run_never_dispatches(self):
        audit=self.audit();watch.run_watch(audit,None,minutes=0,recover=False)
        audit.recover_results.assert_not_called();audit.github.assert_not_called()
    def test_delivery_changes_never_launch_duplicate_full_health_audits(self):
        audit=self.audit()
        self.assertEqual(watch.run_watch(audit,None,minutes=0),0)
        audit.github.assert_not_called()
    def test_bounded_watch_does_not_loop_forever_or_dispatch_every_tick(self):
        audit=self.audit();t=[0.]
        def clock():return t[0]
        def sleep(seconds):t[0]+=seconds
        result=watch.run_watch(audit,None,minutes=10,interval=300,clock=clock,sleep=sleep)
        self.assertEqual(result,0);self.assertEqual(t[0],600)
        self.assertEqual(audit.audit.call_count,12)
        audit.github.assert_not_called()

class StatusTests(unittest.TestCase):
    def test_not_yet_available_is_labelled_but_not_invented(self):
        result=dict(model='ifs_ens',sourceStatus='verified',availableRun=OLD,publishedRun=OLD,status='current')
        state.annotate([result],NOW)
        self.assertEqual(result['sourcePendingRun'],RUN)
        self.assertEqual(result['availableRun'],OLD)
        self.assertEqual(result['publishedRun'],OLD)
    def test_no_warning_for_run_too_early_in_its_release_window(self):
        result=dict(model='ifs_ens',sourceStatus='verified',availableRun=OLD,status='current')
        state.annotate([result],NOW.replace(hour=3))
        self.assertNotIn('sourcePendingRun',result)
    def test_a_verified_current_cycle_is_not_provider_pending(self):
        result=dict(model='gefs',sourceStatus='verified',availableRun=RUN,status='current')
        state.annotate([result],NOW)
        self.assertNotIn('sourcePendingRun',result)
    def test_source_outage_is_not_called_missing_data(self):
        result=dict(model='ifs_ens',sourceStatus='unavailable',status='error')
        state.annotate([result],NOW)
        self.assertNotIn('sourcePendingRun',result)
    def test_vortex_cannot_be_current_against_an_older_parent(self):
        for parent,expected in [('updating','updating'),('behind','updating'),('error','error')]:
            reports=[dict(model='gefs',status=parent,availableRun=RUN,publishedRun=OLD),dict(model='vortex',status='current',publishedRun=OLD)]
            state.annotate(reports,NOW)
            self.assertEqual(reports[1]['status'],expected)
            self.assertEqual(reports[1]['upstreamAvailableRun'],RUN)
    def test_complete_vortex_is_not_changed(self):
        reports=[dict(model='gefs',status='current',availableRun=RUN,publishedRun=RUN),dict(model='vortex',status='current',publishedRun=RUN)]
        state.annotate(reports,NOW)
        self.assertEqual(reports[1]['status'],'current')

class DirectIFS(unittest.TestCase):
    def test_primary_missing_secondary_current_is_current(self):
        read=Mock(side_effect=[http(404),rows()])
        self.assertEqual(state.latest_direct_ifs(read,NOW),RUN)
        self.assertEqual(read.call_count,2)
    def test_primary_network_failure_secondary_current_is_current(self):
        read=Mock(side_effect=[TimeoutError(),rows()])
        self.assertEqual(state.latest_direct_ifs(read,NOW),RUN)
    def test_both_absent_allow_previous_cycle(self):
        read=Mock(side_effect=[http(404),http(404),rows(OLD)])
        self.assertEqual(state.latest_direct_ifs(read,NOW),OLD)
        self.assertEqual(read.call_count,3)
    def test_an_outage_is_not_evidence_of_an_older_latest_cycle(self):
        read=Mock(side_effect=[http(404),http(503)])
        with self.assertRaises(urllib.error.HTTPError):state.latest_direct_ifs(read,NOW)
        self.assertEqual(read.call_count,2)
    def test_duplicate_or_wrong_cycle_inventory_is_not_accepted(self):
        bad=rows()+b'\n'+rows().splitlines()[0]
        read=Mock(side_effect=[bad,rows(OLD),rows(OLD)])
        self.assertEqual(state.latest_direct_ifs(read,NOW),OLD)
    def test_malformed_json_is_a_real_error(self):
        with self.assertRaises(ValueError):state.latest_direct_ifs(Mock(return_value=b'not-json'),NOW)

class WorkflowTests(unittest.TestCase):
    def test_gefs_connections_have_not_increased(self):
        text=(ROOT/'.github/workflows/prepare-gefs.yml').read_text()
        self.assertIn('--workers 2 --hour-workers 3',text)
        self.assertIn('Three isolated decoders x two transfers',text)
        self.assertIn('gh workflow run prepare-diagnostics.yml',text)
        self.assertIn('gh workflow run prepare-vortex.yml',text)
    def test_three_hour_audit_remains_and_watcher_is_bounded(self):
        self.assertIn("cron: '11 */3 * * *'",(ROOT/'.github/workflows/check-pipelines.yml').read_text())
        text=(ROOT/'.github/workflows/watch-delivery.yml').read_text()
        self.assertIn('--minutes 55 --interval 900',text)
        self.assertIn('cancel-in-progress: true',text)
        self.assertNotIn('CDSAPI_KEY',text)
        # The watcher does not trigger itself through its health refresh.
        self.assertNotIn('workflows: [Check forecast pipeline freshness',text)

if __name__=='__main__':unittest.main()
