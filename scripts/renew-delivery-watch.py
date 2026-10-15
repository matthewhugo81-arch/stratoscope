"""Keep one bounded release watcher alive, with cron as an independent backstop."""
import argparse
from datetime import datetime, timezone, timedelta
import importlib.util
import os
from pathlib import Path

ACTIVE={'queued','in_progress','waiting','pending','requested'}

def ensure(audit, now, current_id=None):
    workflow='/actions/workflows/watch-delivery.yml'
    runs=audit.github(workflow+'/runs?per_page=100&branch=main')['workflow_runs']
    if any(r['status'] in ACTIVE and str(r['id'])!=str(current_id) for r in runs):return 'active'
    def age(value):return now-datetime.fromisoformat(value.replace('Z','+00:00'))
    if current_id is not None:
        current=next((r for r in runs if str(r['id'])==str(current_id)),None)
        # An early setup/permission failure must never create a dispatch storm.
        if current is None or age(current['created_at'])<timedelta(minutes=30):return 'cooldown'
    elif any(age(r.get('updated_at',r['created_at']))<timedelta(minutes=15) for r in runs):return 'cooldown'
    audit.github(workflow+'/dispatches',{'ref':'main'})
    return 'dispatched'

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--successor',action='store_true');args=parser.parse_args()
    spec=importlib.util.spec_from_file_location('audit',Path(__file__).with_name('check-pipelines.py'))
    audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
    current=os.environ['GITHUB_RUN_ID'] if args.successor else None
    print('Release watcher:',ensure(audit,datetime.now(timezone.utc),current),flush=True)
