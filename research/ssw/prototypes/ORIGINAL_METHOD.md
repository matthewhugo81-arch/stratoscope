# Stratoscope SSW precursor monitoring — evidence-first approach

## Purpose and scope

The first stage adds a seven-day *analysed* 500-hPa height anomaly and +2-PVU dynamical-tropopause potential-temperature history (00 UTC, Northern Hemisphere 30–90°N). These analyses provide preceding tropospheric context for the existing GEFS 100-hPa heat flux, 3D PV geometry, and 10-hPa 60°N zonal-wind diagnostics. They are **not** a standalone prediction of a sudden stratospheric warming (SSW).

## Field integrity and provenance

- **Contemporary atmospheric state:** NOAA GFS operational **analysis** (`gfs.t00z.pgrb2.0p25.anl`) for each completed date. Do not call it ERA5 reanalysis or a deterministic forecast. Never silently substitute `f000`, previous days, or another model when a source is missing.
- **H500 anomaly:** analysis geopotential height at 500 hPa, in metres, minus the existing calendar-day 1991–2020 NCEP/NCAR Reanalysis 1 height climatology held at `scripts/data/height-500-ncep-1991-2020.npz`; reference metadata and SHA-256 are validated by `scripts/vortex_context.py`. NCEP/NCAR R1 no longer provides new 2026 observations; its reference climatology is historical.
- **Dynamical tropopause:** GFS temperature in Kelvin and pressure in Pa on the **+2 PVU surface** (Northern Hemisphere), converted to potential temperature θ = T(100000/p)^(287.05/1004) in Kelvin. θ contours shown on this *PV surface* are distinct from PV contours on fixed isentropic surfaces. Neither approach should be conflated with PV computed at 500 hPa.
- **Spatial sampling:** native GFS 0.25° fields sampled on a documented 1° Northern Hemisphere 90–30°N grid; 00 UTC snapshots, not daily averages. Real-source index records and GRIB SHA-256s accompany each date.
- **Missing data:** no issue is published unless every one of the seven target days has complete, validated HGT/TMP/PRES fields. Production freshness must be monitored; a previous issue may remain online if the provider is unavailable.

## Rossby-wave-breaking diagnosis (phase two, not yet implemented)

Do **not** infer anticyclonic/cyclonic breaking merely from a 500-hPa trough/ridge dipole, a single PV streamer, or positive upward eddy heat flux.

A defensible RWB detector needs objectively validated overturning geometry, event duration, spatial extent, and treatment of cutoffs, the polar discontinuity and grid resolution. Published alternatives include the +2-PVU surface isentropic-overturning method and 2-PVU contours on multiple isentropic surfaces (e.g. 315, 330, 350 K). They are different methods and require validation against independent analysed cases before any automated AWB/CWB count or label is exposed. A proposed implementation should:

1. Evaluate filtered θ contours on the +2-PVU dynamical tropopause or filtered +2-PVU contours on multiple θ isentropic surfaces.
2. Identify true contour overturning, reject small/noisy or closed isolated cutoffs, require spatial coherence and persistence, and correctly classify anticyclonic versus cyclonic morphology.
3. Track events across consecutive 6-hour analyses and record longitude, latitude, orientation, strength and timing; a once-daily snapshot alone may alias wave-breaking onset and duration.
4. Backtest detection against a manually labelled set across multiple seasons before introducing alert thresholds. Report false alarms and missed events.

## Upward wave propagation (phase two)

- The bundled `scripts/ssw_wave_flux.py` implements an independently tested, member-wise k=1/k=2/full-total/higher-waves decomposition for complete GEFS 100-hPa fields. Integrate it into the operational flux publisher only after real-run comparison with the existing unmodified total series and validation against an independent calculation.
- In addition to instantaneous values, maintain **3-, 5- and 7-day rolling integrated positive forcing**, comparable with a reforecast or reanalysis calendar-day distribution. A fixed raw heat-flux threshold cannot be treated as seasonally calibrated.
- Where complete wind/temperature fields exist, compute an Eliassen–Palm flux or wave-activity-flux diagnostic, and assess vertical propagation, convergence and consistency of subsequent 10/30/50-hPa responses.
- Monitor 10-hPa 60°N U and polar-cap temperature/height anomaly trends separately for deterministic and ensemble forecasts. At matched valid times, compare successive cycles, ensemble control/mean/spread and fraction of members crossing zero.
- SSW formal criteria are separate from a single instantaneous easterly forecast; verify daily mean, winter season, calendar definition and post-event behaviour.

## Qualitative precursor states (not probabilistic)

| Label | Minimum evidence | What it does **not** mean |
| --- | --- | --- |
| Background monitoring | All required sources ingested and time-aligned | No evidence of a future SSW |
| Tropospheric watch | Repeatedly identified/verified blocking and objectively confirmed relevant wave-breaking patterns | Wave breaking alone predicts an SSW |
| Upward-forcing watch | Sustained, calibrated 100-hPa wave activity with k=1/k=2 contributions and supporting vertical propagation | A formal major-warming declaration |
| Vortex-response watch | Robust 10-hPa deceleration and temperature/geometry response in several recent cycles, adequate ensemble support | A calibrated SSW probability |
| Reversal scenario | Explicit ensemble members indicate sustained daily-mean wind reversal; season/event criteria checked | A guaranteed SSW or surface cold outbreak |

All stages require labelled, distinct sources, run cycles, valid times, uncertainty, and a demonstrable tropospheric-to-stratospheric chronology. It is legitimate to move backwards between stages or record **insufficient evidence**.

## Deployment and verification

The prepared analysis is published to its own generated branch `forecast-data-ssw-history`, not to source `main`. The website only consumes a complete seven-day manifest and separately labelled static map files. The new source files and UI should be reviewed as a **draft PR** and tested against live NOAA `.idx`/GRIB before merging. Local tests verify calculation and index selection but **cannot** verify live NOAA file availability or ecCodes metadata. Existing Stratoscope ensemble pipelines should remain untouched.

Useful references: NOAA GFS product inventory and public archive; ECMWF ERA5T documentation; objective RWB methods described by Ndarana & Waugh and related dynamical-tropopause studies; published 100-hPa wave forcing and major-SSW predictability analyses.
