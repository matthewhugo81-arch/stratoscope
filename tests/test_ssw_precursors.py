"""Analytic and adversarial tests: identities, member order, physics and gates."""
import importlib.util
from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
import eccodes as ec

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
import ssw_sources as source
import ssw_diagnostics as diag


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.run=source.run_time('2026-10-09T00:00:00Z')

    def test_run_requires_exact_utc_cycle(self):
        for run in ['2026-10-09T00:00:00','2026-10-09T01:00:00Z','2026-10-09T00:01:00Z','2026-10-09T00:00:00+01:00']:
            with self.assertRaises(ValueError):source.run_time(run)

    def test_noaa_wrong_member_run_lead_rejected(self):
        raw='1:0:d=2026100900:UGRD:10 mb:anl:ENS=+1\n2:100:d=2026100900:VGRD:10 mb:anl:ENS=+1'
        fields={(10,'u')}
        self.assertEqual(source.select_noaa(raw,self.run,0,1,fields,True)[0]['length'],100)
        for changed in [raw.replace('ENS=+1','ENS=+2'),raw.replace('2026100900','2026100800'),raw.replace(':anl:',':6 hour fcst:')]:
            with self.assertRaises(ValueError):source.select_noaa(changed,self.run,0,1,fields,True)

    def test_negative_pv_cannot_satisfy_positive_surface(self):
        raw='1:0:d=2026100900:TMP:PV=-2e-06 (Km^2/kg/s) surface:anl:\n2:100:x'
        self.assertEqual(source.select_noaa(raw,self.run,0,0,{('2pvu','temperature')}),[])

    def test_ifs_control_is_same_product_as_deterministic(self):
        self.assertEqual(source.ec_base('ifs',self.run,0,True),source.ec_base('ifs_ens',self.run,0,True))
        self.assertIn('enfo-ef',source.ec_base('ifs_ens',self.run,0,False))
        self.assertIn('enfo-cf',source.ec_base('aifs_ens',self.run,0,True))

    def test_missing_or_duplicate_inventory_members_fail(self):
        class FakeStore:
            def get(self,*args,**kwargs):
                raw='1:0:d=2026100900:HGT:500 mb:anl:\n2:100:d=2026100900:TMP:500 mb:anl:'
                return raw.encode(),dict(sha256='a'*64)
        with self.assertRaises(ValueError):source.inventory(FakeStore(),'gfs',self.run,0,{(500,'height'),(100,'u')})
        with self.assertRaises(ValueError):source.inventory(FakeStore(),'gefs',self.run,0,{(500,'height')})

    def test_decoded_identity_independent_of_inventory(self):
        metadata=dict(edition=2,centre=7,dataDate=20261009,dataTime=0,endStep=0,stepType='instant',validityDate=20261009,validityTime=0,
                      typeOfLevel='isobaricInhPa',level=10,shortName='u',units='m s**-1',productDefinitionTemplateNumber=1,perturbationNumber=30)
        e=dict(level=10,key='u',member=30)
        source.validate_grib(lambda k,t=None:metadata[k],'gefs',self.run,0,e)
        for key,value in [('centre',98),('dataDate',20261008),('endStep',6),('level',100),('perturbationNumber',29),('shortName','v'),('units','knots'),('stepType','avg')]:
            bad={**metadata,key:value}
            with self.subTest(key=key),self.assertRaises(ValueError):source.validate_grib(lambda k,t=None:bad[k],'gefs',self.run,0,e)

    def test_grib_pv_scaling_and_sign(self):
        metadata=dict(edition=2,centre=7,dataDate=20261009,dataTime=0,endStep=0,stepType='instant',validityDate=20261009,validityTime=0,
                      typeOfFirstFixedSurface=109,scaleFactorOfFirstFixedSurface=9,scaledValueOfFirstFixedSurface=2000,
                      shortName='t',units='K',productDefinitionTemplateNumber=0,typeOfGeneratingProcess=0)
        entry=dict(level='2pvu',key='temperature',member=0,url='https://example.test/file.anl')
        source.validate_grib(lambda k,t=None:metadata[k],'gfs',self.run,0,entry,True)
        for scale in [-2000,2000000]:
            bad={**metadata,'scaledValueOfFirstFixedSurface':scale}
            with self.assertRaises(ValueError):source.validate_grib(lambda k,t=None:bad[k],'gfs',self.run,0,entry,True)
        bad={**metadata,'typeOfGeneratingProcess':2}
        with self.assertRaises(ValueError):source.validate_grib(lambda k,t=None:bad[k],'gfs',self.run,0,entry,True)

    def test_corrupt_cache_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=source.Store(tmp);url='https://example.test/data';key=source.digest(f'{url}|0|20'.encode())
            (Path(tmp)/(key+'.bin')).write_bytes(b'corrupt')
            (Path(tmp)/(key+'.json')).write_text('{"url":"https://example.test/data","sha256":"wrong"}')
            with self.assertRaises(ValueError):store.get(url,0,20)

    def test_native_wind_cannot_hide_missing_longitude_between_display_samples(self):
        h=ec.codes_grib_new_from_samples('regular_ll_pl_grib2')
        try:
            for key,value in dict(centre=7,dataDate=20261009,dataTime=0,shortName='u',level=10,
                Ni=1440,Nj=721,latitudeOfFirstGridPointInDegrees=90,longitudeOfFirstGridPointInDegrees=0,
                latitudeOfLastGridPointInDegrees=-90,longitudeOfLastGridPointInDegrees=359.75,
                iDirectionIncrementInDegrees=.25,jDirectionIncrementInDegrees=.25,jScansPositively=0).items():ec.codes_set(h,key,value)
            values=np.full((721,1440),10.);values[120,1]=9999.
            ec.codes_set_values(h,values.ravel());blob=ec.codes_get_message(h)
        finally:ec.codes_release(h)
        with self.assertRaisesRegex(ValueError,'native 60N'):
            source.decode(blob,'gfs',self.run,0,dict(level=10,key='u',member=0))


