# Genie Replay Lab

[Open the progress dashboard](https://cmsautter.github.io/genie-progress/)

Reproducible progress measurements for [GenieRust](https://github.com/librematch/genie), an independent reimplementation of the Age of Empires II: Definitive Edition engine.

## Two corpus views

* **Fixed reference:** a frozen set of **5,604 unique recordings**. This is the default view for comparing engine revisions.
* **Growing corpus:** newly discovered eligible recordings, with membership frozen independently for each test run. New games enter the next snapshot.

The initial reference targets full internal build **158041**, public game version **101.103.26969.0**, using matching game data. Every run identifies its upstream engine commit, diagnostic instrumentation, toolchain, architecture, data fingerprints and replay hashes.

Snapshot history retains the newest 30 distinct engine revision and build profile pairs, with the historical baseline pinned separately. Repeated runs as the corpus grows replace that revision's representative instead of pushing older revisions out. A completed snapshot remains available alongside an unfinished or failed retry of the same revision.

## What is measured

Recordings start from their saved headers. The simulation stops at its first reported unsupported condition, differing recorded checkpoint, resource limit or recording end. The dashboard shows ticks reached, progress distributions, first blockers and changes on identical reference recordings.

Completed recordings with matching usable checkpoints are separate from recordings without checkpoints. These checkpoints contain partial state checksums; matching them does not establish complete equality of every simulation field or tick. Ignored commands, parse errors, multiple chapters, timeouts and process failures remain visible.

### Changes between engine snapshots

**Changes since the previous snapshot** lists every measured replay whose progress or stopping diagnostics changed. Each row shows ticks reached and checkpoints passed **before and now**, signed deltas, and both stopping reasons. Expand a reason for all reported conditions or checkpoint categories; **Progress details** also shows changed failure ticks, last matching checkpoint ticks, ignored command counts and recording-length metadata.

The comparison uses the most recently completed test of a **different engine commit before the selected run started**. Recordings are paired by identical SHA256 hashes. Newly added or ambiguous recordings and tests still pending are counted separately. Runtime-only differences and diagnostic list ordering do not count as changes. Gains and losses across ticks, matching checkpoints and EOF status are classified as advanced, regressed or mixed; changed recording lengths are labelled separately. Differences in build profile, architecture, game data, instrumentation or resource limits are identified where known.

Use the fixed or growing corpus tabs, search by match ID or stopping reason, filter regressions or EOF transitions, and sort by tick or checkpoint gains/losses. **Download changes JSON** provides the full list for the selected run. Active runs update as more results arrive. A missing earlier retained report is reported explicitly, without substituting an unrelated baseline.

### Refresh consistency

The page keeps the latest results it has already received when a cache returns an older update. Each report is verified against the version named by its publication before replacing the displayed data. Mixed versions and temporary missing responses keep the last verified results visible and are retried. Manual historical selections and genuine changes between engine runs still work normally.

### Execution time

The dashboard shows total run wall time, plus average and median time per replay in the selected corpus. Wall time includes build, pauses and retries. Replay averages use the final stored attempt, with current-run measurements separate from cached or historical timings. Missing timers are excluded.

Each recording has a **Time to stop** value such as **12.2s**, including parsing and simulation until its first failure or EOF. Select **Slowest first (elapsed time)** to find expensive recordings. Shared session startup is excluded; historical and fallback process timers can include startup. Full result JSON retains precise `runtime_seconds`, identifies `runtime_source`, and includes timing summaries.

### Histogram controls

Progress histograms show separate outcome bars in a fixed order, with a shared baseline. Use **Count scale** to switch between logarithmic and linear counts, and **Chart outcome** to inspect one outcome on its own. Log mode uses `log10(count + 1)` to include zero. Hover or keyboard-focus a bucket for its exact outcome counts and total. The selected scale and outcome apply to both progress and tick histograms.

### Checkpoint mismatch categories

The dashboard distinguishes object positions, combined resources, live object counts, actions/unit AI and the other recorded checks. The category overview counts affected recordings; selecting a category filters the table. Expand a mismatch to see the affected players, zero-based checkpoint words, and recorded versus simulated values. A recording can fail several checks. These aggregate checks help locate the differing state without establishing its exact cause.

The same categories appear in the stopping-summary JSON, with a `checkpoint_word` field. [Checkpoint definitions](https://cmsautter.github.io/genie-progress/checkpoint-checks.json) describe each word for build 158041 and link to the engine implementation. Unknown words, other builds and older reports without details remain explicitly identified. Full report JSON retains the original numeric differences.

### Full-recording command coverage

The command census reads whole recording bodies, including commands beyond the simulation's first stop. Its two percentages show **coverage of distinct recorded command variants** and **coverage weighted by their total occurrence counts**. Both follow the selected engine snapshot and fixed or growing corpus.

The default definition counts reviewed handlers only. **Handler presence, including partial** provides a broader measure of implemented entry points. Partial or conditional implementations, explicit unsupported branches and unknown packets remain separate. A handler does not establish successful execution, checkpoint agreement or complete support for later autonomous mechanics. The reviewed count is deliberately conservative; handlers that have not been reviewed as complete stay partial.

The usage ranking includes the entire recording, with filters for unsupported, partial and unknown variants. GAME subcommands, unit-order actions, stances, remembered selections and farm construction are distinguished. **After stop** counts commands in strictly later updates where a comparable simulation horizon exists; it excludes the failure update itself and is unavailable when no comparable horizon exists. Unknown command packets stay in the denominator. Bodies that cannot be scanned completely are excluded and explicitly counted. Camera, chat, checkpoints and internal unit/AI updates are outside these command metrics.

Use **Download census JSON** for the exact run's counts, classification reasons, source links and parser provenance. The census runs separately and reuses cached recording counts as engine classifications change.

New corpus snapshots include a census assembled from the existing cache at publication time. Recordings still being scanned are labelled pending; subsequent publications fill them in. This keeps coverage visible when an unchanged engine revision gets a larger corpus run.

The original historical baseline used local diagnostic instrumentation and is labeled separately. New results are produced by a background benchmark worker and published as static JSON reports. The website does not run game code in visitors' browsers. During a run, new results are published about every five minutes; the page checks for updates every minute. Deployment and caching can add delay.

## Stable JSON URLs

| URL | Contents |
| --- | --- |
| [latest.json](https://cmsautter.github.io/genie-progress/latest.json) | The newest benchmark run, including partial results while it is in progress. |
| [latest-completed.json](https://cmsautter.github.io/genie-progress/latest-completed.json) | The newest completed benchmark run. |
| [latest-running.json](https://cmsautter.github.io/genie-progress/latest-running.json) | The newest unfinished run that is queued, building or running. |
| [latest-simulated.json](https://cmsautter.github.io/genie-progress/latest-simulated.json) | Recordings that reached the end in the newest run, including those with zero checkpoints. |
| [latest-completed-simulated.json](https://cmsautter.github.io/genie-progress/latest-completed-simulated.json) | Recordings that reached the end in the newest completed run, including those with zero checkpoints. |
| [latest-running-simulated.json](https://cmsautter.github.io/genie-progress/latest-running-simulated.json) | Recordings that have reached the end within the newest unfinished run. |
| [latest-stopping-simulation.json](https://cmsautter.github.io/genie-progress/latest-stopping-simulation.json) | Ranked stopping reasons for the newest benchmark run. |
| [latest-completed-stopping-simulation.json](https://cmsautter.github.io/genie-progress/latest-completed-stopping-simulation.json) | Ranked stopping reasons for the newest completed run. |
| [latest-running-stopping-simulation.json](https://cmsautter.github.io/genie-progress/latest-running-stopping-simulation.json) | Ranked stopping reasons from the newest unfinished run. |
| [latest-command-coverage.json](https://cmsautter.github.io/genie-progress/latest-command-coverage.json) | Full-recording command coverage and frequency ranking for the newest benchmark run. |
| [latest-completed-command-coverage.json](https://cmsautter.github.io/genie-progress/latest-completed-command-coverage.json) | Command coverage for the newest completed benchmark run. |
| [latest-running-command-coverage.json](https://cmsautter.github.io/genie-progress/latest-running-command-coverage.json) | Command coverage for the newest unfinished run, when its census is available. |
| [latest-changes.json](https://cmsautter.github.io/genie-progress/latest-changes.json) | Replay changes for the newest run versus its preceding completed engine revision. |
| [latest-completed-changes.json](https://cmsautter.github.io/genie-progress/latest-completed-changes.json) | Replay changes for the newest completed run. |
| [latest-running-changes.json](https://cmsautter.github.io/genie-progress/latest-running-changes.json) | Changes measured so far in the newest unfinished run. |
| [manifest.json](https://cmsautter.github.io/genie-progress/manifest.json) | Available runs, summaries and engine commits. |

The three full-report URLs return the original per-run JSON with `run`, `identity` and `rows`, including recording IDs, SHA256 hashes, outcomes and checkpoint counts. They update with each publication; deployment and caching can add delay. Diagnostic pilots and superseded worker continuations are excluded. `latest.json` can also describe a build or setup failure, so check `run.status` before using its results. Completed URLs become available after the first completed run. Running URLs return HTTP 404 when the published snapshot has no unfinished run; they never fall back to completed results.

Stopping summaries contain `run` metadata, the `source_report` path and separate `fixed` and `growing` views. Each view has corpus totals, outcome counts and a `reasons` array sorted by affected recording count. Entries include `status`, the reported `reason`, `count`, `percent_of_stopped` and up to five example recording IDs. Checkpoint mismatches and input or execution errors are included alongside unsupported mechanics. Counts are deduplicated within each condition; one recording can report several conditions at its first stopping point, so counts can overlap. Completed recordings, including those without checkpoints, are not counted as stopped. The same summaries are also available without the `.json` suffix, for example `/latest-stopping-simulation`; the `.json` URLs use the JSON content type.

Simulated lists contain compact `run` metadata, `source_report`, `scope`, `count` and `rows`. They select every row with `status == "complete"` across the growing corpus; `fixed` identifies members of the frozen reference. Each entry includes `match_id`, `sha256`, game build, ticks reached, `checkpoints_passed`, `total_checkpoints`, the last matching checkpoint tick and ignored command count. Zero-checkpoint recordings are retained as `0/0`; reaching the end does not establish verified correctness. Rows are sorted by matching checkpoint count descending, then recording ID. These lists also work without `.json`. An available run with no completed recordings returns `count: 0` and an empty `rows` array.

For a reproducible reference, use `run.id` from either report to construct `data/<run.id>.json`. To identify recordings that reached the end with recorded checkpoints matching, select rows with `status == "complete"`, `total_checkpoints > 0` and `checkpoints_passed == total_checkpoints`. Rows without usable checkpoints remain separate, and `ignored_commands_to_stop` records any ignored commands.

Command-coverage responses contain `run`, parser and classification provenance, definitions and separate `fixed` and `growing` summaries. Each summary includes `implemented_types_percent`, `implemented_occurrences_percent`, the two `handler_*_percent` alternatives, four implementation-status counts, scan exclusions and frequency-ranked `rows`. Use `coverage/<run.id>.json` for a particular retained run. These aliases also work without `.json`; unavailable censuses return 404 without substituting a different run. No private per-command position lists or replay payloads are included.

Replay-change responses contain current and baseline provenance, `fixed` and `growing` counts, and one `rows` array of changed recordings. Rows include SHA256, corpus membership, before/after counters and stopping diagnostics, `ticks_delta`, `checkpoints_delta`, the change category and EOF flags. `fixed` on a row identifies reference-set membership. Missing counters have null deltas. Use `changes/<run.id>.json` for a particular retained run; the three aliases also work without `.json`. Reports without an available baseline return `available: false` with a reason and an empty list. Running aliases return 404 when no run is active.

## Repository contents

This repository contains the static dashboard and its report-deployment workflow. Sanitized report snapshots are available in the **Benchmark report snapshots** prerelease. The worker implementation is maintained separately.

Proprietary game assets, replay payloads, local configuration and credentials are not published here.

Independent community project. Not affiliated with the Age of Empires developers or publisher.
