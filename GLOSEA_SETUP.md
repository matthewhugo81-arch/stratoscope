# GloSea seasonal wind outlook — awaiting CDS activation

The importer, chart and monthly workflow are implemented, but **no real CDS
download has been tested yet**. The public chart stays hidden until a complete
validated dataset is published. The existing six forecast models are unchanged.

## One-time account setup

1. Create a free account using https://cds.climate.copernicus.eu/how-to-api.
2. Open https://cds.climate.copernicus.eu/datasets/seasonal-original-pressure-levels?tab=download
   and personally accept the applicable dataset terms.
3. Copy your personal API token into a **repository Actions secret** named
   `CDSAPI_KEY` at https://github.com/matthewhugo81-arch/stratoscope/settings/secrets/actions.
   Store only the token value. Never put it in a GitHub variable, issue, source
   file, public website, screenshot or chat. The workflow passes it only to CDS.
4. Set the repository Actions variable `GLOSEA_ENABLED` to `true`, then manually
   run **Prepare GloSea seasonal wind outlook**, leaving **publish unchecked**.
   This downloads and validates data without publishing.
5. Review the first actual GRIB download against the catalogue: UKMO centre,
   system 610, 10 hPa signed u in m/s, actual initialisation and valid dates,
   complete longitude circles and all 50 member time series. Parser failures
   must be fixed before release; never relax validation to accept missing data.
6. After the real-data run is reviewed, run with **publish checked**. A small
   `forecast-data-glosea/latest.json` snapshot activates the website's collapsible
   seasonal section on reload. No frontend rebuild needed.
7. Set `GLOSEA_PUBLISH_ENABLED` to `true` only after the first successful reviewed
   publication, to allow subsequent scheduled updates.

The schedule runs on the 11th at 13:17 UTC, after the normal UKMO release on the
10th at 12 UTC. Keep both variables unset/false until setup and review are done.

## Scope and calculations

- Current GloSea6-GC5.1, CDS system **610**, nominal issues April 2026 onward.
- First phase is **wind at 60N/10hPa**, not temperature/height maps.
- 180 calendar days after the nominal first-of-month issue, at **00 UTC**.
  These are instantaneous daily samples, not daily averages.
- Two members on each of 25 daily starts ending on the first of the nominal
  month: 50 members. Older starts need longer lead times for the same valid day.
- Every longitude is included; a duplicated longitude seam is checked and
  counted once. If the 1-degree grid straddles 60N, zonal means on the adjacent
  rows are linearly interpolated to 60N. No averaging of scalar wind speed.
- Raw, equal-weight ensemble mean and individual members. Negative-wind member
  counts are descriptive, **not calibrated SSW probabilities**. No anomalies,
  bias correction or historical climatology are claimed.
- Missing start dates, unexpected daily ensemble sizes, invalid metadata or
  incomplete time series stop publication and preserve the preceding issue.
  UKMO sometimes runs recovery members on a later date. Such an issue requires
  an explicit reviewed handling change; this first importer fails closed.

## Cost and credentials

CDS access is free. No payment account or subscription is configured.
Preparation uses standard GitHub-hosted runners only in this exact public
repository; no paid runners, Actions artifacts or cache storage are requested.
The CDS token never enters browser code, build variables or generated files.
The publication staging directory contains only a validated JSON file and its
attribution README. Failed requests cannot overwrite the public snapshot.

## Local checks

Use Python 3.12+ with `scripts/glosea-requirements.txt` installed.

```sh
python scripts/prepare-glosea.py --month 2026-09 --plan
python -m unittest discover -s tests -p 'test_glosea_preparation.py'
node --test tests/glosea.test.mjs
```

`--plan` needs no token and performs no download. `--input file1.grib file2.grib`
decodes existing CDS files. Synthetic fixtures used by tests are never published.

## Official references

- Dataset and licence: https://cds.climate.copernicus.eu/datasets/seasonal-original-pressure-levels
- API setup: https://cds.climate.copernicus.eu/how-to-api
- UKMO systems: https://confluence.ecmwf.int/spaces/CKB/pages/77213502/Description+of+the+C3S+seasonal+multi-system
- Lagged start dates and releases: https://confluence.ecmwf.int/spaces/CKB/pages/104239050/Summary+of+available+data
- Product interpretation: https://confluence.ecmwf.int/pages/viewpage.action?pageId=586149246

Display attribution identifies modified Copernicus Climate Change Service
information, the UK Met Office model and CC BY 4.0. The UI links the dataset.
