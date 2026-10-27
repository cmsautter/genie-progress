# Scout and goat replay investigation

[Interactive report](index.html#shared-scene) · [SpriteScout MP4](scene/scout-goat-genie.mp4) · [GIF](scene/scout-goat-genie.gif) · [Screenshot](scene/poster.webp)

Replay **430217696**, SHA256 `c861f2bcd7cf450b6bffa824376b2c5f91983ce6193d3fdbc397587b851a9766`, historical game build **158041 / 26969**, Genie revision **a6cea327dc4a20ec6f47c7a9d9846140763a51f8**.

The first compared player-object difference appears at zero-based after-update index **829**, **13,156 ms**, on player 2 scout **3031**. Goat **3250** first differs at index **839**, **13,286 ms**. Their position-checksum contributions at checkpoint 999 are **+40** and **−3**, exactly explaining recorded/original **187548** versus Genie **187585**. All compared player-object fields match through index 828. The shared scene includes 15 nearby objects; spatial proximity does not prove causal involvement. Collision/bumping behavior is a hypothesis, not an established root cause.

The comparison covers 999 supported updates. The original game supplied verified mTLS gRPC states; their timestamps align exactly with the independently parsed recording timeline. Full raw captures remain local. This case describes the named historical engine revision and does not claim the current engine still has the same issue.

Compared fields: owner, master, lifecycle state, HP, held amount, X/Y/Z, sleeping flag. Float comparison uses exact f32 bits. Player owners 1 and 2 are compared; original-game dopple entities are excluded. Gaia cliff representation differences are reported separately. Actions and AI are context fields. A checkpoint at index N compares the state after index N−1.

[Scene provenance](scene/README.md), [JSON evidence](report.json), [resources](resources.json), [per-frame differences](differences.jsonl.gz), and [hash provenance](provenance.json) are available alongside the report. Personal machine paths have been removed from this public copy. Replay files, raw game-state captures, game data files and credentials are not included.

The page has no inbound link from the dashboard and requests `noindex` from search engines. It remains public and may be shared by URL or discovered through repository history. It is not access-controlled.
