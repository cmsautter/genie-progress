# Scout and goats — replay 430356142

[Interactive scene](index.html#shared-scene) · [SpriteScout video](scene/scout-goats-genie.mp4) · [Onset GIF](scene/scout-goats-genie.gif) · [Screenshot](scene/poster.webp)

Replay SHA256: `056a76f1caa6c3f295910eefd988a38aa3598b55342b4e310c2cdb085c078b97`. Genie revision: `a6cea327dc4a20ec6f47c7a9d9846140763a51f8`. Original game: internal build **158041**, UI **26969**. This is a historical investigation, not a current-engine regression claim.

| Object | Owner | First differing update index | Game time | Compared difference |
| --- | ---: | ---: | ---: | --- |
| 9585 SCOUT | 6 | 290 | 10,504 ms | X/Y position |
| 34792 GOAT | 6 | 291 | 10,532 ms | X/Y position |
| 34795 GOAT | 6 | 317 | 11,260 ms | Y, then X position |
| 34793 GOAT | 6 | 330 | 11,624 ms | X/Y position |

All compared player-object fields match through index **289**. The nearby goat **34794** and villager **9572** remain visible as context. The full shared scene contains **13 nearby objects**, selected by proximity during its time window. Nearby membership is not proof of causal involvement. Collision/bumping remains a hypothesis.

At index 290 the scout and goat 34792 are **0.506274 tiles apart in Genie** and **0.476494 in the original**. Genie holds the scout at its preceding position while the original advances it. The goats' differences follow at the indices above. DAT footprint guides show approximate extents, not the complete contact solver or adjusted clearances.

At checkpoint **499**, player 6's position sum is **437995 recorded/original** versus **437939 Genie**. Contributions (Genie minus original): scout 9585 **−158**, goat 34792 **+54**, goat 34793 **+3**, goat 34795 **+45**. Their sum is **−56**, exactly explaining the mismatch. The other seven players' position checks match. All four player resources also match throughout the compared horizon.

All **1,493 original-game updates** through **46,321 ms** were captured with exact timestamp coverage and zero skipped steps. The Genie comparison covers the **499 supported updates**, ending at **16,094 ms**, before the checkpoint's associated update to 16,119 ms. Raw replay and gRPC files remain local.

Indices are zero-based after-update states. Compared fields: owner, master, lifecycle state, HP, held amount, X/Y/Z and sleeping flag, for all eight non-Gaia players. Floats use exact f32 bits. Original-game dopple entities are excluded. Actions and AI remain context. No unsupported state is exported.

[Object evidence](report.json) · [Resources](resources.json) · [Every compared frame](differences.jsonl.gz) · [Provenance](provenance.json) · [Scene evidence](scene/scene.json.gz) · [Rendering details](scene/README.md).

The self-contained interactive payloads are losslessly compressed. A modern browser with `DecompressionStream` support is required; evidence downloads remain available independently. The page is unlinked from dashboard navigation and requests `noindex`. It is public, not access-controlled. Local paths and credentials are excluded.
