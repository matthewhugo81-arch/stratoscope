"""Exercise generated-branch replacement against an isolated local Git remote."""
import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


class PublicationTests(unittest.TestCase):
    def test_publication_retains_only_two_runs_and_never_rewrites_main(self):
        scratch = ROOT/'work'
        scratch.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
            root = Path(directory).resolve()
            self.assertTrue(root.is_relative_to(scratch.resolve()))
            remote = root/'remote.git'
            actual = subprocess.check_output
            def git(*args, cwd=None):
                return actual(['git', *args], cwd=cwd, text=True, stderr=subprocess.DEVNULL).strip()
            git('init', '--bare', str(remote))
            source = root/'source'
            git('init', '-b', 'main', str(source))
            git('config', 'user.name', 'Test', cwd=source)
            git('config', 'user.email', 'test@example.invalid', cwd=source)
            (source/'README.md').write_text('Source must remain unchanged')
            git('add', '.', cwd=source)
            git('commit', '-m', 'Source', cwd=source)
            git('remote', 'add', 'origin', str(remote), cwd=source)
            git('push', 'origin', 'main', cwd=source)
            source_sha = git('rev-parse', 'main', cwd=remote)
            def local_only(command, **kwargs):
                if command[:4] == ['git', 'remote', 'add', 'origin']:
                    self.assertEqual(command[4], 'https://github.com/matthewhugo81-arch/stratoscope.git')
                    command = command[:4]+[str(remote)]
                kwargs['stderr'] = subprocess.DEVNULL
                return actual(command, **kwargs)
            runs = [('2026100700', '2026-10-07T00:00:00.000Z'),
                    ('2026100712', '2026-10-07T12:00:00.000Z'),
                    ('2026100800', '2026-10-08T00:00:00.000Z')]
            for index, (key, stamp) in enumerate(runs):
                output = root/f'prepared-{index}'
                file = output/key/'10'/'0.bin.gz'
                file.parent.mkdir(parents=True)
                file.write_bytes(b'public-test-data')
                (output/'latest.json').write_text(json.dumps({'model':'gefs','complete':True,'run':stamp,'files':{'10/0':{'path':f'{key}/10/0.bin.gz'}}}))
                with patch.object(subprocess, 'check_output', side_effect=local_only), patch.object(sys, 'argv', ['publish', '--model', 'gefs', '--output', str(output)]), patch.dict(os.environ, {'GITHUB_REPOSITORY':'matthewhugo81-arch/stratoscope','GITHUB_REPOSITORY_VISIBILITY':'public'}), contextlib.redirect_stdout(io.StringIO()):
                    runpy.run_path(str(ROOT/'scripts/publish-ensemble-data.py'), run_name='__main__')
                branch = 'forecast-data-gefs'
                paths = git('ls-tree', '-r', '--name-only', branch, cwd=remote).splitlines()
                for retained, _ in runs[max(0,index-1):index+1]:
                    self.assertIn(f'{retained}/10/0.bin.gz', paths)
                if index == 2:
                    self.assertNotIn('2026100700/10/0.bin.gz', paths)
                self.assertEqual(git('rev-parse', 'main', cwd=remote), source_sha)
                self.assertEqual(git('rev-list', '--count', branch, cwd=remote), '1')


if __name__ == '__main__':
    unittest.main()
