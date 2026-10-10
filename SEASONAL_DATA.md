# Native seasonal wind charts

Stratoscope prepares its own 60°N / 10 hPa zonal-mean u-wind time series from
official Copernicus CDS GRIB data. The public website renders compact JSON as
interactive SVG; the API token is never delivered to visitors.

## Data and calculation

- Seven models: UKMO system 610, ECMWF 51, Météo-France 9, DWD 22, CMCC 4,
  JMA 4 and BOM 2. These definitions are reviewed for April–December 2026.
  The importer stops outside that period until versions are reviewed.
- Six models contain 360 instantaneous 12-hour samples over 180 days after
  the nominal first of the month. BOM has 180 instantaneous 24-hour samples,
  following its verified native source availability. Lagged members are aligned
  by valid time; no missing samples are interpolated or repeated.
- Ensemble sizes are 50, 51, 51, 50, 50, 55 and 55 respectively. The importer
  requires every configured start and member to have a complete time series.
  Unusual recovery-member schedules require review, not relaxed validation.
- Every longitude enters the signed u-wind mean once. A duplicated seam must
  agree. Adjacent native latitude rows are interpolated to 60°N when needed.
  JMA's 1.25° grid is handled explicitly alongside 1° and ERA5's 0.25° grid.
- The optional manual model-climatology importer pools equally weighted qualified
  hindcast trajectories from 1993–2016 for the same system and nominal start
  month. These are raw values without bias correction. Model-hindcast imports
  are not part of the operational scheduled forecast update.
- ERA5's white dashed curve averages all 24 hourly zonal means into each day,
  then averages matching calendar days over 1993–2016. February 29 uses six
  leap years. ERA5 is one reusable annual reference.
- Model climatology follows lead time; ERA5 follows calendar day. Leap-year
  alignment can therefore differ by a day. This is a documented independent
  calculation, not a promise to reproduce every detail of Copernicus plots.
- Negative-member counts describe the raw ensemble, not calibrated SSW risk.

## Preparation and storage

`Prepare native seasonal wind charts` accepts forecast, climate or ERA5 phases
and one model or all models. Its lightweight planning job runs every three hours
at 00:37, 03:37, 06:37, 09:37, 12:37, 15:37, 18:37 and 21:37 UTC. GitHub can delay
scheduled starts; these are requested start times, not a delivery guarantee.

The expected current issue changes at the actual C3S release boundary: ECMWF on
the 6th at 12:00 UTC; GloSea and the other five seasonal systems on the 10th at
12:00 UTC. Before that instant, the previous month remains the expected issue.
This is release scheduling, not proof that every upstream file is already ready.

The planner reads only the small public forecast JSON files, without CDS secrets,
native GRIB libraries or any data-order submission. It validates model/system,
member and time completeness and mean/member consistency. Only missing or older
issues enter the preparation matrix; a newer complete issue is never downgraded.
Current issues skip the entire download job. At most two model imports run at
once, and the shared concurrency group does not cancel an active import.

The normal importer reuses saved CDS request IDs and requires the complete native
ensemble before replacing the published forecast. A delayed issue is reconsidered
at subsequent checks. Scheduled checks never order ERA5 or model hindcasts. The
permanent ERA5 reference is retained and reused.

The `forecast-data-seasonal` branch contains:

- `forecast/{centre}.json`: latest complete forecast for that model.
- `climate/{centre}-{system}-{month}.json`: manually prepared historical statistics.
- `climate/era5-1993-2016.json`: complete ERA5 calendar-day reference.
- `checkpoints/`: reduced intermediate historical values for resumability.
- `requests/`: saved CDS orders, reused when the same issue is resumed.

Missing references are labelled as pending on the site and are never fabricated.
The forecast-health workflow independently checks the ERA5 archive. If the final
reference is absent and neither ERA5-capable workflow is active, it can resume the
import with a 15-minute dispatch cooldown. Completed years and accepted CDS
request IDs are reused; the audit itself never submits CDS requests. Both ERA5
entry points share a concurrency group. Completion requires all 366 valid daily
values and the correct 24-year / six-leap-year sample counts.
On resumption the importer collects already successful saved CDS requests before
waiting for an earlier queued year, so ready results cannot be stranded behind it.
The read-only `Diagnose seasonal imports` workflow can inspect saved requests
without submitting, replacing or cancelling any request.
Models awaiting their first native file retain an explicitly labelled official
Copernicus chart until the prepared data become available.
Refresh the seasonal section to discover newly published files. Failed preparation
does not replace the previous successful issue. The legacy GloSea pipeline remains
available as an opt-in compatibility route; the website prioritises the native
multi-model archive. See GLOSEA_SETUP.md for that legacy route.

CDS access uses the existing `CDSAPI_KEY` GitHub Actions secret and accepted
dataset terms. Preparation is restricted to this public repository using standard
GitHub-hosted runners. No paid runners, Actions artifact storage or cache storage
are configured. Visitors fetch only the small public prepared files.

## Validation

The importer checks model/system, u-wind units, pressure, timestamps, longitude
coverage, expected member counts and all requested valid times before publication.
The frontend checks schemas, model version, completeness, mean/member consistency,
historical quantile order and ERA5 day counts before drawing. Release tests cover
UTC noon boundaries, UK summer time, year rollover, skip guards, missing issues
and preservation of explicit manual historical phases.

```sh
python -m unittest discover -s tests -p 'test_seasonal*.py'
node --test tests/seasonal.test.mjs tests/glosea.test.mjs
```

## Official sources and attribution

Contains modified Copernicus Climate Change Service information (2026).
Each forecast asset identifies its originating model. Dataset licences and terms
are available on the official catalogue pages below.

- https://cds.climate.copernicus.eu/datasets/seasonal-original-pressure-levels
- https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels
- https://climate.copernicus.eu/c3s-seasonal-forecast-spring-updates
- https://confluence.ecmwf.int/spaces/CKB/pages/77213502/Description+of+the+C3S+seasonal+multi-system
- https://confluence.ecmwf.int/spaces/CKB/pages/104239050/Summary+of+available+data
- https://confluence.ecmwf.int/spaces/CKB/pages/340775655/C3S+seasonal+forecast+product+descriptions
