"""Official ECMWF replica selection. No credentials, proxies or paid services.

Each byte range is always read from the SAME origin as its index. On a transport
failure, an hour is re-indexed on a different official replica. Scientific and
GRIB identity checks are never relaxed. Canonical ECMWF attribution is retained.

https://www.ecmwf.int/en/forecasts/datasets/open-data
"""
import http.client
import urllib.error

ORIGINS = (
    'https://storage.googleapis.com/ecmwf-open-data',
    'https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com',
    'https://data.ecmwf.int/forecasts',
)
TRANSIENT_CODES = {408, 429, 500, 502, 503, 504}
TRANSPORT_ERRORS = (urllib.error.URLError, TimeoutError, ConnectionError, http.client.IncompleteRead)


def retryable(error):
    if isinstance(error, urllib.error.HTTPError):
        return error.code in TRANSIENT_CODES or error.code in {404, 410}
    return isinstance(error, TRANSPORT_ERRORS)


def validate_origin(origin):
    if origin not in ORIGINS:
        raise ValueError('Only official ECMWF replicas may supply ensemble data')
    return origin


def complete_inventory(read, model, run, hour, levels, count, keys, origins=ORIGINS):
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


def calculate_hour(calculate, model, run, hour, levels, workers, panel_writer=None, heat_writer=None, origins=ORIGINS):
    if model == 'gefs':
        return calculate(model, run, hour, levels, workers, panel_writer, heat_writer)
    last = None
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
            print('Retrying complete hour on next official replica:', model, hour, origin, str(error), flush=True)
    raise last or ValueError('No official download source configured')
