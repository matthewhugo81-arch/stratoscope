"""Official ECMWF replica selection. No credentials, proxies or paid services.

Each byte range is always read from the SAME origin as its index. On a transport
failure, an hour is re-indexed on a different official replica. Scientific and
GRIB identity checks are never relaxed. Canonical ECMWF attribution is retained.

https://www.ecmwf.int/en/forecasts/datasets/open-data
"""
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import http.client
import math
import time
import urllib.error

ORIGINS = (
    'https://storage.googleapis.com/ecmwf-open-data',
    # ECMWF's public AWS replica, through its documented CloudFront endpoint.
    # Google can have holes in a cycle even when earlier hours are available.
    # Try the independent cloud replica before the rate-limited main portal.
    # https://registry.opendata.aws/ecmwf-forecasts/
    'https://d2zvc0wgha4k2l.cloudfront.net',
    'https://data.ecmwf.int/forecasts',
)
# CloudFront can return 503 for absent, not-yet-released objects. Use it to
# recover downloads of a discovered cycle, not to establish cycle absence.
INVENTORY_ORIGINS = (ORIGINS[0], ORIGINS[-1])
TRANSIENT_CODES = {408, 429, 500, 502, 503, 504}
TRANSPORT_ERRORS = (urllib.error.URLError, TimeoutError, ConnectionError, http.client.IncompleteRead)
# Only IFS ENS gets additional whole-hour passes. A missing early-hour object
# on Google must be revisited after AWS/main-portal outages, rather than losing
# every other completed hour immediately. Keep concurrency and other feeds as-is.
IFS_HOUR_RETRY_DELAYS = (120, 300)


def retryable(error):
    if isinstance(error, urllib.error.HTTPError):
        return error.code in TRANSIENT_CODES or error.code in {404, 410}
    return isinstance(error, TRANSPORT_ERRORS)


def validate_origin(origin):
    if origin not in ORIGINS:
        raise ValueError('Only official ECMWF replicas may supply ensemble data')
    return origin


def complete_inventory(read, model, run, hour, levels, count, keys, origins=INVENTORY_ORIGINS):
    """Check every replica for this cycle BEFORE considering an older cycle.

An outage on one replica can be satisfied by another complete replica, but if
none verifies this cycle and any origin is unavailable, discovery fails rather
than claiming the older cycle is the latest. Missing/incomplete inventories on
all replicas allow the caller to inspect the preceding cycle.
"""
    transport_error = None
    incomplete_error = None
    expected = {(m, level, key) for m in range(count) for level in levels for key in keys}
    for origin in origins:
        validate_origin(origin)
        try:
            entries = read(model, run, hour, levels, probe=True, origin=origin)
            identities = [tuple(e[3:]) for e in entries]
            assert len(identities) == len(expected) and set(identities) == expected, 'Incomplete or duplicate ensemble inventory'
            return entries
        except AssertionError as error:
            incomplete_error = error
        except TRANSPORT_ERRORS as error:
            if not retryable(error):
                raise
            if isinstance(error, urllib.error.HTTPError) and error.code in {404, 410}:
                incomplete_error = error
            else:
                transport_error = error
            print('Inventory replica unavailable:', model, origin, str(error), flush=True)
    if transport_error is not None:
        raise transport_error
    raise incomplete_error or ValueError('No official inventory source configured')


def _retry_after_seconds(error):
    """Never shorten a provider's Retry-After when starting another pass."""
    if not isinstance(error, urllib.error.HTTPError) or not error.headers:
        return 0
    value = error.headers.get('Retry-After', '')
    try:
        delay = float(value)
    except (TypeError, ValueError):
        try:
            delay = (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds()
        except (TypeError, ValueError, OverflowError):
            return 0
    return max(0, delay) if math.isfinite(delay) else 0


def calculate_hour(calculate, model, run, hour, levels, workers, panel_writer=None, heat_writer=None, origins=ORIGINS):
    if model == 'gefs':
        return calculate(model, run, hour, levels, workers, panel_writer, heat_writer)
    # Retry this exact hour/run only, within its existing worker. Successful
    # hours elsewhere in the preparation job are not downloaded again. All
    # providers are re-indexed; no offsets or member arrays cross replicas.
    delays = IFS_HOUR_RETRY_DELAYS if model == 'ifs_ens' else ()
    last = None
    retry_not_before = 0
    for attempt in range(1 + len(delays)):
        if attempt:
            delay = max(delays[attempt - 1], retry_not_before - time.monotonic())
            print('Retrying same IFS ENS forecast hour after replica failures:',
                  hour, f'pass {attempt + 1}/{1 + len(delays)}',
                  f'waiting {delay:g} seconds', flush=True)
            time.sleep(delay)
        for origin in origins:
            validate_origin(origin)
            try:
                # calculate obtains this origin's own control and perturbed indexes,
                # then verifies every native GRIB before invoking output writers.
                result = calculate(model, run, hour, levels, workers, panel_writer, heat_writer, origin=origin)
                print('HOUR_SOURCE', model, hour, origin, flush=True)
                return result
            except TRANSPORT_ERRORS as error:
                if not retryable(error):
                    raise
                last = error
                if model == 'ifs_ens':
                    retry_not_before = max(retry_not_before, time.monotonic() + _retry_after_seconds(error))
                    if isinstance(error, urllib.error.HTTPError):
                        error.close()
                print('Retrying complete hour on next official replica:', model, hour, origin, str(error), flush=True)
        if last is None:
            break
    raise last or ValueError('No official download source configured')
