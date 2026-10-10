# Validation record — 9 October 2026

Baseline source: `2ed7cabc99c4bb0a583c6ea98bc1948576c1690c`.

- Python: all 81 tests pass, including 28 new SSW tests.
- JavaScript: all 76 existing tests pass.
- TypeScript: `tsc --noEmit` passes.
- Pages: Vite build passes into `work/pages-validation`; deployed `docs/`
  remains unchanged. No files under app, components or lib were modified.
- Live native retrieval: six adapters; exact runs, leads, decoded fields,
  complete member identities and content hashes in `source-audit.json` and
  `evidence/`. At least two forecast times per model; not a full-timeline test.
- GFS history: seven complete 00 UTC analyses (2–8 October), each with H500 and
  +2-PVU T/P/U/V. No forecast or date substitution.
- Run changes: complete native U10 member sets from the preceding GEFS,
  IFS ENS and AIFS ENS cycles at the same valid times.
- GEFS total flux matches the existing direct-covariance implementation for all
  31 members at +0h and +120h within 0.000001 K m/s. Detailed errors are in
  `heat-flux-validation.json`. Spectral conservation is tested independently
  with known harmonics and on every saved live diagnostic.
- PV: analytic resting-state Ertel PV and interpolation ambiguity tests; one
  real GFS pressure-derived calculation. This is not native-PV validation.
- RWB: synthetic crossing orientation, direction invariance, representation
  rejection and cutoff/nonbreaking tests. No real-event skill assessment.
- ERA5 importer: actual ecCodes-generated synthetic GRIB tests for complete
  weeks, unit conversion, preliminary expver, forecast rejection and gaps.
  No real independent ERA5/ERA5T history retrieved.
- Pulsecheck HTML inspected in a browser; six-model tables, seven historical
  dates, measured cycle changes, explicit uncertainty and source links render.
- Existing workflow and Pages status inspected through GitHub's public API;
  results saved in `pipeline-audit.json`. No recovery, dispatch or publication
  was needed or performed by this branch.

Recorded source failures are part of validation: the newer IFS cycle returned
404 during probing, and GFS +120h 2-PVU U contains a native missing value.
Neither failure was hidden with a substitute. The prototype's numeric PV-surface
type check also needed an explicit ecCodes integer conversion (`pv` vs `109`).
ICON step units are decoded explicitly (e.g. `0m`), not assumed to be hours.

Outstanding scientific release gates are in `SSW_DEVELOPMENT.md`. A passing CI
run cannot calibrate SSW probabilities, prove RWB persistence, or verify every
forecast lead and pressure level. Keep this PR in draft until those intended
operational claims and any future app integration are separately reviewed.
