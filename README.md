# Stratoscope

Interactive Northern Hemisphere stratosphere globe, hosted on **GitHub Pages**. The browser downloads official public weather fields directly and decodes them in background Web Workers. No ChatGPT hosting, server account, API key or paid proxy is needed to use this build.

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

The Pages build writes static browser assets into `docs/`. Commit the source **and rebuilt docs/** to `main`; GitHub Pages publishes from `main /docs`. `.nojekyll` disables Jekyll processing. The `/stratoscope/` base path is configured in `vite.pages.config.ts`. No scheduled workflow, paid runner, cloud backend or artifact store is configured. GitHub's free Pages service has published usage limits; this does not mean unlimited traffic or guaranteed availability.

The original Sites/Vinext build commands remain available for portability, but the GitHub website does not call that deployment. `.openai/hosting.json` identifies the historical Site and contains no credentials. Do not add secrets or environment files to this public repository. `docs/` is intentionally tracked; local dependencies and generated Worker output are ignored.

## Sources and coverage

| Model | Pressure levels, hPa | Timeline | Display grid |
| --- | --- | --- | --- |
| NOAA GFS, direct | 100, 70, 50, 30, 20, 10 | Analysis to +240 h | 1 degree |
| ECMWF IFS, direct | 100, 50, 10 | Initial field to +240 h | 1-degree display samples from 0.25-degree fields |
| NOAA GEFS, 31 members | 100, 70, 50, 30, 20, 10 | Initial field to +384 h | 1-degree samples from 0.5-degree fields |
| ECMWF IFS ENS, 51 members | 100, 50, 10 | Initial field to +360 h | 1-degree samples from 0.25-degree fields |
| ECMWF AIFS ENS, 51 members | 100, 50, 10 | Initial field to +360 h | 1-degree samples from 0.25-degree fields |
| ECMWF IFS 0.25 via Open-Meteo | 100, 50 | Today 00 UTC to +240 h | 10-degree sampled overview |
| DWD ICON Global via Open-Meteo | 100, 70, 50, 30 | Today 00 UTC to +168 h | 10-degree sampled overview |
| GFS Global via Open-Meteo | 100, 70, 50, 30 | Today 00 UTC to +240 h | 10-degree sampled overview |

The direct ECMWF feed includes 10 hPa, verified in the 7 October 2026 00 UTC IFS inventory. It omits 20, 30 and 70 hPa. Open-Meteo ECMWF provides only 50 and 100 hPa within this viewer's range. Unsupported levels are disabled and rejected by the API; the viewer never silently changes the source model or vertically interpolates missing levels. Open-Meteo HRES 9 km does not supply pressure-level fields, so both ECMWF sources use IFS 0.25.

The Open-Meteo layers are **coarse sampled maps**, not native-resolution model grids. 360 point forecasts form a 10-degree regular grid. Bilinear interpolation smooths the display but does not restore smaller-scale information. Each location is requested with nearest-cell selection and elevation downscaling disabled.

Direct NOAA and ECMWF fields are from one named model cycle. Direct ECMWF selects a completed 00/12 UTC cycle after checking the +240 h inventory for all required fields and levels. Open-Meteo supplies a rolling timeseries assembled from model updates; its timeline anchor is midnight UTC, not a claimed model initialisation. All dates are UTC.

## Globe and units

The WebGL2 globe uses an orthographic spherical projection, with reversible camera-basis rotation. Drag to tilt or rotate. Scroll directly over the map, pinch or use the buttons to zoom the globe; scrolling outside the map moves the page or side panel. Left/right arrows step backward/forward by six forecast hours. With the globe focused, Shift + arrows rotate, +/− zoom, and Home resets north. Focused sliders, tabs, model menus and pressure controls retain their normal keyboard behavior. The timeline stays visible as the page scrolls, and the globe adapts to the screen size. The software fallback preserves the controls if WebGL2 is unavailable.

Temperature is Celsius; geopotential height is metres, with contours every 400 m labelled in dam; wind speed is m/s. Open-Meteo meteorological wind direction is converted to earth-relative components as u = -speed sin(direction), v = -speed cos(direction), then interpolated before computing speed. Lighting near the globe edge is decorative depth shading; hover values provide the unshaded numerical values. The Southern Hemisphere is explicitly outside data coverage and never filled with extrapolated Northern Hemisphere weather. Coastlines are Natural Earth 1:110m, public domain.

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

The browser requests at most two members concurrently, accumulates Welford statistics, and shows completed-member progress. Two reusable browser Web Workers fetch and decode individual members without blocking globe interactions. Abandoning a task terminates its worker and network activity. It plots statistics only when all members are present. Mean/spread switching reuses the same calculation. Bounded browser caches retain 24 individual frames and six statistical pairs with least-recently-used eviction. Fixed-cycle frames remain reusable in the tab for six hours; rolling Open-Meteo frames expire after 15 minutes. Each decoder retains a bounded in-memory cache. The optional server Cache API is absent in the Pages build. The first mean/spread download can take a few minutes, especially on slow connections; individual members are much lighter. Latest-run discovery checks end-of-range inventories; IFS uses complete 00/12 UTC cycles, GEFS and AIFS use six-hour cycles with an eight-hour availability buffer.

Cached frames switch without an artificial delay. After a single direct forecast loads, the browser may preload one six-hour step ahead. It skips speculative whole-ensemble and Open-Meteo downloads, hidden tabs and supported data-saving/slow-connection signals. Foreground requests reuse in-flight preloads, abandoned requests are cancelled, and Refresh clears the selected model cache.

The ensemble feeds are direct official data and need no API key. NOAA data is public domain unless otherwise identified. ECMWF Open Data is CC BY 4.0 with ECMWF terms and attribution; the site identifies modified data. The app uses free public endpoints and has no paid weather API credentials. GitHub Pages hosts the public static site. Data is requested anonymously from NOAA NODD public buckets, ECMWF and Open-Meteo. No AWS account is created and there are no requester-pays credentials. Open-Meteo's free hosted API is for non-commercial use within its published quotas, which is distinct from the underlying data licence.

Direct ECMWF uses the public JSON index to request only the four required GRIB2 byte ranges. It requires HTTP 206 and validates byte count, run, lead time, pressure, variable and grid; the content-range header is checked when the provider exposes it through CORS. CCSDS template 5.42 is decoded in TypeScript, then every fourth 0.25-degree point is retained and longitudes reordered to 0–359 degrees. Decoding proceeds one field at a time to bound memory. Byte-range requests bypass the browser HTTP cache because merged partial responses can return the wrong range; completed forecast frames remain cached by the app. Completed frames are cached in bounded decoder memory (12 frames).

An Open-Meteo level is downloaded in six batches of 60 coordinates. Each download retrieves the full supported timeline and keeps only six-hour steps. Completed timelines and partial downloads are cached in bounded decoder memory for up to 30 minutes. A temporary 429 response preserves completed batches and asks the browser to resume automatically after 65 seconds; hourly/daily quota errors remain explicit. Source outages never produce synthetic fallback weather. Previous plots retain an explicit source, pressure and timestamp label during loading.

## Run and verify

See Quick start above. The regression tests cover optional Worker cache access, preload/foreground request sharing, cancellation, refresh invalidation, forecast identity checks, cache expiry and complete ensemble statistics. Site identity is preserved in `.openai/hosting.json`.

Initial direct-GFS decoder validation compared all 32,760 points of temperature, height and U/V against ECMWF ecCodes with errors below 0.0051 in display units. The interactive update verifies forward/inverse projection consistency after repeated rotations, cached timeline retrieval, resumed partial downloads, wind conversion, unsupported pressure/horizon rejection, live provider frames and browser controls.

The direct ECMWF update compared all 1,038,240 native values of each of temperature, height and U/V at 10 hPa for +0 and +240 h against ecCodes 2.49.0. All eight fields agreed within 0.0051 in display units, the rounding tolerance. Northern Hemisphere sampling and longitude order were independently checked from ecCodes coordinates. Live 50 and 100 hPa frames and API rejection of unsupported 30 hPa were also checked. The decoder adaptation's MIT notice is in `THIRD_PARTY_NOTICES.txt`.

Ensemble validation compared native IFS member temperature/height, AIFS member temperature/geopotential and all four GEFS fields with ecCodes 2.49.0; all values agreed within 0.0051 display units. The built Worker’s sampled outputs also agreed against independent ecCodes latitude/longitude coordinates at all 32,760 northern points per checked field. Checks cover population SD, scalar wind statistics, mean-height contours, duplicate/missing/mixed-member rejection, live control and last-member fields at initial and final leads, and unsupported model/level/member requests. Browser checks exercise complete mean/spread downloads for all three systems, member controls and the narrow-screen layout.

Sources:
- https://registry.opendata.aws/noaa-gfs-bdp-pds/
- https://registry.opendata.aws/noaa-gefs/
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://www.ecmwf.int/en/forecasts/datasets/open-data
- https://data.ecmwf.int/forecasts/
- https://github.com/pspoerri/go-tiled-eccodes/tree/main/aec
- https://www.nco.ncep.noaa.gov/pmb/products/gfs/
- https://www.nco.ncep.noaa.gov/pmb/products/gens/
- https://www.weather.gov/disclaimer
- https://open-meteo.com/en/terms
- https://open-meteo.com/en/docs/ecmwf-api
- https://open-meteo.com/en/docs/gfs-api
- https://open-meteo.com/en/docs/dwd-api
- https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_coastline.geojson
