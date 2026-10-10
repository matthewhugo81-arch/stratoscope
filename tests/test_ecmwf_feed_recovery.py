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

if __name__=='__main__':unittest.main()
