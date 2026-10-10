"""Saved real-source receipts remain complete and usable without network access."""
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest
import numpy as np
ROOT=Path(__file__).parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
spec=importlib.util.spec_from_file_location('pulsecheck',ROOT/'scripts/ssw-pulsecheck.py')
pulse=importlib.util.module_from_spec(spec);spec.loader.exec_module(pulse)


class SavedEvidenceTests(unittest.TestCase):
    def test_all_model_receipts_have_exact_members_and_preserved_hashes(self):
        audit=json.loads((ROOT/'research/ssw/source-audit.json').read_text())
        self.assertEqual(len(audit['models']),6)
        for model in audit['models']:
            e=model['evidence'];packed=(ROOT/'research/ssw'/e['path']).read_bytes();raw=gzip.decompress(packed)
            self.assertEqual(hashlib.sha256(packed).hexdigest(),e['gzipSha256'])
            self.assertEqual(hashlib.sha256(raw).hexdigest(),e['uncompressedSha256'])
            product=pulse.validate_product(json.loads(raw))
            for point in product['points']:
                for flux in point['diagnostics']['heatFlux'].values():
                    np.testing.assert_allclose(np.array(flux['wave1'])+flux['wave2']+flux['residual'],flux['total'],atol=1e-10)

    def test_tampered_member_and_time_fail_report_validation(self):
        raw=gzip.decompress((ROOT/'research/ssw/evidence/gefs.json.gz').read_bytes())
        product=json.loads(raw);product['memberIds'].pop()
        with self.assertRaises(ValueError):pulse.validate_product(product)
        product=json.loads(raw);product['points'][0]['evidence']['fields'][0]['decoded']['leadHours']=6
        with self.assertRaises(ValueError):pulse.validate_product(product)

    def test_history_is_analysis_and_never_substitutes_f000(self):
        data=json.loads(gzip.decompress((ROOT/'research/ssw/evidence/history.json.gz').read_bytes()))
        self.assertEqual(data['days'],7)
        for day in data['analyses']:
            self.assertEqual(day['sourceClass'],'operational_analysis')
            self.assertEqual(len(day['evidence']['fields']),5)
            self.assertTrue(all(r['url'].endswith('.anl') for r in day['evidence']['fields']))


if __name__=='__main__':unittest.main()
