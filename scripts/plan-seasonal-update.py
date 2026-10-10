"""Plan only missing/released seasonal issues, without CDS credentials or imports."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import math
import os
from pathlib import Path
import time
import urllib.error
import urllib.request
from seasonal_config import MODELS, current_forecast, iso, latest

ROOT = 'https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/forecast-data-seasonal/'


def read_forecast(model):
    url = ROOT + 'forecast/' + model + '.json'
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'Stratoscope-seasonal-release-check', 'Cache-Control': 'no-cache'})
            with urllib.request.urlopen(request, timeout=25) as response:
                raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                raise ValueError('Unexpected seasonal publication size')
            return json.loads(raw)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            if error.code not in {408, 429, 500, 502, 503, 504} or attempt == 2:
                raise
            delay = 60 * 2**attempt if error.code in {429, 503} else 2**attempt
            value = error.headers.get('Retry-After', '') if error.headers else ''
            try:
                requested = float(value)
            except ValueError:
                try:
                    requested = (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds()
                except (TypeError, ValueError, OverflowError):
                    requested = 0
            if not math.isfinite(requested) or requested > 120:
                raise
            error.close()
            time.sleep(max(delay, requested))
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == 2:
                raise
            time.sleep(2**attempt)


def plan(model='all', phase='update', scheduled=True, now=None, reader=read_forecast):
    if phase == 'era5':
        if scheduled:
            raise ValueError('Scheduled seasonal checks must not prepare historical ERA5')
        return ['era5']
    selected = list(MODELS) if model == 'all' else [model]
    if any(m not in MODELS for m in selected):
        raise ValueError('Unknown seasonal model')
    if not scheduled:
        return selected
    if phase not in ['forecast', 'update']:
        raise ValueError('Scheduled seasonal checks must not prepare hindcasts')
    now = now or datetime.now(timezone.utc)
    def check(m):
        nominal = latest(m, now)
        data = reader(m)
        current = current_forecast(data, m, nominal)
        print(json.dumps({'model': m, 'expectedIssue': iso(nominal),
                          'publishedIssue': data.get('nominal') if isinstance(data, dict) else None,
                          'status': 'current' if current else 'update-required'}), flush=True)
        return None if current else m
    # Small public JSON files only; no scientific dependencies or CDS requests.
    with ThreadPoolExecutor(max_workers=3) as pool:
        return [m for m in pool.map(check, selected) if m is not None]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', choices=['all', *MODELS], default='all')
    parser.add_argument('--phase', choices=['forecast', 'update', 'climate', 'era5'], default='update')
    parser.add_argument('--manual', action='store_true')
    args = parser.parse_args()
    models = plan(args.model, args.phase, scheduled=not args.manual)
    matrix = json.dumps({'model': models}, separators=(',', ':'))
    print('Planned model jobs:', matrix, flush=True)
    if os.environ.get('GITHUB_OUTPUT'):
        with Path(os.environ['GITHUB_OUTPUT']).open('a') as output:
            output.write('matrix=' + matrix + '\n')
            output.write('needed=' + str(bool(models)).lower() + '\n')


if __name__ == '__main__':
    main()
