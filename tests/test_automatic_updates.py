"""Offline missed-start, duplicate-job, and incomplete-publication recovery."""
from datetime import datetime, timezone, timedelta
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT=Path(__file__).resolve().parents[1]
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
renew=load('renew','renew-delivery-watch.py')
audit=load('automatic_audit','check-pipelines.py')
watch=load('automatic_watch','watch-delivery.py')
snapshot=load('snapshot','publication_snapshot.py')
NOW=datetime(2026,10,15,12,tzinfo=timezone.utc)

def run(id=1,status='completed',minutes=60):
    stamp=(NOW-timedelta(minutes=minutes)).isoformat()
    return dict(id=id,status=status,created_at=stamp,updated_at=stamp,html_url='https://github.com/run/'+str(id))

class AutomaticUpdates(unittest.TestCase):
    def api(self,runs):return SimpleNamespace(github=Mock(side_effect=[{'workflow_runs':runs},{}]))
    def test_normal_watcher_arranges_exactly_one_successor(self):
        api=self.api([run(status='in_progress')]);self.assertEqual(renew.ensure(api,NOW,1),'dispatched')
        self.assertEqual(api.github.call_args.args,('/actions/workflows/watch-delivery.yml/dispatches',{'ref':'main'}))
        self.assertEqual(api.github.call_count,2)
    def test_existing_successor_or_active_watcher_is_never_duplicated(self):
        for state in renew.ACTIVE:
            api=self.api([run(status='in_progress'),run(2,state)])
            self.assertEqual(renew.ensure(api,NOW,1),'active');self.assertEqual(api.github.call_count,1)
    def test_early_failures_and_recent_completions_do_not_loop(self):
        for current in [1,None]:
            api=self.api([run(minutes=5)])
            self.assertEqual(renew.ensure(api,NOW,current),'cooldown');self.assertEqual(api.github.call_count,1)
    def test_missing_scheduled_watcher_is_recovered(self):
        api=self.api([run()]);self.assertEqual(renew.ensure(api,NOW),'dispatched')
    def test_unknown_history_fails_closed_without_dispatch(self):
        api=SimpleNamespace(github=Mock(side_effect=TimeoutError()))
        with self.assertRaises(TimeoutError):renew.ensure(api,NOW)
        self.assertEqual(api.github.call_count,1)
    def test_watcher_discards_previous_tick_snapshots(self):
        def inspect(model,now,prep):
            self.assertEqual(audit._publication_commits,{})
            return dict(model=model,status='current')
        with patch.object(audit,'audit',side_effect=inspect):
            for i in range(2):
                audit._publication_commits['forecast-data-gefs']='stale'
                watch.check_once(audit,None,NOW,recover=False)
    def test_health_backstop_runs_even_when_source_has_failed(self):
        api=SimpleNamespace(reset_publications=Mock(),audit=Mock(side_effect=TimeoutError()),recover_results=Mock(),stamp=lambda d:d.isoformat())
        maintenance=Mock()
        watch.run_watch(api,None,minutes=0,maintenance=maintenance)
        maintenance.assert_called_once()
    def test_seasonal_recovery_only_dispatches_missing_issues(self):
        with patch.object(audit,'github',side_effect=[{'workflow_runs':[]},{}]) as api:
            rows=[dict(model='ecmf',status='current'),dict(model='egrr',status='behind'),dict(model='ammc',status='error')]
            audit.recover_seasonal(rows,True,NOW)
        self.assertNotIn('recoveryStatus',rows[0]);self.assertEqual(rows[1]['recoveryStatus'],'updating')
        self.assertEqual(api.call_args.args,('/actions/workflows/prepare-seasonal.yml/dispatches',{'ref':'main','inputs':{'phase':'forecast','model':'all','missing_only':True}}))
    def test_healthy_seasonal_issues_do_not_start_jobs(self):
        with patch.object(audit,'github') as api:audit.recover_seasonal([dict(model='ecmf',status='current')],True,NOW)
        api.assert_not_called()
    def test_seasonal_active_and_cooldown_attempts_are_not_duplicated(self):
        for prior,expected in [(run(status='in_progress'),'updating'),(run(minutes=120),'behind')]:
            with patch.object(audit,'github',return_value={'workflow_runs':[prior]}) as api:
                self.assertEqual(audit.recovery('seasonal',True,NOW)[0],expected)
                self.assertEqual(api.call_count,1)
    def test_broken_derived_catalogue_is_repaired_but_remains_an_error(self):
        row=dict(model='vortex',status='error',availableRun='2026-10-15T00:00:00.000Z')
        with patch.object(audit,'recovery',return_value=('updating','url')) as recover:audit.recover_results([row],True,NOW)
        recover.assert_called_once_with('vortex',True,NOW)
        self.assertEqual(row['status'],'error');self.assertEqual(row['recoveryStatus'],'updating')
    def test_immutable_snapshot_rejects_wrong_refs_and_non_data_branches(self):
        with patch.object(snapshot.subprocess,'check_output',return_value='a'*40+'\trefs/heads/forecast-data-vortex'):
            self.assertIn('/'+'a'*40+'/',snapshot.snapshot_base('forecast-data-vortex'))
            with self.assertRaises(ValueError):snapshot.snapshot_base('forecast-data-gefs')
            with self.assertRaises(ValueError):snapshot.snapshot_base('main')

if __name__=='__main__':unittest.main()
