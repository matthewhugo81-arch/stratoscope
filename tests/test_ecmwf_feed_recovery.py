"""Offline regression tests: no provider requests, credentials or dispatches."""
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT/path)
    module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module
transport = load('ecmwf_transport_tests', 'scripts/ecmwf_transport.py')
health = load('pipeline_freshness_tests', 'scripts/pipeline_freshness.py')
audit = load('pipeline_feed_audit_tests', 'scripts/check-pipelines.py')
prep = audit.preparation()
NOW = datetime(2026,10,10,22,tzinfo=timezone.utc)
RUN = NOW.replace(hour=12)
OLD = NOW.replace(hour=0)

def error(code):
    return urllib.error.HTTPError('https://example.invalid/test.index',code,'test',{},None)

def entries():
    return [('u',0,20,m,l,k) for m in range(51) for l in [10,50,100] for k in prep.KEYS]

class Mirrors(unittest.TestCase):
    def inventory(self, read):
        return transport.complete_inventory(read,'ifs_ens',RUN,360,[10,50,100],51,prep.KEYS)
    def test_google_replica_is_first(self):
        self.assertEqual(transport.ORIGINS[0],'https://storage.googleapis.com/ecmwf-open-data')
        self.assertTrue(prep.ec_base('ifs_ens',RUN,0).startswith(transport.ORIGINS[0]+'/'))
        self.assertEqual(prep.EC_ORIGIN,'https://data.ecmwf.int/forecasts')
    def test_non_official_source_rejected(self):
        with self.assertRaises(ValueError): transport.validate_origin('https://example.invalid')
    def test_missing_google_hour_uses_official_aws_before_throttled_portal(self):
        self.assertEqual(transport.ORIGINS[1], 'https://d2zvc0wgha4k2l.cloudfront.net')
        self.assertEqual(transport.ORIGINS[-1], 'https://data.ecmwf.int/forecasts')
        calculate = Mock(side_effect=[error(404), {'verified': True}, error(429)])
        result = transport.calculate_hour(calculate, 'ifs_ens', RUN, 24, [10,50,100], 2)
        self.assertEqual(result, {'verified': True})
        self.assertEqual(calculate.call_count, 2)
        self.assertEqual([c.kwargs['origin'] for c in calculate.call_args_list], list(transport.ORIGINS[:2]))
        self.assertTrue(all(c.args[1:4] == (RUN,24,[10,50,100]) for c in calculate.call_args_list))
    def test_terminal_inventory_keeps_the_canonical_fallback(self):
        read = Mock(side_effect=[error(404), entries(), error(429)])
        self.assertEqual(len(self.inventory(read)), 612)
        self.assertEqual(read.call_count, 2)
        self.assertEqual(read.call_args_list[1].kwargs['origin'], transport.ORIGINS[-1])
    def test_cloudfront_missing_object_503_cannot_block_cycle_discovery(self):
        def read(model, run, hour, levels, probe=False, origin=None):
            if origin == transport.ORIGINS[1]:
                raise error(503)
            if run == RUN:
                raise error(404)
            self.assertEqual(run, OLD)
            return entries()
        with patch.object(prep, 'ec_entries', side_effect=read) as inventory:
            self.assertEqual(prep.discover('ifs_ens', NOW), OLD)
        self.assertNotIn(transport.ORIGINS[1], [c.kwargs['origin'] for c in inventory.call_args_list])
    def test_inventory_error_uses_another_source_for_the_same_cycle(self):
        read=Mock(side_effect=[error(429),entries()])
        self.assertEqual(len(self.inventory(read)),612)
        self.assertEqual(read.call_count,2)
        self.assertTrue(all(c.args[1]==RUN for c in read.call_args_list))
    def test_missing_replica_does_not_hide_a_newer_cycle_on_another(self):
        read=Mock(side_effect=[error(404),entries()])
        self.inventory(read)
        self.assertTrue(all(c.args[1]==RUN for c in read.call_args_list))
    def test_partial_replica_cannot_supply_a_reduced_ensemble(self):
        read=Mock(side_effect=[entries()[:-1],entries()])
        self.assertEqual(len(self.inventory(read)),612)
        self.assertEqual(read.call_count,2)
    def test_duplicates_rejected(self):
        data=entries();data[-1]=data[0]
        with self.assertRaises(AssertionError): self.inventory(Mock(return_value=data))
    def test_every_source_absent_allows_prior_cycle(self):
        with self.assertRaises(urllib.error.HTTPError) as raised:self.inventory(Mock(side_effect=error(404)))
        self.assertEqual(raised.exception.code,404)
    def test_outage_is_not_evidence_of_absence(self):
        read=Mock(side_effect=[error(503),error(404),error(404)])
        with self.assertRaises(urllib.error.HTTPError) as raised:self.inventory(read)
        self.assertEqual(raised.exception.code,503)
    def test_hour_failover_reindexes_same_model_cycle_hour(self):
        calculate=Mock(side_effect=[error(429),{'verified':True}])
        result=transport.calculate_hour(calculate,'aifs_ens',RUN,42,[10,50,100],2)
        self.assertTrue(result['verified'])
        self.assertEqual(calculate.call_count,2)
        self.assertEqual(calculate.call_args_list[0].args,calculate.call_args_list[1].args)
        self.assertNotEqual(calculate.call_args_list[0].kwargs['origin'],calculate.call_args_list[1].kwargs['origin'])
    def test_bad_scientific_data_are_not_retried_or_relaxed(self):
        calculate=Mock(side_effect=AssertionError('wrong native GRIB member'))
        with self.assertRaises(AssertionError):transport.calculate_hour(calculate,'ifs_ens',RUN,42,[10],2)
        self.assertEqual(calculate.call_count,1)
    def test_gefs_path_is_unchanged(self):
        calculate=Mock(return_value={})
        transport.calculate_hour(calculate,'gefs',RUN,0,[10],2)
        self.assertEqual(calculate.call_count,1)
        self.assertNotIn('origin',calculate.call_args.kwargs)
    def test_explicit_source_keeps_index_and_grib_on_same_host(self):
        raw=b'{"levtype":"pl","levelist":"10","param":"u","date":"20261010","time":"1200","step":0,"type":"pf","number":"1","_offset":0,"_length":100}'
        control=raw.replace(b'"pf"',b'"fc"')
        with patch.object(prep,'request',side_effect=[raw,control]) as request:
            values=prep.ec_entries('ifs_ens',RUN,0,[10],origin=transport.ORIGINS[1])
        self.assertTrue(all(e[0].startswith(transport.ORIGINS[1]+'/') for e in values))
        self.assertTrue(all(c.args[0].startswith(transport.ORIGINS[1]+'/') for c in request.call_args_list))

