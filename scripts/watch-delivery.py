"""Bounded, low-volume release pickup; the three-hour health audit stays separate.

Only public catalogues and terminal inventories are read. No GRIB data, CDS
orders, credentials, or third-party services are created. Existing preparation
workflows retain ownership of decoding, validation, and atomic publication.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import time

MODELS = ('gefs', 'ifs_ens', 'aifs_ens', 'icon')
REPO = 'matthewhugo81-arch/stratoscope'


def load_audit():
    spec = importlib.util.spec_from_file_location('delivery_audit', Path(__file__).with_name('check-pipelines.py'))
    audit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(audit)
    return audit



def check_once(audit, prep, now, recover=True):
    """One failed source must not stop pickup from unrelated working providers."""
    def inspect(model):
        try:
            return audit.audit(model, now, prep)
        except Exception as error:
            return dict(model=model, status='error', sourceStatus='unavailable',
                        message=type(error).__name__ + ': delivery check failed')
    with ThreadPoolExecutor(max_workers=4) as pool:
        reports = list(pool.map(inspect, MODELS))
    if recover:
        # Reuse tested matching-job, completion-cooldown and dispatch safeguards.
        # An active job is never cancelled/restarted by this watcher.
        audit.recover_results(reports, True, now)
    return reports



def run_watch(audit, prep, minutes=55, interval=300, recover=True, clock=time.monotonic, sleep=time.sleep):
    started = clock()
    while True:
        now = datetime.now(timezone.utc)
        reports = check_once(audit, prep, now, recover)
        # Keep source/provider faults in the logged report. The independent
        # three-hour pipeline audit owns the publication health status and
        # actionable failure notifications. Never dispatch that audit at
        # five-minute intervals or fail this pickup job on temporary 429s.
        print(json.dumps(dict(checkedAt=audit.stamp(now), models=reports), separators=(',', ':')), flush=True)
        if any(r['status'] == 'error' for r in reports):
            print('::notice::Source delivery issue recorded; pipeline health will assess publication impact.', flush=True)
        remaining = minutes*60-(clock()-started)
        if minutes == 0 or remaining < interval:
            break
        sleep(interval)
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--minutes', type=int, default=330)
    parser.add_argument('--interval', type=int, default=300)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if not 0 <= args.minutes <= 330 or not 60 <= args.interval <= 900:
        parser.error('Watcher is bounded to 330 minutes and 60–900 second polling')
    if os.environ.get('GITHUB_REPOSITORY', REPO) != REPO:
        raise RuntimeError('Unexpected repository')
    if not args.dry_run and (not os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_REF') != 'refs/heads/main'):
        raise RuntimeError('Recovery is restricted to authenticated main-branch execution')
    audit = load_audit()
    raise SystemExit(run_watch(audit, audit.preparation(), args.minutes, args.interval, not args.dry_run))


if __name__ == '__main__':
    main()
