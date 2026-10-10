"""Offline operational regression tests; no requests, dispatches or CDS imports."""
import copy
from datetime import datetime, timezone, timedelta
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('pipeline_audit', ROOT/'scripts/check-pipelines.py')
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)
prep = audit.preparation()
NOW = datetime(2026, 10, 10, 8, tzinfo=timezone.utc)
RUN = '2026-10-10T00:00:00.000Z'


def http_error(code=503, retry_after=None):
    headers = {} if retry_after is None else {'Retry-After': retry_after}
    return urllib.error.HTTPError('https://example.invalid/forecast.index', code, 'test failure', headers, None)


def response(body=b'ok', status=200, headers=None):
    obj = MagicMock()
    obj.__enter__.return_value = obj
    obj.read.return_value = body
    obj.status = status
    obj.headers = headers or {}
    return obj


def manifest(model='ifs_ens', run=RUN):
    config = prep.CONFIG[model]
    key = datetime.fromisoformat(run.replace('Z', '+00:00')).strftime('%Y%m%d%H')
    def entry(path):
        return {'path': path, 'bytes': 123, 'sha256': 'a'*64}
    hours = range(0, config['maxHour']+1, 6)
    return dict(model=model, run=run, preparedAt=RUN, complete=True,
                count=config['count'], maxHour=config['maxHour'], levels=config['levels'], step=6,
                files={f'{level}/{hour}': entry(f'{key}/{level}/{hour}.bin.gz')
                       for level in config['levels'] for hour in hours},
                panels={str(hour): entry(f'{key}/10/{hour}.members.bin.gz') for hour in hours})


def entries(model):
    return [('https://example.invalid/f.grib2', 0, 20, member, level, key)
            for member in range(prep.CONFIG[model]['count'])
            for level in prep.CONFIG[model]['levels'] for key in prep.KEYS]


class HttpTests(unittest.TestCase):
    def test_audit_retries_temporary_service_failure(self):
        with patch.object(audit.urllib.request, 'urlopen', side_effect=[http_error(), response()]) as read, patch.object(audit.time, 'sleep') as sleep:
            self.assertEqual(audit.fetch('https://example.invalid/data'), b'ok')
        self.assertEqual(read.call_count, 2)
        sleep.assert_called_once_with(60)

    def test_missing_file_is_not_retried(self):
        for fetcher in [audit.fetch, prep.request]:
            with self.subTest(fetcher=fetcher.__name__), patch('urllib.request.urlopen', side_effect=http_error(404)) as read, patch('time.sleep') as sleep:
                with self.assertRaises(urllib.error.HTTPError): fetcher('https://example.invalid/data')
                self.assertEqual(read.call_count, 1)
                sleep.assert_not_called()

    def test_retry_after_is_respected(self):
        with patch('urllib.request.urlopen', side_effect=[http_error(429, '90'), response()]), patch('time.sleep') as sleep:
            audit.fetch('https://example.invalid/data')
        sleep.assert_called_once_with(90)

    def test_long_retry_after_is_deferred_to_next_audit(self):
        with patch('urllib.request.urlopen', side_effect=http_error(429, '3600')) as read, patch('time.sleep') as sleep:
            with self.assertRaises(urllib.error.HTTPError): audit.fetch('https://example.invalid/data')
        self.assertEqual(read.call_count, 1)
        sleep.assert_not_called()

    def test_timeout_retry_is_bounded(self):
        with patch('urllib.request.urlopen', side_effect=TimeoutError('offline')) as read, patch('time.sleep'):
            with self.assertRaises(TimeoutError): audit.fetch('https://example.invalid/data')
        self.assertEqual(read.call_count, 3)

    def test_dispatch_post_is_never_automatically_retried(self):
        with patch.dict('os.environ', {'GH_TOKEN': 'test-not-a-real-token'}), patch('urllib.request.urlopen', side_effect=TimeoutError('lost response')) as read:
            with self.assertRaises(TimeoutError): audit.github('/actions/workflows/example.yml/dispatches', {'ref': 'main'})
        self.assertEqual(read.call_count, 1)
        self.assertEqual(read.call_args.args[0].get_method(), 'POST')

    def test_preparation_retries_service_fault(self):
        with patch('urllib.request.urlopen', side_effect=[http_error(), response()]) as read, patch('time.sleep') as sleep:
            self.assertEqual(prep.request('https://example.invalid/data', attempts=3), b'ok')
        self.assertEqual(read.call_count, 2)
        sleep.assert_called_once_with(60)

    def test_ignored_byte_range_is_rejected(self):
        with patch('urllib.request.urlopen', return_value=response(b'1234', status=200)):
            with self.assertRaisesRegex(AssertionError, 'ignored byte range'):
                prep.request('https://example.invalid/data', 10, 4, attempts=1)

    def test_truncated_byte_range_is_rejected(self):
        with patch('urllib.request.urlopen', return_value=response(b'123', 206, {'Content-Range': 'bytes 10-13/100'})):
            with self.assertRaisesRegex(AssertionError, 'Truncated'):
                prep.request('https://example.invalid/data', 10, 4, attempts=1)


