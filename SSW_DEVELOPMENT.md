# SSW precursor development: review branch

This branch adds an isolated, read-only precursor pipeline and a reproducible
pulsecheck. It does **not** enable an operational SSW alert or change the working
Pages application. Source baseline: `2ed7cab`. The existing `docs/` deployment,
forecast publishers, seasonal requests, schedules and secrets are untouched.

## What is implemented and checked

- Separate native adapters for GFS, IFS deterministic/control, ICON, GEFS 31,
  IFS ENS 51 and AIFS ENS 51. Every requested field requires every member,
  including control. Selection validates provider inventories; ecCodes then
  independently validates centre, run, valid time, lead, instantaneous product,
  pressure/PV surface, variable, units and member. AIFS class/model identity is
  checked in both index and GRIB. Duplicate/missing identities fail the job.
- Receipts retain full URLs, index/message SHA-256, byte ranges, retrieval time,
  native grid size and decoded identity. A count advertised in a filename or
  catalogue cannot substitute for decoded members. Raw GRIB is cached locally.
- Member-wise 100/50/10 hPa heat flux where available, with signed total,
  wave-1, wave-2 and higher-wave residual. Compute longitude departures and
  covariance before ensemble averaging. All diagnostics except native 60N wind
  use explicitly sampled 1-degree fields. ICON uses nearest native cells on its
  verified unstructured grid; interpolation error remains a limitation.
- Native signed 10 hPa/60N wind, area-weighted 60–90N temperature, height-wave
  amplitudes/phases and cross-level phase relationships. Phase alone is not an
  EP flux or proof of upward propagation. Rolling 3/5/7-day signed and positive
  forcing integrals require uninterrupted six-hour samples.
- Per-member height geometry: low-height, fixed equivalent-area 70N masks,
  spherical centroid/displacement and projected aspect ratio. This is a **height
  proxy**, not a PV/Nash vortex edge, split classification or SSW event type.
- Member-wise future H500 fields, anomalies and regional means for all six
  systems. Reference: the existing checked NCEP/NCAR R1 1991–2020 daily
  climatology. Instantaneous fields minus daily climatology carry sampling and
  model biases; these are not model-bias-corrected anomalies or percentiles.
- Seven actual 00 UTC GFS `.anl` records for 2–8 October 2026, with H500,
  native +2-PVU T/P/U/V, derived theta, array hashes and source receipts. No
  `f000` substitution. These are operational analyses, not observations or ERA5.
- Matched-valid-time run changes using separately retrieved earlier native wind
  fields. Perturbation IDs are **not** paired across cycles. Cross-model tables
  use only intersecting valid times and do not pool member probabilities.
- A separate ERA5/ERA5T GRIB importer: checks MARS `class=ea`, analysis type,
  zero lead, expver 1/5, exact timestamps and complete 28-snapshot H500 weeks.
  Isentropic PV/U/V, where included, remain separately identified. Preliminary
  ERA5T is labelled. Synthetic GRIB tests pass; real retrieval is still pending.

## Verified native coverage in this audit

Read `research/ssw/source-audit.json` and the compressed evidence receipts for
exact retrieval dates, fields and counts. This is snapshot validation, not proof
that every lead in a complete operational run is available.

| System | Members required | Decoded core levels, hPa | Decoded leads | Native 2-PVU support in this branch |
|---|---:|---|---|---|
| GFS | 1 | 10, 50, 100; H500 | 0, 120 | Initial forecast and seven analyses verified; +120h U contains missing 9999 and fails |
| IFS deterministic/control | 1 | 10, 50, 100; H500 | 0, 12, 120, 132 | Not verified; not substituted |
| ICON | 1 | 30, 50, 100; H500 | 0, 120 | Not verified; no 10 hPa extrapolation |
| GEFS | 31 | 10, 50, 100; H500 | 0, 120 | Not verified across members |
| IFS ENS | 51 | 10, 50, 100; H500 | 0, 12, 120, 132 | Not verified across members |
| AIFS ENS | 51 | 10, 50, 100; H500 | 0, 120 | Not verified across members |

