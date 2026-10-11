import sys
from pathlib import Path
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from ssw_rwb import tongue_at_meridian,detect_candidates


class RwbTests(unittest.TestCase):
    def test_crossing_order_classifies_geometry_and_is_direction_invariant(self):
        cyclonic=np.array([[-360,30],[-10,30],[10,30],[10,45],[-10,45],[-10,60],[10,60],[720,60]])
        self.assertEqual(tongue_at_meridian(cyclonic,0)['orientation'],'cyclonic')
        self.assertEqual(tongue_at_meridian(cyclonic[::-1],0)['orientation'],'cyclonic')
        anticyclonic=cyclonic.copy();anticyclonic[:,1]=90-cyclonic[:,1]
        self.assertEqual(tongue_at_meridian(anticyclonic,0)['orientation'],'anticyclonic')
        self.assertIsNone(tongue_at_meridian(np.array([[-360,40],[720,60]]),0))

    def test_height_or_tropopause_theta_cannot_be_called_pv_breaking(self):
        a=np.zeros((61,360));lat=np.arange(20,81);lon=np.arange(360)
        for field in ['h500','theta_on_2pvu','pv_on_pressure']:
            with self.assertRaises(ValueError):detect_candidates(a,a,a,lat,lon,dict(field=field,units='PVU'))

    def test_unbroken_contour_and_cutoff_do_not_count(self):
        lat=np.arange(20,81);lon=np.arange(360)
        pv=np.broadcast_to((lat-40)[:,None]/10,(61,360)).copy()
        # Isolated low PV island north of the main circumpolar contour.
        pv[45:50,100:105]=-1
        m=dict(field='pv_on_isentrope',units='PVU',thetaK=350,sourceClass='reanalysis',source='synthetic test',validTime='2000-01-01T00:00:00Z')
        result=detect_candidates(pv,np.ones_like(pv)*30,np.ones_like(pv)*10,lat,lon,m)
        self.assertEqual(result['candidates'],[]);self.assertFalse(result['validated'])


if __name__=='__main__':unittest.main()
