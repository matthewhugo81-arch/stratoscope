# Native seasonal wind charts

Stratoscope prepares its own 60°N / 10 hPa zonal-mean u-wind time series from
official Copernicus CDS GRIB data. The public website renders compact JSON as
interactive SVG; the API token is never delivered to visitors.

## Data and calculation

- Seven models: UKMO system 610, ECMWF 51, Météo-France 9, DWD 22, CMCC 4,
  JMA 4 and BOM 2. These definitions are reviewed for April–December 2026.
  The importer stops outside that period until versions are reviewed.
- Forecasts contain 360 instantaneous 12-hour samples over 180 days after
  the nominal first of the month. Lagged members are aligned by valid time.
- Ensemble sizes are 50, 51, 51, 50, 50, 55 and 55 respectively. The importer
  requires every configured start and member to have a complete time series.
  Unusual recovery-member schedules require review, not relaxed validation.
- Every longitude enters the signed u-wind mean once. A duplicated seam must
  agree. Adjacent native latitude rows are interpolated to 60°N when needed.
  JMA's 1.25° grid is handled explicitly alongside 1° and ERA5's 0.25° grid.
- Model climatology pools equally weighted qualified hindcast trajectories
  from 1993–2016 for the same system and nominal start month. Bands show the
  full range, 10–90% and 25–75% using linear sample quantiles. An amber curve
  shows the mean. These are raw values without bias correction.
- ERA5's white dashed curve averages all 24 hourly zonal means into each day,
  then averages matching calendar days over 1993–2016. February 29 uses six
  leap years. ERA5 is one reusable annual reference.
- Model climatology follows lead time; ERA5 follows calendar day. Leap-year
  alignment can therefore differ by a day. This is a documented independent
  calculation, not a promise to reproduce every detail of Copernicus plots.
- Negative-member counts describe the raw ensemble, not calibrated SSW risk.

## Preparation and storage

`Prepare native seasonal wind charts` accepts forecast, climate or ERA5 phases
and one model or all models. The scheduled update runs at 13:37 UTC on the
7th and 11th, allowing the separate ECMWF and other-centre monthly releases.
It skips already prepared issues and references. Two model jobs run at once.
Each historical year is checkpointed; interrupted preparation resumes from
those checkpoints. A new month needs its corresponding model climatology.

The `forecast-data-seasonal` branch contains:

- `forecast/{centre}.json`: latest complete forecast for that model.
- `climate/{centre}-{system}-{month}.json`: complete historical statistics.
- `climate/era5-1993-2016.json`: complete ERA5 calendar-day reference.
- `checkpoints/`: reduced intermediate historical values for resumability.

Missing references are labelled as pending on the site and are never fabricated.
The ERA5 notice above the plot shows the saved-year count and the time of the
last independent progress check. The forecast-health workflow checks the ERA5
archive every 20 minutes and after an ERA5 preparation run ends. If the final
reference is absent and neither ERA5-capable workflow is active, it resumes the
import (with a 15-minute dispatch cooldown). Completed years and accepted CDS
request IDs are reused; the audit itself never submits CDS requests. Both ERA5
entry points share a concurrency group. Completion requires all 366 valid daily
values and the correct 24-year / six-leap-year sample counts.
The read-only `Diagnose seasonal imports` workflow can inspect all outstanding
ERA5 request states without submitting, replacing or cancelling any request.
Models awaiting their first native file retain an explicitly labelled official
Copernicus chart until the prepared data become available.
Refresh the seasonal section to discover newly published files. Failed preparation
does not replace the previous successful issue. The legacy GloSea pipeline remains
available while the new multi-model archive is established; see GLOSEA_SETUP.md.

CDS access uses the existing `CDSAPI_KEY` GitHub Actions secret and accepted
dataset terms. Preparation is restricted to this public repository using standard
GitHub-hosted runners. No paid runners, Actions artifact storage or cache storage
are configured. Visitors fetch only the small public prepared files.

## Validation

The importer checks model/system, u-wind units, pressure, timestamps, longitude
coverage, expected member counts and all requested valid times before publication.
The frontend checks schemas, model version, completeness, mean/member consistency,
historical quantile order and ERA5 day counts before drawing.

```sh
python -m unittest discover -s tests -p 'test_seasonal_preparation.py'
node --test tests/seasonal.test.mjs tests/glosea.test.mjs
```

## Official sources and attribution

Contains modified Copernicus Climate Change Service information (2026).
Each forecast asset identifies its originating model. Dataset licences and terms
are available on the official catalogue pages below.

- https://cds.climate.copernicus.eu/datasets/seasonal-original-pressure-levels
- https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels
- https://confluence.ecmwf.int/spaces/CKB/pages/77213502/Description+of+the+C3S+seasonal+multi-system
- https://confluence.ecmwf.int/spaces/CKB/pages/104239050/Summary+of+available+data
- https://confluence.ecmwf.int/spaces/CKB/pages/340775655/C3S+seasonal+forecast+product+descriptions
