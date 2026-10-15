"""Resolve generated data to immutable URLs before reading dependent files."""
import re
import subprocess

def snapshot_base(branch):
    if not re.fullmatch(r'forecast-data-[a-z0-9-]+',branch):raise ValueError('Invalid publication branch')
    ref='refs/heads/'+branch
    advertised=subprocess.check_output(['git','ls-remote','https://github.com/matthewhugo81-arch/stratoscope.git',ref],text=True,timeout=45).strip().split()
    if len(advertised)!=2 or advertised[1]!=ref or not re.fullmatch(r'[a-f0-9]{40}',advertised[0]):raise ValueError('Unresolved publication')
    return 'https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/'+advertised[0]+'/'
