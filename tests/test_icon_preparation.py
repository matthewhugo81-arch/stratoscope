import importlib.util,unittest
from pathlib import Path
import numpy as np
spec=importlib.util.spec_from_file_location('icon',Path(__file__).resolve().parents[1]/'scripts/prepare-icon.py')
icon=importlib.util.module_from_spec(spec);spec.loader.exec_module(icon)
class IconTests(unittest.TestCase):
    def test_temperature_and_geopotential_conversions(self):
        idx=np.array([1,0])
        np.testing.assert_allclose(icon.convert(np.array([273.15,253.15]),'t',idx),[-20,0])
        np.testing.assert_allclose(icon.convert(np.array([9.80665*24000,9.80665*23000]),'fi',idx),[23000,24000])
        self.assertEqual(icon.convert(np.array([-12.5,4]),'u',idx),[4,-12.5])
    def test_sampling_wraps_longitude_and_keeps_northern_orientation(self):
        lat=np.repeat(np.arange(90,-1,-1),360);lon=np.tile(np.arange(-180,180),91)
        idx=icon.nearest_indices(lat,lon)
        self.assertEqual(len(idx),360*91)
        for y,x in [(30,0),(30,359),(90,180)]:
            self.assertEqual(lat[idx[y*360+x]],90-y)
            self.assertEqual(lon[idx[y*360+x]]%360,x)
    def test_incomplete_grid_is_rejected(self):
        with self.assertRaises(AssertionError):icon.nearest_indices(np.array([60.]),np.array([0.]))
if __name__=='__main__':unittest.main()
