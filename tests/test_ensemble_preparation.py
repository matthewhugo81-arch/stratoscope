"""Offline checks of the full-member preparation calculation and file encoding."""
from datetime import datetime, timezone
import gzip
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

spec = importlib.util.spec_from_file_location('preparation', Path(__file__).parents[1]/'scripts/prepare-ensembles.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
RUN = datetime(2026, 10, 7, tzinfo=timezone.utc)


class PreparationTests(unittest.TestCase):
    def test_gefs_18z_is_selected_when_newer_00z_is_incomplete(self):
        now=datetime(2026,10,8,5,tzinfo=timezone.utc)
        def inventory(url,**kwargs):
            if 'gefs.20261008/00/' in url:raise FileNotFoundError('cycle still publishing')
            self.assertIn('gefs.20261007/18/',url)
            levels=[20,30,70] if 'pgrb2bp5' in url else [10,50,100]
            return '\n'.join(f'1:0:d=2026100718:{key}:{level} mb:384 hour fcst:' for level in levels for key in ['TMP','HGT','UGRD','VGRD']).encode()
        with patch.object(p,'request',side_effect=inventory):
            self.assertEqual(p.discover('gefs',now),datetime(2026,10,7,18,tzinfo=timezone.utc))
    def test_existing_complete_run_skips_download_and_cannot_regress(self):
        for stamp,complete,expected in [('2026-10-07T00:00:00.000Z',True,True),('2026-10-07T12:00:00.000Z',True,True),('2026-10-06T18:00:00.000Z',True,False),('2026-10-07T00:00:00.000Z',False,False)]:
            with patch.object(p,'request',return_value=json.dumps({'run':stamp,'complete':complete}).encode()):
                self.assertEqual(p.already_published('gefs',RUN),expected)
    def test_panel_encoding_preserves_each_native_diagnostic(self):
        values=np.zeros((51,3,46,180));values[:,0]=-60;values[:,1]=31000;values[:,2]=25
        diagnostics=[dict(value=-.00001 if i==0 else float(i),samples=1440,longitudeStep=.25,basis='native') for i in range(51)]
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'members.bin.gz';p.save_panels(path,'ifs_ens',RUN,360,values,diagnostics)
            raw=gzip.decompress(path.read_bytes());self.assertEqual(raw[:8],b'STRATP01')
            length=struct.unpack('<I',raw[8:12])[0];h=json.loads(raw[12:12+length])
            self.assertEqual(h['zonal'][0],-.00001);self.assertEqual(h['count'],51)
            packed=np.frombuffer(raw[12+length:],dtype='<i4').reshape(51,3,46,180)
            np.testing.assert_array_equal(np.cumsum(packed,axis=-1)/100,values)
    def test_full_ensemble_scalar_speed_population_sd_and_native_signed_wind(self):
        entries = [('https://test.invalid/data', (m*4+k)*20, 20, m, 10, key)
                   for m in range(51) for k, key in enumerate(p.KEYS)]
        def field(message, model, run, hour, member, level, key):
            value = {'temperature': -80+member, 'height': 30000+100*member,
                     'u': 3 if member % 2 == 0 else -3, 'v': 4}[key]
            # Intentionally differs from sampled u to ensure native diagnostics survive.
            z = {'value': -member, 'samples': 1440, 'longitudeStep': .25, 'basis': 'native'} if key == 'u' else None
            return np.full((2, 3), value, dtype=float), z
        with patch.object(p, 'ec_entries', return_value=entries), patch.object(p, 'request', side_effect=lambda url, start, length: bytes(length)), patch.object(p, 'decode', side_effect=field):
            planes, zonal = p.calculate('ifs_ens', RUN, 0, [10], 2)[10]
        self.assertEqual(planes[0][0, 0], -55)
        self.assertEqual(planes[1][0, 0], 32500)
        self.assertAlmostEqual(planes[2][0, 0], 3/51)
        self.assertEqual(planes[4][0, 0], 5)  # Mean scalar speed, not ~4 vector speed.
        self.assertAlmostEqual(planes[5][0, 0], ((51**2-1)/12)**.5)
        self.assertEqual(planes[6][0, 0], 0)
        self.assertEqual(zonal['value'], -25)
        self.assertEqual(zonal['samples'], 1440)

    def test_missing_duplicate_members_rejected_before_download(self):
        entries = [('https://test.invalid/data', (m*4+k)*20, 20, m, 10, key)
                   for m in range(51) for k, key in enumerate(p.KEYS)]
        for invalid in [entries[:-1], entries+[entries[0]]]:
            with patch.object(p, 'ec_entries', return_value=invalid), patch.object(p, 'request') as fetch:
                with self.assertRaisesRegex(AssertionError, 'Incomplete or duplicate'):
                    p.calculate('ifs_ens', RUN, 0, [10], 2)
                fetch.assert_not_called()

    def test_binary_round_trip_all_longitudes_and_row_boundaries(self):
        values = np.arange(7*91*360).reshape(7, 91, 360)*.00071-85
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'frame.bin.gz'
            info = p.save_frame(target, 'ifs_ens', RUN, 0, 50, values, None)
            packed = target.read_bytes()
        self.assertEqual(len(packed), info['bytes'])
        raw = gzip.decompress(packed)
        self.assertEqual(raw[:8], b'STRAT001')
        length = struct.unpack('<I', raw[8:12])[0]
        header = json.loads(raw[12:12+length])
        self.assertEqual(header['count'], 51)
        deltas = np.frombuffer(raw[12+length:], dtype='<i4').reshape(7, 91, 360)
        decoded = deltas.cumsum(axis=2)/100
        self.assertLessEqual(np.max(np.abs(decoded-values)), .00500000001)


if __name__ == '__main__':
    unittest.main()
