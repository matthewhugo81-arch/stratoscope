import importlib.util
from datetime import datetime, timezone
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('health',Path(__file__).parents[1]/'scripts/check-pipelines.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
NOW=datetime(2026,10,8,10,tzinfo=timezone.utc)

class HealthTests(unittest.TestCase):
    def test_vortex_context_must_cover_the_complete_matched_timeline(self):
        run='2026-10-08T06:00:00.000Z'
        data=dict(run=run,complete=True,timelineComplete=True,count=31,files={str(h):{} for h in range(0,385,12)})
        with patch.object(h,'public',return_value=data):
            self.assertEqual(h.derived([dict(model='gefs',publishedRun=run)])[-1]['status'],'behind')
            data.update(contextComplete=True,contextHours=list(range(0,385,12)))
            self.assertEqual(h.derived([dict(model='gefs',publishedRun=run)])[-1]['status'],'behind')
            data['heatFlux']=dict(path='2026100806/gefs/heat-flux-'+('a'*64)+'.json',sha256='a'*64,bytes=25000)
            self.assertEqual(h.derived([dict(model='gefs',publishedRun=run)])[-1]['status'],'current')
            data['contextHours'][-1]=0
            self.assertEqual(h.derived([dict(model='gefs',publishedRun=run)])[-1]['status'],'behind')

    def test_era5_reports_saved_years_without_duplicate_active_request(self):
        run={'id':1,'status':'in_progress','created_at':'2026-10-08T09:00:00Z','html_url':'https://github.com/run/1'}
        def api(path,payload=None):
            self.assertIsNone(payload)
            if '/git/ref/' in path:return {'object':{'sha':'snapshot'}}
            if '/git/trees/' in path:return {'tree':[{'type':'blob','path':f'checkpoints/era5/{y}.json'} for y in range(1993,2008)]}
            return {'workflow_runs':[] if 'prepare-seasonal' in path else [run]}
        with patch.object(h,'github',side_effect=api):result=h.era_reference(True,NOW)
        self.assertEqual(result['status'],'updating')
        self.assertEqual(len(result['completedYears']),15)
        self.assertEqual(result['nextYear'],2008)

    def test_era5_resumes_after_timeout_but_never_overlaps_legacy_import(self):
        sent=[]
        run={'id':1,'status':'completed','conclusion':'cancelled','created_at':'2026-10-08T03:00:00Z','html_url':'https://github.com/run/1'}
        legacy=[]
        def api(path,payload=None):
            if payload:sent.append((path,payload));return
            if '/jobs' in path:return {'jobs':[{'name':'prepare (era5)','status':'in_progress'}]}
            return {'workflow_runs':legacy if 'prepare-seasonal' in path else [run]}
        with patch.object(h,'github',side_effect=api):
            self.assertEqual(h.recovery('era5',True,NOW)[0],'updating')
            self.assertEqual(sent,[('/actions/workflows/prepare-era5.yml/dispatches',{'ref':'main'})])
            sent.clear();legacy.append({**run,'status':'in_progress'})
            self.assertEqual(h.recovery('era5',True,NOW)[0],'updating')
            self.assertEqual(sent,[])

    def test_era5_complete_reference_validates_before_stopping_recovery(self):
        days={(datetime(2000,1,1)+h.timedelta(days=i)).strftime('%m-%d') for i in range(366)}
        data=dict(version=2,complete=True,period=[1993,2016],latitude=60,level=10,units='m/s',source='https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels',daily={d:20 for d in days},counts={d:6 if d=='02-29' else 24 for d in days})
        def api(path,payload=None):
            if '/git/ref/' in path:return {'object':{'sha':'snapshot'}}
            return {'tree':[{'type':'blob','path':'climate/era5-1993-2016.json'}]}
        with patch.object(h,'github',side_effect=api),patch.object(h,'public',return_value=data),patch.object(h,'recovery') as recovery:
            self.assertEqual(h.era_reference(True,NOW)['status'],'complete')
            data['counts']['02-29']=24
            self.assertEqual(h.era_reference(True,NOW)['status'],'error')
            recovery.assert_not_called()

    def test_active_model_not_duplicated(self):
        run={'id':1,'status':'in_progress','created_at':'2026-10-08T09:00:00Z','html_url':'https://github.com/run/1'}
        def api(path,payload=None):
            self.assertIsNone(payload)
            return {'workflow_runs':[run]} if '/workflows/' in path else {'jobs':[{'name':'prepare (ifs_ens)','status':'in_progress'}]}
        with patch.object(h,'github',side_effect=api):self.assertEqual(h.recovery('ifs_ens',True,NOW),('updating',run['html_url']))
    def test_other_model_does_not_block_recovery(self):
        run={'id':1,'status':'in_progress','created_at':'2026-10-08T09:00:00Z','html_url':'https://github.com/run/1'}
        sent=[]
        def api(path,payload=None):
            if payload:sent.append((path,payload));return
            return {'workflow_runs':[run]} if '/workflows/' in path else {'jobs':[{'name':'prepare (aifs_ens)','status':'in_progress'},{'name':'prepare (ifs_ens)','status':'completed'}]}
        with patch.object(h,'github',side_effect=api):self.assertEqual(h.recovery('ifs_ens',True,NOW)[0],'updating')
        self.assertEqual(len(sent),1);self.assertEqual(sent[0][1],{'ref':'main','inputs':{'model':'ifs_ens'}})
    def test_fresh_failed_run_not_retried_repeatedly(self):
        run={'id':1,'status':'completed','conclusion':'failure','created_at':'2026-10-08T09:55:00Z','html_url':'https://github.com/run/1'}
        with patch.object(h,'github',return_value={'workflow_runs':[run]}) as api:
            self.assertEqual(h.recovery('gefs',True,NOW)[0],'behind');self.assertEqual(api.call_count,1)
    def test_queued_matrix_without_jobs_not_duplicated(self):
        with patch.object(h,'github',return_value={'jobs':[]}):self.assertTrue(h.matching_jobs('ifs_ens',{'id':1,'status':'queued'}))
    def test_incomplete_member_panels_rejected(self):
        m=dict(model='ifs_ens',complete=True,count=51,maxHour=360,step=6,levels=[10,50,100],run='2026-10-08T00:00:00.000Z',files={},panels={})
        for l in m['levels']:
            for t in range(0,361,6):m['files'][f'{l}/{t}']=dict(path=f'2026100800/{l}/{t}.bin.gz',bytes=100,sha256='a'*64)
        with self.assertRaises(AssertionError):h.validate_catalogue('ifs_ens',m)
        for t in range(0,361,6):m['panels'][str(t)]=dict(path=f'2026100800/10/{t}.members.bin.gz',bytes=100,sha256='a'*64)
        h.validate_catalogue('ifs_ens',m)
        m['count']=50
        with self.assertRaises(AssertionError):h.validate_catalogue('ifs_ens',m)

if __name__=='__main__':unittest.main()
