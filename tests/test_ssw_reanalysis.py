import importlib.util
from datetime import date,datetime,timedelta
from pathlib import Path
import json
import sys
import tempfile
import unittest
import eccodes as ec
import numpy as np
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
spec=importlib.util.spec_from_file_location('reanalysis_import',Path(__file__).parents[1]/'scripts/import-ssw-reanalysis.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class ReanalysisTests(unittest.TestCase):
    def fixture(self,path,count=28,forecast=False):
        with path.open('wb') as f:
            for hour in range(0,count*6,6):
                time=datetime(2000,1,1)+timedelta(hours=hour)
                h=ec.codes_grib_new_from_samples('regular_ll_pl_grib1')
                try:
                    for k,v in dict(centre=98,**{'class':'ea'},expver='0005',dataType='fc' if forecast else 'an',
                        dataDate=int(time.strftime('%Y%m%d')),dataTime=time.hour*100,shortName='z',level=500,
                        Ni=360,Nj=61,latitudeOfFirstGridPointInDegrees=90,longitudeOfFirstGridPointInDegrees=0,
                        latitudeOfLastGridPointInDegrees=30,longitudeOfLastGridPointInDegrees=359,
                        iDirectionIncrementInDegrees=1,jDirectionIncrementInDegrees=1,jScansPositively=0).items():ec.codes_set(h,k,v)
                    ec.codes_set_values(h,np.full(61*360,5500*9.80665));ec.codes_write(h,f)
                finally:ec.codes_release(h)

    def test_complete_preliminary_history_keeps_source_class_and_units(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root);p=root/'input.grib';self.fixture(p)
            req=root/'request.json';req.write_text(json.dumps(dict(dataset='reanalysis-era5-complete',request={})))
            result=module.import_history(p,req,root/'output',date(2000,1,7))
            self.assertTrue(result['completeH500History']);self.assertFalse(result['observations'])
            self.assertEqual(len(result['files']),28);self.assertTrue(all(r['preliminary'] for r in result['records']))
            with np.load(root/'output'/result['files'][0]['path']) as fields:
                np.testing.assert_allclose(fields['h500'],5500,atol=.01)

    def test_incomplete_week_and_forecast_cannot_publish_reanalysis_manifest(self):
        for count,forecast in [(27,False),(1,True)]:
            with self.subTest(count=count,forecast=forecast),tempfile.TemporaryDirectory() as root:
                root=Path(root);p=root/'input.grib';self.fixture(p,count,forecast)
                req=root/'request.json';req.write_text(json.dumps(dict(dataset='reanalysis-era5-complete',request={})))
                with self.assertRaises(ValueError):module.import_history(p,req,root/'output',date(2000,1,7))
                self.assertFalse((root/'output/reanalysis.json').exists())


if __name__=='__main__':unittest.main()
