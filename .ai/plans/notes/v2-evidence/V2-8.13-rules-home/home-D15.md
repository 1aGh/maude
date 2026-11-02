# Timeline: AI clip Generate ✨, ClipInspector (Speed, Audio, Crop, Grade, Text, Transition), transport (Loop, Mute, Volume, comp picker), clip context menu (~17 items) — home `G0-D/D15` (V2-8.13)

Gate 0 §D "every v1 feature keeps a home" — `.ai/plans/feature-maude-v2-redesign.md` G0-D table, row D15.

## Nothing-deleted map (`apps/studio/client/v2/nothing-deleted.json`)
- row `D15` · action `-` · testid `timeline-inspector`
- where: Open a video canvas → Timeline (⇧⌘T) › click a clip: its inspector (Speed, Audio, Crop, Grade, Text, Transition); the clip’s right-click menu keeps all 17 rows (until S7)
- v1 entry points mapped to this row: 125
- reachability.json (headless boot per shell, probe pass 2026-10-25T23:27:36.802Z): reachable — per shell desktop: ok: video-timeline · browser: ok: video-timeline · cloud-owner: n/a · cloud-member: n/a · cloud-viewer: n/a · viewer: n/a · embed: n/a
- `node scripts/check-v2-nothing-deleted.mjs` on this tip: 100 % (all 144 rows, 1569 entry points, 453 kept actions/hooks)

## Tests that pin it (green on the tip)
- `apps/studio/test/clip-inspector-rows.test.ts` — the clip inspector rows (Speed, Audio, Crop, Grade, Text, Transition)
- `apps/studio/test/timeline-clip-select.test.tsx` — selecting a clip opens its inspector
