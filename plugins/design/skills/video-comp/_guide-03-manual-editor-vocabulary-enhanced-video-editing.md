## Manual-editor vocabulary (enhanced-video-editing)

The Timeline's manual editor and the agent door speak the same per-clip props —
when authoring or editing a comp, use exactly these spellings so the
two-tokenizer contract (`enumerateClips` display + `timeline-parse.js`) holds:

- **Speed**: `playbackRate={2}` on the media element (`<Video>`/`<Audio>`, both
  from `@remotion/media`).
  The clip's `durationInFrames` = source frames ÷ rate. No speed ramps.
- **In-point**: `trimBefore={N}` on the media element (source frames; `startFrom`
  is the legacy spelling — read both, always EMIT `trimBefore`).
- **Per-clip audio**: bare `muted`, `volume={0.6}` (constants only in v1).
- **Grade**: ONE CSS filter chain on the media element's literal style —
  `style={{ filter: 'brightness(1.1) saturate(1.3)' }}`. Deterministic in the
  Player and both export paths; never a sidecar.
- **Crop/reposition**: the `data-mframe="scale,x,y"` wrapper (outer
  `overflow:hidden` div + inner `transform: scale() translate()` div) — keep it
  intact; the engine round-trips it losslessly.
- **AI placeholder**: `<AIPlaceholder prompt={"…"} kind="veo|motion|image" durationInFrames={N} />`
  from `@maude/canvas-lib` — a prompt-carrying slate clip the generation spine
  resolves in place. The prompt is USER TEXT: always the JSON-stringified
  quoted-expression form, never a template literal.
- **Storyline container**: series membership is what makes clips butt
  magnetically and accept seam transitions — greenfield comps and assembled
  reels use `<TransitionSeries>` beats (hard cuts between adjacent beats are
  valid; transitions are optional per seam).
