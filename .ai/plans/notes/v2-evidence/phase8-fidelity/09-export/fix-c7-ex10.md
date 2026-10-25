# 09 Export — round 7 (p8-c7-ex10): done / open

Checklist: `critic-bar2.md` MUST rows. Verification: fail-first tests below (revert-checked where marked), tsc + biome, release rebuild, re-shoot with the round-7 harness (`.scr/g3`: `t09`, plus `ho`, `vid`, `adv` scenarios).

## Done

| id | what | tests |
|---|---|---|
| ex-video, ex-offline | the filmstrip is the cut: each clip is the frame it starts on (`getStillsAt`, one video load per source), its name on a chip (Sequence `name`, else the file's name), a title lane from the text a clip carries, the music bed with its name; full width under the rows (board), playhead kept. `StripClip` gains `name` / `src` / `at` / `title` (estimate rows, server reads `enumerateClips` once more for titles) | `video-export-content.test.ts` (names, src, title), `v2-export-video.test.tsx` (clip names / title lane / music) |
| ex-video, ex-offline | the In the cloud / On this Mac cards were there but the local harness never had a cloud door: harness `vid.mjs` answers the estimate with `render.cloud` (the sheet's own client code draws them) | — (harness) |
| ex-video | Sound / Captions notes sat BELOW their control: `.ex-row-n` (later in `export.css`) overrode `.ex-row-n--in`'s `flex-basis`; `.ex-row-n.ex-row-n--in` | existing video sheet tests |
| ex-advanced | Advanced › Video gains **GIF colours** (a real spec field `options.video.gifColors` 2–256 → engine `gifColors`; live only for a GIF export, disabled otherwise) and **Long videos** ("Up to 3,600 frames", the cap); Advanced › Print gains **Paper** ("Same as artboard"). Harness `adv.mjs`: mixed selection, tall window (the whole fold in frame), exact scale typed 2.5 | `export-spec-v2.test.ts`, `p8-c7-ex10-advanced.test.tsx` |
| ex-handoff | a canvas's handoff offers Web, App, Lottie only (the Design tokens row is the design system's own); the review line is the sheet's hint pill with a done glyph; harness gives the canvas a design system (`Use the design system` + sub line), a planted last review (`_runs/…/design-critic-1.in.json`, no blockers) and "Last used" (localStorage) | `handoff-v2.test.ts`, `v2-handoff-sheet.test.tsx` |
| ex-handoff-edges | the connect step is its own card: the sheet title is hidden, no Claude Pro/Max row, the board's title and body line ("Handoff to production has AI write the code…"); the inline sheet's `position: absolute` (AI island) is static inside the handoff sheet (the body was empty) | `v2-handoff-sheet.test.tsx` |

## Open (09)

- Include row (folder checks) on Whole project (ex-huge): needs a project-scope folder filter in the spec (`exclude` of top-level folders) + the estimate's folder list — a spec field and a server resolve change; not started. The "Project ZIP instead" link colour is unchanged.
- ex-canvas / ex-batch-pick / ex-batch kind-row selections, ex-print-warn in-sheet warnings (headless measure), ex-history populated rows + header folder button + top-bar Exports icon, ex-progress / ex-states seeded jobs with names and thumbnails — harness / product work not started (budget).
- Handoff sheet "sub line" lists the canvas's artboards on the board ("Desktop, Tablet, Mobile · Studio design system"); the product line is the design system only.
