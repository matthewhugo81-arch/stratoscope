import gzip
import importlib.util
import json
import math
from pathlib import Path
import struct
import unittest

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
