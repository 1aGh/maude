# Design video plugin — command categories

> Catalog of the opt-in `design-video` plugin (#156 §4, [DDR-249](../../.ai/archive/decisions/DDR-249-design-video-plugin-split.md)). It adds video to the `design` plugin and needs it: install `design` first. The Maude desktop app's AI chat loads both. Naming follows `plugins/design/CATEGORIES.md` (bare `name:`, Claude Code adds the `design-video:` namespace).

## Groups

### daily — Verb-as-complete-action

| Command | Description |
|---|---|
| `/design-video:reel` | From a folder of raw clips (or the active canvas's clips) to a directed, graphics-laden video cut in one prompt — ingest → SHARED analysis step (same as `/design-video:video-analyze`: smart-frames → optional transcribe → Read-only footage-analyst → orchestrator persists) → footage-director (EDL) → `<TransitionSeries>` codegen → critics; skills `footage-keyframes` + `footage-director` + `video-comp` |
| `/design-video:video-analyze` | Analyze ONE clip (or folder / active canvas) end to end — picture AND sound — in one prompt: scene-aware keyframes (skill `footage-keyframes`) + `transcribe` → footage-analyst → FootageAnalysis sidecar (incl. `speech`) + human report. Analysis-only (vs `/design-video:reel`, which cuts) |
| `/design-video:to-lottie` | Productionize a maude animation → ONE `.lottie` from code (web + mobile, 1:1; emitter, not converter) |

## Skills

| Skill | What it teaches |
|---|---|
| `video-comp` | Author and export editable Remotion video canvases (determinism, the bundled imports, timeline metadata, captions, beats, takes) |
| `footage-director` | The FootageAnalysis + EDL artifacts and the `<TransitionSeries>` codegen behind `/design-video:reel` |
| `footage-keyframes` | Scene-aware keyframe extraction for footage analysis |
| `video-generation` | The video part of BYOK generation (Veo, image-to-video, composing generated media into a reel); the key rule and the procedure stay in `design:ai-generation` + `/design:generate` |

## Agents (NOT user-invocable)

| Agent | Spawned by | What it does |
|---|---|---|
| `footage-analyst` | `/design-video:reel`, `/design-video:video-analyze` (per clip, fanned out) | Read-only, egress-free vision pass over one clip's keyframes → a `FootageAnalysis` verdict (DDR-183 F2). The design plugin's hooks hold it to no shell and no write outside the design root. |
| `footage-director` | `/design-video:reel` only | Bounded writer of one `<slug>.edl.json`; runs only on a hand-off, and only `maude design check` (the design plugin's hooks enforce both). |

Spawn them as `design-video:footage-analyst` / `design-video:footage-director`.

## Rename history

| Old | New | When | Why |
|---|---|---|---|
| `/design:reel`, `/design:video-analyze`, `/design:to-lottie` | `/design-video:reel`, `/design-video:video-analyze`, `/design-video:to-lottie` | 2.1 | Split out of `design` (#156 §4, DDR-249) |
| skills `design:video-comp`, `design:footage-director`, `design:footage-keyframes` | `design-video:video-comp`, `design-video:footage-director`, `design-video:footage-keyframes` | 2.1 | same |
| agents `design:footage-analyst`, `design:footage-director` | `design-video:footage-analyst`, `design-video:footage-director` | 2.1 | same |
