# Stratoscope

Interactive Northern Hemisphere stratosphere globe, built with Vinext/React and a Cloudflare-compatible data route. No API key is required.

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

The WebGL2 globe uses an orthographic spherical projection, with reversible camera-basis rotation. Drag in either direction to tilt or rotate, scroll/pinch or use the buttons to zoom, and reset to the North Pole or the default tilted view. Arrow keys rotate, +/− zoom, and Home resets north. The software fallback preserves these controls if WebGL2 is unavailable.

Temperature is Celsius; geopotential height is metres, with contours every 400 m labelled in dam; wind speed is m/s. Open-Meteo meteorological wind direction is converted to earth-relative components as u = -speed sin(direction), v = -speed cos(direction), then interpolated before computing speed. Lighting near the globe edge is decorative depth shading; hover values provide the unshaded numerical values. The Southern Hemisphere is explicitly outside data coverage and never filled with extrapolated Northern Hemisphere weather. Coastlines are Natural Earth 1:110m, public domain.

## Requests and caching

Ensemble views are mean, spread (population standard deviation, denominator N) and individual member. Member 0 is the control; all 31/51 members receive equal weight. Scalar wind speed is calculated for each member before its mean and spread. Height contours show mean height on both mean and spread maps, and the selected member's height on member maps. Temperature spread is a temperature difference in Celsius. AIFS geopotential is divided by standard gravity 9.80665 to obtain geopotential height in metres.

GEFS uses NOMADS 0.5-degree atmosphere filters: part A at 10/50/100 hPa, part B at 20/30/70 hPa. ECMWF IFS perturbations use enfo/ef (index type pf), and its control uses oper/fc following Cycle 50r1. AIFS uses enfo/pf and enfo/cf. Native GRIB product template 4.1 member identifiers are validated, along with run, time, level and fields. Latitude scan direction and longitude origin are normalized onto a common 360 × 91 northern grid. No vertical interpolation or model substitution is performed.

The browser requests at most two members concurrently, accumulates Welford statistics, and shows completed-member progress. Each server request decodes one member to keep CPU and memory bounded. It plots statistics only when all members are present. Mean/spread switching reuses the same calculation. Bounded browser caches retain 24 member frames and four statistical pairs for 15 minutes; server caches retain ten ensemble frames in memory and use Worker Cache API storage for three hours. The first mean/spread download can take a few minutes, especially on slow connections; individual members are much lighter. Latest-run discovery checks end-of-range inventories; IFS uses complete 00/12 UTC cycles, GEFS and AIFS use six-hour cycles with an eight-hour availability buffer.

The new ensemble feeds are direct official data and need no API key. NOAA data is public domain unless otherwise identified. ECMWF Open Data is CC BY 4.0 with ECMWF terms and attribution; the site identifies modified data. Forecast data is free; infrastructure and optional delivery services have separate costs. Open-Meteo's free hosted API is for non-commercial use within its published quotas, which is distinct from the underlying data licence.

Direct ECMWF uses the public JSON index to request only the four required GRIB2 byte ranges. It requires HTTP 206 and validates the content range, byte count, run, lead time, pressure, variable and grid. CCSDS template 5.42 is decoded in TypeScript, then every fourth 0.25-degree point is retained and longitudes reordered to 0–359 degrees. Decoding proceeds one field at a time to bound memory. Completed frames are cached in bounded memory (12 frames) and the Worker Cache API (three hours).

An Open-Meteo level is downloaded in six batches of 60 coordinates. Each download retrieves the full supported timeline and keeps only six-hour steps. Completed timelines and partial downloads are cached in bounded process memory and the Worker Cache API for up to 30 minutes. A temporary 429 response preserves completed batches and asks the browser to resume automatically after 65 seconds; hourly/daily quota errors remain explicit. Source outages never produce synthetic fallback weather. Previous plots retain an explicit source, pressure and timestamp label during loading.

## Run and verify

`npm ci`, `npm run dev`, `npm run build`. The build emits the Cloudflare Worker. Site identity is preserved in `.openai/hosting.json`.

Initial direct-GFS decoder validation compared all 32,760 points of temperature, height and U/V against ECMWF ecCodes with errors below 0.0051 in display units. The interactive update verifies forward/inverse projection consistency after repeated rotations, cached timeline retrieval, resumed partial downloads, wind conversion, unsupported pressure/horizon rejection, live provider frames and browser controls.

The direct ECMWF update compared all 1,038,240 native values of each of temperature, height and U/V at 10 hPa for +0 and +240 h against ecCodes 2.49.0. All eight fields agreed within 0.0051 in display units, the rounding tolerance. Northern Hemisphere sampling and longitude order were independently checked from ecCodes coordinates. Live 50 and 100 hPa frames and API rejection of unsupported 30 hPa were also checked. The decoder adaptation's MIT notice is in `THIRD_PARTY_NOTICES.txt`.

Ensemble validation compared native IFS member temperature/height, AIFS member temperature/geopotential and all four GEFS fields with ecCodes 2.49.0; all values agreed within 0.0051 display units. The built Worker’s sampled outputs also agreed against independent ecCodes latitude/longitude coordinates at all 32,760 northern points per checked field. Checks cover population SD, scalar wind statistics, mean-height contours, duplicate/missing/mixed-member rejection, live control and last-member fields at initial and final leads, and unsupported model/level/member requests. Browser checks exercise complete mean/spread downloads for all three systems, member controls and the narrow-screen layout.

Sources:
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
