# Forecasting, upstream wave development and verification

The research product follows **upstream forcing -> wave packet -> possible
breaking -> circulation response -> possible stratospheric response**. Each arrow
is a hypothesis to test, not an assumed causal link. PDF briefings must finish
with a situation assessment, alternatives, expected timing and evidence that
would change the assessment.

## Available now

`scripts/ssw_research_archive.py --output work/ssw-run-archive` captures complete
published GEFS (31), IFS ENS (51) and AIFS ENS (51) U10/cap-temperature sequences,
with every six-hour lead through their respective 384/360-hour horizons. It
requires a matching source-catalogue hash and full member arrays. New cycles and
same-cycle corrections get separate retained records. These are **published
Stratoscope diagnostics**, not a second independent native-GRIB decoding audit.
Their temperature sampling differs from the 1-degree native research pipeline.

The first capture time is preserved. Forecasts captured after their valid time
cannot enter prospective verification. `matched_changes` compares matching valid
times without pairing perturbation numbers across cycles. `verify_wind` accepts
source-qualified ERA5/ERA5T U10 only and returns error and ensemble CRPS per case.
It does not call these individual scores skill or pool models into probabilities.
Use final ERA5 and preliminary ERA5T as distinct verification versions.

`scripts/prepare-ssw-wavepacket.py` independently retrieves native 300-hPa
meridional wind for any of the six source adapters. Every requested member, run,
level and lead must decode correctly. It retains member-first zonal wave-number
4-9 analytic-signal envelopes, averaged over 35-65N. It can generate
time-longitude sections. This is a research packet diagnostic, **not** group
velocity, wave-activity flux, arrival prediction, or an AWB/CWB classification.
Daily samples cannot establish fast propagation; six-hour sampling and sensitivity
to latitude, level and wave-number choices are required for development.

Example (run and leads must be available from the named native provider):

```text
python scripts/prepare-ssw-wavepacket.py --model gefs --run 2026-10-09T00:00:00Z --hours 0 24 48 72 96 120 --output work/ssw-wavepacket/gefs/2026100900
```

An hourly research heartbeat archives new published runs independently of the
existing website feed-health monitor. Read `work/ssw-run-archive/latest-check.json`
for actual admitted cycles and failures. A poll can miss short-lived revisions;
this is not a guarantee of a complete operational archive. Production pipelines
should eventually emit permanent run artifacts for the research consumer. Keep
the working Pages app and production workflows unchanged until review.

## MJO lead/lag experiments

Retain index definition (BoM RMM versus CPC WH), components, phase, amplitude,
valid date, retrieval timestamp and original payload hash. They are not identical
products. Do not derive a phase from an unverified chart or substitute one series
without labelling it. The BoM text endpoint returned HTTP 403 in the 9 October
development check; no current MJO phase has been claimed.

`ssw_wavepacket.lagged_predictor` enforces known-at-issue records and flags weak
amplitude. An index downloaded after issue cannot demonstrate real-time forecast
skill. For historical development, explicitly label retrospective/revised-index
experiments separately from the prospective archive.

Pre-register candidate lag windows (for example 0-5, 6-10, 11-15 and 16-20 days),
target regions and metrics. These are test bins, not established physical delay
constants. Compare a season/jet-state baseline with and without MJO predictors,
including weak-MJO cases. Control for ENSO, season and initial stratospheric state;
avoid treating adjacent days of one MJO episode as independent samples. Use
blocked episode/year hold-outs and block-bootstrap uncertainty. Any skill added
by MJO must survive an independent period and outperform the baseline.

## AWB/CWB and downstream response

Use isentropic PV contours and collocated flow; retain ambiguous/no-break outcomes
alongside cyclonic and anticyclonic candidates. Track persistence, geographic
footprint and independent events. The current detector remains `validated=false`.
H500 ridging or theta on +2 PVU cannot substitute for that validation.

Do not hard-code AWB = positive NAO or CWB = negative NAO. The region, jet flank,
waveguide, background flow and subsequent evolution matter. Forecast targets
should include event timing/location/orientation, regional H500 changes, jet
latitude, blocking persistence and a consistently defined NAO metric. Keep the
stratospheric heat-flux/wind response as a separate target. Surface weather
impacts require separately verified temperature, precipitation and wind fields.

