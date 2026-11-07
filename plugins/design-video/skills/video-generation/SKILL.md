---
name: video-generation
description: "Generate a video clip from the person's own Veo key and compose generated clips, music and captions into a reel."
---

# video-generation — the video part of BYOK media generation

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

This is the video half of Maude's BYOK media route; images and sound stay in the design plugin. **Load `Skill design:ai-generation` first**: it holds the rule you must never break (the agent is never handed a key), the prompt conventions, assets-only localization and the prompt-injection posture, and `/design:generate` is the one procedure for every modality. This skill adds only what is different for video. Architecture + trust boundary: [DDR-164](../../../../.ai/archive/decisions/DDR-164-byok-ai-media-generation-provider-adapter-spine.md).

## Provider

| Modality | Provider (BYOK, direct) | Model | Shape | Notes |
|---|---|---|---|---|
| **Video** | Google **Veo 3.1** | via Gemini API (`veo-3.1-generate-preview`) | **async** — poll (~1–10 min), job queue | native synced audio + **image-to-video** (`--source <still>`). `maude design generate --modality video --provider gemini`. Lands `assets/<sha8>.mp4`. |

## Generate a clip

Run `/design:generate` with `--modality video` (provider `gemini`). `--source <asset>` seeds image-to-video from a still, so a generated clip matches a generated hero's style. The verb waits for the job, and a clip can take up to 10 minutes: pass `--timeout`, and say so before you send, together with whose account pays (the person's own key) and the licence line below. Paid generation runs only on the person's request or after they confirmed a proposed slot.

## Compose into a reel

- **Audio (Phase 2):** generated music, SFX and voiceover become `Edl.audioTracks[]` (layered: duck the music bed under VO with a negative `gainDb`), and transcribed subtitles become the `Edl.captions` track. The footage-director codegen renders both (`<Audio>` + a frame-driven caption overlay). Audio rides the `renderMediaOnWeb` export path; captions survive the frame-step fallback too.
- **Video (Phase 3):** a generated clip is a **first-class footage clip**. It lands as `assets/<sha8>.mp4`, and the generate route drops a provenance `assets/<sha8>.footage.json` stub next to it (the `ai-generated` tag + the prompt as the summary), so `/design-video:reel` treats it exactly like ingested footage: the `design-video:footage-analyst` watches it, then the `design-video:footage-director` places it as an `Edl.beats[].clip`. Use it to **fill a coverage gap** ("no clip for this beat — generate one?"); `/design-video:reel` Step 1.5 is the flow.

## Licence

- **Video (Veo):** the provider's terms and any watermark apply. Surface that line before the call; the clip then carries **Made by AI** in Assets, with the prompt, the provider and the licence line under its details.
- Never build on **OpenAI Sora 2** (API sunset).
