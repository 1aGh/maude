# P8 stage C round 2 · C2-inspector (rest) + C3-timeline (rest) + C4-export (rest) — done vs open

Branch `p8-c2-insptl` (from feat/maude-v2 3fd7b1658). Budget stop at ~250k tokens, so this is the user-visible subset; the open list is at the bottom. Pairs for 07 / 08 / 09 were re-shot light + dark with the stage-A harness (`t07/t08/t09.mjs`, retargeted; scratch, not committed) on this branch's release client and overwrite the committed pairs. Nothing is marked "matches" — the lead's critic re-check decides.

## Done (commits)

| commit | what | tests (red → green) |
|---|---|---|
| 37c362740 | 08 ak-video / 07 VideoInspector: **Length** is the kit's number well with the clock (`.insp-ro--well`), **Sound** is the fill pill (green object swatch + name; "None yet" stays the quiet note). 14 Editing `ISeg`: **Combine shapes** are four icon segments (`.seg` / `.k-seg-b`, the board's own union / subtract / intersect / exclude glyphs, name for AT), dim for one object | `kind-inspector-rows` (Length well, Sound pill), `v2-inspector-path` (Combine icons) — both red on the old text buttons |
| 4ceb78cd4 (**shared app.jsx**, one line) | 07 ve-text: "+ Title" selects the clip `insert-sequence` returned (`stableId`), so the Title inspector is what opens next | `p8-c2-insptl` source pin |
| e62dc6a35 + follow-up | 07 ve-transition: **no preview slab** — each tile's picture is the two real shots, hover/focus plays the join inside the tile; **tip** on the join's dot; **roving radiogroup** (one tab stop on the lit tile, ← ↑ → ↓ move, focus plays); "Remove transition (hard cut)" stays (note 26: nothing deleted) but is no longer underlined or wrapped. 07 ve-advanced: the island **grows** past the dragged height instead of spilling (`minHeight` while Advanced is open, CSS cap at the window), the tracks keep a 112 px floor, cards scroll inside, **Copy timecode** (`.tla-btn`) is the kit's quiet button (appearance / border / font reset). 07 ve-play: the scrub bar needs a clip that has **played** (a poster-frame seek no longer counts as started) | `timeline-clip-select` (3 tests rewritten to the board: no slab / stills in tiles / roving tabindex + arrows / hover plays inside the tile), `video-play-chrome` (red on `frame > 0`), `p8-c2-insptl` CSS pins |
| 522b2b5df (**shared route tables**) | 09 patch request: `POST /_api/export-preview {spec}` → one `thumb()` per artboard the spec reaches (≤ 24, card size, `visible`), through the same `gateSpecV2` as the estimate (ungranted canvases are not in the answer); export class (Can view refused); writer-registry `local`, `_acl-route-classes`, `_role-refusals`, `workspace-mode` entries; `http.ts` wires `thumb` lazily | `export-preview.test.ts` (4) |
| 26f79f0d4 | 09 ex-batch: batch kind rows draw a **stack of up to three artboard stills** in place of the icon tile (`usePictures`: asked only for a batch, re-asked while a picture is pending) | `p8-c2-insptl` (`stillsOf`, wiring pins) |

Verified: `tsc --noEmit` clean, biome clean on the touched files. Lane runs: see the hand-back (the lane was held by a 60-minute full suite for the whole session; results are listed there).

## 08 artboard × theme (this branch)
| id | light | dark |
|---|---|---|
| ak-video | board-fixed/fixed: Length well + clock, Sound note, timeline body (C3); still differs: inspector opens collapsed with the timeline up in this harness (the dock toggle, not the card) | same |
| ak-advanced | frame shows the fold open at the card's foot (Theme / Clip content / Kind); the board's Exact size / Resolution / Colour / Guides / In code rows are NOT in the fixture's fold → still differs | same |
| ak-convert / -after | unreachable: the harness's `insp-ab-preset` option match no longer lands (the select is the kit Select) — product exists | same |
| ak-mixed-select | not re-driven (see open 4) | same |
| ak-web-hug, ak-web-widths, ak-social, ak-safe-zones, ak-print-letak, ak-warnings | unchanged by this round (wave-1 state stands) | same |