For validated events, evaluate misses, false alarms, spatial/timing error and
raw ensemble event-fraction reliability/Brier scores. For continuous outcomes,
evaluate bias, MAE/RMSE, CRPS and anomaly correlation against climatology and
persistence at fixed lead times. Split by season and lead, show independent case
counts and uncertainty, and do not describe raw fractions as calibrated risks.

## ERA5 next dataset and access

The existing 1993-2016 daily wind climatology on Stratoscope is useful context,
but cannot verify dated wave-breaking events or forecast trajectories.
`scripts/ssw_era5_requests.py` writes three bounded ERA5-complete requests for a
seven-day, six-hourly case: H500; U10; and PV/U/V on 315/330/350 K. The initial
prepared window is 27 September-3 October 2026, allowing for ERA5T delay. Actual
availability must be checked. The H500/U10 portions have now been retrieved and
independently decoded: 28 six-hourly timestamps, 56 fields, all preliminary
ERA5T expver 5. Array hashes, coverage and finite values pass. The isentropic
portion remains pending. See `evidence/era5t-case-20260927-20261003.json`.
This case precedes the captured forecasts and produces zero prospective scores;
it validates ingestion, not predictive skill.

Local CDS credentials are absent. Reuse the authorised CDS account via the
repository's secret-backed research validation workflow or a local CDS configuration; never
copy secrets into the repository or chat. Check for accepted jobs before submitting
and retain/resume their IDs. Preserve original request JSON, data hashes and expver.
Combine these three GRIB parts into one input only after successful downloads;
retain a request envelope `{"dataset":"reanalysis-era5-complete","request":
{"parts":[...]}}`. Import with `import-ssw-reanalysis.py --south 20` for the
wave-breaking domain. Optional U10 must cover the entire verification week.

The research validation workflow has an optional manual `era5_end_date` input.
Only that explicit dispatch enables the ERA5 job; ordinary PR validation stays
offline. The job first searches the account's existing requests for exact
matches, saves request IDs as an artifact before waiting, then downloads and
decodes the case. It has read-only repository permission and cannot publish to
Pages. An interrupted job must reuse those requests; an uncertain catalogue
lookup fails closed instead of submitting again.

The first runner reached its 30-minute limit while waiting for PV, but preserved
the completed H500/U10 downloads. The downloader now checks each request's status
and downloads only completed parts instead of occupying a runner while queued.
`case-status.json` distinguishes `pending` from `validated`: a successful Actions
run alone is not evidence that the reanalysis case is complete. Subsequent checks
resume the accepted IDs and preserve completed parts as artifacts.

Next validate selected known AWB/CWB and non-event cases, then expand to a
seasonally representative hindcast set. The seven-day case is an engineering
validation dataset, not enough to estimate teleconnection or SSW skill.

## Scientific references

- [ECMWF ERA5 documentation](https://confluence.ecmwf.int/spaces/CKB/pages/76414402/ERA5+data+documentation): pressure/isentropic products, source versions and update lag.
- [CPC MJO index definition](https://www.cpc.ncep.noaa.gov/products/precip/CWlink/MJO/whindex.shtml): input fields and differences from the BoM formulation.
- [Strong and Magnusdottir (2008), Tropospheric Rossby Wave Breaking and the NAO/NAM](https://doi.org/10.1175/2008JAS2632.1): isentropic contour-overturning framework.
- [Rossby Wave Breaking and Transient Eddy Forcing during Euro-Atlantic Circulation Regimes](https://doi.org/10.1175/JAS-D-16-0263.1): spatial/regime dependence; association does not guarantee ridge forcing.

## Release gates still open

Packet tracking and arrival skill; independently validated persistent AWB/CWB;
real ERA5 import and prospective scores; MJO ingestion/forecast member coverage;
out-of-sample lagged impact skill; calibrated scenarios; automated general PDF
rendering from arbitrary run archives. The existing PDF is a dated analysis of
its stated source package and must not silently inherit newer run labels.
