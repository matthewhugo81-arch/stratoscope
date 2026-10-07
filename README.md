# Stratoscope

Northern Hemisphere polar stereographic weather viewer. A Vinext/React client and Cloudflare-compatible route read NOAA GFS 1-degree data on demand.

## Data

- 100, 70, 50, 30, 20 and 10 hPa; 6-hour steps from analysis to +240 hours.
- Temperature in Celsius, geopotential height in metres (contour labels in dam), earth-relative U/V wind components in m/s.
- The latest completed cycle is selected by checking the +240h inventory, with an initial five-hour publication delay and fallback across prior cycles.
- NOAA NOMADS filters a complete Northern Hemisphere grid; GRIB2 template 3.0 and packing template 5.0 are validated and decoded locally in the Worker. Other packing, missing fields, mixed runs and unsupported grids fail explicitly.
- Raster interpolation is bilinear. Wind speed is calculated after interpolating U and V. Height contours are sampled in projection space at 400 m intervals. The colour scales are fixed across times and levels; end colours clamp out-of-scale values.
- Pressure labels include approximate standard-atmosphere altitude only. GFS forecasts are model output, not observations. All dates are UTC.
- Coastline data is Natural Earth 1:110m, public domain.

Sources: https://www.nco.ncep.noaa.gov/pmb/products/gfs/ and https://nomads.ncep.noaa.gov/
Coastlines: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_coastline.geojson

## Run

`npm ci`, then `npm run dev`. `npm run build` emits the Cloudflare Worker. No API keys are required. Site identity is retained in `.openai/hosting.json`.

The browser checks for the latest run when opened or refreshed; no scheduled automation is required. NOAA outages are shown explicitly, retaining any previous plot with its original timestamp clearly labelled. Recent frames are cached in bounded memory on client and server.

## Verification

Live frames were checked at all six levels, spanning analysis to +240h. All 32,760 points in each of four fields of a +24h 10 hPa sample were independently compared with ECMWF ecCodes: maximum error below 0.0051 in display units. Invalid API inputs return HTTP 400. TypeScript and responsive browser checks are part of the initial delivery.

The optional `select_forecast` WebMCP tool shares the same visible state as the UI. It selects a view; it does not claim that loading has completed.
