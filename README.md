# Stratoscope

Interactive Northern Hemisphere stratosphere globe, built with Vinext/React and a Cloudflare-compatible data route. No API key is required.

## Sources and coverage

| Model | Pressure levels, hPa | Timeline | Display grid |
| --- | --- | --- | --- |
| NOAA GFS, direct | 100, 70, 50, 30, 20, 10 | Analysis to +240 h | 1 degree |
| ECMWF IFS 0.25 via Open-Meteo | 100, 50 | Today 00 UTC to +240 h | 10-degree sampled overview |
| DWD ICON Global via Open-Meteo | 100, 70, 50, 30 | Today 00 UTC to +168 h | 10-degree sampled overview |
| GFS Global via Open-Meteo | 100, 70, 50, 30 | Today 00 UTC to +240 h | 10-degree sampled overview |

ECMWF requests for 70 and 30 hPa return null in the Open-Meteo feed checked on 7 October 2026. Unsupported levels are disabled and rejected by the API; the viewer never silently changes the source model. Open-Meteo HRES 9 km does not supply pressure-level fields, so the ECMWF source is specifically IFS 0.25.

The Open-Meteo layers are **coarse sampled maps**, not native-resolution model grids. 360 point forecasts form a 10-degree regular grid. Bilinear interpolation smooths the display but does not restore smaller-scale information. Each location is requested with nearest-cell selection and elevation downscaling disabled.

NOAA fields are from one named GFS cycle. Open-Meteo supplies a rolling timeseries assembled from model updates; its timeline anchor is midnight UTC, not a claimed model initialisation. All dates are UTC.

## Globe and units

The WebGL2 globe uses an orthographic spherical projection, with reversible camera-basis rotation. Drag in either direction to tilt or rotate, scroll/pinch or use the buttons to zoom, and reset to the North Pole or the default tilted view. Arrow keys rotate, +/− zoom, and Home resets north. The software fallback preserves these controls if WebGL2 is unavailable.

Temperature is Celsius; geopotential height is metres, with contours every 400 m labelled in dam; wind speed is m/s. Open-Meteo meteorological wind direction is converted to earth-relative components as u = -speed sin(direction), v = -speed cos(direction), then interpolated before computing speed. Lighting near the globe edge is decorative depth shading; hover values provide the unshaded numerical values. The Southern Hemisphere is explicitly outside data coverage and never filled with extrapolated Northern Hemisphere weather. Coastlines are Natural Earth 1:110m, public domain.

## Requests and caching

An Open-Meteo level is downloaded in six batches of 60 coordinates. Each download retrieves the full supported timeline and keeps only six-hour steps. Completed timelines and partial downloads are cached in bounded process memory and the Worker Cache API for up to 30 minutes. A temporary 429 response preserves completed batches and asks the browser to resume automatically after 65 seconds; hourly/daily quota errors remain explicit. Source outages never produce synthetic fallback weather. Previous plots retain an explicit source, pressure and timestamp label during loading.

## Run and verify

`npm ci`, `npm run dev`, `npm run build`. The build emits the Cloudflare Worker. Site identity is preserved in `.openai/hosting.json`.

Initial direct-GFS decoder validation compared all 32,760 points of temperature, height and U/V against ECMWF ecCodes with errors below 0.0051 in display units. The interactive update verifies forward/inverse projection consistency after repeated rotations, cached timeline retrieval, resumed partial downloads, wind conversion, unsupported pressure/horizon rejection, live provider frames and browser controls.

Sources:
- https://www.nco.ncep.noaa.gov/pmb/products/gfs/
- https://open-meteo.com/en/docs/ecmwf-api
- https://open-meteo.com/en/docs/gfs-api
- https://open-meteo.com/en/docs/dwd-api
- https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_coastline.geojson