class RecoveryHealth(unittest.TestCase):
    def report(self, model='ifs_ens'):
        return dict(model=model,publishedRun=health.iso(OLD),availableRun=health.iso(RUN),
                    preparedAt=health.iso(OLD+timedelta(hours=8)),status='updating',workflowUrl='active')
    def test_recent_processing_remains_updating(self):
        r=self.report();health.record_health([r],None,NOW)
        self.assertEqual(r['status'],'updating')
        self.assertEqual(r['backlogMinutes'],0)
    def test_three_hour_backlog_is_error_even_with_running_recovery(self):
        r=self.report();old={**r,'behindSince':health.iso(NOW-timedelta(hours=4))}
        health.record_health([r],{'models':[old],'checkedAt':health.iso(NOW-timedelta(hours=1))},NOW)
        self.assertEqual(r['status'],'error');self.assertEqual(r['recoveryStatus'],'updating')
        self.assertEqual(r['backlogMinutes'],240)
    def test_restarts_and_new_upstream_cycles_do_not_reset_backlog_clock(self):
        r=self.report();old={**r,'availableRun':health.iso(RUN-timedelta(hours=6)),'behindSince':health.iso(NOW-timedelta(hours=5))}
        health.record_health([r],{'models':[old]},NOW)
        self.assertEqual(r['backlogMinutes'],300)
    def test_complete_publication_is_current(self):
        r=self.report();r.update(publishedRun=health.iso(RUN),status='current')
        health.record_health([r],None,NOW)
        self.assertEqual(r['status'],'current');self.assertNotIn('behindSince',r)
    def test_failed_job_is_not_hidden_by_new_attempt(self):
        r=self.report()
        def api(path):
            if '/workflows/' in path:return {'workflow_runs':[{'id':123,'status':'completed','conclusion':'failure','html_url':'failure-link'}]}
            return {'jobs':[{'name':'prepare (ifs_ens)','conclusion':'failure','completed_at':health.iso(NOW-timedelta(hours=1))}]}
        health.record_health([r],None,NOW,api,{'ifs_ens':'prepare-ensembles.yml'})
        self.assertEqual(r['status'],'error');self.assertEqual(r['lastFailedWorkflow'],'failure-link')
        self.assertEqual(r['recoveryStatus'],'updating')
    def test_other_matrix_model_failure_does_not_poison_ifs(self):
        r=self.report()
        def api(path):
            if '/workflows/' in path:return {'workflow_runs':[{'id':123,'status':'completed','conclusion':'failure','html_url':'failure-link'}]}
            return {'jobs':[{'name':'prepare (aifs_ens)','conclusion':'failure','completed_at':health.iso(NOW-timedelta(hours=1))}]}
        health.record_health([r],None,NOW,api,{'ifs_ens':'prepare-ensembles.yml'})
        self.assertEqual(r['status'],'updating')
    def test_diagnostics_do_not_mislabel_stale_parent_as_current(self):
        parent=self.report();parent['status']='error'
        child=dict(model='diagnostics',sourceModel='ifs_ens',status='current',publishedRun=health.iso(OLD),availableRun=health.iso(OLD))
        health.record_health([parent,child],None,NOW)
        self.assertEqual(child['status'],'error');self.assertTrue(child['alignedWithPublishedInputs'])
        self.assertEqual(child['upstreamAvailableRun'],health.iso(RUN))
    def test_three_hour_schedule_retained(self):
        text=(ROOT/'.github/workflows/check-pipelines.yml').read_text()
        self.assertIn("cron: '11 */3 * * *'",text)