## 07 (light + dark re-shot: ve-select, ve-play, ve-transition, ve-advanced, ve-text, ve-captions, ve-music, ve-formats, ve-reframe, …)
- ve-transition: fixed (no slab, tile pictures, tip, keyboard); the tile pictures are black in the fixture because its footage is missing ("Missing — no device has it") — with real clips they are the two stills.
- ve-advanced: fixed (contained, tracks stay, Copy timecode quiet). The board's floating Render settings / Easing / Cut-as-code islands stay a deliberate lift into the foot (note 26).
- ve-play: scrub bar only after play (code); the harness frame is the paused poster state.
- ve-text: + Title now selects the clip (code); the Title inspector grid itself (`title-rows.jsx`) was not re-checked live.
- unreachable (spec only, no stub): ve-ai-cut / ve-ai-watch / ve-ai-scrub / ve-ai-proposal / ve-ai-adjust / ve-render / ve-together / ve-fit-fill (need a replayable AI-cut run / a second peer / a render job); ve-drop not re-shot.

## 09 (light + dark re-shot)
- ex-batch / ex-batch-pick / ex-huge: kind rows now carry the artboard stills (live, from the real route).
- ex-progress / ex-states / ex-handoff-ready / ex-edges: still unreachable (no stub built).
- everything else: as the wave-1 table in `09-export/fix-export.md`.

## Open (not done) — in the order I would take them
1. **Photo inspector for readable-name images** (08 / 03 / 12 `ia-photo-*`): proposed split, own task "photo edits keyed by asset id". The photo pipeline matches `assets/<sha8>.<ext>` in five places (`dom-selection.ts:553-569`, `inspect.ts:312`, `canvas-lib.tsx:3607-3650`, `api.ts` photo-edit/`image-edit` source check, bg-remove harness). Two options for the contract: (a) a name→sha map served read-only (`GET /_api/asset-ids`) so the client keys by sha while showing the name; (b) widen the matcher to any file under `assets/` that resolves inside the design root and sniffs as an image (security review needed: the matcher is the write-path allowlist). Not picked here.
2. Export, picture-dependent rest: filmstrip clip stills + names (server `StripClip` has no names; stills would come from the media `#t=` frame the timeline already uses), format-tile pictures (the new route returns one per artboard — the tiles only need to read `usePictures`), Advanced field content (Paper, GIF colours, Long videos, Frame rate, Bitrate, Codec, exact scale, FOGRA), Inspector/Exports panel bits, `ex-history` header folder button.
3. Unreachable stubs ex-progress / ex-states / ex-handoff-ready / ex-edges: a Playwright `page.route` override of `GET /_api/export-jobs` / `/_api/export-estimate` in `t09.mjs` — not written.
4. 14 finer rows: W/H + Clip on web (08 wins: not drawn), constraint diagram, free-placement tip card, Align tile, instance Variant chips, Padding token chip, "Tokens it uses" chips in Advanced; **Combine on several shapes is still disabled** (no boolean-ops engine behind `shape.combine.*` was checked); multi-artboard values (Preset "Story 9:16", X/Y Mixed, swatches); crop-mode inspector; video inspector Sound pct / volume.
5. ak-convert: fix the harness step (select the A6 option through the kit Select), ak-mixed-select: re-drive after Esc.
6. Transition picker: tile pictures fall back to flat colours only when a clip has NO media; a clip whose file is missing draws a black `<video>` — should use the flat fallback on `error`.
7. Release-bundle note: shots were taken on a locally built `dist/` that is reverted, not committed.

## Decisions
- `decision:maude/v2-p8-c2r2-tiles-are-the-preview`: the transition picker has no separate preview slab; hover plays inside the tile's own two shots (board 07: "the tiles are the preview"). Rejected: keeping the slab and restyling it (the critic's blocker), a canvas-side preview.
- `decision:maude/v2-p8-c2r2-export-preview-route`: pictures for the export sheet come from a new export-class route over the existing thumb service (artboard stills only), not from the canvas bridge capture. Rejected: widening `/_api/thumbs/want` (answers nothing by design, L14), per-artboard GET routes.
- `decision:maude/v2-p8-c2r2-advanced-grows-the-island`: Advanced open turns the dragged height into a floor (`minHeight`) capped at the window; cards scroll inside. Rejected: a fixed island height with the tracks collapsing (the old behaviour).
- `decision:maude/v2-p8-c2r2-photo-by-asset-id-split`: not built here — two contract options listed above for the lead to choose.