class AuditTests(unittest.TestCase):
    def test_valid_publication_survives_provider_outage(self):
        source = SimpleNamespace(CONFIG={'ifs_ens': {}}, discover=MagicMock(side_effect=http_error()))
        with patch.object(audit, 'public', return_value=manifest()):
            result = audit.audit('ifs_ens', NOW, source)
        self.assertEqual(result['publishedRun'], RUN)
        self.assertEqual(result['frames'], 183)
        self.assertEqual(result['catalogueStatus'], 'valid')
        self.assertEqual(result['status'], 'error')
        self.assertNotIn('availableRun', result)
        self.assertIn('503', result['message'])

    def test_incomplete_catalogue_is_never_current(self):
        data = manifest(); data['complete'] = False
        source = SimpleNamespace(CONFIG={'ifs_ens': {}}, discover=MagicMock(return_value=NOW.replace(hour=0)))
        with patch.object(audit, 'public', return_value=data): result = audit.audit('ifs_ens', NOW, source)
        self.assertEqual(result['status'], 'error')
        self.assertEqual(result['failureStage'], 'catalogue')
        self.assertEqual(result['availableRun'], RUN)
        self.assertNotIn('publishedRun', result)

    def test_equivalent_timestamp_formats_are_current(self):
        data = manifest(run='2026-10-10T00:00:00+00:00')
        source = SimpleNamespace(CONFIG={'ifs_ens': {}}, discover=MagicMock(return_value=NOW.replace(hour=0)))
        with patch.object(audit, 'public', return_value=data): result = audit.audit('ifs_ens', NOW, source)
        self.assertEqual(result['status'], 'current')
        self.assertEqual(result['lagHours'], 0)

    def test_missing_frame_panel_or_member_count_is_rejected(self):
        data = manifest()
        for mutation in ['frame', 'panel', 'count', 'hash']:
            invalid = copy.deepcopy(data)
            if mutation == 'frame': del invalid['files']['10/0']
            if mutation == 'panel': del invalid['panels']['0']
            if mutation == 'count': invalid['count'] = 50
            if mutation == 'hash': invalid['files']['10/0']['sha256'] = 'bad'
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError): audit.validate_catalogue('ifs_ens', invalid)

    def test_derived_models_remain_auditable_during_source_outage(self):
        reports = [dict(model=model, publishedRun=RUN, status='error') for model in ['ifs_ens', 'aifs_ens']]
        with patch.object(audit, 'public', return_value={'complete': True, 'run': RUN}): result = audit.derived(reports)
        diagnostics = [r for r in result if r['model'] == 'diagnostics']
        self.assertEqual({r['sourceModel'] for r in diagnostics}, {'ifs_ens', 'aifs_ens'})
        self.assertTrue(all(r['status'] == 'current' for r in diagnostics))

    def test_direct_discovery_does_not_call_outage_an_older_cycle(self):
        with patch.object(audit, 'fetch', side_effect=http_error()) as fetch:
            with self.assertRaises(urllib.error.HTTPError): audit.direct_latest('gfs', NOW)
        self.assertEqual(fetch.call_count, 1)


