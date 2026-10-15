"""Recover a missed health audit without polling weather providers or bulk data."""
from datetime import datetime, timezone, timedelta
import importlib.util
from pathlib import Path
import re

ACTIVE={'queued','in_progress','waiting','pending','requested'}

def parsed(value):
    try:
        d=datetime.fromisoformat(value.replace('Z','+00:00'))
        return d if d.tzinfo else None
    except (AttributeError,TypeError,ValueError):return None

def ensure(audit,now):
    # API ref + immutable data avoids a stale raw-branch report hiding a new check.
    try:
        sha=audit.github('/git/ref/heads/forecast-status')['object']['sha']
        if not re.fullmatch('[a-f0-9]{40}',sha):raise ValueError('Invalid status snapshot')
        report=audit.public(sha)
        checked=parsed(report.get('checkedAt')) if report.get('version')==1 else None
    except Exception:
        checked=None
    if checked and -timedelta(minutes=5)<=now-checked<timedelta(hours=3):
        return 'recent'
    workflow='/actions/workflows/check-pipelines.yml'
    runs=audit.github(workflow+'/runs?per_page=100&branch=main')['workflow_runs']
    if any(r['status'] in ACTIVE for r in runs):return 'active'
    if any((ended:=parsed(r.get('updated_at',r.get('created_at')))) and
           now-ended<timedelta(minutes=15) for r in runs):return 'cooldown'
    audit.github(workflow+'/dispatches',{'ref':'main'})
    return 'dispatched'

if __name__=='__main__':
    spec=importlib.util.spec_from_file_location('audit',Path(__file__).with_name('check-pipelines.py'))
    audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
    print('Health audit:',ensure(audit,datetime.now(timezone.utc)),flush=True)
