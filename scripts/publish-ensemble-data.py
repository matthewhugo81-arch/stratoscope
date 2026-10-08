"""Publish only generated ensemble snapshots to dedicated data branches.

Each snapshot has no history parents and retains the preceding run's files.
Source/main history is never rewritten. No billable Actions artifacts are used.
"""
import argparse
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('--model', choices=['gefs', 'ifs_ens', 'aifs_ens', 'icon', 'vortex'], required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
repository = os.environ['GITHUB_REPOSITORY']
assert repository == 'matthewhugo81-arch/stratoscope'
assert os.environ.get('GITHUB_REPOSITORY_VISIBILITY') == 'public', 'Free public-repository preparation only'
root = args.output.resolve()
manifest = json.loads((root/'latest.json').read_text())
assert manifest['model'] == args.model and manifest['complete']
branch = 'forecast-data-' + args.model.replace('_', '-')
def git(*cmd, binary=False):
    return subprocess.check_output(['git', *cmd], cwd=root, text=not binary).strip()

git('init', '-b', branch)
git('config', 'user.name', 'github-actions[bot]')
git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
git('remote', 'add', 'origin', 'https://github.com/' + repository + '.git')
remote = git('ls-remote', 'origin', 'refs/heads/' + branch)
old_sha = remote.split()[0] if remote else ''
if old_sha:
    git('fetch', '--depth=1', 'origin', branch)
    previous = json.loads(git('show', old_sha + ':latest.json'))
    assert previous['run'] <= manifest['run'], 'Refusing to replace a newer published run'
    old_run = previous['run'].replace('-', '').replace(':', '')[:10]
    new_run = manifest['run'].replace('-', '').replace(':', '')[:10]
    # Use the actual validated numeric run directory from the manifest.
    old_run = next(iter(previous['files'].values()))['path'].split('/')[0]
    new_run = next(iter(manifest['files'].values()))['path'].split('/')[0]
    assert re.fullmatch(r'\d{10}', old_run) and re.fullmatch(r'\d{10}', new_run)
    if old_run != new_run:
        archive = git('archive', old_sha, old_run, binary=True)
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            for member in tar.getmembers():
                target = (root/member.name).resolve()
                assert target.is_relative_to(root) and not member.issym() and not member.islnk()
            tar.extractall(root, filter='data')
(root/'README.md').write_text('Generated Stratoscope forecast data. Current and preceding model runs only.\n\nThis branch is replaced automatically; source code lives on main.\nOfficial NOAA / ECMWF / DWD sources and calculation details: see the main README.\n', encoding='utf-8')
git('add', '.')
git('commit', '-m', f"Prepared {args.model} forecast {manifest['run']}")
# Compare-and-swap is restricted to this generated branch; never main.
git('push', f'--force-with-lease=refs/heads/{branch}:{old_sha}', 'origin', f'HEAD:refs/heads/{branch}')
print('PUBLISHED', args.model, manifest['run'], branch)
