## Provider capability map (v1)

| Modality | Provider (BYOK, direct) | Model | Shape | Notes |
|---|---|---|---|---|
| **Image** | Google **Nano Banana** | `gemini-2.5-flash-image` (default), `gemini-3-pro-image-preview` (Pro) | **sync** — base64 in one call | gen + **maskless edit** (via `--source`) + text-in-image. Aspects: `1:1 2:3 3:2 3:4 4:3 4:5 5:4 9:16 16:9` (+ `21:9` Pro). |
| **Audio** | **ElevenLabs** | Music (`/v1/music`) · SFX (`/v1/sound-generation`) · TTS (`eleven_v3`) · Scribe STT | **sync** — mp3 in one call | one key covers the whole stack. `maude design generate --modality audio --kind music\|sfx\|tts` (`tts` needs `--voice`). Lands `assets/<sha8>.mp3`. |
| **Subtitles** | **user-chosen** engine — local **whisper.cpp** (default) · ElevenLabs Scribe · Groq | `large-v3-turbo` (local) | local free/no-key, or cloud w/ key | `maude design transcribe --source <asset> [--provider whisper\|elevenlabs\|groq]` → word-timestamped SRT/VTT. The engine is an **explicit choice, never an auto-fallback** (Task 2.6): `--provider` wins, else the project's `generation.transcription.provider` config, else whisper — and a chosen-but-unavailable engine errors clearly (it never silently runs another). Cloud engines write `assets/<sha8>.srt` next to the source (same as local). |
| **Video** | Google **Veo 3.1** | — | — | in the opt-in **design-video** plugin: load `Skill design-video:video-generation`. |

Direct BYOK only — **no aggregator** (owner decision 2026-07-11): the user brings their own direct-provider key. Image = Nano Banana; audio = ElevenLabs. There is no FLUX/Recraft/Ideogram/fal breadth in v1.

**Reuse audio before you pay for it (Task 2.5 — AUDIO ONLY).** Before generating **music or SFX** (opt-in for VO), run `maude design audio-search --query "<what you need>" --root "$REPO"` first: it searches the project's own generated audio (intent sidecars) **and** the user's ElevenLabs history (re-downloadable for **no credit** — already paid) and returns ranked matches. Prefer a good match over spending credits; re-download a history hit with `--reuse <historyId>` (lands `assets/<sha8>.mp3`, no new charge). On the **interactive** path surface it as a choice ("reuse this existing track, or generate fresh?"); on the **proactive/agent** path (Phase 4) reuse-first is the default — search before proposing a paid generation. **Images are explicitly OUT** — cheap, single-use, already reusable straight from `assets/`; no image cache.

**Compose into a reel:** generated clips, music beds, voiceover and captions in a reel are the design-video plugin's (`Skill design-video:video-generation`).