class PhysicsTests(unittest.TestCase):
    def test_known_wave_covariance_for_each_model_member_count(self):
        x=np.deg2rad(np.arange(360))
        for count in (1,31,51):
            sign=np.where(np.arange(count)%2,1,-1)[:,None,None]
            v=np.broadcast_to(sign*(4*np.cos(x)+6*np.cos(2*x)+2*np.sin(3*x)),(count,91,360)).copy()
            t=230+np.broadcast_to(sign*(3*np.cos(x)-2*np.cos(2*x)+5*np.sin(3*x)),v.shape)
            flux=diag.heat_flux(v,t,count)
            for key,value in [('wave1',6),('wave2',-6),('residual',5),('total',5)]:
                np.testing.assert_allclose(flux[key],value,atol=1e-10)
            np.testing.assert_allclose(diag.heat_flux(v,t+10,count)['total'],flux['total'],atol=1e-10)

    def test_missing_member_or_longitude_rejected(self):
        v=np.zeros((30,91,360))
        with self.assertRaises(ValueError):diag.heat_flux(v,v,31)
        v=np.zeros((31,91,359))
        with self.assertRaises(ValueError):diag.heat_flux(v,v,31)
        v=np.zeros((31,91,360));v[0,0,0]=np.nan
        with self.assertRaises(ValueError):diag.heat_flux(v,v,31)

    def test_analytic_spherical_weights(self):
        w=diag.band_weights(np.arange(90,29,-1),45,75)
        self.assertAlmostEqual(w.sum(),np.sin(np.deg2rad(75))-np.sin(np.deg2rad(45)),places=12)
        self.assertGreater(diag.band_weights(np.arange(90,29,-1),60,90)[0],0)
        self.assertAlmostEqual(float(diag.area_mean(np.full((61,360),240))),240)

    def test_phase_wrap_and_zero_amplitude(self):
        x=np.deg2rad(np.arange(360))
        field=lambda phase:np.broadcast_to(30000+200*np.cos(x+phase),(1,91,360))
        low,high=diag.waves(field(np.deg2rad(179))),diag.waves(field(np.deg2rad(-179)))
        phase=diag.cross_level({100:low,10:high})[0]['upperMinusLowerPhaseRadians'][0]
        self.assertAlmostEqual(phase,np.deg2rad(2),places=9)
        zero=diag.waves(np.full((1,91,360),30000.))
        self.assertIsNone(diag.cross_level({100:zero,10:zero})[0]['upperMinusLowerPhaseRadians'][0])

    def test_height_proxy_handles_dateline_and_flat_field(self):
        lat=np.deg2rad(90-np.arange(91))[:,None];lon=np.deg2rad(np.arange(360))[None,:]
        # Spherical bowl centred at 70N, 359E; no longitude arithmetic seam error.
        dot=np.sin(lat)*np.sin(np.deg2rad(70))+np.cos(lat)*np.cos(np.deg2rad(70))*np.cos(lon-np.deg2rad(359))
        result=diag.height_geometry((30000-1000*dot)[None])['members'][0]
        self.assertLess(abs(result['centroidLatitude']-70),.3)
        self.assertLess(abs(result['centroidLongitude']-359),.3)
        self.assertEqual(diag.height_geometry(np.full((1,91,360),30000.))['members'],[None])

    def test_signed_integral_retained_and_gaps_rejected(self):
        hours=list(range(0,169,6));members=np.tile([4.,-4.],(len(hours),1))
        result=diag.rolling_forcing(hours,members,7)[0]
        np.testing.assert_allclose(result['signed'],[28,-28]);np.testing.assert_allclose(result['positive'],[28,0])
        with self.assertRaises(ValueError):diag.rolling_forcing(hours[::2],members[::2],7)

    def test_matching_valid_time_not_equal_lead(self):
        previous=dict(model='gefs',count=31,run='2026-10-08T18:00:00Z',points=[dict(hour=6,wind=[20]*31)])
        current=dict(model='gefs',count=31,run='2026-10-09T00:00:00Z',points=[dict(hour=0,wind=[17]*31)])
        self.assertEqual(diag.matched_changes(previous,current)[0]['meanChange'],-3)
        with self.assertRaises(ValueError):diag.matched_changes(current,previous)

    def test_fraction_is_not_event_probability(self):
        result=diag.reversal_fraction([-1,0,2])
        self.assertEqual(result['easterlyMembers'],1)
        self.assertIn('not calibrated',result['interpretation'])
        with self.assertRaises(ValueError):diag.reversal_fraction([-1])

    def test_watch_fails_closed_and_never_declares_ssw(self):
        self.assertEqual(diag.precursor_watch({})['stage'],'insufficient_evidence')
        self.assertEqual(diag.precursor_watch({'coverage_complete':True})['stage'],'insufficient_evidence')
        all_evidence={key:dict(verified=True,source='validated-case-set') for _,keys in diag.STAGES for key in keys}
        result=diag.precursor_watch(all_evidence)
        self.assertEqual(result['stage'],'reversal_scenario');self.assertFalse(result['sswDeclared']);self.assertIsNone(result['probability'])
        all_evidence['daily_mean_reversal']['verified']=None
        self.assertNotEqual(diag.precursor_watch(all_evidence)['stage'],'reversal_scenario')


if __name__=='__main__':unittest.main()
