---
name: footage-keyframes
description: "Extract scene-aware video keyframes for footage analysis, including cuts, action and edit decisions."
---

# footage-keyframes — understand the video's dynamics, extract only the frames that matter

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Blind frame-rate sampling is the problem this skill exists to fix. `probe-footage`
pulls N evenly-spaced frames; a sub-interval shot (a <0.25 s action flash before an
interview, a quick cut) falls **between** samples and is lost — the analyzer then
can't see that beat and either misses or hallucinates it. Raising the frame rate
blindly just inflates cost without guaranteeing the *right* frames land.

`maude design smart-frames` selects frames by the video's **real dynamics**:
scene cuts + semantic action beats + the true first & last frame. Fewer, meaningful
frames → sharper analysis at lower cost.

## The three tiers (auto-detected, each a graceful fallback)

| Tier | How it picks frames | Needs | When |
| ---- | ------------------- | ----- | ---- |
| **`gemma`** | Gemma **scout** watches the video and flags action beats that are *not* hard cuts (a snap, a run, a reveal inside one continuous shot), merged with ffmpeg scene cuts. Two interchangeable runtimes: **mlx-vlm** (preferred — native video input, Apple Silicon, the benchmarked path) or **Ollama** (simplest install — a gemma3 vision model; frames are sampled by ffmpeg and sent as timestamped images). | ffmpeg **+** (mlx-vlm + a Gemma-4 MLX model, *or* Ollama + `gemma3:4b`+) | opt-in; richest — catches beats inside continuous shots |
| **`ffmpeg`** | ffmpeg content scene-detection + endpoints + long-shot midpoints. | ffmpeg | **the default** when ffmpeg is present; cross-platform, no model download |
| **`blind`** | delegates to `probe-footage` (headless Chromium, even-spaced). | Chromium (already shipped) | the floor — so extraction always works even with neither ffmpeg nor Gemma |

`--engine auto` (default) probes availability and degrades **gemma → ffmpeg → blind**.
An explicit `--engine X` forces a tier and **errors if its deps are missing** — Maude
never silently downgrades an engine the user asked for by name (mirrors the
transcription-engine posture).

**No model, no problem.** The whole point of the tiering: a user who doesn't want to
download a multi-GB Gemma model (or isn't on Apple Silicon) gets the `ffmpeg` tier —
still scene-aware, just without the semantic-beat layer. A user with nothing gets the
`blind` floor. The Gemma scout is a bonus, never a requirement.

## Contract — `maude design smart-frames`

```sh
maude design smart-frames <asset> [--root <repo>] [--out-dir DIR] [--frames N]
                          [--engine auto|gemma|ffmpeg|blind]
                          [--scene-thresh 0.3] [--scout-fps 4]
```

- `<asset>` — a content-addressed `assets/<sha8>.<ext>` (production) **or** any readable
  clip path (terminal power-user analysis of an arbitrary file). The `ffmpeg`/`gemma`
  tiers accept both; the `blind` tier delegates to `probe-footage`, which requires the
  content-addressed form.
- stdout on success = a JSON **manifest** (a strict SUPERSET of `probe-footage`'s, so
  it's a drop-in for the footage-analyst):

```jsonc
{ "asset": "assets/<sha8>.mp4", "durationSec": 8.0, "width": 1280, "height": 720,
  "method": "ffmpeg",                       // which tier actually ran
  "scout": null,                            // "mlx" | "ollama" when the gemma scout contributed beats
  "sceneCuts": [0.233, 6.533],              // ffmpeg scene-detect (empty in blind)
  "scoutBeats": [{ "t": 6.9, "what": "run play" }],  // gemma only (empty otherwise)
  "outDir": "/tmp/smart-frames-…",
  "frames": [ { "index": 1, "t": 0.0, "png": "…/f_01.png" }, … ] }
```

Consumers read `frames[]` (index + source-time `t` + PNG path) exactly as they read
`probe-footage`'s; `method` / `sceneCuts` / `scoutBeats` are additive hints.

- Exit: `0` ok · `2` usage / asset-not-found · `3` a forced engine's deps are missing
  · `4` decode/extract error · `1` other.

## Env knobs

| Env | Default | Effect |
| --- | ------- | ------ |
| `MAUDE_SMARTFRAMES_ENGINE` | `auto` | tier override (same as `--engine`) |
| `SCENE_THRESH` (`--scene-thresh`) | `0.3` | ffmpeg scene-cut sensitivity (lower = more cuts) |
| `SCOUT_FPS` (`--scout-fps`) | `4` | Gemma scout native sampling density |
| `--frames` / `--max-frames` | `12` | hard cap on extracted frames |
| `MAUDE_MLX_PYTHON` | auto (Maude venv → PATH) | a Python that can `import mlx_vlm` (gemma tier, mlx runtime) |
| `MAUDE_GEMMA_MODEL` | `mlx-community/gemma-4-e4b-it-4bit` | the scout model (mlx runtime) |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | the Ollama server (gemma tier, ollama runtime). **Loopback-only** — a non-loopback value is refused, never uploaded to (the footage pipeline is egress-free by design, DDR-183) |
| `MAUDE_OLLAMA_MODEL` | auto (first vision-capable `gemma3:*` tag) | the scout model (ollama runtime; `gemma3:1b` and `gemma3n` are text-only and skipped) |

## Two front doors, one engine

- **Maude Studio Settings** → the "Scene-aware keyframes" section persists the engine
  choice (`keyframeEngine`) and offers a one-click Gemma-model download (like the
  Subtitles / whisper section). App-served runs honor that pref.
- **Terminal / power users** → `--engine auto` **self-detects deps** with no app or
  config, so `maude design smart-frames <clip>` is a standalone terminal video
  analyzer. Neither path requires the other; an explicit `--engine` always wins.

## Consumers (who references this skill)

- **`/design:video-analyze`** — the canonical one-shot analysis: the orchestrator runs
  `smart-frames` + `maude design transcribe`, the Read-only `footage-analyst` watches
  the smart frames (with the transcript folded in) and returns JSON, the orchestrator
  persists it → a combined **visual + audio** metadata report.
- **`/design:reel`** — runs the **same** shared analysis step (no duplicate workflow)
  before the director/codegen phase.
- **`footage-analyst`** agent — consumes the `frames[]` this skill produces; it's
  Read-only/egress-free (DDR-183 F2), so the orchestrator runs `smart-frames`, not the
  agent.
- **`scripts/video-benchmark/`** — the harness this pipeline was proven in; this skill
  is its productionized form.

## Related

- `maude design transcribe` (skill/verb) — the audio half (whisper.cpp local / cloud STT).
  Audio quality is engine-independent, so transcription is a separate, unchanged step.
- Implementation: `apps/studio/bin/smart-frames.sh` → `_smart-frames.mjs` (pure JS;
  runs under node or bun). Manifest superset of `apps/studio/bin/_probe-footage-playwright.mjs`.
