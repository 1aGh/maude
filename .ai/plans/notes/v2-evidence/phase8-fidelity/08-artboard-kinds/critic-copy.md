# copy-critic — 08 Artboard Kinds · phase 8 stage B

_2026-10-22 · board `.design/ui/v2/08 Artboard Kinds.tsx` · impl frames `.claude/worktrees/agent-af625ef88bd36c798/.scr/impl/08/` · voice: CONTRACT §3–§4, kind words Fixed size · Web page · Print · Video (C16) · strings reviewed ≈ 260_

**Themes.** Copy does not change with the theme. Every light frame was read, and ak-print-letak-dark was spot-checked (same strings), so each row covers **L·D**.
**Fixture.** Names like Matchday, `Zápas · post 4:5`, `Nábor · web` and `A · přední (FLAG)`, plus a 304×540 story (not a preset), "Uses project" and empty Recent, all come from the fixture. They are not findings.

## TL;DR

**Blockers: 7** (5 in-lens + 2 unreachable) · Warnings: 17 · Verdict: **fix-and-retry**

The picker, the safe zones, the print rows, the warnings and the label mark all say what the board says, nearly word for word. The gaps are elsewhere:
- Every artboard kind gets a **Layout › Content "Page flow"** row. No board has that word, and it contradicts "place things anywhere" on a Fixed size artboard.
- The **video label carries no length**.
- **Clip names fork.** The block says "Clip 1" while its row shows a hash.
- **Layers shows raw DOM** (`div`, `div.__remotion-player`, `img`).

## Per artboard (L·D)

