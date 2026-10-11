"""Native, read-only precursor adapters. No publication or provider substitution.

An inventory advertises availability; a decoded message verifies a field. Both
identities and SHA-256 receipts are retained. Existing production code is untouched.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
import bz2
import hashlib
import json
import re
import time
from email.utils import parsedate_to_datetime
from pathlib import Path
from threading import Lock
from urllib.request import Request, urlopen
from urllib.error import HTTPError

import eccodes as ec
import numpy as np

MODELS = {
    'gfs': dict(count=1, centre=7, kind='deterministic_forecast', levels=[10, 50, 100, 500]),
    'ifs': dict(count=1, centre=98, kind='deterministic_forecast', levels=[10, 50, 100, 500]),
    'icon': dict(count=1, centre=78, kind='deterministic_forecast', levels=[30, 50, 100, 500]),
    'gefs': dict(count=31, centre=7, kind='ensemble_forecast', levels=[10, 50, 100, 500]),
    'ifs_ens': dict(count=51, centre=98, kind='ensemble_forecast', levels=[10, 50, 100, 500]),
    'aifs_ens': dict(count=51, centre=98, kind='ensemble_forecast', levels=[10, 50, 100, 500]),
}
NOAA = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com'
GEFS = 'https://noaa-gefs-pds.s3.amazonaws.com'
ECMWF = 'https://data.ecmwf.int/forecasts'
DWD = 'https://opendata.dwd.de/weather/nwp/icon/grib'
LOCK = Lock()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def stamp(value):
    return value.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def run_time(value):
    value = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(value.tzinfo is not None and value.utcoffset() == timedelta(0), 'UTC run required')
    require(value.hour in (0, 6, 12, 18) and not any((value.minute, value.second, value.microsecond)), 'Invalid run cycle')
    return value


def digest(blob):
    return hashlib.sha256(blob).hexdigest()


class Store:
    """Content-checked local cache; refresh inventories for every invocation."""
    def __init__(self, path):
        self.path = Path(path)
        self.path.mkdir(parents=True, exist_ok=True)

    def get(self, url, start=None, length=None, cache=True):
        key = digest(f'{url}|{start}|{length}'.encode())
        target = self.path / (key + '.bin')
        receipt = self.path / (key + '.json')
        if cache and target.exists() and receipt.exists():
            data = target.read_bytes()
            meta = json.loads(receipt.read_text())
            require(meta['url'] == url and meta['sha256'] == digest(data), 'Corrupt cache')
            require(meta['start'] == start and meta['length'] == length, 'Cache identity mismatch')
            return data, meta
        headers = {'User-Agent': 'Stratoscope-precursor-research/1'}
        if start is not None:
            headers['Range'] = f'bytes={start}-{start + length - 1}'
        for attempt in range(4):
            try:
                response = urlopen(Request(url, headers=headers), timeout=45)
                break
            except HTTPError as error:
                if error.code not in (429,503) or attempt==3:raise
                retry=error.headers.get('Retry-After','') if error.headers else ''
                try:delay=float(retry)
                except ValueError:
                    try:delay=(parsedate_to_datetime(retry)-datetime.now(timezone.utc)).total_seconds()
                    except (ValueError,TypeError):delay=60*2**attempt
                # Respect server backoff even when it is longer than our default.
                delay=max(1,delay);error.close()
                print(f'Provider throttled; retry in {delay:.0f}s (attempt {attempt+1}/3)',flush=True)
                time.sleep(delay)
        with response:
            if start is not None:
                require(response.status == 206, 'Provider ignored byte range')
                require(response.headers.get('Content-Range', '').startswith(f'bytes {start}-{start+length-1}/'), 'Wrong byte range')
            data = response.read(32_000_001)
            require(len(data) <= 32_000_000, 'Response exceeds bounded field size')
            require(length is None or len(data) == length, 'Truncated response')
            meta = dict(url=url, start=start, length=length, bytes=len(data), sha256=digest(data),
                        retrievedAt=stamp(datetime.now(timezone.utc)), etag=response.headers.get('ETag'))
        target.write_bytes(data)
        receipt.write_text(json.dumps(meta, indent=2), encoding='utf-8')
        return data, meta


def ec_base(model, run, hour, control):
    system = 'aifs-ens' if model == 'aifs_ens' else 'ifs'
    stream = 'oper' if model == 'ifs' or (model == 'ifs_ens' and control) else 'enfo'
    kind = 'fc' if stream == 'oper' else 'cf' if control else 'ef' if model == 'ifs_ens' else 'pf'
    return f'{ECMWF}/{run:%Y%m%d}/{run:%H}z/{system}/0p25/{stream}/{run:%Y%m%d%H}0000-{hour}h-{stream}-{kind}'


def noaa_base(model, run, hour, member=0, part='a', analysis=False):
    if model == 'gfs':
        suffix = 'anl' if analysis else f'f{hour:03}'
        return f'{NOAA}/gfs.{run:%Y%m%d}/{run:%H}/atmos/gfs.t{run:%H}z.pgrb2.0p25.{suffix}'
    name = 'gec00' if member == 0 else f'gep{member:02}'
    return f'{GEFS}/gefs.{run:%Y%m%d}/{run:%H}/atmos/pgrb2{part}p5/{name}.t{run:%H}z.pgrb2{part}.0p50.f{hour:03}'


def icon_name(run, hour, level, key):
    return f'icon_global_icosahedral_pressure-level_{run:%Y%m%d%H}_{hour:03}_{level}_{key.upper()}.grib2.bz2'


def requested_fields(model, levels=None):
    return {(level, key) for level in (levels or MODELS[model]['levels'])
            for key in (['height'] if level == 500 else ['temperature', 'height', 'u', 'v'])}


def select_noaa(raw, run, hour, member, fields, ensemble=False, analysis=False):
    rows = [line.split(':') for line in raw.splitlines() if line.strip()]
    result = []
    params = {'TMP': 'temperature', 'HGT': 'height', 'UGRD': 'u', 'VGRD': 'v', 'PRES': 'pressure'}
    for i, row in enumerate(rows):
        if len(row) < 6 or row[3] not in params:
            continue
        level = int(row[4].split()[0]) if re.fullmatch(r'\d+ mb', row[4]) else '2pvu' if row[4] == 'PV=2e-06 (Km^2/kg/s) surface' else None
        key = params[row[3]]
        if (level, key) not in fields:
            continue
        require(row[2] == f'd={run:%Y%m%d%H}', 'NOAA index run mismatch')
        require(row[5] == ('anl' if hour == 0 else f'{hour} hour fcst'), 'NOAA index lead mismatch')
        if analysis:
            require(hour == 0 and row[5] == 'anl', 'Forecast is not analysis')
        if ensemble:
            expected = 'ENS=low-res ctl' if member == 0 else f'ENS=+{member}'
            require(expected in row[6:], 'NOAA index member mismatch')
        require(i + 1 < len(rows), 'No terminating index offset')
        start, end = int(row[1]), int(rows[i+1][1])
        require(0 <= start < end and end-start < 25_000_000, 'Invalid index span')
        result.append(dict(start=start, length=end-start, member=member, level=level, key=key))
    return result


def inventory(store, model, run, hour, fields=None, analysis=False):
    require(model in MODELS, 'Unsupported model')
    require(isinstance(hour, int) and 0 <= hour <= 384 and hour % 6 == 0, 'Unsupported lead')
    require(not analysis or model == 'gfs' and hour == 0, 'Only explicit GFS analysis is implemented')
    fields = fields or requested_fields(model)
    records, receipts = [], []
    availability = set()
    if model in ('gfs', 'gefs'):
        parts = {'b' if level in [1, 2, 3, 5, 7, 20, 30, 70, 150] else 'a' for level, _ in fields} if model == 'gefs' else {'a'}
        def one(task):
            member, part = task
            url = noaa_base(model, run, hour, member, part, analysis)
            data, receipt = store.get(url+'.idx', cache=False)
            selected = select_noaa(data.decode(), run, hour, member, fields, model == 'gefs', analysis)
            return [dict(e, url=url, indexSha256=receipt['sha256']) for e in selected], receipt, data.decode()
        with ThreadPoolExecutor(max_workers=4) as pool:
            for selected, receipt, raw in pool.map(one, [(m,p) for m in range(MODELS[model]['count']) for p in sorted(parts)]):
                records.extend(selected); receipts.append(receipt)
                availability.update(line.split(':')[4] for line in raw.splitlines() if len(line.split(':')) > 5)
    elif model == 'icon':
        for key in sorted({key for _, key in fields}):
            param = {'height':'fi', 'temperature':'t', 'u':'u', 'v':'v'}[key]
            url = f'{DWD}/{run:%H}/{param}/'
            data, receipt = store.get(url, cache=False); receipts.append(receipt)
            names = set(re.findall(r'href="([^"]+)"', data.decode()))
            availability.update(re.findall(rf'pressure-level_{run:%Y%m%d%H}_{hour:03}_(\d+)_', data.decode()))
            for level, requested in sorted(fields):
                if requested != key: continue
                name = icon_name(run, hour, level, param)
                require(name in names, f'ICON lacks {level} hPa {key} at requested run/lead')
                records.append(dict(url=url+name, start=None, length=None, member=0, level=level, key=key, indexSha256=receipt['sha256']))
    else:
        for control in ([True] if model == 'ifs' else [False, True]):
            url = ec_base(model, run, hour, control)
            data, receipt = store.get(url+'.index', cache=False); receipts.append(receipt)
            for item in map(json.loads, data.decode().splitlines()):
                availability.add(item.get('levtype','')+':'+str(item.get('levelist','')))
                params = {'t':'temperature','z' if model == 'aifs_ens' else 'gh':'height','u':'u','v':'v'}
                level = int(item.get('levelist', -1)) if item.get('levtype') == 'pl' else None
                key = params.get(item['param'])
                if (level, key) not in fields: continue
                expected_type = 'fc' if model == 'ifs' or (model == 'ifs_ens' and control) else 'cf' if control else 'pf'
                require(item['date'] == run.strftime('%Y%m%d') and int(item['time']) == run.hour*100 and int(item['step']) == hour, 'ECMWF index time mismatch')
                require(item['type'] == expected_type and item['class'] == ('ai' if model == 'aifs_ens' else 'od'), 'ECMWF product mismatch')
                require(item['stream'] == ('oper' if expected_type == 'fc' else 'enfo'), 'ECMWF stream mismatch')
                if model == 'aifs_ens': require(item.get('model') == 'aifs-ens', 'AIFS model mismatch')
                member = 0 if control else int(item['number'])
                if control and 'number' in item: require(int(item['number']) == 0, 'Control member mismatch')
                start, length = item['_offset'], item['_length']
                require(type(start) is int and type(length) is int and start >= 0 and 20 < length < 25_000_000, 'Bad ECMWF range')
                records.append(dict(url=url+'.grib2',start=start,length=length,member=member,level=level,key=key,indexSha256=receipt['sha256']))
    identities = [(e['member'], e['level'], e['key']) for e in records]
    expected = {(m, l, k) for m in range(MODELS[model]['count']) for l,k in fields}
    require(len(identities) == len(set(identities)) and set(identities) == expected, 'Incomplete or duplicate members/fields')
    return records, dict(indexes=receipts, advertisedLevels=sorted(availability), expectedMembers=list(range(MODELS[model]['count'])),
                         verifiedInventoryRecords=len(records), decoded=False)


def validate_grib(get, model, run, hour, entry, analysis=False):
    """Independent decoded identity; never trust an index or filename alone."""
    level, key, member = entry['level'], entry['key'], entry['member']
    require(get('edition') == 2 and get('centre', int) == MODELS[model]['centre'], 'GRIB centre/edition mismatch')
    require(get('dataDate') == int(run.strftime('%Y%m%d')) and get('dataTime') == run.hour*100, 'GRIB run mismatch')
    end = get('endStep')
    if isinstance(end,str):
        match = re.fullmatch(r'(\d+)([smh])',end)
        require(match is not None, 'Unsupported GRIB step units')
        end = int(match[1])*{'s':1/3600,'m':1/60,'h':1}[match[2]]
    require(end == hour and get('stepType') == 'instant', 'GRIB lead/step mismatch')
    valid = run + timedelta(hours=hour)
    require(get('validityDate') == int(valid.strftime('%Y%m%d')) and get('validityTime') == valid.hour*100, 'GRIB valid time mismatch')
    if level == '2pvu':
        require(model == 'gfs' and get('typeOfFirstFixedSurface', int) == 109, 'Not a PV surface')
        pv = get('scaledValueOfFirstFixedSurface') * 10.0**(-get('scaleFactorOfFirstFixedSurface'))
        require(abs(pv-2e-6) < 1e-12, 'Not the positive 2-PVU surface')
    else:
        require(get('typeOfLevel') == 'isobaricInhPa' and get('level') == level, 'GRIB pressure mismatch')
    name = {'temperature':'t','height':'z' if model in ('aifs_ens','icon') else 'gh','u':'u','v':'v','pressure':'pres'}[key]
    units = {'temperature':'K','height':'m**2 s**-2' if name == 'z' else 'gpm','u':'m s**-1','v':'m s**-1','pressure':'Pa'}[key]
    require(get('shortName') == name and get('units') == units, 'GRIB variable/units mismatch')
    ensemble = MODELS[model]['count'] > 1 and not (model == 'ifs_ens' and member == 0)
    require(get('productDefinitionTemplateNumber') == (1 if ensemble else 0), 'GRIB product type mismatch')
    if ensemble:
        require(get('perturbationNumber') == member, 'GRIB member mismatch')
    if model == 'aifs_ens':
        require(get('class') == 'ai' and get('model') == 'aifs-ens', 'Decoded AIFS identity mismatch')
    if analysis:
        require(get('typeOfGeneratingProcess') == 0 and hour == 0 and '.anl' in entry['url'], 'Not a native analysis')


def regular_samples(values, get, southern=0):
    nx, ny = get('Ni'), get('Nj')
    dx = get('iDirectionIncrementInDegrees')
    dy = get('jDirectionIncrementInDegrees') * (1 if get('jScansPositively') else -1)
    require(get('gridType') == 'regular_ll' and dx in (.25,.5,1) and abs(dy) == dx and nx*dx == 360, 'Incomplete longitude grid')
    require(not get('iScansNegatively') and not get('jPointsAreConsecutive') and not get('alternativeRowScanning'), 'Unsupported scan order')
    lat0, lon0 = get('latitudeOfFirstGridPointInDegrees'), get('longitudeOfFirstGridPointInDegrees')
    rows = (np.arange(90,southern-1,-1)-lat0)/dy
    cols = ((np.arange(360)-lon0+720)%360)/dx
    require(np.allclose(rows, np.rint(rows)) and np.allclose(cols, np.rint(cols)) and rows.min() >= 0 and rows.max() < ny, 'Missing exact sample grid')
    values = values.reshape(ny,nx)
    subset = values[np.ix_(np.rint(rows).astype(int), np.rint(cols).astype(int))].copy()
    require(np.isfinite(subset).all() and np.abs(subset).max() < 1e10, 'Missing sampled values')
    return subset, values[int(round((60-lat0)/dy))].copy()


def decode(blob, model, run, hour, entry, analysis=False, icon_grid=None):
    if model == 'icon': blob = bz2.decompress(blob)
    with LOCK:
        handle = ec.codes_new_from_message(blob)
        require(handle is not None, 'Not a GRIB message')
        try:
            get = lambda k, typ=None: ec.codes_get(handle, k, typ)
            require(get('totalLength') == len(blob), 'Multiple or truncated GRIB messages')
            validate_grib(get, model, run, hour, entry, analysis)
            values = ec.codes_get_values(handle)
            key = entry['key']
            if key == 'height' and model in ('aifs_ens','icon'): values = values/9.80665
            if model == 'icon':
                require(icon_grid is not None and (get('uuidOfHGrid'), get('numberOfDataPoints')) == icon_grid[1], 'ICON field/coordinate grid mismatch')
                require(not get('bitmapPresent') and np.isfinite(values).all(), 'Missing ICON values')
                sampled, circle = values[icon_grid[0]].reshape(91,360), None
            else:
                if entry['level'] != '2pvu': require(not get('bitmapPresent'), 'Missing pressure-level values')
                sampled, circle = regular_samples(values, get, 30 if entry['level'] == '2pvu' else 0)
            ranges = {'height':(-1000,65000), 'temperature':(100,350), 'pressure':(1000,110000), 'u':(-250,250), 'v':(-250,250)}
            lo, hi = ranges[key]
            require(np.isfinite(sampled).all() and (sampled > lo).all() and (sampled < hi).all(), f'Implausible {model} {key} {entry["level"]}: {sampled.min()} .. {sampled.max()}')
            native_wind = key == 'u' and entry['level'] == 10 and circle is not None
            if native_wind:
                require(np.isfinite(circle).all() and (np.abs(circle)<250).all(), 'Incomplete native 60N longitude circle')
            wind = float(circle.mean()) if native_wind else None
            return sampled, wind, dict(shortName=get('shortName'), units=get('units'), centre=get('centre',int),
                member=entry['member'], level=entry['level'], run=stamp(run), leadHours=hour,
                validTime=stamp(run+timedelta(hours=hour)), gridType=get('gridType'), nativePoints=int(values.size),
                nativeZonalSamples=len(circle) if wind is not None else None)
        finally:
            ec.codes_release(handle)


def icon_coordinates(store, run):
    from scipy.spatial import cKDTree
    coords, receipts, grid = [], [], None
    for key, short in [('clat','tlat'),('clon','tlon')]:
        url = f'{DWD}/{run:%H}/{key}/icon_global_icosahedral_time-invariant_{run:%Y%m%d%H}_{key.upper()}.grib2.bz2'
        blob, receipt = store.get(url); receipts.append(receipt)
        with LOCK:
            h = ec.codes_new_from_message(bz2.decompress(blob))
            try:
                identity = (ec.codes_get(h,'uuidOfHGrid'),ec.codes_get(h,'numberOfDataPoints'))
                require(grid is None or grid == identity, 'Inconsistent coordinate grids')
                require(ec.codes_get(h,'shortName') == short, 'Wrong ICON coordinates')
                coords.append(ec.codes_get_values(h)); grid = identity
            finally: ec.codes_release(h)
    def xyz(lat,lon):
        lat,lon = np.deg2rad(lat),np.deg2rad(lon)
        return np.column_stack((np.cos(lat)*np.cos(lon),np.cos(lat)*np.sin(lon),np.sin(lat)))
    require(np.isfinite(coords).all() and np.abs(coords[0]).max() <= 90 and np.abs(coords[1]).max() <= 180, 'Invalid degree coordinates')
    distance, indices = cKDTree(xyz(*coords)).query(xyz(np.repeat(np.arange(90,-1,-1),360),np.tile(np.arange(360),91)))
    require(distance.max() < .005, 'ICON sampling too distant')
    return (indices, grid), receipts


def retrieve(store, model, run, hour, fields=None, analysis=False):
    entries, evidence = inventory(store, model, run, hour, fields, analysis)
    grid = None
    if model == 'icon': grid, evidence['coordinates'] = icon_coordinates(store, run)
    def one(entry):
        blob, receipt = store.get(entry['url'],entry['start'],entry['length'])
        values, wind, identity = decode(blob,model,run,hour,entry,analysis,grid)
        return (entry['member'],entry['level'],entry['key']), values, wind, dict(receipt, indexSha256=entry['indexSha256'], decoded=identity)
    fields, winds, receipts = {}, {}, []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for identity, value, wind, receipt in pool.map(one, entries):
            fields[identity] = value; receipts.append(receipt)
            if wind is not None: winds[identity[0]] = wind
    evidence.update(decoded=True, fields=receipts)
    return fields, winds, evidence
