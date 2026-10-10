# Forecast delivery and honest health reporting

## October 10, 2026 repair

IFS ENS and AIFS ENS repeatedly failed with HTTP 429 from the canonical ECMWF
open-data portal, despite complete 12Z inventories being available. The prior
freshness audit detected a lag but treated an active/dispatched retry as healthy.
An active process is not evidence that its replacement publication succeeded.

The importer now uses the official Google Cloud replica first, with canonical
ECMWF as a separately indexed fallback. AWS was also returning SlowDown during
diagnosis and is not in the active source list. Metadata retains canonical ECMWF
attribution. The index and its GRIB byte ranges always come from the same origin.
On transport failure, the affected forecast hour is re-indexed on the alternate
source. Native date, forecast step, pressure, variable and member validation are
unchanged. Exactly 51 members and every required six-hour frame remain required
before a complete public catalogue is written. No partial catalogue replaces the
previous successful run. GEFS transport is unchanged.

Live pre-release verification decoded all 51 members for both 12Z ECMWF models
at +360h on 10/50/100 hPa from the new primary, including compact frame/member
bundle identities, lengths and SHA-256 checksums. This verifies that route and
those fields, not every future download or an entire production cycle.

## Three-hour monitoring

`Check forecast pipeline freshness` retains `11 */3 * * *` (UTC) and also checks
preparation completions. GitHub may delay or omit scheduled events under load;
this is not an exact-time SLA. Each ECMWF preparation attempt now explicitly
requests a health check, and successful publication requests new diagnostics.

The audit persists the time at which a publication backlog was observed. A retry
does not reset that timer. A failed attempt after the last publication, or a
backlog lasting at least three hours, remains an error even if another attempt
is active. The public report distinguishes `recoveryStatus` from publication
health and names the latest relevant failed workflow. Diagnostics aligned with
an older parent no longer claim their inputs are current upstream.

The report also validates all seven seasonal publications against their expected
release issue. A seasonal warning is not proof that every upstream member is
available. ERA5's already-complete historical reference is not redownloaded.
Do not suppress audit failures while genuine missing publications remain.

## BOM October seasonal issue

C3S known issue I2 documents that the 29 September 2026 ACCESS-S2 start is absent.
C3S products use the 55 most recent available members, not necessarily five
consecutive calendar starts. October therefore uses the 11 native members from
26, 27, 28 and 30 September and 1 October. No members are fabricated, repeated or
silently omitted. All 55 trajectories still require all 180 valid daily samples.
The corresponding documented April 2026 gap is covered separately; historical
hindcast selection and the other six seasonal models are unchanged.

The modified older-month CDS request uses a new checkpoint name, preserving the
old request for audit. The unchanged first-of-month request remains reusable.
Unknown future gaps still fail completeness checks rather than being guessed.

## Verification and sources

Regression checks run on relevant main changes and pull requests, with no model
orders, API secrets or publication writes. Operational schedules, last-known-good
catalogues, isolated per-model concurrency and existing security safeguards are
retained. Website design, chart rendering and Save controls are unchanged.

- https://www.ecmwf.int/en/forecasts/datasets/open-data
- https://docs.github.com/en/actions/how-tos/troubleshoot-workflows
- https://confluence.ecmwf.int/spaces/CKB/pages/87853536/C3S+Seasonal+Forecast+known+issues
