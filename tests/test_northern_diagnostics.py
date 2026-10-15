import gzip
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import struct
import unittest
import tempfile
from unittest.mock import MagicMock, patch

s=importlib.util.spec_from_file_location('diagnostics',Path(__file__).parents[1]/'scripts/prepare-diagnostics.py')
d=importlib.util.module_from_spec(s);s.loader.exec_module(d)

def panel():
    header=dict(version=1,model='gefs',run='2026-10-07T18:00:00.000Z',hour=6,level=10,count=31,scale=100,planes=3,grid=dict(nx=180,ny=46,lat0=90,lon0=0,dx=2,dy=-2),source='https://noaa-gefs-pds.s3.amazonaws.com',samples=720,zonal=[-3.5]*31)
    h=json.dumps(header).encode(); b=bytearray(31*3*46*180*4)
    # A constant field encoded with row deltas. Other planes are not used.
    for m in range(31):
        for y in range(46):struct.pack_into('<i',b,(m*3*46*180+y*180)*4,-5000)
    return gzip.compress(b'STRATP01'+struct.pack('<I',len(h))+h+b)

class DiagnosticsTests(unittest.TestCase):
    def test_parent_catalogue_uses_an_immutable_git_snapshot(self):
        sha='a'*40
        with patch.object(d.subprocess,'check_output',return_value=sha+'\trefs/heads/forecast-data-gefs\n') as git:
            self.assertEqual(d.snapshot_base('forecast-data-gefs'),(d.ROOT+sha+'/',sha))
        self.assertEqual(git.call_args.args[0][-1],'refs/heads/forecast-data-gefs')
        for advertised in ['',sha+'\trefs/heads/wrong','invalid\trefs/heads/forecast-data-gefs']:
            with patch.object(d.subprocess,'check_output',return_value=advertised):
                with self.assertRaises(ValueError):d.snapshot_base('forecast-data-gefs')

    def test_one_failed_model_does_not_prevent_other_complete_series(self):
        with patch.object(d,'prepare',side_effect=[TimeoutError('GEFS unavailable'),None,None]) as prepare:
            self.assertEqual(d.prepare_models(d.MODELS,Path('unused')),['gefs'])
        self.assertEqual([c.args[0] for c in prepare.call_args_list],list(d.MODELS))

    def test_mutable_catalogues_bypass_cdn_cache(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'current'
        with patch.object(d.urllib.request, 'urlopen', return_value=response) as download, patch.object(d.time, 'time_ns', return_value=123):
            self.assertEqual(d.fetch('https://test.invalid/latest.json', fresh=True), b'current')
        request = download.call_args.args[0]
        self.assertEqual(request.full_url, 'https://test.invalid/latest.json?_fresh=123')
        self.assertEqual(request.get_header('Cache-control'), 'no-cache')

    def test_cached_old_catalogue_cannot_skip_new_diagnostics(self):
        payload = b'verified-panel'
        digest = hashlib.sha256(payload).hexdigest()
        manifest = dict(model='ifs_ens',run='2026-10-11T00:00:00.000Z',complete=True,count=51,maxHour=360,step=6,
                        panels={str(h):dict(path=f'2026101100/10/{h}.members.bin.gz',bytes=len(payload),sha256=digest) for h in range(0,361,6)})
        stale = b'cached old catalogue'
        def fetch(url, fresh=False):
            if url.endswith('latest.json'):
                self.assertTrue(url.startswith(d.ROOT+'a'*40+'/'))
                return json.dumps(manifest).encode()
            if 'forecast-data-diagnostics' in url:
                self.assertTrue(fresh)
                return json.dumps(dict(complete=True,inputSha256=hashlib.sha256(stale).hexdigest())).encode()
            self.assertTrue(url.endswith('?sha='+digest))
            return payload
        with tempfile.TemporaryDirectory() as folder, patch.object(d,'snapshot_base',return_value=(d.ROOT+'a'*40+'/','a'*40)), patch.object(d,'fetch',side_effect=fetch), patch.object(d,'decode_panel',side_effect=lambda packed,model,run,hour:dict(hour=hour,wind=[1]*51,temperature=[-50]*51)):
            d.prepare('ifs_ens',Path(folder))
            result=json.loads((Path(folder)/'ifs_ens.json').read_text())
        self.assertEqual(result['run'],manifest['run'])
        self.assertEqual(len(result['points']),61)
        self.assertEqual(result['inputCommit'],'a'*40)

    def test_published_output_must_match_the_immutable_remote_snapshot(self):
        data=dict(model='gefs',run='2026-10-15T00:00:00.000Z',complete=True)
        with tempfile.TemporaryDirectory() as folder:
            output=Path(folder);(output/'gefs.json').write_text(json.dumps(data))
            with patch.object(d,'snapshot_base',return_value=(d.ROOT+'b'*40+'/','b'*40)), patch.object(d,'fetch',return_value=json.dumps(data).encode()) as read:
                d.verify_publication(output)
                self.assertEqual(read.call_args.args[0],d.ROOT+'b'*40+'/gefs.json')
            with patch.object(d,'snapshot_base',return_value=(d.ROOT+'b'*40+'/','b'*40)), patch.object(d,'fetch',return_value=json.dumps({**data,'run':'2026-10-14T18:00:00.000Z'}).encode()):
                with self.assertRaises(ValueError):d.verify_publication(output)

    def test_spherical_cap_area(self):
        self.assertAlmostEqual(sum(d.cap_weights()),1-math.sin(math.radians(60)),places=12)
        self.assertGreater(d.cap_weights()[-1],0)
    def test_preserves_signed_native_wind_and_constant_temperature(self):
        result=d.decode_panel(panel(),'gefs','2026-10-07T18:00:00.000Z',6)
        self.assertEqual(result['wind'],[-3.5]*31)
        self.assertEqual(result['temperature'],[-50.0]*31)
    def test_rejects_wrong_run_and_truncated_ensemble(self):
        with self.assertRaises(AssertionError):d.decode_panel(panel(),'gefs','2026-10-07T12:00:00.000Z',6)
        with self.assertRaises(AssertionError):d.decode_panel(gzip.compress(gzip.decompress(panel())[:-4]),'gefs','2026-10-07T18:00:00.000Z',6)

if __name__=='__main__':unittest.main()
