import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec=importlib.util.spec_from_file_location('heat',Path(__file__).parents[1]/'scripts/heat_flux.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)

class HeatFluxTests(unittest.TestCase):
    def fields(self):
        return np.zeros((31,91,360)),np.full((31,91,360),-60.)

    def test_zonal_uniform_fields_have_no_eddy_heat_flux(self):
        v,t=self.fields();v[:]=15
        np.testing.assert_allclose(h.member_heat_flux(v,t),0,atol=1e-8)

    def test_known_covariance_and_member_first_order(self):
        v,t=self.fields();wave=np.sin(np.arange(360)*np.pi/180)
        for m in range(31):
            sign=1 if m%2 else -1
            v[m]=sign*4*wave+12;t[m]+=sign*6*wave
        np.testing.assert_allclose(h.member_heat_flux(v,t),12,atol=1e-6)
        # Multiplying ensemble-mean departures would give 12/31² instead.
        mean_wrong=((v.mean(0)-v.mean(0).mean(1,keepdims=True))*(t.mean(0)-t.mean(0).mean(1,keepdims=True))).mean()
        self.assertLess(mean_wrong,.02)

    def test_area_weights_clip_band_boundaries(self):
        v,t=self.fields();wave=np.cos(np.arange(360)*np.pi/180)
        v[:,15,:]=2*wave;t[:,15,:]+=3*wave
        boundary=np.sin(np.deg2rad(75))-np.sin(np.deg2rad(74.5))
        expected=3*boundary/(np.sin(np.deg2rad(75))-np.sin(np.deg2rad(45)))
        np.testing.assert_allclose(h.member_heat_flux(v,t),expected,atol=1e-6)
        v[:,14,:]=40*wave;t[:,14,:]+=20*wave
        np.testing.assert_allclose(h.member_heat_flux(v,t),expected,atol=1e-6)

    def test_negative_flux_and_temperature_offset(self):
        v,t=self.fields();wave=np.sin(np.arange(360)*np.pi/180)
        v[:]=5*wave;t[:]-=2*wave
        np.testing.assert_allclose(h.member_heat_flux(v,t),-5,atol=1e-6)
        np.testing.assert_allclose(h.member_heat_flux(v,t+10),-5,atol=1e-6)

    def test_partial_or_nonfinite_members_rejected(self):
        v,t=self.fields()
        with self.assertRaises(AssertionError):h.member_heat_flux(v[:30],t[:30])
        v[0,20,10]=np.nan
        with self.assertRaises(AssertionError):h.member_heat_flux(v,t)

if __name__=='__main__':unittest.main()
