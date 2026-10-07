"""Publish only validated compact JSON, never downloads, logs or credentials."""
import json
import os
from pathlib import Path
import subprocess

repo = os.environ['GITHUB_REPOSITORY']
assert repo == 'matthewhugo81-arch/stratoscope'
assert os.environ.get('GITHUB_REPOSITORY_VISIBILITY') == 'public'
source = Path('work/prepared-glosea/latest.json')
data = json.loads(source.read_text())
assert source.stat().st_size < 2_000_000
assert data['complete'] and data['model'] == 'glosea' and data['memberCount'] == 50
assert len(data['dates']) == 180 and len(data['members']) == 50
assert all(len(m['values']) == 180 for m in data['members'])
root = Path('work/publish-glosea'); root.mkdir(parents=True, exist_ok=False)
(root/'latest.json').write_bytes(source.read_bytes())
(root/'README.md').write_text('GloSea 60N/10hPa seasonal wind outlook.\n\n'+data['attribution']+'\n\n'+data['source']+'\n\n'+data['method']+'\n', encoding='utf-8')
def git(*args):
    return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
branch = 'forecast-data-glosea'
git('init', '-b', branch)
git('config', 'user.name', 'github-actions[bot]')
git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
git('remote', 'add', 'origin', 'https://github.com/' + repo + '.git')
remote = git('ls-remote', 'origin', 'refs/heads/' + branch)
old = remote.split()[0] if remote else ''
git('add', 'latest.json', 'README.md')
git('commit', '-m', 'Prepared GloSea issue ' + data['nominal'])
git('push', f'--force-with-lease=refs/heads/{branch}:{old}', 'origin', f'HEAD:refs/heads/{branch}')
