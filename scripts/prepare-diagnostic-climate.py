"""Extract NASA Ozone Watch's published Mean column from archived source files.

Offline, deterministic extraction; never use the Data or Fcst columns.
"""
from datetime import date, timedelta
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PERIOD = '1978/1979 to 2025/2026'
SOURCES = {
    'wind': ('wind/u60n_10_2026_merra2.txt', '60N Zonal Mean Zonal Wind', 'm s!U-1!N'),
    'temperature': ('temperature/t60_90n_10_2026_merra2.txt', '60-90N Zonal Mean Temperature', 'K'),
}

def extract(text, name, units):
    lines = text.splitlines()
    assert lines[0] == 'Name: ' + name
    assert lines[1] == 'Units: ' + units
    assert lines[2] == 'Level: 10 hPa'
    assert lines[5] == 'Climatology: ' + PERIOD
    columns = lines[6].split()
    assert columns == ['Date', 'Data', 'Minimum', '10%', '30%', 'Mean', '70%', '90%', 'Maximum', 'Fcst']
    values = {}
    for line in lines[7:]:
        row = line.split()
        assert len(row) == len(columns)
        day = date.fromisoformat(row[0]).strftime('%m-%d')
        assert day not in values
        value = float(row[columns.index('Mean')])
        assert (-100 < value < 100) if units != 'K' else (150 < value < 300)
        values[day] = round(value - (273.15 if units == 'K' else 0), 2)
    calendar = [(date(2001, 1, 1) + timedelta(days=i)).strftime('%m-%d') for i in range(365)]
    assert set(values) == set(calendar), 'Require every calendar day exactly once'
    return [values[day] for day in calendar]

def main():
    result = dict(version=1, provider='NASA Ozone Watch', dataset='MERRA2',
                  period=PERIOD, level=10, calendar='365 days, January 1 first',
                  leapDay='mean of February 28 and March 1', sources={})
    for key, (path, name, units) in SOURCES.items():
        raw = (ROOT / 'scripts/data/northern-climate' / (key + '.txt')).read_bytes()
        result[key] = extract(raw.decode('ascii'), name, units)
        result['sources'][key] = dict(url='https://ozonewatch.gsfc.nasa.gov/meteorology/figures/merra2/' + path,
                                      sha256=hashlib.sha256(raw).hexdigest())
    (ROOT / 'lib/diagnostic-climate.json').write_text(json.dumps(result, indent=2) + '\n')
    print('Validated 365 daily means for both diagnostics')

if __name__ == '__main__':
    main()
