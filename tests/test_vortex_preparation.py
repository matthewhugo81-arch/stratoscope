import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec = importlib.util.spec_from_file_location('vortex', Path(__file__).resolve().parents[1]/'scripts/prepare-vortex.py')
vortex = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vortex)

class VortexTests(unittest.TestCase):
    def test_resting_atmosphere_pv_sign_and_units(self):
        p = np.array(vortex.PRESSURES)*100.
        theta = (1400-.035*p)[:,None,None]*np.ones((13,91,360))
        temperature = theta*(p[:,None,None]/100000)**(287.05/1004)-273.15
        actual_theta, pv = vortex.pressure_pv(temperature, np.zeros_like(theta), np.zeros_like(theta))
        expected = 9.80665*.035*2*7.292115e-5*np.sin(np.deg2rad(60))*1e6
        np.testing.assert_allclose(pv[:,30,:], expected, rtol=1e-10)
        self.assertTrue(np.isfinite(vortex.on_theta(actual_theta,pv,float(actual_theta[-1,30,0]))).all())

    def test_area_weighted_polar_cap_and_periodic_contour(self):
        values = np.broadcast_to((90-np.arange(61))[:,None],(61,360))
        threshold = vortex.area_threshold(values)
        self.assertTrue(69 <= threshold <= 71)
        segments = vortex.contour_segments(values,threshold)
        self.assertEqual(len(segments),360)
        self.assertEqual(max(segments[-1][0],segments[-1][2]),360)
        self.assertTrue(all(69 <= segment[1] <= 71 for segment in segments))

    def test_missing_polar_coverage_is_rejected(self):
        with self.assertRaises(AssertionError):
            vortex.area_threshold(np.full((61,360),np.nan))

if __name__ == '__main__':
    unittest.main()
