import sys
from pathlib import Path
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from ssw_pv import pressure_pv,on_isentrope


class PvTests(unittest.TestCase):
    def test_resting_linear_theta_profile_matches_analytic_ertel_pv(self):
        p=np.array([100,200,300,500,700,1000]);lat=np.arange(90,-1,-1);lon=np.arange(360)
        theta=400-.001*p*100
        t=theta*(p*100/100000)**(287.05/1004.)
        t=np.broadcast_to(t[None,:,None,None],(2,6,91,360)).copy();u=np.zeros_like(t)
        actual_theta,pv=pressure_pv(t,u,u,p,lat,lon)
        expected=9.80665*2*7.292115e-5*np.sin(np.deg2rad(lat[1:-1]))*.001*1e6
        np.testing.assert_allclose(pv[:,1:-1,1:-1],np.broadcast_to(expected[None,None,:,None],(2,4,89,360)),atol=1e-10)
        self.assertTrue(np.isnan(pv[:,:,0]).all());self.assertTrue(np.isnan(pv[:,0]).all())

    def test_multiple_crossings_and_unbracketed_cells_stay_masked(self):
        theta=np.array([400,330,370,300],dtype=float).reshape(1,4,1,1)
        pv=np.ones_like(theta)*2
        result,meta=on_isentrope(theta,pv,350)
        self.assertTrue(np.isnan(result).all());self.assertEqual(meta['multipleCrossingCells'],1)
        result,meta=on_isentrope(theta,pv,450)
        self.assertTrue(np.isnan(result).all());self.assertEqual(meta['noCrossingCells'],1)


if __name__=='__main__':unittest.main()
