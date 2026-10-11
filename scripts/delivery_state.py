"""Release-state annotations; waiting for upstream is not a successful new run.

The offsets below only OPEN a release-watch window. They are not guarantees of
provider publication time and are never used to fabricate an available cycle.
"""
from datetime import datetime, timedelta, timezone
import http.client
import json
import urllib.error

ORIGINS = ('https://storage.googleapis.com/ecmwf-open-data', 'https://data.ecmwf.int/forecasts')
WATCH_WINDOWS = {'gfs': (6, 4), 'ecmwf_direct': (12, 6), 'gefs': (6, 5),
                 'ifs_ens': (12, 6), 'aifs_ens': (6, 5), 'icon': (12, 3)}


def parse(value):
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result if result.tzinfo is not None else None
    except (AttributeError, TypeError, ValueError):
        return None


def stamp(value):
    return value.isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def annotate(results, now):
    for result in results:
        model = result['model']
        if model not in WATCH_WINDOWS or result.get('sourceStatus') != 'verified':
            continue
        available = parse(result.get('availableRun'))
        interval, opening = WATCH_WINDOWS[model]
        cutoff = now-timedelta(hours=opening)
        candidate = datetime.fromtimestamp(int(cutoff.timestamp())//(interval*3600)*(interval*3600), timezone.utc)
        if available is not None and candidate > available:
            result['sourcePendingRun'] = stamp(candidate)
            result['sourcePendingReason'] = 'The candidate cycle did not pass the required upstream inventory checks; no substitute or partial run has been published.'
    gefs = next((r for r in results if r['model'] == 'gefs'), {})
    for result in results:
        if result['model'] != 'vortex':
            continue
        result['upstreamAvailableRun'] = gefs.get('availableRun')
        if gefs.get('status') == 'error':
            result['alignedWithPublishedInputs'] = result.get('publishedRun') == gefs.get('publishedRun')
            result.update(status='error', failureStage='upstream', message='Vortex and heat-flux inputs are waiting for the parent GEFS publication to recover.')
        elif result.get('status') == 'current' and gefs.get('status') in {'behind', 'updating'}:
            result.update(status='updating', alignedWithPublishedInputs=True,
                          message='Vortex and heat flux match the previous GEFS publication, not the newer available GEFS cycle.')


def latest_direct_ifs(fetch, now):
    """Use the same official replicas for the direct IFS audit and browser.

Read both origins for each candidate before inspecting an older cycle. A network
outage cannot establish that an older run is the latest. Date/time/step and every
required pressure-level variable must be present exactly once.
"""
    start = datetime.fromtimestamp(int(now.timestamp())//43200*43200, timezone.utc)
    for back in range(5):
        run = start-timedelta(hours=12*back)
        day, cycle = run.strftime('%Y%m%d'), run.strftime('%H')
        error = None
        for origin in ORIGINS:
            url = f'{origin}/{day}/{cycle}z/ifs/0p25/oper/{day}{cycle}0000-240h-oper-fc.index'
            try:
                entries = [json.loads(line) for line in fetch(url).decode().splitlines()]
                for level in [10, 50, 100]:
                    for field in ['t', 'gh', 'u', 'v']:
                        found = [e for e in entries if e.get('levtype') == 'pl' and str(e.get('levelist')) == str(level) and e.get('param') == field and e.get('date') == day and int(e.get('time', -1)) == run.hour*100 and int(e.get('step', -1)) == 240]
                        assert len(found) == 1, 'Incomplete or duplicate IFS inventory'
                return stamp(run)
            except urllib.error.HTTPError as e:
                if e.code not in {404, 410}:
                    error = e
            except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.IncompleteRead) as e:
                error = e
            except AssertionError:
                continue
        if error is not None:
            raise error
    raise ValueError('No complete provider inventory available for direct IFS')
