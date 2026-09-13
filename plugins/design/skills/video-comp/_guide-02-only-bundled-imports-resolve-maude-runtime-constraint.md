## Only bundled imports resolve (Maude runtime constraint)

A canvas can `import` ONLY from the packages Maude pre-bundles — an unbundled
specifier fails to resolve on an end-user install (no `node_modules`). For
video-comps that means:

- `@maude/canvas-lib` — `DesignCanvas`, `DCSection`, `DCArtboard`, **`VideoComp`**.
- `remotion` — `useCurrentFrame`, `useVideoConfig`, `interpolate`, `spring`,
  `Easing`, `random`, `AbsoluteFill`, `Sequence`, `Series`, `Loop`, `Freeze`,
  `Img`, `staticFile`, `interpolateColors`.
  **Never `Audio` or `OffthreadVideo` from here** — see "Audio in exports" below.
- `@remotion/media` — **`<Video>` AND `<Audio>`**, the audio-capable media
  elements. These are the only media elements the export path can render (see
  "Audio in exports" below — this is not a preference, an export of a comp using
  `remotion`'s versions loses its audio).
- `@remotion/transitions` — `TransitionSeries`, `linearTiming`, `springTiming`.
- Transition **presentations** (each a separate import): `@remotion/transitions/fade`,
  `/slide`, `/wipe`, `/flip`, `/clock-wipe`, `/none`. (Exotic presentations like
  `dreamy-zoom` are NOT bundled in v1 — stick to these six.)

Do **not** import `@remotion/renderer`, `@remotion/web-renderer`, or any other
`@remotion/*` — they aren't bundled and aren't needed (export is the capture
spine).