class DiscoveryTests(unittest.TestCase):
    def test_ifs_only_probes_full_horizon_cycles(self):
        with patch.object(prep, 'ec_entries', return_value=entries('ifs_ens')) as inventory:
            run = prep.discover('ifs_ens', NOW)
        self.assertEqual(run.hour, 0)
        self.assertEqual(inventory.call_args.args[2], 360)

    def test_aifs_retains_six_hourly_cycles(self):
        with patch.object(prep, 'ec_entries', return_value=entries('aifs_ens')):
            run = prep.discover('aifs_ens', NOW)
        self.assertEqual(run.hour, 6)

    def test_missing_cycle_falls_back(self):
        with patch.object(prep, 'ec_entries', side_effect=[http_error(404), entries('ifs_ens')]) as inventory:
            run = prep.discover('ifs_ens', NOW)
        self.assertEqual(run, datetime(2026, 10, 9, 12, tzinfo=timezone.utc))
        self.assertEqual(inventory.call_count, 2)

    def test_incomplete_ensemble_falls_back(self):
        with patch.object(prep, 'ec_entries', side_effect=[entries('ifs_ens')[:-1], entries('ifs_ens')]):
            run = prep.discover('ifs_ens', NOW)
        self.assertEqual(run.day, 9)
        self.assertEqual(run.hour, 12)

    def test_outage_timeout_and_invalid_json_do_not_fall_back(self):
        for error in [http_error(503), http_error(500), TimeoutError('offline'), ValueError('invalid JSON')]:
            with self.subTest(error=type(error).__name__), patch.object(prep, 'ec_entries', side_effect=error) as inventory:
                with self.assertRaises(type(error)): prep.discover('ifs_ens', NOW)
                self.assertEqual(inventory.call_count, 1)

    def test_inventory_probes_use_bounded_retries(self):
        with patch.object(prep, 'request', return_value=b'') as fetch:
            prep.ec_entries('ifs_ens', NOW.replace(hour=0), 360, [10], probe=True)
        self.assertTrue(all(call.kwargs['attempts'] == 3 for call in fetch.call_args_list))


class RecoveryTests(unittest.TestCase):
    def run_record(self, identifier=1, status='completed', created=None, updated=None):
        return dict(id=identifier, status=status, html_url=f'https://example.invalid/run/{identifier}',
                    created_at=audit.stamp(created or NOW-timedelta(hours=2)),
                    updated_at=audit.stamp(updated or NOW-timedelta(minutes=2)))

    def test_job_matching_is_exact(self):
        run = self.run_record(status='in_progress')
        with patch.object(audit, 'github', return_value={'jobs': [{'name': 'not prepare (ifs_ens)', 'status': 'in_progress'}]}):
            self.assertFalse(audit.matching_jobs('ifs_ens', run))

    def test_other_model_cooldown_does_not_block_idle_ifs(self):
        run = self.run_record()
        calls = []
        def github(endpoint, payload=None):
            calls.append((endpoint, payload))
            if '/jobs' in endpoint: return {'jobs': [{'name': 'prepare (aifs_ens)', 'status': 'completed', 'conclusion': 'success'}]}
            if '/runs?' in endpoint: return {'workflow_runs': [run]}
            return None
        with patch.object(audit, 'github', side_effect=github): result = audit.recovery('ifs_ens', True, NOW)
        self.assertEqual(result[0], 'updating')
        self.assertEqual(calls[-1][1], {'ref': 'main', 'inputs': {'model': 'ifs_ens'}})

    def test_cooldown_is_measured_from_completion(self):
        run = self.run_record()
        def github(endpoint, payload=None):
            self.assertIsNone(payload, 'Recent completed job must not be dispatched again')
            if '/jobs' in endpoint: return {'jobs': [{'name': 'prepare (ifs_ens)', 'status': 'completed', 'conclusion': 'failure'}]}
            return {'workflow_runs': [run]}
        with patch.object(audit, 'github', side_effect=github): result = audit.recovery('ifs_ens', True, NOW)
        self.assertEqual(result[0], 'behind')

    def test_old_active_job_beyond_twelve_runs_is_not_duplicated(self):
        runs = [self.run_record(i, updated=NOW-timedelta(hours=1)) for i in range(15)]
        active = self.run_record(99, status='in_progress', updated=NOW-timedelta(hours=3))
        runs.append(active)
        with patch.object(audit, 'github', return_value={'workflow_runs': runs}) as github:
            result = audit.recovery('gefs', True, NOW)
        self.assertEqual(result, ('updating', active['html_url']))
        github.assert_called_once()
        self.assertIn('per_page=100', github.call_args.args[0])

    def test_one_recovery_failure_does_not_abort_others(self):
        results = [dict(model=m, status='behind') for m in ['gefs', 'icon', 'diagnostics', 'diagnostics']]
        def recover(model, enabled, now):
            if model == 'gefs': raise TimeoutError('API timeout')
            return 'updating', f'https://example.invalid/{model}'
        with patch.object(audit, 'recovery', side_effect=recover) as recovery:
            audit.recover_results(results, True, NOW)
        self.assertEqual(results[0]['status'], 'error')
        self.assertTrue(all(r['status'] == 'updating' for r in results[1:]))
        self.assertEqual(recovery.call_count, 3)


if __name__ == '__main__':
    unittest.main()