GFS, GEFS, ICON and AIFS use 9 October 00Z here. IFS uses 8 October 12Z:
9 October 00Z returned HTTP 404 at the time of probing. The +12/+132 IFS leads
allow comparisons at 9 and 14 October 00Z without a false equal-lead comparison.
GFS `.f000` is labelled a deterministic forecast initialization, never promoted
to an observation. IFS `oper/fc` is also the IFS ENS control in the verified
distribution; those curves are not independent evidence. AIFS and IFS also
share initial-state information.

## PV, wave breaking and scientific release gates

`ssw_pv.py` provides member-wise pressure-coordinate Ertel PV and unique-crossing
isentropic interpolation. Use explicit native pressure levels with `--pv-levels`;
the inventory must independently supply all requested T/U/V fields. No vertically
invented ICON levels or substitutions. Derivative boundaries and ambiguous or
unbracketed isentropes remain NaN in NPZ arrays, never zero. Analytic resting-state
PV and ambiguity tests pass, and one GFS native-data calculation was exercised.
Coarse pressure spacing, subsurface pressure fields, finite differences and
sampling still need comparison with native/model-level PV. These results are
not validated for an objective operational RWB detector.

`ssw_rwb.py` takes **PV on a named isentrope**, plus collocated U/V and source
metadata. It extracts a circumpolar contour, excludes closed cutoffs, tests
multiple meridian intersections and uses first/last crossing order for candidate
cyclonic/anticyclonic orientation. It additionally screens spatial scale,
poleward tongue flow and shear consistency. The latter thresholds are explicit
research choices, not a validated reproduction of the published climatology.
The function always returns `validated=false`; it cannot promote an alert.
Theta on +2 PVU is a different coordinate representation and is rejected by
this interface, as are H500 and pressure-level PV.

Still required before operational AWB/CWB counts:

1. Retrieve independent six-hourly ERA5/ERA5T isentropic PV and collocated winds;
   verify known cyclonic and anticyclonic events and non-events across seasons.
2. Add event tracking, persistence/irreversibility checks, overlapping-contour
   de-duplication, nested tongue handling, resolution sensitivity and area screens.
3. Quantify misses and false alarms, validate flow thresholds and compare derived
   PV against native PV. No event count is emitted from the daily GFS history.
4. Validate EP/wave-activity flux, lagged cross-level response and a seasonal
   reanalysis/reforecast forcing distribution. Raw positive heat flux is not an
   extreme percentile and phase tilt is not causal proof.

An ERA5T source is delayed relative to real time; it cannot silently replace a
missing contemporary analysis. No CDS credentials were present in this checkout,
and no live ERA5 history was retrieved. Existing GitHub seasonal requests were
not accessed or resubmitted. No observed verification skill is claimed.

## Transparent precursor states

`precursor_watch` keeps verified true/false/unknown evidence and the unmet
requirements for every stage. It defaults to `insufficient_evidence`, which is
not equivalent to low SSW risk. No numeric score is turned into a probability.

| Stage | Evidence requirements |
|---|---|
| Background monitoring | Required source/time coverage verified |
| Tropospheric watch | Validated RWB and persistent tropospheric pattern |
| Upward-forcing watch | Above plus calibrated forcing and supporting propagation |
| Vortex-response watch | Calibrated forcing/propagation plus repeated response and independent-model support |
| Reversal scenario | Complete daily-mean reversal evidence and explicit season/event-definition checks |

The stages are evidence checklists, not an inevitable sequence. A vortex
response can be identified without asserting an unverified tropospheric cause.
The current report deliberately stays at insufficient evidence. `sswDeclared`
is always false. A raw instantaneous 10 hPa easterly-member fraction is not a
calibrated SSW probability. October initialization snapshots cannot establish a
major midwinter event; a chosen published definition, daily means, event
separation and final-warming exclusions require separate retrospective checks.

