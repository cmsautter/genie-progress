# SpriteScout scene rendering

[Back to report](../index.html#shared-scene) · [MP4](scout-goat-genie.mp4) · [GIF](scout-goat-genie.gif) · [Screenshot](poster.webp) · [Exact scene data](scene.json.gz)

Real SpriteScout / MonoGame rendering of the report's pinned Genie states: **a6cea327dc4a20ec6f47c7a9d9846140763a51f8**. Every exported position was checked against the verified Genie trace. A read-only observer supplies appearance without changing gameplay state or drawing gameplay RNG. The current SpriteScout helper supplies the original map/catalog and DAT-derived type metadata; its simulated positions are not used in the clip.

The MP4 runs **8.7 seconds**, **960×540**, **30 fps**, silent, at half speed. It covers game time **10,998–15,340 ms**. The GIF is **480×270**, 8 fps. The screenshot shows index **829**, **13,156 ms**. Scout 3031, goat 3250, nearby goat 3248 and the town-centre area are visible with a fixed zoomed camera. IDs, time, index and onset cues are annotations. The source sprites and positions are unaltered. No position interpolation is used.

The interactive scene includes 15 nearby objects and every native update in its **10,010–15,353 ms** window. DAT footprint guides show extents; they do not reconstruct the exact contact solver or adjusted clearances. At index 829, scout/goat centres are **0.4903338 tiles** apart in Genie versus **0.5051177** in the original game. The cause is still under investigation.

The renderer uses SpriteScout's normal scene/branch rendering. Appearance is presentation, not an independent verification of every original-engine graphics field. Static facets fall back to zero where the observer lacks a retained facet.

[Media/renderer hashes](provenance.json), [source-position verification](render-source-validation.json), and [video parameters](video-validation.json) retain supporting evidence. Machine-specific reproduction paths were removed for publication. The original full captures and build workspace remain local.