class AlertGating(unittest.TestCase):
    def provider429(self, model='aifs_ens', published=RUN):
        return dict(model=model, status='error', failureStage='provider',
                    sourceStatus='unavailable', catalogueStatus='valid',
                    publishedRun=health.iso(published),
                    message='HTTPError: HTTP Error 429: Too Many Requests')
    def test_recent_valid_ensemble_remains_reported_but_does_not_email(self):
        report=self.provider429()
        self.assertFalse(health.requires_alert([report], [], None, NOW))
        self.assertEqual(report['status'], 'error')
    def test_persistent_429_with_stale_publication_still_alerts(self):
        self.assertTrue(health.requires_alert([self.provider429(published=OLD)], [], None, NOW))
    def test_ifs_ens_has_its_own_publication_lag_tolerance(self):
        self.assertFalse(health.requires_alert([self.provider429('ifs_ens', OLD)], [], None, NOW))
        self.assertTrue(health.requires_alert([self.provider429('ifs_ens', OLD-timedelta(hours=12))], [], None, NOW))
    def test_missing_verified_publication_or_other_provider_failure_alerts(self):
        row=self.provider429();row.pop('publishedRun')
        self.assertTrue(health.requires_alert([row], [], None, NOW))
        row=self.provider429();row['message']='Invalid native GRIB inventory'
        self.assertTrue(health.requires_alert([row], [], None, NOW))
    def test_existing_true_backlog_failure_still_alerts(self):
        self.assertTrue(health.requires_alert([dict(model='gefs',status='error',failureStage='freshness')], [], None, NOW))
    def test_aligned_diagnostic_inherits_parent_error_without_second_alert(self):
        parent=self.provider429()
        child=dict(model='diagnostics', sourceModel='aifs_ens', status='error',
                   failureStage='upstream', alignedWithPublishedInputs=True)
        self.assertFalse(health.requires_alert([parent,child], [], None, NOW))
    def test_seasonal_error_still_alerts(self):
        self.assertTrue(health.requires_alert([], [dict(model='ecmf',status='error')], None, NOW))

if __name__=='__main__':unittest.main()
