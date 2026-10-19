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

The original historical baseline used local diagnostic instrumentation and is labeled separately. New results are produced by a background benchmark worker and published as static JSON reports. The website does not run game code in visitors' browsers.

## Repository contents

This repository contains the static dashboard and its report-deployment workflow. Sanitized report snapshots are available in the **Benchmark report snapshots** prerelease. The worker implementation is maintained separately.

Proprietary game assets, replay payloads, local configuration and credentials are not published here.

Independent community project. Not affiliated with the Age of Empires developers or publisher.
