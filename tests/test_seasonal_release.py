"""Offline seasonal release/planning tests; Python standard library only."""
import copy
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from seasonal_config import MODELS, SOURCE, current_forecast, forecast_dates, forecast_interval, iso, latest, starts_for
spec = importlib.util.spec_from_file_location('seasonal_plan', SCRIPTS/'plan-seasonal-update.py')
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)
OCT = datetime(2026, 10, 1, tzinfo=timezone.utc)
SEP = OCT.replace(month=9)
AFTER_RELEASE = OCT.replace(day=10, hour=12)


def publication(model='egrr', issue=OCT):
    cfg = MODELS[model]
    dates = [iso(d) for d in forecast_dates(model, issue)]
    members = [dict(id=f'{start:%Y%m%d}-{i}', start=iso(start), values=[9.0]*len(dates))
               for start in starts_for(model, issue) for i in range(cfg['per_start'])]
    return dict(version=2, complete=True, model=model, system=cfg['system'], name=cfg['name'],
                source=SOURCE, nominal=iso(issue), preparedAt=iso(AFTER_RELEASE),
                latitude=60, level=10, units='m/s', sampling=f'{forecast_interval(model)}-hourly instantaneous',
                dates=dates, members=members, memberCount=cfg['forecast'],
                mean=[9.0]*len(dates), easterlyFraction=[0.0]*len(dates))


class ReleaseTests(unittest.TestCase):
    def test_ecmwf_released_on_sixth_at_noon_utc(self):
        release = OCT.replace(day=6, hour=12)
        self.assertEqual(latest('ecmf', release-timedelta(microseconds=1)), SEP)
        self.assertEqual(latest('ecmf', release), OCT)

    def test_other_six_systems_released_on_tenth_at_noon(self):
        for model in MODELS:
            if model == 'ecmf': continue
            with self.subTest(model=model):
                self.assertEqual(latest(model, AFTER_RELEASE-timedelta(microseconds=1)), SEP)
                self.assertEqual(latest(model, AFTER_RELEASE), OCT)
                self.assertEqual(latest(model, AFTER_RELEASE+timedelta(hours=1)), OCT)

    def test_uk_summer_time_does_not_release_an_hour_early(self):
        local = timezone(timedelta(hours=1))
        self.assertEqual(latest('egrr', datetime(2026, 10, 10, 12, 59, tzinfo=local)), SEP)
        self.assertEqual(latest('egrr', datetime(2026, 10, 10, 13, tzinfo=local)), OCT)

    def test_year_boundary_and_leap_month(self):
        self.assertEqual(latest('egrr', datetime(2027, 1, 1, tzinfo=timezone.utc)), datetime(2026, 12, 1, tzinfo=timezone.utc))
        self.assertEqual(latest('egrr', datetime(2024, 3, 5, tzinfo=timezone.utc)), datetime(2024, 2, 1, tzinfo=timezone.utc))

    def test_unknown_model_and_naive_datetime_rejected(self):
        with self.assertRaises(ValueError): latest('not-a-model', AFTER_RELEASE)
        with self.assertRaises(ValueError): latest('egrr', AFTER_RELEASE.replace(tzinfo=None))


class PublicationTests(unittest.TestCase):
    def test_all_valid_models_are_current(self):
        for model in MODELS:
            with self.subTest(model=model): self.assertTrue(current_forecast(publication(model), model, OCT))

    def test_old_issue_is_not_current_and_newer_issue_is_not_downgraded(self):
        self.assertFalse(current_forecast(publication(issue=SEP), 'egrr', OCT))
        self.assertTrue(current_forecast(publication(issue=OCT.replace(month=11)), 'egrr', OCT))

    def test_absent_or_incomplete_publications_are_not_skipped(self):
        for data in [None, {}, [], {'version': 2, 'complete': False}]:
            self.assertFalse(current_forecast(data, 'egrr', OCT))
        data = publication(); data['complete'] = False
        self.assertFalse(current_forecast(data, 'egrr', OCT))

    def test_member_counts_dates_units_and_source_are_preserved(self):
        data = publication()
        for key, value in [('memberCount', 49), ('units', 'mph'), ('source', 'unverified'), ('system', '600'), ('latitude', 59), ('sampling', '24-hourly instantaneous')]:
            with self.subTest(key=key):
                bad = {**data, key: value}
                self.assertFalse(current_forecast(bad, 'egrr', OCT))
        for field in ['dates', 'members', 'mean', 'easterlyFraction']:
            with self.subTest(field=field):
                bad = {**data, field: data[field][:-1]}
                self.assertFalse(current_forecast(bad, 'egrr', OCT))

    def test_invalid_values_duplicates_and_shifted_start_dates_rejected(self):
        for fault in ['nan', 'missing-value', 'duplicate', 'wrong-start', 'wrong-mean', 'wrong-fraction']:
            data = publication()
            if fault == 'nan': data['members'][0]['values'][0] = float('nan')
            if fault == 'missing-value': data['members'][0]['values'].pop()
            if fault == 'duplicate': data['members'][0]['id'] = data['members'][1]['id']
            if fault == 'wrong-start': data['members'][0]['start'] = iso(SEP)
            if fault == 'wrong-mean': data['mean'][0] = 8
            if fault == 'wrong-fraction': data['easterlyFraction'][0] = .5
            with self.subTest(fault=fault): self.assertFalse(current_forecast(data, 'egrr', OCT))


class PlanTests(unittest.TestCase):
    def test_all_current_skips_every_download(self):
        self.assertEqual(planner.plan(now=AFTER_RELEASE, reader=publication), [])

    def test_only_missing_glosea_issue_is_selected(self):
        def read(model): return publication(model, SEP if model == 'egrr' else OCT)
        self.assertEqual(planner.plan(now=AFTER_RELEASE, reader=read), ['egrr'])

    def test_before_tenth_only_ecmwf_october_is_due(self):
        now = OCT.replace(day=8, hour=13)
        def read(model): return publication(model, OCT if model == 'ecmf' else SEP)
        self.assertEqual(planner.plan(now=now, reader=read), [])

    def test_missing_file_selects_only_requested_model(self):
        read = Mock(return_value=None)
        self.assertEqual(planner.plan('egrr', now=AFTER_RELEASE, reader=read), ['egrr'])
        read.assert_called_once_with('egrr')

    def test_transport_failure_does_not_start_duplicate_downloads(self):
        read = Mock(side_effect=TimeoutError('public read failed'))
        with self.assertRaises(TimeoutError): planner.plan('egrr', now=AFTER_RELEASE, reader=read)

    def test_manual_phases_are_preserved_without_public_reads(self):
        read = Mock(side_effect=AssertionError('manual planning should not download publications'))
        self.assertEqual(planner.plan('egrr', 'forecast', False, reader=read), ['egrr'])
        self.assertEqual(planner.plan('all', 'forecast', False, reader=read), list(MODELS))
        self.assertEqual(planner.plan('ecmf', 'climate', False, reader=read), ['ecmf'])
        self.assertEqual(planner.plan('all', 'era5', False, reader=read), ['era5'])
        read.assert_not_called()

    def test_schedule_never_triggers_era5_or_hindcast_imports(self):
        for phase in ['era5', 'climate']:
            with self.subTest(phase=phase), self.assertRaises(ValueError): planner.plan(phase=phase)


if __name__ == '__main__':
    unittest.main()
