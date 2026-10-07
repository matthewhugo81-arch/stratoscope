"""Prepare a small 60N/10hPa wind plume from the authenticated, free CDS API.

Never writes credentials. Publication is separate and remains gated until a real
download is reviewed. UKMO members are aligned by VALID date, not lead time.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys

DATASET = 'seasonal-original-pressure-levels'
SOURCE = 'https://cds.climate.copernicus.eu/datasets/' + DATASET
DAYS = 180


def nominal_month(now):
    first = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    # Leave a day for the monthly release to settle. No speculative next cycle.
    return first if now.day >= 11 else (first - timedelta(days=1)).replace(day=1)


def system_for(nominal):
    # Explicit version boundary: do not silently mix different model climates.
    if nominal >= datetime(2026, 4, 1, tzinfo=timezone.utc):
        return '610'
    raise ValueError('This importer supports GloSea6-GC5.1 issues from April 2026 only')


def requests_for(nominal):
    """50 members: two members on each of the latest 25 start dates.

    Fail closed if a start date/member is absent. Recovery runs with a different
    daily ensemble count need review, never a silent smaller ensemble.
    """
    groups = {}
    for lag in range(25):
        start = nominal - timedelta(days=lag)
        groups.setdefault((start.year, start.month), []).append(f'{start.day:02}')
    return [dict(originating_centre='ukmo', system=system_for(nominal),
                 variable=['u_component_of_wind'], pressure_level=['10'],
                 year=[str(year)], month=[f'{month:02}'], day=sorted(days),
                 leadtime_hour=[str(h) for h in range(24, (DAYS + 24) * 24 + 1, 24)],
                 area=[61, -180, 59, 180], data_format='grib')
            for (year, month), days in sorted(groups.items())]


def zonal_mean(lat, lon, values):
    import numpy as np
    lat, lon, values = (np.asarray(a, dtype=float) for a in (lat, lon, values))
    if not (lat.shape == lon.shape == values.shape and lat.ndim == 1
            and all(np.isfinite(a).all() for a in (lat, lon, values))
            and np.all(np.abs(values) < 300)):
        raise ValueError('Invalid wind coordinates or values')
    rows = np.unique(lat)
    lower, upper = rows[rows <= 60], rows[rows >= 60]
    if not len(lower) or not len(upper):
        raise ValueError('Latitude rows do not bracket 60N')
    lo, hi = float(lower[-1]), float(upper[0])
    if hi - lo > 1.01:
        raise ValueError('Expected a 1 degree CDS grid at 60N')
    means = []
    for row in (lo, hi):
        mask = np.isclose(lat, row, atol=1e-6)
        x, v = lon[mask] % 360, values[mask]
        order = np.argsort(x); x, v = x[order], v[order]
        # Ignore a duplicate seam only if its two values agree.
        duplicates = np.where(np.diff(x) < 1e-5)[0]
        if len(x) == 361 and len(duplicates) == 1:
            seam = int(duplicates[0])
            if abs(v[seam] - v[seam + 1]) > 1e-5:
                raise ValueError('Inconsistent longitude seam')
            x, v = np.delete(x, seam), np.delete(v, seam)
        if len(x) != 360 or not np.allclose(np.diff(np.r_[x, x[0] + 360]), 1, atol=1e-5):
            raise ValueError('Incomplete or nonuniform longitude circle')
        means.append(float(v.mean()))
    return means[0] if lo == hi else means[0] + (means[1] - means[0]) * (60 - lo) / (hi - lo)


def read_grib(path, nominal):
    import eccodes as ec
    with path.open('rb') as handle:
        while (g := ec.codes_grib_new_from_file(handle)) is not None:
            try:
                get = lambda key: ec.codes_get(g, key)
                if not (get('shortName') == 'u' and get('typeOfLevel') == 'isobaricInhPa'
                        and get('level') == 10 and get('units') == 'm s**-1'
                        and get('centre') == 'egrr' and str(get('systemNumber')) == system_for(nominal)
                        and get('gridType') == 'regular_ll' and get('bitmapPresent') == 0):
                    raise ValueError('Unexpected GRIB source, system, field, units or grid')
                start = datetime.strptime(f"{get('dataDate'):08}{get('dataTime'):04}", '%Y%m%d%H%M').replace(tzinfo=timezone.utc)
                valid = datetime.strptime(f"{get('validityDate'):08}{get('validityTime'):04}", '%Y%m%d%H%M').replace(tzinfo=timezone.utc)
                if start.hour or start.minute or valid.hour or valid.minute:
                    raise ValueError('Expected instantaneous 00 UTC samples')
                if get('stepType') != 'instant':
                    raise ValueError('Expected instantaneous u wind, not averages or anomalies')
                value = zonal_mean(ec.codes_get_array(g, 'latitudes'), ec.codes_get_array(g, 'longitudes'), ec.codes_get_values(g))
                yield start, int(get('number')), valid, value
            finally:
                ec.codes_release(g)


def assemble(records, nominal, prepared_at):
    dates = [nominal + timedelta(days=d) for d in range(1, DAYS + 1)]
    starts = {nominal - timedelta(days=d) for d in range(25)}
    fields = {}; identities = {}
    for start, member, valid, value in records:
        if start not in starts or member < 0:
            raise ValueError('Unexpected member start date or number')
        identities.setdefault(start, set()).add(member)
        if valid not in dates:
            continue
        key = (start, member, valid)
        if key in fields:
            raise ValueError('Duplicate member/date field')
        if not (-200 < value < 200):
            raise ValueError('Invalid signed zonal wind')
        fields[key] = value
    if set(identities) != starts or any(len(ids) != 2 for ids in identities.values()):
        raise ValueError('Expected two members for all 25 start dates; no partial ensemble will be published')
    iso = lambda dt: dt.strftime('%Y-%m-%dT%H:%M:%S.000Z')
    members = []
    for start in sorted(starts):
        for member in sorted(identities[start]):
            if any((start, member, valid) not in fields for valid in dates):
                raise ValueError('Incomplete member time series; previous issue is retained')
            members.append(dict(id=f'{start:%Y%m%d}-{member}', start=iso(start),
                                values=[round(fields[(start, member, valid)], 3) for valid in dates]))
    mean = [round(sum(m['values'][i] for m in members) / len(members), 3) for i in range(DAYS)]
    fraction = [round(sum(m['values'][i] < 0 for m in members) / len(members), 4) for i in range(DAYS)]
    return dict(version=1, model='glosea', system=system_for(nominal), complete=True,
                nominal=iso(nominal), preparedAt=iso(prepared_at), source=SOURCE,
                latitude=60, level=10, units='m/s', sampling='00 UTC daily samples',
                memberCount=50, dates=list(map(iso, dates)), members=members,
                mean=mean, easterlyFraction=fraction,
                attribution='Contains modified Copernicus Climate Change Service information (2026). UK Met Office GloSea6-GC5.1; CC BY 4.0.',
                method='Equal-weight lagged ensemble; two members from each of 25 daily starts. Aligned by valid date. Longitude means on the CDS 1-degree grid, linearly interpolated to 60N if required. Raw model output; no bias correction. Negative wind fraction is not a calibrated SSW probability.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--month', help='Nominal issue YYYY-MM; defaults to latest scheduled release')
    parser.add_argument('--plan', action='store_true', help='Print requests without network access or credentials')
    parser.add_argument('--input', type=Path, nargs='+', help='Decode already downloaded GRIB files')
    parser.add_argument('--output', type=Path, default=Path('work/prepared-glosea'))
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    nominal = datetime.strptime(args.month, '%Y-%m').replace(tzinfo=timezone.utc) if args.month else nominal_month(now)
    requests = requests_for(nominal)
    if args.plan:
        print(json.dumps(dict(dataset=DATASET, requests=requests), indent=2)); return
    inputs = args.input
    if not inputs:
        key = os.environ.get('CDSAPI_KEY')
        if not key:
            raise ValueError('CDSAPI_KEY is missing. Add it as a private Actions secret after accepting the CDS dataset terms.')
        import cdsapi
        cache = args.output.parent / 'glosea-downloads' / nominal.strftime('%Y%m')
        cache.mkdir(parents=True, exist_ok=True)
        client = cdsapi.Client(url='https://cds.climate.copernicus.eu/api', key=key, quiet=True, debug=False, timeout=60)
        inputs = []
        for index, request in enumerate(requests):
            dest = cache / f'part-{index}.grib'
            client.retrieve(DATASET, request, str(dest))
            inputs.append(dest)
    payload = assemble((record for path in inputs for record in read_grib(path, nominal)), nominal, now)
    args.output.mkdir(parents=True, exist_ok=True)
    temporary = args.output / 'latest.json.tmp'
    temporary.write_text(json.dumps(payload, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    temporary.replace(args.output / 'latest.json')
    print(f"Prepared {payload['memberCount']} complete GloSea members, {DAYS} valid dates, nominal {nominal:%Y-%m}")


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not print arbitrary API exception bodies that could include auth.
        print(f'GloSea preparation failed ({type(error).__name__}). Nothing published.', file=sys.stderr)
        response = getattr(error, 'response', None)
        if response is not None:
            print(f'CDS HTTP status: {response.status_code}', file=sys.stderr)
            detail = response.text.lower()
            if any(word in detail for word in ['licence', 'license', 'terms of use', 'terms and conditions']):
                print('CDS reports a licence/terms requirement. Accept the seasonal pressure-level dataset terms in the CDS account associated with this token.', file=sys.stderr)
            elif any(word in detail for word in ['invalid token', 'invalid key', 'authentication', 'unauthorized']):
                print('CDS reports an authentication problem. Check the stored personal API token.', file=sys.stderr)
            elif response.status_code == 400:
                print('CDS rejected the dataset selection; the request needs review.', file=sys.stderr)
        if isinstance(error, ValueError):
            print(str(error), file=sys.stderr)
        sys.exit(1)