EC46 remains separate **sub-seasonal** corroboration. The current application
loads an official graphic, not a locally decoded 101-member archive. A working
chart API does not verify its individual members or justify numerical ingestion.
The seven existing seasonal systems remain separate monthly/seasonal products.
Neither seasonal data nor EC46 is counted in the 31/51/51 medium-range sets.

## Reproduce without publishing

Use Python 3.12 and a dedicated virtual environment:

```sh
python -m pip install -r scripts/ssw-requirements.txt
python -m unittest discover -s tests -p 'test_*.py'
python scripts/prepare-ssw-precursors.py --output work/history history --end-date 2026-10-08
python scripts/prepare-ssw-precursors.py --output work/precursors forecast --model gefs --run 2026-10-09T00:00:00Z --hours 0 120 --previous-run 2026-10-08T18:00:00Z
python scripts/prepare-ssw-precursors.py --output work/pv forecast --model gfs --run 2026-10-09T00:00:00Z --hours 0 --pv-levels 10 20 30 50 70 100 150 200 250 300 500
python scripts/ssw-pulsecheck.py --inputs work/precursors --history work/history/history.json --output work/pulsecheck
```

Prepare each of the six model files before the pulsecheck command; use the run
and leads in the table for this saved example. The report rejects partial member
or identity coverage and compares only shared valid times. Retrieval is bounded
to four transfers; errors fail loudly. Published files at a provider can expire,
so dated commands may later fail. Checksummed compressed receipts in this branch
retain the evidence, not a promise of permanent raw-file availability.

For separately retrieved ERA5-complete GRIB, wrap the **original** request as
`{"dataset":"reanalysis-era5-complete","request":{...}}`, then run:

```sh
python scripts/import-ssw-reanalysis.py --input work/era5.grib --request work/request.json --end-date YYYY-MM-DD --output work/verification
```

It imports only a complete H500 week; it does not certify PV completeness unless
the relevant fields are also checked. It does not retrieve data or reuse CDS jobs.

App regression validation uses the existing TypeScript and JavaScript checks,
and `vite build --config vite.pages.config.ts --outDir work/pages-validation`.
Do not use the normal Pages output directory during review: `docs/` is the
existing deployment. The added GitHub workflow is offline, read-only, PR/manual
only, with no forecast download, publishing, cron, deployment or secrets.

## Recovered context and references

The untouched 9 October ZIP and expanded PDF are under
`research/ssw/prototypes/`, with checksums and the original method notes. The
shared chat was read, including its three-stage blueprint summary. Its separate
early-warning PDF was absent locally and the shared download returned an upload
status error; `manifest.json` records that gap rather than pretending it was read.
No prototype workflow was installed or executed unchanged.

- [ECMWF public product definitions](https://www.ecmwf.int/en/forecasts/datasets/open-data)
- [NOAA GEFS product inventory](https://www.nco.ncep.noaa.gov/pmb/products/gens/)
- [DWD native ICON inventory](https://opendata.dwd.de/weather/nwp/icon/grib/)
- [ERA5 data documentation](https://confluence.ecmwf.int/pages/viewpage.action?pageId=185075432)
- [ERA5T release and delay](https://www.ecmwf.int/en/about/media-centre/news/2026/era5t-reanalysis-data)
- [Strong and Magnusdottir (2008), contour method](https://doi.org/10.1175/2008JAS2632.1)
- [Butler and Gerber (2018), event-definition sensitivity](https://journals.ametsoc.org/view/journals/clim/31/6/jcli-d-17-0648.1.xml)

Provider documentation establishes product descriptions; the separately saved
native receipts establish what was actually retrieved. Source attribution:
NOAA/NCEP, ECMWF (CC BY 4.0), DWD, NOAA PSL/NCEP–NCAR climatology.
