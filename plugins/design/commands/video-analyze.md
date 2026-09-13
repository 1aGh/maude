---
name: video-analyze
category: daily
description: "Analyze video picture and sound using scene-aware keyframes and audio transcription."
argument-hint: "<clip|folder> [--from-canvas] [--engine auto|gemma|ffmpeg|blind] [--frames N] [--no-audio] [--out <path>]"
---

# /design:video-analyze — one clip → visual + audio metadata, one prompt

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Understand a video the way an editor would: **what happens on screen AND what is
said**, distilled into structured metadata + a plain-language summary. This is the
analysis front-half — it does NOT cut anything (that's `/design:reel`). The heavy
lifting lives in skill **`footage-keyframes`** (frame selection) + `maude design
transcribe` (audio) + the **`footage-analyst`** agent (the watching); this command
just wires them together for one clip in one go.

## Step 0 — Resolve the source

- `<clip>` — a path or `assets/<sha8>.<ext>`. If it's a loose file not yet in the
  project, ingest it first: `maude design ingest-footage <path> --root "$REPO"`
  (content-addresses it into `assets/`).
- `<folder>` — analyze every video clip in it (fan out Step 2, capped 3–4 concurrent).
- `--from-canvas` — analyze the clips on the active canvas (read `_active.json`).

Resolve `REPO` (`$CLAUDE_PROJECT_DIR`/cwd) and `PORT` (`PORT=$(maude design server-up --root "$REPO")`)
— a dev server is needed for the footage-analyst's `PUT /_api/footage` write.

## Step 1 — Extract scene-aware keyframes

For each clip (DDR-062 — always through `maude`):

```bash
maude design smart-frames "assets/<sha8>.<ext>" --root "$REPO" --frames "${FRAMES:-12}" \
  ${ENGINE:+--engine "$ENGINE"} --out-dir "$TMPDIR/va-<sha8>"
```

Prints the manifest (`method`, `sceneCuts[]`, `scoutBeats[]`, `frames[]`). `--engine`
defaults to `auto` (gemma → ffmpeg → blind by what's installed); `--frames` caps the
set. This is the whole reason picture analysis is sharp — the frames land on real
shot boundaries and action beats, not a blind interval.

## Step 2 — Transcribe the audio (unless `--no-audio`)

```bash
maude design transcribe --source "assets/<sha8>.<ext>" --root "$REPO" --format srt --segments
```

Local whisper.cpp by default (free, offline); cloud STT if configured. Capture the
transcript text/path as `TRANSCRIPT`. If the clip has no audio track, or `--no-audio`
is passed, skip this step and note "no audio".

## Step 3 — Analyze (this is the SHARED analysis step `/design:reel` also uses)

This is the one **analyze-a-clip** workflow in the design plugin — `/design:reel`
drives the exact same three sub-steps (extract → optional transcribe → watch → persist)
for its Step 2, so there is no duplicate analysis flow. The security boundary
(DDR-183 F2) lives here: **the orchestrator owns all I/O; the `footage-analyst`
subagent is Read-only and egress-free** — it watches the frames and RETURNS JSON, it
never runs a command or writes a file. So the untrusted transcript + imagery reach an
agent that has no way to act on them.

Per clip (fan out, capped 3–4 concurrent), spawn the watch-only analyst with the frames
you already extracted (Step 1) + the transcript you already produced (Step 2):

```
Task tool → subagent_type: "design:footage-analyst"
prompt: "ASSET=assets/<sha8>.<ext>  DURATION=<durationSec>
         FRAMES=<the manifest frames[] — each {t, png} path, in order>
         SCOUT=<sceneCuts[] + scoutBeats[] from the manifest, advisory>
         TRANSCRIPT=<whisper text, or omit for a vision-only run>
         BRIEF=\"<brief verbatim, optional>\".
         Read the frames in t-order and RETURN the full FootageAnalysis JSON
         (with a `speech` field iff a TRANSCRIPT was given). Do not write anything."
```

**Then the ORCHESTRATOR persists it** (the analyst has no network): take the returned
JSON and `PUT /_api/footage?asset=<sha8>` (loopback route; it validates + stamps the
`assets/<sha8>.footage.json` sidecar). A non-200 = the JSON failed validation — fix the
offending field and retry. Preserve an existing `ai-generated` provenance stub's tag.

**Cache:** skip a clip whose `assets/<sha8>.footage.json` already holds a usable shot
**and** (when audio was requested) a `speech` field — re-running analyzes nothing new.

### Step 3.5 — Record the footage node (kgai — when active)

The sidecar lands via `PUT /_api/footage` (a **server write**), so kgai's edit-tool Stop hook does NOT catch it — record it explicitly at the command boundary. Load **`flow:kgai-backend`**; when `maude kg resolve --json` is `active`, ingest a content-addressed `footage:<sha8>` node (deterministic id converges across machines):

```bash
echo '{"decision":{"title":"Footage: <sha8>","rationale":"<summary>","date":"<YYYY-MM-DD>","mutations":[{"op":"upsert_element","kind":"footage","name":"<sha8>","props":{"summary":"<summary>","tags":"<tags>"}},{"op":"add_link","from":"footage:<sha8>","to":"asset:<sha8>","link":"FROM"}]}}' | maude kg ingest --root "$CLAUDE_PROJECT_DIR"
```

Skip silently when inactive. *(Follow-up, option-b: emit this server-side from `apps/studio/footage-store.ts` `saveAnalysis` so UI-driven writes are covered too — deferred as a dev-server change needing packaged-app validation.)*

## Step 4 — Report

Print a human "what is this about" summary per clip, pulled from the sidecar:

- **TL;DR** — the `summary` (what the clip is + best editorial use).
- **Shots** — `shots[]` with times, type, subject, on-screen text, quality, usable.
- **Audio** — the `speech` field (or "no audio / not transcribed").
- **Best moment** — the strongest `usable` shot range.
- Note the extraction `method` (gemma / ffmpeg / blind) so the user knows which tier ran.

Write the report to `--out <path>` if given, else print inline. The sidecar
(`assets/<sha8>.footage.json`, versioned) is the machine-readable source of truth.

## Notes

- Frame-selection tiers, env knobs, and the manifest schema are owned by skill
  **`footage-keyframes`** — don't re-derive them here.
- Audio quality is engine-independent; transcription is a separate, unchanged step
  (skill/verb `transcribe`).
- This command is analysis-only. To turn analyzed footage into an edited cut, use
  `/design:reel`.
