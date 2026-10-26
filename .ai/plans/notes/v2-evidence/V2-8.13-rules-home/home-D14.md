# Figma token Test, transcription engines (whisper.cpp / Scribe / Groq), keyframe engines (Gemma / ffmpeg / Blind), Generate model select + Generate/Insert — home `G0-D/D14` (V2-8.13)

Gate 0 §D "every v1 feature keeps a home" — `.ai/plans/feature-maude-v2-redesign.md` G0-D table, row D14.

## Nothing-deleted map (`apps/studio/client/v2/nothing-deleted.json`)
- row `D14` · action `-` · testid `settings-transcription-engine`
- where: Settings › Connections › Figma › Test connection (figma-test); full selects in Settings › Advanced › Engines (settings-transcription-engine, settings-keyframe-engine); Generate model select + Generate/Insert stay in the AI chat Generate mode (12)
- v1 entry points mapped to this row: 3
- reachability.json (headless boot per shell, probe pass 2026-10-25T23:27:36.802Z): reachable — per shell desktop: ok: settings-advanced · browser: ok: settings-advanced · cloud-owner: n/a · cloud-member: n/a · cloud-viewer: n/a · viewer: n/a · embed: n/a
- `node scripts/check-v2-nothing-deleted.mjs` on this tip: 100 % (all 144 rows, 1569 entry points, 453 kept actions/hooks)

## Tests that pin it (green on the tip)
- `apps/studio/test/v2-settings.test.tsx` — Settings › Advanced: transcription and keyframe engine selects (settings-transcription-engine)
- `apps/studio/test/v2-s11-13-advanced.test.tsx` — the full selects (whisper.cpp / Scribe / Groq, Gemma / ffmpeg / Blind)
