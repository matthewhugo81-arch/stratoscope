import importlib.util
from datetime import datetime
from pathlib import Path
import unittest
import numpy as np

spec=importlib.util.spec_from_file_location('context',Path(__file__).resolve().parents[1]/'scripts/vortex_context.py')
context=importlib.util.module_from_spec(spec);spec.loader.exec_module(context)

class ContextTests(unittest.TestCase):
    def test_reference_provenance_full_daily_coverage(self):
        values,meta=context.load_reference()
        self.assertEqual(values.shape,(365,25,144))
        self.assertEqual(meta['samplesPerDay'],30)

    def test_calendar_alignment_leap_day_and_new_year(self):
        values=np.arange(365)[:,None,None]*np.ones((365,25,144))
        for date,expected in [('2028-02-28',58),('2028-02-29',58.5),('2028-03-01',59),('2027-03-01',59),('2028-12-31',364),('2029-01-01',0)]:
            np.testing.assert_array_equal(context.daily_reference(values,datetime.fromisoformat(date)),np.full((25,144),expected))

    def test_interpolation_latitude_and_longitude_seam(self):
        field=np.arange(25)[:,None]*10+np.arange(144)[None,:]
        actual=context.interpolate_reference(field)
        self.assertEqual(actual.shape,(61,360))
        self.assertAlmostEqual(actual[1,1],4.4)
        self.assertAlmostEqual(actual[60,0],240)
        self.assertAlmostEqual(actual[0,359],57.2) # wraps to 0 E

    def test_all_members_required_and_mean_is_not_control(self):
        fields={m:np.full((91,360),5500+m) for m in range(31)}
        np.testing.assert_array_equal(context.complete_mean(fields),np.full((61,360),5515))
        del fields[30]
        with self.assertRaises(AssertionError):context.complete_mean(fields)
        fields[30]=np.full((91,360),np.nan)
        with self.assertRaises(AssertionError):context.complete_mean(fields)

if __name__=='__main__':unittest.main()
