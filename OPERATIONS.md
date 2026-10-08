# Stratoscope operational baseline — 8 October 2026

The owner requested that the established project and process be saved and stabilised. Keep automated forecast updates and the hourly reliability monitor running. Do not add features or change scientific definitions without a new user request. This is an operational baseline, not an access restriction: the website remains public.

## Publication and recovery

Source and the compiled GitHub Pages site are versioned on main; docs/ is deployed by GitHub Pages. Preparation workflows publish validated compact data to separate forecast-data-* branches. Ordinary viewers fetch those public files; they cannot dispatch authenticated workflows or edit the repository merely by visiting the URL. Browser rendering runs on the visitor's device. Direct GFS/IFS requests still depend on provider availability.

check-pipelines.yml audits source completeness, published model cycles, member panels, diagnostics, vortex context and ERA5. It runs on its existing schedule and after preparation; the hourly monitor checks for missed audits. An audit older than 60 minutes may be dispatched once only after checking that no audit is active. Use exact model-job matching and the existing dispatch cooldown. GitHub schedules may be delayed. Keep the last complete run while a new one prepares. Never publish partial ensembles.

Do not disable automatic data updates when preserving this baseline. Do not change billing, secrets, permissions or hosting as part of routine maintenance. GitHub secrets remain in GitHub and are deliberately absent from backups.

## Seasonal source correction

BOM system 2 publishes instantaneous wind at 24-hour lead intervals. On 8 October the live CDS constraints endpoint returned exactly 24,48,...,5160 hours for BOM/system2/2026-09-01/u/10hPa. The evidence and exact availability query are saved in scripts/bom-source-availability.json. This source-specific availability resolves the mismatch with the generic 12-hour product description.

BOM forecasts must contain all 55 members (11 from each of the five qualified starts) and 180 consecutive daily dates through +4320 hours. No noon interpolation, repeated samples or incomplete members are allowed. The earlier accepted requests asked for a superset of lead times; reuse those exact saved requests when compatible, never create duplicate CDS jobs. Future requests use 24-hour leads. Other six seasonal models retain their 360 twelve-hourly dates and existing complete-member counts. Model-hindcast imports are not requested.

ERA5 1993–2016 daily wind climatology is complete and stored on forecast-data-seasonal at climate/era5-1993-2016.json. It has 366 calendar days, 24 samples on ordinary dates and six on February29. Reuse it permanently; it is not downloaded again for every forecast. The 500hPa height-anomaly reference is a separate NOAA PSL NCEP/NCAR 1991–2020 baseline. Do not confuse the two.

## Sharing and capacity

The public URL grants viewing access, not repository write access. The public repository and client code can also be read/copied. Visits do not use Codex credits or launch a fresh forecast-preparation job. Browser caching and on-demand frame loading reduce repeated traffic but do not remove bandwidth constraints.

The website shell is small; prepared maps and 3D timelines dominate transfers. A sampled GEFS mean/spread frame is about0.32MB, an all-member panel about1.15MB, and one PV geometry frame about2MB before its anomaly context. Multiple frames and models multiply these figures. These are measured file sizes, not a visitor-capacity guarantee.

GitHub Pages documents a soft100GB/month bandwidth limit and possible rate limiting: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits . Forecast assets served from raw.githubusercontent.com and direct providers have separate service behaviour; the Pages limit is not an allowance covering all those downloads. Do not infer overall traffic from a healthy preparation job.

Before a large publicity campaign, assess actual traffic and transfer volume and consider dedicated cached object storage/CDN for the data assets. Any hosting migration, spending or account setup needs a concrete user decision. This baseline does not introduce a paid service or promise unlimited visitors.

## Restore

Use the stable tag made after BOM publication verification to restore source and compiled site. A local Git bundle preserves source history; a ZIP provides the tagged tree without dependencies, credentials or transient downloads. Data branches continue to advance independently. Backups include the branch-reference inventory and saved permanent reference assets separately; transient forecast caches are reproducible from the authorised workflows and are not the source-code archive.

To restore the code into a new folder: git clone <saved-bundle> <new-folder>, then checkout the stable tag. Node22.13+ and npm ci restore dependencies. Follow README.md for TypeScript checks, tests and Pages build. Do not overwrite a live data branch with an old snapshot or restore old request IDs as new jobs. Check current remote workflow state before any recovery.
