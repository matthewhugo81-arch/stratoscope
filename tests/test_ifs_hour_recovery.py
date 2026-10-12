"""Offline regression tests for the 12 October 00Z IFS ENS delivery failure."""
from datetime import datetime, timezone, timedelta
from email.utils import format_datetime
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location(
    'ecmwf_transport', Path(__file__).resolve().parents[1] / 'scripts/ecmwf_transport.py')
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)


class IfsHourRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.run = datetime(2026, 10, 12, tzinfo=timezone.utc)
        self.args = ('ifs_ens', self.run, 0, [10, 50, 100], 2)

    def error(self, origin, status, headers=None):
        return urllib.error.HTTPError(origin, status, 'test provider error', headers or {}, None)

    def test_missing_google_503_aws_429_portal_revisits_same_hour(self):
        calls = []
        result = object()
        def calculate(*args, origin):
            calls.append((args, origin))
            if len(calls) <= 3:
                raise self.error(origin, (404, 503, 429)[len(calls)-1])
            return result
        with patch.object(transport.time, 'sleep') as sleep:
            self.assertIs(transport.calculate_hour(calculate, *self.args), result)
        self.assertEqual([origin for _, origin in calls], [*transport.ORIGINS, transport.ORIGINS[0]])
        self.assertTrue(all(args[:5] == self.args for args, _ in calls))
        sleep.assert_called_once_with(120)

    def test_success_does_not_retry_or_sleep(self):
        calls = []
        def calculate(*args, **kwargs):
            calls.append((args, kwargs))
            return 'complete'
        with patch.object(transport.time, 'sleep') as sleep:
            self.assertEqual(transport.calculate_hour(calculate, *self.args), 'complete')
        self.assertEqual(len(calls), 1)
        sleep.assert_not_called()

    def test_retry_after_is_honoured_across_whole_hour_passes(self):
        calls = []
        def calculate(*args, origin):
            calls.append(origin)
            if len(calls) <= 3:
                raise self.error(origin, 429, {'Retry-After': '900'})
            return 'complete'
        with patch.object(transport.time, 'monotonic', return_value=0), patch.object(transport.time, 'sleep') as sleep:
            self.assertEqual(transport.calculate_hour(calculate, *self.args), 'complete')
        sleep.assert_called_once_with(900)

    def test_retry_after_http_date_and_invalid_values(self):
        future = format_datetime(datetime.now(timezone.utc) + timedelta(seconds=600))
        self.assertGreater(transport._retry_after_seconds(self.error('x', 429, {'Retry-After': future})), 590)
        for value in ('not-a-date', 'NaN', 'inf', '-5', ''):
            self.assertEqual(transport._retry_after_seconds(self.error('x', 429, {'Retry-After': value})), 0)

    def test_persistent_failure_is_bounded_and_never_returns_success(self):
        calls = []
        def calculate(*args, origin):
            calls.append(origin)
            raise self.error(origin, 503)
        with patch.object(transport.time, 'sleep') as sleep:
            with self.assertRaises(urllib.error.HTTPError):
                transport.calculate_hour(calculate, *self.args)
        self.assertEqual(calls, list(transport.ORIGINS) * 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [120, 300])

    def test_grib_member_level_run_and_value_validation_errors_are_not_retried(self):
        for message in ('Wrong variable', 'Incomplete or duplicate ensemble', 'wrong run', 'Incomplete field'):
            calls = []
            def calculate(*args, **kwargs):
                calls.append(args)
                raise AssertionError(message)
            with patch.object(transport.time, 'sleep') as sleep:
                with self.assertRaisesRegex(AssertionError, message):
                    transport.calculate_hour(calculate, *self.args)
            self.assertEqual(len(calls), 1)
            sleep.assert_not_called()

    def test_non_retryable_http_error_fails_immediately(self):
        for status in (400, 401, 403):
            calls = []
            def calculate(*args, origin):
                calls.append(origin)
                raise self.error(origin, status)
            with patch.object(transport.time, 'sleep') as sleep:
                with self.assertRaises(urllib.error.HTTPError):
                    transport.calculate_hour(calculate, *self.args)
            self.assertEqual(len(calls), 1)
            sleep.assert_not_called()

    def test_aifs_retains_its_existing_single_replica_pass(self):
        calls = []
        def calculate(*args, origin):
            calls.append(origin)
            raise self.error(origin, 503)
        args = ('aifs_ens', *self.args[1:])
        with patch.object(transport.time, 'sleep') as sleep:
            with self.assertRaises(urllib.error.HTTPError):
                transport.calculate_hour(calculate, *args)
        self.assertEqual(calls, list(transport.ORIGINS))
        sleep.assert_not_called()

    def test_gefs_path_is_unchanged(self):
        calls = []
        def calculate(*args, **kwargs):
            calls.append((args, kwargs))
            return 'noaa'
        with patch.object(transport.time, 'sleep') as sleep:
            self.assertEqual(transport.calculate_hour(calculate, 'gefs', *self.args[1:]), 'noaa')
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1], {})
        sleep.assert_not_called()

    def test_missing_origins_are_not_slept_or_retried(self):
        with patch.object(transport.time, 'sleep') as sleep:
            with self.assertRaisesRegex(ValueError, 'No official download source'):
                transport.calculate_hour(lambda *args: None, *self.args, origins=())
        sleep.assert_not_called()

    def test_unapproved_origin_never_calls_downloader(self):
        calls = []
        with self.assertRaisesRegex(ValueError, 'Only official ECMWF'):
            transport.calculate_hour(lambda *args: calls.append(args), *self.args, origins=('https://unapproved.invalid',))
        self.assertEqual(calls, [])

    def test_timeout_can_recover_without_changing_worker_count_or_writers(self):
        calls = []
        panels, heat = object(), object()
        def calculate(*args, origin):
            calls.append(args)
            if len(calls) <= 3:
                raise TimeoutError('temporary')
            return 'complete'
        with patch.object(transport.time, 'sleep'):
            self.assertEqual(transport.calculate_hour(calculate, *self.args, panels, heat), 'complete')
        self.assertTrue(all(args[-3:] == (2, panels, heat) for args in calls))


if __name__ == '__main__':
    unittest.main()
