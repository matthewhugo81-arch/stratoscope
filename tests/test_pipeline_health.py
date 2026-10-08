import importlib.util
from datetime import datetime, timezone
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('health',Path(__file__).parents[1]/'scripts/check-pipelines.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
NOW=datetime(2026,10,8,10,tzinfo=timezone.utc)

class HealthTests(unittest.TestCase):
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
