"""Offline regression cases use deliberately constructed, non-working values."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('source_security', Path(__file__).resolve().parents[1]/'scripts/check-source-security.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class SecurityChecks(unittest.TestCase):
    def rules(self, text, name='example.txt'):
        return {rule for _, rule in module.inspect_file(name, text.encode())}

    def test_known_token_families(self):
        examples = [
            ('gh'+'p_'+'Z'*36, 'github-token'),
            ('github_'+'pat_'+'Z'*80, 'github-fine-grained-token'),
            ('AK'+'IA'+'Z'*16, 'aws-access-key-id'),
            ('AI'+'za'+'Z'*35, 'google-api-key'),
            ('sk'+'-proj-'+'Z'*32, 'openai-style-key'),
            ('xo'+'xb-'+'Z'*24, 'slack-token'),
        ]
        for value, rule in examples:
            with self.subTest(rule=rule):
                self.assertIn(rule, self.rules(value))

    def test_private_key_and_url(self):
        self.assertIn('private-key', self.rules('-----BEGIN '+'RSA PRIVATE KEY-----'))
        self.assertIn('credential-in-url', self.rules('https://user'+':abcdefghij@example.invalid'))

    def test_cds_key_assignments(self):
        for value in ["CDSAPI_KEY = '"+'a'*24+"'", 'CDSAPI_KEY: '+'b'*24, '"CDSAPI_KEY": "'+'c'*24+'"']:
            self.assertIn('literal-service-credential', self.rules(value))

    def test_safe_runtime_references(self):
        text = '\n'.join([
            'CDSAPI_KEY: ${{ secrets.CDSAPI_KEY }}',
            'GH_TOKEN: ${{ github.token }}',
            "CDSAPI_KEY = os.environ['CDSAPI_KEY']",
            "GH_TOKEN='${GITHUB_TOKEN}'",
            'OPENAI_API_KEY: example-not-a-key',
            '//registry.npmjs.org/:_authToken=${NPM_TOKEN}',
        ])
        self.assertEqual(self.rules(text), set())

    def test_sensitive_file_names_even_when_binary(self):
        for path in ['.env', '.env.local', 'config/.cdsapirc', 'x/id_ed25519', 'keys/server.pem', 'x/account.p12']:
            self.assertIn('credential-file-must-not-be-tracked', {v for _,v in module.inspect_file(path,b'\x00test')})
        self.assertEqual(self.rules('OPENAI_API_KEY=your-key-here', '.env.example'), set())

    def test_action_pinning(self):
        file = '.github/workflows/check.yml'
        self.assertIn('action-must-be-commit-pinned', self.rules('steps:\n - uses: actions/checkout@main', file))
        self.assertEqual(self.rules('steps:\n - uses: actions/checkout@'+'a'*40+'\n - uses: ./local', file), set())

    def test_privileged_workflow_changes(self):
        file = '.github/workflows/check.yml'
        self.assertIn('privileged-pr-trigger-needs-review', self.rules('on:\n  pull_request_target:', file))
        self.assertIn('write-all-permissions', self.rules('permissions: write-all', file))
        self.assertIn('unsafe-pr-checkout', self.rules('    allow-unsafe-pr-checkout: true', file))
        self.assertEqual(self.rules('# pull_request_target: disabled\npermissions:\n  contents: read', file), set())

    def test_finding_does_not_include_value(self):
        value = 'gh'+'p_'+'Z'*36
        findings = module.inspect_file('test.txt', ('line\n'+value).encode())
        self.assertEqual(findings, [(2, 'github-token')])
        self.assertNotIn(value, repr(findings))

if __name__ == '__main__':
    unittest.main()
