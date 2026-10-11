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


def signature(reports):
    # Do not cause repeated dispatches merely because an updating job URL changed.
    return tuple((r['model'], r.get('publishedRun'), r.get('availableRun'),
                  r.get('sourceStatus'), r.get('catalogueStatus')) for r in reports)


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


def should_refresh(previous_signature, reports, last_refresh, now_seconds):
    return signature(reports) != previous_signature and now_seconds-last_refresh >= 120


def run_watch(audit, prep, minutes=50, interval=300, recover=True, clock=time.monotonic, sleep=time.sleep):
    started = clock()
    last_refresh = float('-inf')
    previous_signature = None
    had_errors = False
    while True:
        now = datetime.now(timezone.utc)
        reports = check_once(audit, prep, now, recover)
        had_errors = any(r['status'] == 'error' for r in reports)
        print(json.dumps(dict(checkedAt=audit.stamp(now), models=reports), separators=(',', ':')), flush=True)
        if recover and should_refresh(previous_signature, reports, last_refresh, clock()):
            try:
                audit.github('/actions/workflows/check-pipelines.yml/dispatches', {'ref': 'main'})
                previous_signature = signature(reports)
                last_refresh = clock()
                print('Requested publication-health refresh after changed delivery state', flush=True)
            except Exception as error:
                # No immediate POST retry: GitHub might have accepted a lost response.
                previous_signature = signature(reports)
                last_refresh = clock()
                had_errors = True
                print('Health refresh dispatch not confirmed:', type(error).__name__, flush=True)
        remaining = minutes*60-(clock()-started)
        if minutes == 0 or remaining < interval:
            break
        sleep(interval)
    return 1 if had_errors else 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--minutes', type=int, default=50)
    parser.add_argument('--interval', type=int, default=300)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if not 0 <= args.minutes <= 50 or not 60 <= args.interval <= 900:
        parser.error('Watcher is bounded to 50 minutes and 60–900 second polling')
    if os.environ.get('GITHUB_REPOSITORY', REPO) != REPO:
        raise RuntimeError('Unexpected repository')
    if not args.dry_run and (not os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_REF') != 'refs/heads/main'):
        raise RuntimeError('Recovery is restricted to authenticated main-branch execution')
    audit = load_audit()
    raise SystemExit(run_watch(audit, audit.preparation(), args.minutes, args.interval, not args.dry_run))


if __name__ == '__main__':
    main()
