import copy
from datetime import datetime,timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import importlib.util
import numpy as np
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
import ssw_research_archive as archive
from ssw_wavepacket import envelope,lagged_predictor
from ssw_era5_requests import requests

def fixture():
    run='2026-10-09T00:00:00Z'
    m=dict(model='gefs',run=run,complete=True,count=31,maxHour=384,step=6,
        panels={str(h):dict(path=f'2026100900/10/{h}.members.bin.gz',bytes=100,sha256='a'*64) for h in range(0,385,6)})
    mb=json.dumps(m).encode()
    d=dict(version=1,model='gefs',run=run,complete=True,level=10,count=31,maxHour=384,
        inputSha256=archive.sha(mb),windBasis='native 60N full longitude circle',temperatureBasis='test grid',
        points=[dict(hour=h,wind=[15.]*31,temperature=[-50.]*31) for h in range(0,385,6)])
    return d,m,mb

class ArchiveTests(unittest.TestCase):
    def test_repeated_capture_preserves_first_seen(self):
        d,m,mb=fixture(); now=datetime(2026,10,9,8,tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as root:
            a,new=archive.archive(Path(root),json.dumps(d).encode(),mb,now,'https://example.test')
            b,newer=archive.archive(Path(root),json.dumps(d).encode(),mb,now.replace(hour=9),'https://example.test')
            self.assertTrue(new);self.assertFalse(newer);self.assertEqual(a['firstSeenAt'],b['firstSeenAt'])

    def test_reject_lagging_diagnostics_missing_member_nan_or_lead(self):
        for defect in ('hash','member','nan','lead','future'):
            d,m,mb=fixture()
            if defect=='hash':d['inputSha256']='b'*64
            if defect=='member':d['points'][2]['wind'].pop()
            if defect=='nan':d['points'][2]['wind'][0]=float('nan')
            if defect=='lead':d['points'].pop()
            now=datetime(2026,10,8 if defect=='future' else 9,8,tzinfo=timezone.utc)
            with self.subTest(defect=defect),self.assertRaises(ValueError):archive.validate(d,m,mb,now)

    def test_comparison_uses_valid_time_not_lead_or_member_identity(self):
        old=dict(model='gefs',run='2026-10-09T00:00:00Z',points=[dict(hour=6,wind=[1,3]),dict(hour=12,wind=[10,10])])
        new=dict(model='gefs',run='2026-10-09T06:00:00Z',points=[dict(hour=0,wind=[4,2]),dict(hour=6,wind=[11,11])])
        result=archive.matched_changes(old,new)
        self.assertEqual([p['meanWindChange'] for p in result],[1,1])

    def test_crps_matches_two_member_analytic_case(self):
        score=archive.continuous_score([0,2],1)
        self.assertEqual(score['crps'],.5);self.assertEqual(score['meanError'],0)

    def test_verification_excludes_forecasts_captured_after_valid_time(self):
        d,_,_=fixture(); receipt=dict(model='gefs',run=d['run'],firstSeenAt='2026-10-09T08:00:00Z')
        truth=dict(sourceClass='reanalysis',dataset='reanalysis-era5-complete',variable='u10_60N',units='m/s',inputSha256='a'*64,
            points=[dict(validTime=f'2026-10-09T{h}:00:00Z',value=16,expver='5') for h in ('00','06','12')])
        result=archive.verify_wind(d,receipt,truth)
        self.assertEqual(len(result['scores']),1);self.assertEqual(result['scores'][0]['leadHours'],12)
        self.assertTrue(result['scores'][0]['preliminary']);self.assertFalse(result['skillClaim'])
        truth['sourceClass']='deterministic_forecast'
        with self.assertRaises(ValueError):archive.verify_wind(d,receipt,truth)

    def test_provider_retry_after_is_respected(self):
        import io
        from urllib.error import HTTPError
        from ssw_sources import Store
        class Response(io.BytesIO):
            headers={}
        error=HTTPError('https://example.test',429,'slow down',{'Retry-After':'123'},None)
        with tempfile.TemporaryDirectory() as root,patch('ssw_sources.urlopen',side_effect=[error,Response(b'field')]) as request,patch('ssw_sources.time.sleep') as sleep:
            blob,_=Store(Path(root)).get('https://example.test')
            self.assertEqual(blob,b'field');sleep.assert_called_once_with(123);self.assertEqual(request.call_count,2)

class Era5ResumeTests(unittest.TestCase):
    def test_pending_parts_do_not_block_or_claim_validation(self):
        from datetime import date
        from types import SimpleNamespace
        spec=importlib.util.spec_from_file_location('era5_retrieve_pending',Path(__file__).parents[1]/'scripts/retrieve-ssw-era5.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        wanted=requests(date(2026,10,3));downloads=[]
        def remote(name):
            entry=wanted[name]
            def download(path):
                self.assertNotEqual(name,'isentropic');downloads.append(name);Path(path).write_bytes(b'GRIB')
            return SimpleNamespace(collection_id=entry['dataset'],request=entry['request'],status='accepted' if name=='isentropic' else 'successful',download=download)
        client=SimpleNamespace(get_remote=remote)
        with tempfile.TemporaryDirectory() as root:
            root=Path(root);(root/'requests.json').write_text(json.dumps({name:dict(id=name,**entry) for name,entry in wanted.items()}))
            result=module.download(client,date(2026,10,3),root)
            self.assertEqual(result['status'],'pending');self.assertEqual(downloads,['h500','wind10'])
            self.assertFalse((root/'validated').exists());self.assertFalse((root/'combined.grib').exists())

    def test_existing_matching_requests_are_not_resubmitted(self):
        from datetime import date
        from types import SimpleNamespace
        spec=importlib.util.spec_from_file_location('era5_retrieve',Path(__file__).parents[1]/'scripts/retrieve-ssw-era5.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        wanted=requests(date(2026,10,3))
        remotes={name:SimpleNamespace(request_id=name,collection_id=entry['dataset'],request=entry['request'],status='accepted') for name,entry in wanted.items()}
        client=SimpleNamespace(get_jobs=lambda **kw:SimpleNamespace(request_ids=list(remotes),next=None),get_remote=lambda key:remotes[key],submit=lambda **kw:self.fail('Duplicate request submitted'))
        with tempfile.TemporaryDirectory() as root:
            first=module.submit(client,date(2026,10,3),Path(root))
            again=module.submit(client,date(2026,10,3),Path(root))
            self.assertEqual(first,again);self.assertEqual(set(first),set(wanted))

class PacketTests(unittest.TestCase):
    def test_known_modulated_wave_packet_and_member_first_amplitude(self):
        lon=np.arange(360);lat=np.arange(90,-1,-1);x=np.deg2rad(lon)
        amplitude=10*(1+.5*np.cos(x));v=amplitude*np.cos(6*x)
        fields=np.broadcast_to(np.stack([v,-v])[:,None,:],(2,91,360))
        packet=envelope(fields,lat,lon)
        np.testing.assert_allclose(packet['latitudeMeanEnvelope'],np.stack([amplitude,amplitude]),atol=1e-10)
        np.testing.assert_allclose(envelope(fields.mean(0),lat,lon)['latitudeMeanEnvelope'],0,atol=1e-10)

    def test_wave_one_is_not_mislabeled_synoptic_packet(self):
        v=np.broadcast_to(np.cos(np.deg2rad(np.arange(360))),(91,360))
        np.testing.assert_allclose(envelope(v,np.arange(90,-1,-1),np.arange(360))['amplitude'],0,atol=1e-10)

    def test_missing_grid_and_nan_rejected(self):
        lat=np.arange(90,-1,-1);lon=np.arange(360);v=np.zeros((91,360))
        with self.assertRaises(ValueError):envelope(v,lat,lon+1)
        v[0,0]=np.nan
        with self.assertRaises(ValueError):envelope(v,lat,lon)

    def test_mjo_lag_prevents_lookahead_and_preserves_definition(self):
        index=dict(definition='BOM_RMM',inputSha256='a'*64,sourceUrl='https://example.test/index',retrievedAt='2026-10-09T00:00:00Z',records=[dict(date='2026-10-08',rmm1=.3,rmm2=.4,phase=5)])
        result=lagged_predictor(index,'2026-10-09T08:00:00Z','2026-10-18T00:00:00Z',10)
        self.assertFalse(result['active']);self.assertEqual(result['amplitude'],.5);self.assertFalse(result['causalAttribution'])
        index['retrievedAt']='2026-10-10T00:00:00Z'
        self.assertEqual(lagged_predictor(index,'2026-10-09T08:00:00Z','2026-10-18T00:00:00Z',10)['status'],'unavailable_at_issue')

    def test_era5_request_has_collocated_isentropic_flow(self):
        from datetime import date
        req=requests(date(2026,10,3))
        self.assertEqual(req['isentropic']['request']['levtype'],'pt')
        self.assertEqual(req['isentropic']['request']['param'],'54/131/132')
        self.assertEqual(req['h500']['request']['date'],'2026-09-27/to/2026-10-03')

if __name__=='__main__':unittest.main()
