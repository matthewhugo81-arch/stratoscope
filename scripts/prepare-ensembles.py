"""Prepare complete ensemble statistics once, from anonymous official GRIB data.

Only compact sampled statistics are published; raw fields stay in runner memory.
No credentials, paid APIs, Actions artifacts, caches or cloud resources are used.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
import gzip
import hashlib
import json
from pathlib import Path
import struct
from threading import Lock
import time
import urllib.request

import eccodes as ec
import numpy as np

CONFIG = {
    'gefs': {'count': 31, 'levels': [10, 20, 30, 50, 70, 100], 'maxHour': 384},
    'ifs_ens': {'count': 51, 'levels': [10, 50, 100], 'maxHour': 360},
    'aifs_ens': {'count': 51, 'levels': [10, 50, 100], 'maxHour': 360},
}
KEYS = ['temperature', 'height', 'u', 'v']
EC_ORIGIN = 'https://data.ecmwf.int/forecasts'
NOAA_ORIGIN = 'https://noaa-gefs-pds.s3.amazonaws.com'
DECODE_LOCK = Lock()


def request(url, start=None, length=None, attempts=4):
    for attempt in range(attempts):
        try:
            headers = {'User-Agent': 'Stratoscope-public-ensemble-preparation/1'}
            if start is not None:
                headers['Range'] = f'bytes={start}-{start+length-1}'
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as response:
                if start is not None:
                    assert response.status == 206, 'Provider ignored byte range'
                    assert response.headers['Content-Range'].startswith(f'bytes {start}-{start+length-1}/'), 'Wrong byte range'
                data = response.read()
                if length is not None:
                    assert len(data) == length, 'Truncated provider response'
                return data
        except Exception:
            if attempt == attempts-1:
                raise
            time.sleep(2 ** attempt)


def ec_base(model, run, hour, control=False):
    day, cycle = run.strftime('%Y%m%d'), run.strftime('%H')
    system = 'aifs-ens' if model == 'aifs_ens' else 'ifs'
    stream = 'oper' if model == 'ifs_ens' and control else 'enfo'
    kind = 'fc' if stream == 'oper' else 'cf' if control else 'ef' if model == 'ifs_ens' else 'pf'
    return f'{EC_ORIGIN}/{day}/{cycle}z/{system}/0p25/{stream}/{day}{cycle}0000-{hour}h-{stream}-{kind}'


def noaa_base(run, hour, member, part):
    day, cycle = run.strftime('%Y%m%d'), run.strftime('%H')
    name = 'gec00' if member == 0 else f'gep{member:02}'
    return f'{NOAA_ORIGIN}/gefs.{day}/{cycle}/atmos/pgrb2{part}p5/{name}.t{cycle}z.pgrb2{part}.0p50.f{hour:03}'


def ec_entries(model, run, hour, levels, probe=False):
    result = []
    for control in [False, True]:
        base = ec_base(model, run, hour, control)
        entries = [json.loads(line) for line in request(base + '.index', attempts=1 if probe else 4).decode().splitlines()]
        params = {'t': 'temperature', 'z' if model == 'aifs_ens' else 'gh': 'height', 'u': 'u', 'v': 'v'}
        for item in entries:
            if item.get('levtype') != 'pl' or int(item.get('levelist', -1)) not in levels or item['param'] not in params:
                continue
            member = 0 if control else int(item['number'])
            assert item['date'] == run.strftime('%Y%m%d') and int(item['time']) == run.hour * 100 and int(item['step']) == hour
            assert item['type'] == ('fc' if model == 'ifs_ens' and control else 'cf' if control else 'pf')
            result.append((base + '.grib2', item['_offset'], item['_length'], member, int(item['levelist']), params[item['param']]))
    return result


def noaa_entries(run, hour, levels, workers):
    def inventory(task):
        member, part = task
        base = noaa_base(run, hour, member, part)
        entries = [line.split(':') for line in request(base + '.idx').decode().splitlines()]
        keys = {'TMP': 'temperature', 'HGT': 'height', 'UGRD': 'u', 'VGRD': 'v'}
        result = []
        for i, item in enumerate(entries):
            if item[3] not in keys or item[4] not in [f'{level} mb' for level in levels]:
                continue
            start, end = int(item[1]), int(entries[i+1][1])
            result.append((base, start, end-start, member, int(item[4].split()[0]), keys[item[3]]))
        return result
    parts = set('b' if level in [20, 30, 70] else 'a' for level in levels)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return [entry for entries in pool.map(inventory, [(m, p) for m in range(31) for p in parts]) for entry in entries]


def groups(entries):
    """Join adjacent requested GRIB messages, bounded to 8 MB per HTTP request."""
    result = []
    for item in sorted(entries):
        url, start, length = item[:3]
        assert 20 <= length <= 8_000_000 and start >= 0
        if result and result[-1][0][0] == url and result[-1][-1][1] + result[-1][-1][2] == start and start+length-result[-1][0][1] <= 8_000_000:
            result[-1].append(item)
        else:
            result.append([item])
    return result


def decode(message, model, run, hour, member, level, key):
    # ecCodes builds differ in thread-safety; parallelise transfers, serialize
    # native decoder access so definition parsing is safe on every platform.
    with DECODE_LOCK:
        return decode_field(message, model, run, hour, member, level, key)


def decode_field(message, model, run, hour, member, level, key):
    handle = ec.codes_new_from_message(message)
    try:
        get = lambda name: ec.codes_get(handle, name)
        assert get('edition') == 2 and get('gridType') == 'regular_ll'
        assert get('dataDate') == int(run.strftime('%Y%m%d')) and get('dataTime') == run.hour * 100
        assert get('endStep') == hour and get('typeOfLevel') == 'isobaricInhPa' and get('level') == level
        expected = {'temperature': 't', 'height': 'z' if model == 'aifs_ens' else 'gh', 'u': 'u', 'v': 'v'}[key]
        assert get('shortName') == expected, 'Wrong variable'
        if model == 'ifs_ens' and member == 0:
            assert get('productDefinitionTemplateNumber') == 0
        else:
            assert get('perturbationNumber') == member and get('productDefinitionTemplateNumber') == 1
        nx, ny = get('Ni'), get('Nj')
        dx = get('iDirectionIncrementInDegrees')
        dy = get('jDirectionIncrementInDegrees') * (1 if get('jScansPositively') else -1)
        lat0, lon0 = get('latitudeOfFirstGridPointInDegrees'), get('longitudeOfFirstGridPointInDegrees')
        assert dx in [.25, .5, 1] and abs(dy) == dx and nx * dx == 360
        assert not get('iScansNegatively') and not get('jPointsAreConsecutive')
        values = ec.codes_get_values(handle).reshape(ny, nx)
        assert np.isfinite(values).all() and not get('bitmapPresent'), 'Incomplete field'
        if key == 'temperature':
            values = values - 273.15
        if key == 'height' and model == 'aifs_ens':
            values = values / 9.80665
        rows = (90 - np.arange(91) - lat0) / dy
        columns = ((np.arange(360) - lon0 + 720) % 360) / dx
        assert np.all(rows == np.rint(rows)) and np.all(columns == np.rint(columns))
        assert rows.min() >= 0 and rows.max() < ny
        zonal = None
        if key == 'u' and level == 10:
            row = (60-lat0)/dy
            assert row == round(row) and 0 <= row < ny
            zonal = {'value': float(values[int(row)].mean()), 'samples': nx, 'longitudeStep': dx, 'basis': 'native'}
        return values[np.ix_(rows.astype(int), columns.astype(int))].copy(), zonal
    finally:
        ec.codes_release(handle)


def calculate(model, run, hour, levels, workers, panel_writer=None):
    entries = noaa_entries(run, hour, levels, workers) if model == 'gefs' else ec_entries(model, run, hour, levels)
    expected = {(m, level, key) for m in range(CONFIG[model]['count']) for level in levels for key in KEYS}
    identities = [tuple(item[3:]) for item in entries]
    assert len(identities) == len(set(identities)) and set(identities) == expected, 'Incomplete or duplicate ensemble'
    def read_group(items):
        url, start = items[0][:2]
        length = items[-1][1] + items[-1][2] - start
        content = request(url, start, length)
        result = []
        for _, offset, size, member, level, key in items:
            value, zonal = decode(content[offset-start:offset-start+size], model, run, hour, member, level, key)
            result.append(((member, level, key), (value, zonal)))
        return result
    downloaded = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for decoded in pool.map(read_group, groups(entries)):
            downloaded.update(decoded)
    results = {}
    for level in levels:
        values = {key: np.stack([downloaded[m, level, key][0] for m in range(CONFIG[model]['count'])]) for key in KEYS}
        wind = np.hypot(values['u'], values['v'])
        planes = [values[key].mean(axis=0) for key in KEYS] + [wind.mean(axis=0), values['temperature'].std(axis=0, ddof=0), wind.std(axis=0, ddof=0)]
        zonal = None
        if level == 10:
            diagnostics = [downloaded[m, 10, 'u'][1] for m in range(CONFIG[model]['count'])]
            assert all(d and d['samples'] == diagnostics[0]['samples'] for d in diagnostics)
            zonal = {**diagnostics[0], 'value': sum(d['value'] for d in diagnostics)/len(diagnostics)}
            if panel_writer:
                panel_writer(np.stack([values['temperature'],values['height'],wind],axis=1)[:,:,::2,::2],diagnostics)
        results[level] = (planes, zonal)
    return results


def save_panels(path,model,run,hour,values,diagnostics):
    count=CONFIG[model]['count']
    assert values.shape==(count,3,46,180) and np.isfinite(values).all()
    assert len(diagnostics)==count and all(d and np.isfinite(d['value']) for d in diagnostics)
    header=json.dumps(dict(version=1,model=model,run=run.isoformat(timespec='milliseconds').replace('+00:00','Z'),hour=hour,level=10,count=count,grid=dict(nx=180,ny=46,lat0=90,lon0=0,dx=2,dy=-2),scale=100,planes=3,zonal=[d['value'] for d in diagnostics],samples=diagnostics[0]['samples'],source=NOAA_ORIGIN if model=='gefs' else EC_ORIGIN),separators=(',',':')).encode()
    arrays=np.rint(values*100).astype('<i4')
    arrays[:,:,:,1:]-=arrays[:,:,:,:-1].copy()
    payload=gzip.compress(b'STRATP01'+struct.pack('<I',len(header))+header+arrays.tobytes(),compresslevel=6,mtime=0)
    path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(payload)
    return dict(bytes=len(payload),sha256=hashlib.sha256(payload).hexdigest())


def save_frame(path, model, run, hour, level, planes, zonal):
    stamp = run.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    metadata = {'version': 1, 'model': model, 'run': stamp, 'hour': hour, 'level': level, 'count': CONFIG[model]['count'], 'grid': {'nx': 360, 'ny': 91, 'lat0': 90, 'lon0': 0, 'dx': 1, 'dy': -1}, 'zonalWind60N': zonal, 'preparedAt': datetime.now(timezone.utc).isoformat(), 'scale': 100, 'planes': 7, 'source': NOAA_ORIGIN if model == 'gefs' else EC_ORIGIN}
    header = json.dumps(metadata, separators=(',', ':')).encode()
    values = np.stack(planes)
    assert values.shape == (7, 91, 360) and np.isfinite(values).all()
    assert np.max(np.abs(values)) < 10_000_000, 'Value exceeds packed representation'
    arrays = np.rint(values*100).astype('<i4')
    # Row differences compress smoothly varying fields without losing precision.
    arrays[:, :, 1:] = arrays[:, :, 1:] - arrays[:, :, :-1]
    payload = gzip.compress(b'STRAT001' + struct.pack('<I', len(header)) + header + arrays.tobytes(), compresslevel=6, mtime=0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return {'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}


def discover(model, now=None):
    now = now or datetime.now(timezone.utc)
    interval = 6
    start = datetime.fromtimestamp(int(now.timestamp())//(interval*3600)*(interval*3600), timezone.utc)
    cfg = CONFIG[model]
    for back in range(6):
        run = start-timedelta(hours=interval*back)
        try:
            if model == 'gefs':
                for member in [0,30]:
                    for part in ['a','b']:
                        lines = request(noaa_base(run,384,member,part)+'.idx',attempts=1).decode().splitlines()
                        fields = {(line.split(':')[3],line.split(':')[4]) for line in lines}
                        for level in cfg['levels']:
                            if ('b' if level in [20,30,70] else 'a') != part:continue
                            assert all((key,f'{level} mb') in fields for key in ['TMP','HGT','UGRD','VGRD'])
            else:
                entries = ec_entries(model,run,cfg['maxHour'],cfg['levels'],probe=True)
                identities = {(m,l,k) for _,_,_,m,l,k in entries}
                assert len(entries)==cfg['count']*len(cfg['levels'])*4
                assert all((m,l,k) in identities for m in range(cfg['count']) for l in cfg['levels'] for k in KEYS)
            print('Newest complete provider cycle:',model,run.isoformat(),flush=True)
            return run
        except Exception as e:
            print('Cycle not complete:',model,run.isoformat(),type(e).__name__,flush=True)
    raise RuntimeError('No complete provider cycle found for '+model)

def already_published(model,run):
    url=f"https://raw.githubusercontent.com/matthewhugo81-arch/stratoscope/forecast-data-{model.replace('_','-')}/latest.json"
    try:previous=json.loads(request(url,attempts=2))
    except urllib.error.HTTPError as e:
        if e.code==404:return False
        raise
    return previous.get('complete') is True and datetime.fromisoformat(previous['run'].replace('Z','+00:00'))>=run

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', choices=CONFIG, required=True)
    parser.add_argument('--run')
    parser.add_argument('--hours', type=int, nargs='+')
    parser.add_argument('--levels', type=int, nargs='+')
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--skip-published', action='store_true')
    args = parser.parse_args()
    config = CONFIG[args.model]
    run = datetime.fromisoformat(args.run.replace('Z', '+00:00')) if args.run else discover(args.model)
    hours, levels = args.hours or list(range(0, config['maxHour']+1, 6)), args.levels or config['levels']
    assert run.hour in [0,6,12,18] and run.minute == 0
    if args.skip_published and already_published(args.model,run):
        print('Current complete cycle is already published; no downloads needed',flush=True);return
    assert all(h in range(0, config['maxHour']+1, 6) for h in hours) and all(l in config['levels'] for l in levels)
    run_key = run.strftime('%Y%m%d%H')
    manifest = {'version': 1, 'model': args.model, 'run': run.isoformat(timespec='milliseconds').replace('+00:00', 'Z'), 'maxHour': max(hours), 'levels': levels, 'step': 6, 'count': config['count'], 'files': {}, 'complete': hours == list(range(0, config['maxHour']+1, 6)) and levels == config['levels']}
    for hour in hours:
        started = time.monotonic()
        def panel_writer(values,diagnostics):
            filename=f'{run_key}/10/{hour}.members.bin.gz'
            manifest.setdefault('panels',{})[str(hour)]={'path':filename,**save_panels(args.output/filename,args.model,run,hour,values,diagnostics)}
        result = calculate(args.model, run, hour, levels, args.workers,panel_writer)
        for level, (planes, zonal) in result.items():
            filename = f'{run_key}/{level}/{hour}.bin.gz'
            manifest['files'][f'{level}/{hour}'] = {'path': filename, **save_frame(args.output/filename, args.model, run, hour, level, planes, zonal)}
        print(json.dumps({'model': args.model, 'hour': hour, 'seconds': round(time.monotonic()-started, 2), 'files': len(manifest['files'])}), flush=True)
    manifest['preparedAt'] = datetime.now(timezone.utc).isoformat()
    (args.output/'latest.json').write_text(json.dumps(manifest, separators=(',', ':')), encoding='utf-8')
    print('COMPLETE', args.model, len(manifest['files']), sum(v['bytes'] for v in manifest['files'].values()), flush=True)


if __name__ == '__main__':
    main()
