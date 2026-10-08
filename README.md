# Stratoscope

Interactive Northern Hemisphere stratosphere globe, hosted on **GitHub Pages**. Ensemble mean/spread maps are prepared from complete official ensembles on public GitHub Actions runners, then downloaded as compact files. Individual forecasts are downloaded directly and decoded in background Web Workers. No ChatGPT hosting, server account, API key or paid proxy is needed to use this build.

[Live viewer](https://matthewhugo81-arch.github.io/stratoscope/)

## Run and publish

Use Node.js 22.13 or newer and npm:

```sh
npm ci
npm run dev:pages
```

Open http://localhost:5174/stratoscope/.

```sh
npm exec -- tsc --noEmit
node --test tests/*.test.mjs
npm run build:pages
```

The Pages build writes static browser assets into `docs/`. Commit the source **and rebuilt docs/** to `main`; GitHub Pages publishes from `main /docs`. `.nojekyll` disables Jekyll processing. The `/stratoscope/` base path is configured in `vite.pages.config.ts`. Ensemble preparation uses standard public GitHub runners, with no paid runner, cloud backend, Actions cache or artifact store. GitHub's free services have published usage limits; this does not mean unlimited traffic or guaranteed availability.

The original Sites/Vinext build commands remain available for portability, but the GitHub website does not call that deployment. `.openai/hosting.json` identifies the historical Site and contains no credentials. Do not add secrets or environment files to this public repository. `docs/` is intentionally tracked; local dependencies and generated Worker output are ignored.

## Sources and coverage

| Model | Pressure levels, hPa | Timeline | Display grid |
| --- | --- | --- | --- |
| NOAA GFS, direct | 100, 70, 50, 30, 20, 10 | Analysis to +240 h | 1 degree |
| ECMWF IFS, direct | 100, 50, 10 | Initial field to +240 h | 1-degree display samples from 0.25-degree fields |
| NOAA GEFS, 31 members | 100, 70, 50, 30, 20, 10 | Initial field to +384 h | 1-degree samples from 0.5-degree fields |
| ECMWF IFS ENS, 51 members | 100, 50, 10 | Initial field to +360 h | 1-degree samples from 0.25-degree fields |
| ECMWF AIFS ENS, 51 members | 100, 50, 10 | Initial field to +360 h | 1-degree samples from 0.25-degree fields |
| DWD ICON Global, direct | 100, 70, 50, 30 | Initial field to +180 h | 1-degree nearest-cell samples from the native triangular grid |

All selectable sources are direct official NOAA, ECMWF or DWD feeds. The duplicate GFS and ECMWF Open-Meteo options are retired, and ICON no longer uses Open-Meteo. Legacy Open-Meteo modules remain only for historical regression coverage; they are not imported by the active weather route or selectable through the UI/API.

The direct ECMWF feed includes 10 hPa but omits 20, 30 and 70 hPa. DWD's public ICON pressure-level files stop at 30 hPa in the stratosphere: 10 and 20 hPa are unavailable. Unsupported levels are disabled and rejected; the viewer never silently changes source or vertically interpolates missing levels.

Every map uses one named model cycle. Direct ECMWF checks the +240 h inventory for all required fields and levels before selecting a completed 00/12 UTC run. Prepared ICON verifies every required file through +180 h before preparing and publishing the full run. All dates are UTC.

## Globe and units

The WebGL2 globe uses an orthographic spherical projection, with reversible camera-basis rotation. Drag to tilt or rotate. Scroll directly over the map, pinch or use the buttons to zoom the globe; scrolling outside the map moves the page or side panel. Left/right arrows step backward/forward by six forecast hours. With the globe focused, Shift + arrows rotate, +/− zoom, and Home resets north. Focused sliders, tabs, model menus and pressure controls retain their normal keyboard behavior. The timeline stays visible as the page scrolls, and the globe adapts to the screen size. The software fallback preserves the controls if WebGL2 is unavailable.

Temperature is Celsius; geopotential height is metres, with contours every 400 m labelled in dam; wind speed is m/s. Lighting near the globe edge is decorative depth shading; hover values provide the unshaded numerical values. The Southern Hemisphere is explicitly outside data coverage and never filled with extrapolated Northern Hemisphere weather. Coastlines are Natural Earth 1:110m, public domain.

The absolute-temperature colour scale spans −90°C to +20°C, retaining the cold-end colours and reaching orange at −20°C, red-orange at −15°C, and deeper reds above 0°C. The WebGL globe, software fallback and legend share the same Celsius anchors. Values outside the range use endpoint colours; pointer readouts still show the actual temperature. Wind and ensemble-spread scales are separate.

## Animation and frame previews

Press **Loop** to advance through all six-hour forecast times, starting at the selected time and wrapping to the beginning. The first pass waits for each complete map and its 10 hPa wind readout before starting the selected frame dwell (0.5× = 2 seconds, 1× = 1 second, 2× = 0.5 seconds). A frame counter shows how many times are downloaded. Subsequent passes reuse the retained data, including ensemble statistics, within the cache lifetime. Each ensemble mean/spread frame downloads one prepared file, typically about 300–400 KB, containing both views. Individual NOAA/ECMWF forecasts still require source downloads and GRIB decoding; ICON uses one prepared file. Only an explicit Loop action starts playback.

Pause stops advancing; a current download may finish so the selected map remains usable. Manual timeline navigation, model/pressure/member/view changes, Refresh, hidden tabs and download errors stop playback. Failures keep the source/time error visible and never silently skip a forecast. Missing prepared summaries never fall back to downloading every member in the browser.

**Frames** opens an optional horizontal strip of north-pole previews, showing the active temperature/wind field and height contours at each downloaded time. Previews are generated locally from the same sampled fields and colour scale; empty slots are labelled “To load”. Clicking a slot pauses playback and selects that time. Opening the strip makes no weather requests and does not shrink the main globe. The current rotated globe and the previews intentionally have independent camera views.

## Polar-vortex wind indicator

The readout shows zonal-mean eastward wind **u at 60°N and 10 hPa**, in m/s. It averages signed u across every unique longitude on that latitude circle before reducing the native source grid for display: 360 samples for direct GFS, 720 for GEFS, and 1,440 for ECMWF IFS/AIFS. A repeated longitude seam is counted only once. It uses neither scalar wind speed nor the absolute value of u. The sign is retained: positive is westerly, negative is easterly, and zero is the direction-change threshold. No latitude or vertical interpolation is used.

The indicator follows the selected model, run, forecast lead and member. It stays at 10 hPa when the map is switched to another pressure level, reuses the forecast cache, and waits for the selected map to finish before requesting a separate 10 hPa field. Mean and Spread views both show the mean signed zonal wind across the complete ensemble, including the control; Member shows that individual member. Missing models, incomplete latitude circles and failed downloads show an unavailable state, never a synthetic zero. Previous model/time/member values are not presented as the selected diagnostic. Older cached frames without the native diagnostic use a clearly labelled display-grid estimate.

This is an **instantaneous model field**, not a daily mean, direct observation, probability of warming or formal SSW event declaration. A negative value is a reversal signal to monitor. Winter timing and event criteria matter when identifying a major SSW; see [NOAA's SSW Compendium](https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ncdc:C00960).

Regression tests cover signed averaging, exact latitude selection, seam handling, incomplete data, stale forecast rejection, ensemble aggregation and near-zero formatting. Independent ecCodes comparisons of all 1,440 ECMWF longitudes at initial and +240 h lead times agreed within 0.0012 m/s (the app decodes winds to 0.01 m/s). Live native diagnostics were checked for GFS, direct IFS, GEFS, IFS ENS and AIFS ENS.

## Requests and caching

NOAA GFS and GEFS use byte-range GETs against `noaa-gfs-bdp-pds.s3.amazonaws.com` and `noaa-gefs-pds.s3.amazonaws.com`. These are NOAA-managed public datasets, not user-owned AWS resources. GRIB complex packing with spatial differencing (5.3) is decoded locally; 24 raw NOAA fields across GFS/GEFS, 10/30/100 hPa, initial/future hours and multiple members were compared at every grid point with ecCodes, within 0.005 display units. Offline regression fixtures include independently generated ecCodes checksums.


Worker Cache API access is optional. The Sites runtime can deny access to `caches.default` even when CacheStorage exists. All cache access, reads, JSON decoding and writes are guarded by `lib/optional-cache.ts`. A denied cache behaves as a cache miss; downloads and the existing bounded memory caches continue without adding storage or paid services. Run `node --test tests/optional-cache.test.mjs` for the production-permission-error regression checks.

Ensemble views are mean, spread (population standard deviation, denominator N) and individual member. Member 0 is the control; all 31/51 members receive equal weight. Scalar wind speed is calculated for each member before its mean and spread. Height contours show mean height on both mean and spread maps, and the selected member's height on member maps. Temperature spread is a temperature difference in Celsius. AIFS geopotential is divided by standard gravity 9.80665 to obtain geopotential height in metres.

GEFS uses NOAA’s public NODD 0.5-degree GRIB files: part A at 10/50/100 hPa, part B at 20/30/70 hPa. ECMWF IFS perturbations use enfo/ef (index type pf), and its control uses oper/fc following Cycle 50r1. AIFS uses enfo/pf and enfo/cf. Native GRIB product template 4.1 member identifiers are validated, along with run, time, level and fields. Latitude scan direction and longitude origin are normalized onto a common 360 × 91 northern grid. No vertical interpolation or model substitution is performed.

Mean and Spread share one prepared download and never request individual members. Two reusable browser Web Workers still fetch and decode individual forecasts without blocking globe interactions. Abandoning a task cancels its network activity. The active model/run/level/member selection retains its complete six-hour sequence (at most 65 frames, or mean/spread pairs) so a full loop can replay from memory. Changing that selection releases the retained sequence; Refresh clears it. General caches additionally retain 24 individual frames and six statistical pairs with least-recently-used eviction. Retained frames share array references with those caches. Compact 10 hPa zonal-wind diagnostics are retained separately so other pressure-level loops do not have to retain a second set of grids. Fixed-cycle frames remain reusable in the tab for six hours. Each decoder retains a bounded in-memory cache. The optional server Cache API is absent in the Pages build. Individual-member discovery checks end-of-range inventories; Discovery probes end-of-range provider inventories instead of subtracting a fixed availability delay. GEFS and AIFS consider all four daily cycles. IFS uses complete 00/12 UTC cycles for the full horizon because the public 06/18 UTC feed stops at +144 h. The actual selected run is always displayed.

Cached frames switch without an artificial delay. After a direct forecast or prepared summary loads, the browser may preload one six-hour step in the last navigation direction, starting after 120 ms. It skips hidden tabs and supported data-saving/slow-connection signals. Foreground requests reuse in-flight preloads, abandoned requests are cancelled, and Refresh clears the selected model cache.

## Preparing ensembles once per run

`.github/workflows/prepare-ensembles.yml` checks hourly at minute 23 UTC and can be run manually. It is restricted to this **public** repository and standard `ubuntu-latest` runners, which GitHub provides free for public repositories. It does not use larger runners, Actions artifacts, Actions caches, API keys or external compute accounts. Already-published complete cycles are skipped, avoiding repeat bulk downloads. Scheduling and provider availability can delay publication. A new run replaces the catalogue only after every member, pressure level and six-hour forecast time succeeds; an unsuccessful preparation leaves the preceding published run available.

`scripts/prepare-ensembles.py` downloads only the required official GRIB byte ranges, with six concurrent transfers per model and serialized native ecCodes decoding. It validates run, lead, variable, pressure, grid and member identities. All 31 GEFS or 51 ECMWF members contribute equally. Statistics use full decoded precision; only the finished display fields are rounded to 0.01 units, encoded as row differences and gzip-compressed. The 60°N signed-wind diagnostic retains its unrounded native-grid ensemble average. No raw member fields are published.

The completed data are published to `forecast-data-gefs`, `forecast-data-ifs-ens` and `forecast-data-aifs-ens`, served anonymously by `raw.githubusercontent.com`. Each generated branch is replaced with a snapshot containing the current and preceding model run, keeping the reachable dataset bounded. Only those generated branches are replaced; `main` and source history are never rewritten. The preceding run lets an already-open viewer continue across an update. The manifest records every file's size and SHA-256; the browser checks both, plus the binary forecast identity. A repeated preparation of a run uses content-addressed download URLs to avoid stale HTTP-cache collisions.

To verify or prepare locally (Python 3.12+):

```sh
python -m pip install -r scripts/ensemble-requirements.txt
python tests/test_ensemble_preparation.py
python scripts/prepare-ensembles.py --model ifs_ens --hours 0 --output work/smoke
```

Partial smoke-test catalogues are explicitly incomplete and cannot be published as full forecasts. Omit `--hours` to prepare the full timeline. Publication requires the guarded GitHub Actions environment.

The ensemble feeds are direct official data and need no API key. NOAA data is public domain unless otherwise identified. ECMWF Open Data is CC BY 4.0 with ECMWF terms and attribution; the site identifies modified data. The app uses free public endpoints and has no paid weather API credentials. GitHub Pages hosts the public static site. Data is requested anonymously from NOAA NODD public buckets, ECMWF and DWD. No AWS account is created and there are no requester-pays credentials. DWD data is attributed under CC BY 4.0. No Open-Meteo subscription or requests are needed.

Direct ECMWF uses the public JSON index to request only the four required GRIB2 byte ranges. It requires HTTP 206 and validates byte count, run, lead time, pressure, variable and grid; the content-range header is checked when the provider exposes it through CORS. CCSDS template 5.42 is decoded in TypeScript, then every fourth 0.25-degree point is retained and longitudes reordered to 0–359 degrees. Decoding proceeds one field at a time to bound memory. Byte-range requests bypass the browser HTTP cache because merged partial responses can return the wrong range; completed forecast frames remain cached by the app. Completed frames are cached in bounded decoder memory (12 frames).

## Preparing direct DWD ICON maps

`.github/workflows/prepare-icon.yml` checks hourly at minute 31 UTC, with the same public-repository and standard-runner guard as the ensemble pipeline. It downloads anonymous bzip2 GRIB2 pressure-level files from `https://opendata.dwd.de/weather/nwp/icon/grib/`, plus the matching CLAT/CLON coordinates. Four concurrent downloads and serialized ecCodes decoding keep resource use bounded. No paid resources, API keys, Actions artifacts or Actions caches are used.

`scripts/prepare-icon.py` verifies model run, valid time, pressure, variable, units, complete finite values and the coordinate/field grid UUID. A spherical nearest-cell lookup samples native global triangular cells onto the northern 360 × 91 display grid; the one-degree display is not the native model resolution. Celsius = kelvin − 273.15; geopotential height = geopotential / 9.80665. Eastward and northward winds are retained with their signs. Finished arrays are rounded to 0.01 units and gzip-compressed. No 10 hPa diagnostic is fabricated for ICON.

All 124 frames (four levels, 31 six-hour times through +180 h) must finish before publication to `forecast-data-icon`. The current and preceding run are retained. The browser validates catalogue completeness, SHA-256, byte count, model/run/time/level, grid and every field before display. Loop and frame previews reuse these prepared maps. Provider failures leave the preceding complete run available; there is no fallback to Open-Meteo or synthetic weather.

Local smoke check: `python -m pip install -r scripts/icon-requirements.txt`, then `python scripts/prepare-icon.py --hours 0 --output work/icon-smoke`. Partial catalogues cannot be published. Tests: `python tests/test_icon_preparation.py` and `node --test tests/dwd.test.mjs`.

## Run and verify

See Quick start above. The regression tests cover optional Worker cache access, preload/foreground request sharing, cancellation, refresh invalidation, forecast identity checks, cache expiry and complete ensemble statistics. Site identity is preserved in `.openai/hosting.json`.

Initial direct-GFS decoder validation compared all 32,760 points of temperature, height and U/V against ECMWF ecCodes with errors below 0.0051 in display units. The interactive update verifies forward/inverse projection consistency after repeated rotations, cached timeline retrieval, resumed partial downloads, wind conversion, unsupported pressure/horizon rejection, live provider frames and browser controls.

The direct ECMWF update compared all 1,038,240 native values of each of temperature, height and U/V at 10 hPa for +0 and +240 h against ecCodes 2.49.0. All eight fields agreed within 0.0051 in display units, the rounding tolerance. Northern Hemisphere sampling and longitude order were independently checked from ecCodes coordinates. Live 50 and 100 hPa frames and API rejection of unsupported 30 hPa were also checked. The decoder adaptation's MIT notice is in `THIRD_PARTY_NOTICES.txt`.

Ensemble validation compared native IFS member temperature/height, AIFS member temperature/geopotential and all four GEFS fields with ecCodes 2.49.0; all values agreed within 0.0051 display units. The built Worker’s sampled outputs also agreed against independent ecCodes latitude/longitude coordinates at all 32,760 northern points per checked field. Checks cover population SD, scalar wind statistics, mean-height contours, duplicate/missing/mixed-member rejection, live control and last-member fields at initial and final leads, and unsupported model/level/member requests. Browser checks exercise complete mean/spread downloads for all three systems, member controls and the narrow-screen layout.

Sources:
- https://opendata.dwd.de/weather/nwp/icon/
- https://www.dwd.de/EN/service/legal_notice/legal_notice_node.html
- https://registry.opendata.aws/noaa-gfs-bdp-pds/
- https://registry.opendata.aws/noaa-gefs/
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://www.ecmwf.int/en/forecasts/datasets/open-data
- https://data.ecmwf.int/forecasts/
- https://github.com/pspoerri/go-tiled-eccodes/tree/main/aec
- https://www.nco.ncep.noaa.gov/pmb/products/gfs/
- https://www.nco.ncep.noaa.gov/pmb/products/gens/
- https://www.weather.gov/disclaimer
- https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_coastline.geojson

## GloSea seasonal wind outlook

The optional 60N / 10hPa seasonal wind chart is live below the forecast timeline.
Its first real CDS issue was validated and published on 7 October 2026, with 50
complete members and 180 valid dates. The monthly workflow runs on the 11th at
13:17 UTC and publishes one compact JSON file; viewers do not query CDS.
See [GLOSEA_SETUP.md](GLOSEA_SETUP.md) for setup, validation, dates and attribution.

## Native seasonal chart selector

Downloaded globe frames now use IndexedDB to retain one model run per model
across model switches and page reloads. Levels and ensemble mean/spread/member
selections are keyed independently. A newer run removes that model's older stored
frames; late old requests cannot replace it. Refresh data explicitly clears the
selected model. Browser storage is optional: denied storage or a full quota falls
back to normal downloads. Clearing site data also removes saved frames.
The initial download of each new frame remains necessary. Model discovery is
reused for five minutes when switching models and bypassed by Refresh data.


The seasonal section offers Stratoscope SVG charts for Met Office, ECMWF,
Météo-France, DWD, CMCC, JMA and BOM. Forecast members, the ensemble mean,
historical ranges and ERA5 references can be inspected with a date slider.
An official C3S product link remains available for comparison.

`prepare-seasonal.yml` downloads official CDS data using the existing private
Actions secret, validates complete ensembles and publishes compact JSON to
`forecast-data-seasonal`. The browser never contacts the authenticated CDS API.
The first historical preparation can take hours. Unavailable models and
references are labelled pending; partial ensembles are never plotted. The official
chart remains as a temporary fallback for models awaiting their first native file. The
previously validated daily GloSea issue remains a fallback until its new
12-hourly series is ready. Each plot shows its actual issue and sampling.

Forecasts update monthly. Historical 1993–2016 data are prepared once per model
version and start month, with yearly checkpoints for interrupted downloads.
See [SEASONAL_DATA.md](SEASONAL_DATA.md) for methodology, schedules and checks.

## Ensemble member panels

All members opens a shared 10 hPa north-pole map grid, including the control,
with a six-hour timeline and temperature/wind-speed selector. A red border and
E marker identify native-grid zonal-mean u wind strictly below 0 m/s at 60N,
10 hPa at the selected time. This is an easterly-wind flag, not an SSW diagnosis.
Click a tile to inspect that member on the detailed globe.

The existing ensemble preparation writes one compact gzip bundle per forecast
time, containing 2-degree overview fields and unrounded native wind diagnostics.
The browser downloads one bundle, never 31/51 separate member files, and saves
it in the per-model run cache. Missing bundles are labelled pending. Prepared
files use STRATP01 headers and are validated against model, run, lead, grid,
member count, source and field bounds before display.

## EC46 daily wind chart
The wind-outlook selector includes ECMWF EC46, loaded directly from the official anonymous OpenCharts graphical-product API. Omitting base_time selects the latest available run on opening or Refresh outlook. The issued chart retains its 101 members, mean, model-climate lines, date and attribution. This is an official image, not raw member data. No paid delivery service, API secret or scheduled ingest is used.


### Northern forecast diagnostics

The expandable northern diagnostics compare complete GEFS, IFS ENS and AIFS ENS 10 hPa forecasts in two native charts: signed zonal-mean u wind at 60°N and area-weighted temperature over 60–90°N. Wind retains the native longitude-circle diagnostic; temperature uses spherical latitude-band weights on the stored 2° member overview grid (including clipped boundary cells). It is explicitly a forecast-only view with labelled initialization times, not a historical analysis. Individual member curves and a zero-wind reference are available.

`scripts/prepare-diagnostics.py` verifies and reuses already published member panels; it submits no model-member or CDS requests. Complete compact series are saved on `forecast-data-diagnostics`, one small JSON per model. The public standard-runner workflow checks hourly and after ensemble preparation, skips unchanged inputs and refuses partial ensembles/timelines. It uses no paid API or Actions artifact storage.

### Interactive vertical vortex structure

GEFS uses all 31 members' mean temperature and horizontal winds at 13 pressure levels from 200 to 1 hPa, on a 1-degree Northern Hemisphere grid. `scripts/prepare-vortex.py` estimates pressure-coordinate Ertel potential vorticity with spherical derivatives and interpolates to 400–1200 K potential-temperature surfaces every 25 K. Each high-PV contour encloses an area equivalent to a 70-degree polar cap. This is a fixed-area diagnostic, **not** a Nash vortex-edge diagnosis; PV calculated from mean fields is not ensemble-mean PV, and averaging can hide individual-member splits. Pole PV uses the adjacent latitude-circle mean to avoid the longitude coordinate singularity.

The 3D viewer is GEFS-only. Its north-pole base map and PV contours share an outward-looking projection: east longitudes run counterclockwise, without mirroring coastlines.

Compact, hash-checked GEFS geometry is stored on `forecast-data-vortex`. Offline preparation reuses the six existing mean levels and retrieves seven extra levels directly from NOAA. Each published time requires the complete ensemble; the catalogue explicitly reports whether all 33 twelve-hourly forecast times are ready. Checkpoints let subsequent jobs resume already published times. The original public repository uses free standard GitHub runners and keeps current/preceding generated runs. This preparation is independent of the main GEFS maps, whose own hourly workflow prevents slow ECMWF jobs from blocking new NOAA cycles. Browser drag, wheel, pinch, keyboard rotation and cached playback operate on prepared geometry.

### Wind direction arrows

Wind maps include an optional, default-enabled arrow overlay. Screen-spaced arrows use bilinearly sampled eastward u and northward v components and a short great-circle step projected into the current globe orientation. Arrows point along flow (towards its destination), with bounded length increasing with vector speed; shading retains its existing speed scale. Ensemble mean arrows represent the mean vector, while shading represents the mean member speed, which can differ. Spread maps never display direction arrows. No extra downloads are required.


### Forecast delivery reliability

ECMWF ENS and AIFS preparation now has a separate concurrency lock per model,
checks twice an hour, and processes two forecast hours in separate native-decoder
processes on the public runner. Only a fully validated run is published. IFS ENS
uses complete 15-day 00/12 UTC cycles; the shorter 06/18 UTC IFS cycles are not
substituted into the 15-day timeline. AIFS and GEFS accept all four cycles when
their complete advertised horizon is available.

`check-pipelines.yml` audits terminal provider inventories, complete public
catalogues, all member-panel entries, diagnostics and the GEFS 3D timeline every
20 minutes and after preparation. It recovers idle stale jobs with a 15-minute
retry cooldown, never dispatching duplicate active model jobs. A small public
`forecast-status/latest.json` drives the site's source freshness notice. The
notice offers a new published run without unexpectedly changing the user's
current analysis or deleting cached frames. Status older than 90 minutes is
labelled overdue. The desktop ingest monitor also checks for missed GitHub
schedules; GitHub scheduled events can be delayed or dropped, so this is a
recovery mechanism rather than a guaranteed publication deadline.
