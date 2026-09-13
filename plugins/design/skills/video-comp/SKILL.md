---
name: video-comp
description: "Author and export editable Remotion video canvases with deterministic motion, media, audio and timeline metadata."
---

# video-comp

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Motion must be a deterministic function of frame and fps. Use bundled imports, local assets and editable timeline metadata; audio/video elements use the documented media components. Preserve export checks, reduced-motion handling where applicable, licensing and verification across time. A still frame is insufficient proof of animation.

## Read only the relevant procedure

The references below retain the complete procedure. Read the entry for the stage
before performing it; conditional examples, setup and troubleshooting load only
when needed. A staged workflow follows its applicable stages in order, including
verification and close-out. References to another section mean the matching row
here, not permission to skip that requirement. Do not read all references at once.

| When | Read |
| --- | --- |
| Initial orientation, prerequisites and scope | [Overview](./_guide-00-overview.md) |
| When performing this stage: The determinism iron law (non-negotiable) | [The determinism iron law (non-negotiable)](./_guide-01-the-determinism-iron-law-non-negotiable.md) |
| When performing this stage: Only bundled imports resolve (Maude runtime constraint) | [Only bundled imports resolve (Maude runtime constraint)](./_guide-02-only-bundled-imports-resolve-maude-runtime-constraint.md) |
| When choosing the corresponding schema or element types | [Manual-editor vocabulary (enhanced-video-editing)](./_guide-03-manual-editor-vocabulary-enhanced-video-editing.md) |
| When performing this stage: The `<VideoComp>` wrapper + comp meta | [The `<VideoComp>` wrapper + comp meta](./_guide-04-the-videocomp-wrapper-comp-meta.md) |
| When choosing the corresponding schema or element types | [Vocabulary: sequences, series, transitions, media](./_guide-05-vocabulary-sequences-series-transitions-media.md) |
| When previewing or exporting the composition | [Audio in exports: BOTH `<Video>` and `<Audio>` come from `@remotion/media`](./_guide-06-audio-in-exports-both-video-and-audio-come-from-remotio.md) |
| When performing this stage: Make it hand-editable (DDR-150 — so the user can tweak it on the Timeline) | [Make it hand-editable (DDR-150 — so the user can tweak it on the Timeline)](./_guide-07-make-it-hand-editable-ddr-150-so-the-user-can-tweak-it-.md) |
| When performing this stage: Assets: `assets/` only, no network | [Assets: `assets/` only, no network](./_guide-08-assets-assets-only-no-network.md) |
| When the task needs a worked implementation example | [Worked example — join 4 clips + crossfades + a music bed](./_guide-09-worked-example-join-4-clips-crossfades-a-music-bed.md) |
| When previewing or exporting the composition | [Preview + export](./_guide-10-preview-export.md) |
| When adding effects or motion graphics | [Pushing it — VFX & motion graphics (all frame-driven)](./_guide-11-pushing-it-vfx-motion-graphics-all-frame-driven.md) |
| When previewing or exporting the composition | [Export cost & reliability (learned the hard way — 2026-07-10 dogfood)](./_guide-12-export-cost-reliability-learned-the-hard-way-2026-07-10.md) |
| Before reporting results or handing off | [Verify motion over time — freeze-frames lie (DDR-094)](./_guide-13-verify-motion-over-time-freeze-frames-lie-ddr-094.md) |
| When performing this stage: License note (surface once to the user) | [License note (surface once to the user)](./_guide-14-license-note-surface-once-to-the-user.md) |