| id | difference | spec (board) | impl | owner | sev |
|---|---|---|---|---|---|
| ak-picker | ✓ search `Search sizes — “A5”, “story”, “1920”` · groups App/Web page/Social/Print/Video · badges `Fixed size` / `Grows as you add` / `mm, with bleed` / `Has a timeline` · `All 4 / All 6 / All 7` · tiles + sizes · `Or press F and drag to draw any size.` Recent row is empty in a fresh profile (fixture; `kinds/SizePicker.jsx:463`) | | | `kinds/size-picker-model.js:20-24` | ✓ |
| ak-picker-full | ✓ `Fewer` · `Custom size…` / `mm, any bleed` · ghost `A2 420 × 594 mm`. Custom island copy matches in code (`Custom print size`, `Add artboard`, "…drawn 3 mm larger on every side so colour can run past the cut") | | | `size-picker-model.js:24,180`, `SizePicker.jsx:243-246` | ✓ |
| ak-web-hug | layout row word | `Layout: Top to bottom` | `Layout › Content: Page flow` (also on Fixed size, Print and Video artboards) | `client/v2/inspector/kinds/artboard-model.js:27`, `artboard.jsx:8` | blocker |
| ak-web-hug | fill row | `Fill: White` | section `Fill`, row `Background: None` | `inspector/kinds/artboard.jsx:38` | warning |
| ak-web-hug | Other widths control | button `Add a width` | select `Add a width…` | `inspector/kinds/artboard-web.jsx:49-52` | warning |
| ak-web-hug | ✓ `Width: Tablet · 834` · `Fits content / Fixed` · `1002 now — grows as you add.` | | | `artboard-web.jsx` | — |
| ak-web-hug | panel words not on the board | inspector card: title + kind chip | tabs `Inspector · Photo` (Photo on a web page) + × | `client/v2/inspector/inspector-panel.jsx` | warning |
| ak-web-hug | growth tag `+ 373 px` and section label `Rozpis zápasů · new section` not captured (no section was added) | | | — | warning (unverified) |
| ak-web-widths | not driven. The copy exists: toast `Tablet and Mobile are beside Desktop. Their layout reflowed to fit.` · Undo, plus warning `… wider than Mobile.` · `Fit to width` | | | `artboard-web.jsx:5`, `apps/studio/kinds/warnings.ts:50` | warning (unverified) |
| ak-social | W/H row label repeats | `Size: Story 9:16 (still)` then an unlabelled W/H row | `Size: Custom` then `Size: W 304 H 540` (Custom is the fixture's size) | `inspector/kinds/artboard-fixed.jsx` | warning |
| ak-social | safe-zone note when Safe zones = None | the note sits in the platform menu's foot | `Shown on the canvas only — never exported. Zones as each platform publishes them, checked Oct 2026.` is always shown | `inspector/sections/safe-zones.jsx` | warning |
| ak-social | Export `1× · PNG` + `Export 1 file` vs the board's `PNG · 1×` button. This follows 09 ex-inspector + C21 (08 supplies the default presets), so it isn't a finding | | | `export/inspector-export.jsx` | — |
| ak-safe-zones | ✓ bands `Profile and progress bar` / `Reply bar`, flag `Under the reply bar` (same rule as the board's `Under the caption`), caption `Profile and progress bar on top, reply bar below.`, `Show on canvas`, platform list complete | | | `apps/studio/kinds/safe-zones.ts:72-109` | ✓ |
| ak-print-letak | ✓ Paper · Size in mm · Orientation · Bleed · Safe margin · Print guides · `RGB — the print shop converts to CMYK.` · `Print PDF` · warning `1 px wider than A6 with bleed (419 × 581).` + `Fix size` (one verb) | | | `inspector/kinds/artboard-print.jsx` | — |
| ak-print-letak | Paper value | `A6` | `A6 · 105 × 148 mm` (repeats the next row) | `artboard-print.jsx` | warning |
| ak-print-letak | menu path written without `Menu ›` (§1) | `Menu › View › Advanced › Print guides` (Note 8) | `Follows View › Advanced › Print guides.` | `artboard-print.jsx:209` | warning |
| ak-print-letak | unit order | `3 mm`, `5 mm` | unit prefix `mm 3`, `mm 5` | `artboard-print.jsx` (mm field) | warning |
| ak-print-view | Menu › View › Advanced › `✓ Print guides` wasn't opened (palette used) | | | — | warning (unverified) |
| ak-video | length missing from the label | `Hype trailer · Reels · 0:15` ("Duration on the label") | `Hype trailer · 16:9` + `480 × 270` | `apps/studio/editing/artboard-handles.tsx:252-257` | blocker |
| ak-video | one clip, two names, both meaningless | clip named by content | block `Clip 1`, row label `0fce5…` (hash) | `client/v2/timeline/Timeline.jsx:105-113` vs `:2248,2514` | blocker |
| ak-video | shared timeline header/tools/tracks: same findings as 07 (no name, `30 fps · 90f`, `0.00s`, `×`, 6 tools, `Frames, keyframes…`, total `0:02` vs `0:03`) | 07 `_video.tsx` Timeline | | `Timeline.jsx` (see 07 report) | blocker (1, shared) |
| ak-video | track rows | Text · Graphics · Video · Music | `Text · Graphics · Video 2 · Video`, no Music. Video 2 follows C35 migration, but the empty `Video` row under it reads as a bug | `timeline/tracks.js:19`, `Timeline.jsx:2299` | warning |
| ak-mixed-fit | Layers lists raw DOM nodes | artboard rows only (`Arch 1 · vnějšek …`) | `div` · `div` · `div.__remotion-player` · `div` · `img` · `div` under Hype trailer | `client/v2/layers/artboard-layers.jsx:11-13` (draws the v1 tree unchanged) → `client/tree/tree.jsx` | blocker |
| ak-mixed-fit | Fixed size count | post + story count as `Fixed size` | chip `▯ 0`; the post and story carry the web glyph and are counted in `▭ 3` (also in Canvases: `0 · 6`). Verify the fixture's `kind` before fixing | `kinds/LayersKindFilter.jsx`, `kinds/kind-filter-model.js` | warning |
| ak-mixed-fit | the Print-chip state wasn't reached: footer `19 other artboards are dimmed. Show all` unverified | | | `kinds/LayersKindFilter.jsx` | warning (unverified) |
| ak-mixed-filter | ✓ `Matchday 2 of 6`, `Print 2 of 2`, `2 of 13 canvases have print. A canvas counts once under each kind it has.`; no folder line (root canvases) | | | `kinds/kind-filter-model.js` | — |
| ak-mixed-select | the 2-kind inspector wasn't reached. ⌘A gave `3 objects` (context bar). Code copy: `2 artboards` · `2 kinds` · Kinds · Horizontal · Vertical | `2 artboards · 2 kinds`, `Size and paper differ. Select one to change it.`, `2 files…` | `3 objects` | `inspector/kinds/artboard-multi.jsx:1-60` | warning (unverified) |
| ak-warnings | ✓ shape: label mark, one inspector row, one verb; tooltip `1 thing to check` (`kinds/warnings.ts:156`) | | | | — |
| ak-warnings | over-cap line wording | `2:40 long — one export goes up to 2 min (3600 frames at 30 fps).` | `<label> is 2:40 long — one export goes up to 2:00 (3,600 frames at 30 fps).` Impl matches CONTRACT C22 "3,600"; the board is stale on the grouping | `export/sections/video-copy.js` `overCapLine` | warning |
| ak-advanced | fold not opened (click missed). Headings match in code: Exact size · Resolution · Colour · Guides · Look and layout · In code. The plain rows above it follow ak-print-letak, not the board's `Paper A6 · Portrait` / `Bleed · margin` (the board disagrees with itself) | | | `inspector/kinds/artboard-print-advanced.jsx:48-170` | warning |
| ak-real-print | ✓ `A · přední (FLAG) ⚠ 105 × 148 mm` (content is the fixture) | | | | ✓ |
| ak-real-web | ✓ fixture page; label `Nábor · web` | | | | ✓ |

## Unreachable (missing state → blocker each)

| id | what makes it reachable |
|---|---|
| ak-convert | Pick `A6 · 105 × 148 mm` from a Fixed size artboard's Size select in the lane. This is a harness gap: match the option by label. `kinds/ConvertDialog.jsx` holds the dialog (`Make “…” an A6 print?` / `Make A6 print` / `Check after` / `Keep the post; make the A6 from a copy`). Verify the title verb = button verb. |
| ak-convert-after | Depends on ak-convert: the toast `The A6 copy is beside the post. The post is unchanged.` · Undo and the two inspector warnings (`Replace…`, `Show`). |
| ak-real-about | Not an app state (a board note). Not a finding. |

## Root causes (hit several artboards)

1. **One artboard inspector body for every kind.** Fill › Background plus Layout › Content `Page flow` / Padding / Gap appear on web, fixed size, print and video (`inspector/kinds/artboard.jsx`). "Page flow" is on no board.
2. **The video artboard label never gets its length.** The size tag only knows px/mm (`editing/artboard-handles.tsx:252`).
3. **Timeline row labels skip `displayNameOf`** (`Timeline.jsx:2248,2514`). This is shared with 07.
4. **Layers renders the v1 element tree under the artboard row**, so DOM tag/class names appear as layer names.

## Verdict

```json
{"canvas":"08 Artboard Kinds","critic":"copy-critic","blockers":7,"warnings":17,"verified_ids":["ak-picker·light","ak-picker·dark","ak-picker-full·light","ak-picker-full·dark","ak-safe-zones·light","ak-safe-zones·dark","ak-real-print·light","ak-real-print·dark","ak-real-web·light","ak-real-web·dark"]}
```
