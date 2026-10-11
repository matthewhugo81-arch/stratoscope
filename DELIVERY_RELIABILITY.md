# Model delivery: release pickup is separate from the health audit

## Operational changes — 11 October 2026

The independent publication-health audit retains its three-hour schedule and
completion-triggered checks. Newly available GEFS, IFS ENS, AIFS ENS and ICON
runs have an additional bounded release watcher. Each watcher execution checks
public catalogues and terminal source inventories every five minutes for up to
50 minutes. It is started by hourly scheduling, relevant preparation completions,
or explicit dispatch. A single concurrency group prevents overlapping watchers.

Only the existing idle-job and cooldown-safe recovery function may dispatch
preparation. The watcher does not cancel healthy work, fetch raw GRIB data,
submit CDS orders, create infrastructure, or publish partial forecasts. Changed
source/publication states request a separate full health audit. The site still
requires complete ensembles: 31 GEFS or 51 ECMWF members, every required level
and every forecast time. A monitoring success is not a promise of an instantaneous
new forecast. GitHub can delay or omit cron events; the bounded watcher reduces
reliance on a single cron instant but is not independent of GitHub availability.

GEFS now uses two isolated decoder processes, with three transfer threads each.
The total six-transfer ceiling is unchanged. After actual publication, explicit
workflow dispatches update northern diagnostics, vortex geometry and heat flux,
and request fresh publication health. The parallel decoder was compared against
an already published run at +0 and +384 hours, all six pressure levels and all
31 members: the twelve packed field arrays were byte-for-byte identical.
That is a correctness test, not a guaranteed percentage speed improvement.

Direct IFS browser loading now uses the same official Google Cloud and ECMWF
replicas as ensemble preparation. The index and its GRIB byte ranges always use
the same origin. Discovery is cached for at most one minute. A source outage is
not interpreted as proof that an older cycle is latest. Where browser CORS hides
a missing-file response, a recent successful server-side inventory audit can
identify the last verified run; its terminal inventory must still validate live.
Missing, failed, malformed, future or overdue audit reports cannot authorize that
fallback. The visible status retains its check time and any upstream-wait notice.

## Honest status meanings

A candidate cycle can be in its release-watch window but not yet have all source
files. This is now labelled separately from a newer verified upstream run waiting
for local preparation. The configured release-watch offsets only open a watch
window; they are not contractual provider deadlines and do not invent available
runs. Existing failed-attempt and persistent-backlog warnings remain in place.
Vortex and heat-flux health now follow upstream GEFS freshness, rather than being
called current merely because they match an older published parent cycle.

## Observations during the October 11 investigation

At 07:04 and 07:19 UTC, the checked IFS 00Z October 11 indexes were returning
404 on both official origins. GEFS's member-30 terminal +384h index had a reported
last-modified time of 06:29 UTC; its already-running preparation began at 06:49
and the full public catalogue was prepared at 07:21 UTC. That job was not cancelled.

At 07:19 UTC, Open-Meteo metadata identified its `ecmwf_ifs` high-resolution
feed as October 11 00Z, but `ecmwf_ifs025` and `ecmwf_ifs025_ensemble` as October
10 18Z. These products have different coverage and release paths. The Open-Meteo
high-resolution IFS API does not provide the same pressure-level dataset. It is
not silently substituted for the native stratospheric IFS ensemble. A forecast's
valid date or the API's modification time is not its initialization time.

These are timestamped observations, not permanent claims about future releases.
All forecast state must be read from the current manifests and source inventories.
The changes do not alter chart layout, saved-image controls, meteorological
calculations, seasonal data, ERA5, repository visibility or account security.

## Primary documentation

- https://www.ecmwf.int/en/forecasts/datasets/open-data
- https://open-meteo.com/en/docs/ecmwf-api
- https://open-meteo.com/en/docs/ensemble-api
- https://open-meteo.com/en/docs/model-updates
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
