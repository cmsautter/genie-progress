# SpriteScout rendering and scene evidence

[Report](../index.html#shared-scene) · [MP4](scout-goats-genie.mp4) · [GIF](scout-goats-genie.gif) · [Onset screenshot](poster.webp) · [Exact per-update scene](scene.json.gz)

The clip uses **real SpriteScout/MonoGame rendering** and installed historical game artwork. Its positions come from the report's exact **a6cea327** Genie simulation. Every exported position was checked against the verified report trace; the engine core is byte-identical to its pinned source. A copied read-only SpriteScout appearance observer consumes no gameplay RNG. The currently bundled helper supplies only initial map/catalog and DAT-derived type metadata, not the simulated positions.

The MP4 is **11.03 seconds**, **960×600**, **30 fps**, silent, approximately **half-speed**. It selects exact after-update states across game time **8,499–13,983 ms**, with a fixed zoomed camera and no position interpolation. The screenshot selects source frame 121, exactly recorded index **290**, **10,504 ms**. The public GIF is a **5-second** loop focused on the onset (video 2.5–7.5 seconds), **480×300**, **8 fps**. A higher-resolution full-length GIF is retained locally.

Visible labelled actors: scout **9585**, goats **34792**, **34793**, **34794**, **34795**, and villager **9572**. Unit labels, timestamps, recorded indices and onset cues are annotations. The report's interactive scene includes 13 nearby units/scenery objects across all **246 recorded updates** from **8,024–14,497 ms**. The normal scene contains the town centre and trees too.

The observer and SpriteScout's normal branch renderer are used for presentation. Static facets fall back to zero when no retained facet is available. Appearance is not independently compared with the original game's graphics. The original report's numerical simulation evidence is unchanged. DAT extents are footprint guides and do not establish the exact collision solver or root cause.

[Position/source validation](render-source-validation.json), [video parameters](video-validation.json), and [source/media hashes](provenance.json) preserve reproducibility evidence. Numerical data and embedded payloads are losslessly compressed for delivery. Video/GIF/poster are re-encoded for web delivery; the local source frames and full-quality media remain retained.

The local diagnostic workspace retains native exporter source and licensing notices, the render host source/project, metadata, raw scene snapshots, 331 PNG render frames, and the encoding/build scripts. No game assets, raw replay, credentials or machine paths are included in this public page.
