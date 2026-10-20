# Genie Replay Lab

[Open the progress dashboard](https://cmsautter.github.io/genie-progress/)

Reproducible progress measurements for [GenieRust](https://github.com/librematch/genie), an independent reimplementation of the Age of Empires II: Definitive Edition engine.

## Two corpus views

* **Fixed reference:** a frozen set of **5,604 unique recordings**. This is the default view for comparing engine revisions.
* **Growing corpus:** newly discovered eligible recordings, with membership frozen independently for each test run. New games enter the next snapshot.

The initial reference targets full internal build **158041**, public game version **101.103.26969.0**, using matching game data. Every run identifies its upstream engine commit, diagnostic instrumentation, toolchain, architecture, data fingerprints and replay hashes.

## What is measured

Recordings start from their saved headers. The simulation stops at its first reported unsupported condition, differing recorded checkpoint, resource limit or recording end. The dashboard shows ticks reached, progress distributions, first blockers and changes on identical reference recordings.

Completed recordings with matching usable checkpoints are separate from recordings without checkpoints. These checkpoints contain partial state checksums; matching them does not establish complete equality of every simulation field or tick. Ignored commands, parse errors, multiple chapters, timeouts and process failures remain visible.

### Checkpoint mismatch categories

The dashboard distinguishes object positions, combined resources, live object counts, actions/unit AI and the other recorded checks. The category overview counts affected recordings; selecting a category filters the table. Expand a mismatch to see the affected players, zero-based checkpoint words, and recorded versus simulated values. A recording can fail several checks. These aggregate checks help locate the differing state without establishing its exact cause.

The same categories appear in the stopping-summary JSON, with a `checkpoint_word` field. [Checkpoint definitions](https://cmsautter.github.io/genie-progress/checkpoint-checks.json) describe each word for build 158041 and link to the engine implementation. Unknown words, other builds and older reports without details remain explicitly identified. Full report JSON retains the original numeric differences.

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
| [manifest.json](https://cmsautter.github.io/genie-progress/manifest.json) | Available runs, summaries and engine commits. |

The three full-report URLs return the original per-run JSON with `run`, `identity` and `rows`, including recording IDs, SHA256 hashes, outcomes and checkpoint counts. They update with each publication; deployment and caching can add delay. Diagnostic pilots and superseded worker continuations are excluded. `latest.json` can also describe a build or setup failure, so check `run.status` before using its results. Completed URLs become available after the first completed run. Running URLs return HTTP 404 when the published snapshot has no unfinished run; they never fall back to completed results.

Stopping summaries contain `run` metadata, the `source_report` path and separate `fixed` and `growing` views. Each view has corpus totals, outcome counts and a `reasons` array sorted by affected recording count. Entries include `status`, the reported `reason`, `count`, `percent_of_stopped` and up to five example recording IDs. Checkpoint mismatches and input or execution errors are included alongside unsupported mechanics. Counts are deduplicated within each condition; one recording can report several conditions at its first stopping point, so counts can overlap. Completed recordings, including those without checkpoints, are not counted as stopped. The same summaries are also available without the `.json` suffix, for example `/latest-stopping-simulation`; the `.json` URLs use the JSON content type.

Simulated lists contain compact `run` metadata, `source_report`, `scope`, `count` and `rows`. They select every row with `status == "complete"` across the growing corpus; `fixed` identifies members of the frozen reference. Each entry includes `match_id`, `sha256`, game build, ticks reached, `checkpoints_passed`, `total_checkpoints`, the last matching checkpoint tick and ignored command count. Zero-checkpoint recordings are retained as `0/0`; reaching the end does not establish verified correctness. Rows are sorted by matching checkpoint count descending, then recording ID. These lists also work without `.json`. An available run with no completed recordings returns `count: 0` and an empty `rows` array.

For a reproducible reference, use `run.id` from either report to construct `data/<run.id>.json`. To identify recordings that reached the end with recorded checkpoints matching, select rows with `status == "complete"`, `total_checkpoints > 0` and `checkpoints_passed == total_checkpoints`. Rows without usable checkpoints remain separate, and `ignored_commands_to_stop` records any ignored commands.

## Repository contents

This repository contains the static dashboard and its report-deployment workflow. Sanitized report snapshots are available in the **Benchmark report snapshots** prerelease. The worker implementation is maintained separately.

Proprietary game assets, replay payloads, local configuration and credentials are not published here.

Independent community project. Not affiliated with the Age of Empires developers or publisher.
