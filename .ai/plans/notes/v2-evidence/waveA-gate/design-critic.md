# design-critic — wave-A gate (canvases 03 · 04 · 11 · 14 · 15)

_2026-10-19 · read-only review · opt_out_scope: palette (full DS enforcement) · evidence: verifier screenshots under `.ai/plans/notes/v2-evidence/` (all taken in the dark theme, browser lane, Chromium 1440–1600 wide). Light theme and the Tauri lane were not shown by any verifier._

Evidence base is older than HEAD for several rows. Where a later commit claims the fix I say **(fix claimed, not re-shot)** and still count it, because the gate can only score what a picture proves. Reviewed against: `.design/system/maude-v2/{README,CONTRACT §3–§5,colors_and_type.css}` and canvas sources `.design/ui/v2/{03,04,11,14,15}*.tsx` + `_kit.css`. I could not render the canvases (no server booted, to keep the tree and `dist/` untouched), so "what the canvas draws" comes from canvas source, the S3.14 side-by-side composites and the verifier notes.

## TL;DR

| Area | Canvas | Package | Score | Gate (≥ 4.0) |
| --- | --- | --- | --- | --- |
| AI chat | 03 | S5 | **3.6** | fail |
| Modes & Present | 04 | S3 | **3.9** | fail (just) |
| Navigation & history | 11 | S1 | **4.0** | pass (no blockers; 7 warnings) |
| Editing | 14 | S2 | **3.4** | fail |
| Annotations | 15 | S4 | **3.5** | fail |

**Blockers: 8 · Warnings: 29 · Verdict: fix-and-retry.**
The new shell chrome (project pill and menu, Canvases panel, search, trash, Version history, Present bar, share cluster) is faithful and on-token. What drags 03/14/15 down is **v1 chrome that was never retired and still renders next to it**: mono, near-black, hard-coded menus and tags (`canvas-lib.tsx`, `context-menu.tsx`, `3-shell-maude.css`), one dead CSS class, and a few v1 strings that name "Claude". Three of the eight blockers are the same two root causes, so the fix list is shorter than it looks.

### Root causes worth fixing once (they hit several areas)
- **RC1, v1 artboard header + context menu.** `canvas-lib.tsx:476-486` (`.dc-artboard-label`: mono 10 px, uppercase, `letter-spacing .06em`, a filled strip *inside* the artboard that scales with zoom) and `context-menu.tsx:204` + `3-shell-maude.css:6291` (`.dc-context-menu`: mono 12 px, hard-coded `--maude-chrome-*` oklch values, near-black, not the island material). Canvas draws a constant 11 px sans label above the artboard that turns into an azure pill when selected (`_kit.css:427-451`) and sans island menus. Hits 14 (B1, B2), 15 (B2), 04 and 11 (warnings).
- **RC2, dead class `island--pad`.** No CSS rule exists anywhere for it; used by `v2/inspect/inspect-panel.jsx:124` and `v2/export/exports-panel.jsx`. Hits 04 (B1).
- **RC3, v1 buttons/segments with no font.** `.st-cp-segbtn` (`3-shell-maude.css:3638`) sets no `font`, so the UA button font (~15 px) wins. Hits 14 (B3).

---

## 03 AI chat — 3.6

Layers: Task 4 (ask, ring, tag, Undo/Keep going read in 2 s) · IA 4 · States 3.5 (working/done/permission/not-ready/fail all drawn; point ring + dividers landed after the last shot) · Interaction 3.5 (needs-you "Open" fixed in `eda71f9ba`, not re-shot) · Microcopy 3 (v1 strings leak) · Parity n/a (native-only, lane stubbed) · A11y 4.

**Blockers**
1. **[ds · microcopy]** `S5.V2/ai-working.jpg`, `S5.V3/ai-chat-list.jpg`: a top banner reads "Claude (Maude chat) is editing this canvas — your changes may conflict". CONTRACT §3: it is "AI", never "Claude"; §4: the app never names itself. It also duplicates the canvas ring + "AI is working" tag that 03 draws as the one signal. Source: `apps/studio/ai-banner.tsx:189` (+ `participants-chrome.tsx`). Fix: suppress for the panel's own run, and reword to "AI is editing this canvas" for a terminal agent.
2. **[ds · microcopy]** Every panel screenshot: a v1 status row "● Ready · Claude Code" / "Working… · Claude Code" under the header (mono, green status dot). Canvas 03 draws no such row (the working state is the ring + panel line + Stop). It names "Claude" in the panel and spends the status-green on a non-status. `client/v2/ai/Feed.jsx:407-420` (`StatusRow`, `.chat-statusrow-cc`). Fix: drop it, or keep only the working line.
3. **[ds-status]** `S5.V3/ai-permission.jpg`, `S4.V3/an-ai-read.png`: "Not now" is red `btn--danger` text. 03 draws it as a plain `btn btn--sm` (`03 AI Chat.tsx:123, 232`); error-red on a dismiss reads as destructive, and README says error hue 22 must never sit near the spark unpaired. Files: `v2/ai/PermissionCard.jsx:125`, `OfferCard.jsx:147`, `Consent.jsx:50`. Fix: drop `btn--danger`.

**Warnings**
- **[ux]** Chat is squeezed when the Inspector is open: it stacks under it as a ~250 px island and the feed shows ~100 px (`S5.V2/ai-done.jpg`, `S5.V3/ai-copy-divider.jpg`). 03 draws the full-height column. Suspect: right-column layout in the shell, not the panel.
- **[ux]** Version history AI row: "Made by AI" chip sits beside the title and truncates it; Compare / Undo this chat / Restore this version are three cramped buttons on one line (`S5.V3/ai-history.jpg`). Row sub shows the artboard id ("landing"), not its label.
- **[microcopy]** Slash menu rows are alphabetical manifest strings cut mid-word ("Read a whiteboard or creat…", "Open the local Maude ca…") rather than 03's plain notes (verifier nit; `/design:*` verbs themselves are fine in mono).
- **[ds]** Advanced shows "Ask before" above "Model" (verifier nit, canvas order differs). Fine for backed-only blocks (known default).
- **[ux]** Fix claimed after the last shots, not re-shot: "Run on a copy" divider/placement (`6e10a0233`, `142caaa55`), day dividers + Before/After + Compare (`8779321b7`), question point ring (`7d0a14068`), no follow-up chips after a failed run (`72ebb178b`), needs-you Open switching canvas (`eda71f9ba`). Re-shoot before closing.
- **[ux]** After a failed run, "Retry" and the failure card are right; the green dot in the status row (B2) contradicts a failed state.

Not raised (recorded defaults): Always-for-this-canvas box, backed-only Advanced.

## 04 Modes & Present — 3.9

Layers: Task 4.5 (Edit ⇄ Preview ⇄ Present is obvious; "Previewing Site · esc to edit" bar is exact) · IA 4 · States 4 (Present video/mixed/web scroll verified) · Interaction 4 (esc rungs, link chip clear of tag after S3.15) · Microcopy 4.5 (Apple key order verified, menu words exact) · A11y 4. This is the strongest area: the project menu, Present menu, Present bar and Preview bar match the canvas.

**Blockers**
1. **[ds · ux]** `S3.V3/md-esc.v4-inspected.png` (Inspect panel after ⌘-click): rows and group titles are flush against the panel's left edge (no inner padding), the label column wraps and truncates ("Gap to Three plans. No surpris…"), the title sits 6 px under the top-right cluster, and colours show a raw `#111111` where 04 draws a token/swatch row. Cause: the panel uses `island island--pad`, and `island--pad` has no rule anywhere (RC2). Files: `client/v2/inspect/inspect-panel.jsx:124`, `inspect.css` (add the pad; widen the label column; swatch + name for colour). The same dead class makes `exports-panel.jsx` flush too.

**Warnings**
- **[ds · icons]** Preview toolbar is a small monochrome strip (~34 px buttons) (`S3.V2/md-annotate.png`); 04's drawn Preview toolbar is the 48 px / 22 px-glyph bar with object colours (sticky disc, marker ink, stamp) per README "Preview toolbar may carry the object colours" (S3.14 `md-preview.png`, left vs right). Allowed, not required, but it is the visible difference between Edit and Preview that 04 leans on. Source: `apps/studio/toolbars/`.
- **[ds-typography]** Selection tag "Pricing · 1200 × 56" and "1200 × 56" size tag are mono azure (`md-esc.v4-inspected.png`), plus RC1's mono artboard header "PRICING" in Preview. 04 uses sans.
- **[ux]** Verified rows left U: Present menu "in a cloud project" row, presenter view, link, viewer, offline, Can-comment (stub only: toolbar shows Hand, canvas draws Hand + Comment) need the desktop/hub lane.
- **[ux]** md-comment still the v1 composer (wave B, known); native Tauri accelerator strings untested.
- **[ux]** Preview-toolbar and artboard-menu parity with 15 is untested for light theme.

## 11 Navigation & history — 4.0 (pass, with warnings)

Layers: Task 4.5 · IA 4.5 (Canvases tree, counts, Pinned, folders-on-top sort, 21-artboard jump list "21 artboards · 19 digital, 2 print") · States 4 (trash, empty-trash dialog "Clear out the trash?", rename refusal in place with a suggestion) · Interaction 4 (drag + "Move here", ↵/esc rename hint) · Microcopy 4.5 (toast "“Test2” moved to the trash." + Undo; "Nothing called…" voice) · A11y 4.

**Blockers:** none. (The earlier S1.V finds, Sort menu clipped, rename refusal in a non-contract voice, stale foot counts, Viewing bar under the cluster, compare stage under the left panel, are fixed in the V2/V3 shots.)

**Warnings**
- **[ds · IA]** Version-history rows are mostly blank dark squares (`S1.V2/pn-history-viewing.png`): only the baseline row has a real picture; canvas 18 is titled "Versions with pictures". Trash and search canvas rows are the same (wave-B thumb renderer, known default); I list it once because it is the largest visible gap against 11's pictures.
- **[ux]** "Now" row: "Now" is centred over a 3-line wrapped title ("Combine-letak-registrace · Saved") with "Name this version…" jammed on the right when a version is selected (`pn-history-viewing.png`); canvas keeps it a single quiet row. `client/v2/history/history.css`.
- **[ux]** Compare: B pane shows the first artboard plus a sliver of the next, not fit-to-pane (`pn-compare.png`); the A caption "A · Moved “Leták · přední” to the trash · 19 Oct…" is clipped by the onboarding toast and runs under the left panel's edge. `history/compare-view.jsx`.
- **[ds-typography]** "Move “…” to" popover header is mono, uppercase, `fg-3`: `v2/canvases/move-sheet.jsx:48` uses `.st-dd-hd` (`3-shell-maude.css:106`), a v1 header. Canvas shows no such header; CONTRACT §5 panel titles are `--type-xs` semibold `fg-2`, sans (`pn-move-menu.png`).
- **[ds-typography]** RC1 artboard header "COMBINE · KAMPAN" etc. is mono uppercase on every canvas in these shots (`pn-jump.png`).
- **[ux]** Keyboard sheet "Finding a canvas": canvas lists "Open project… ⌘O" (desktop only) and a Tabs-and-windows group: desktop lane, not shown.
- **[ux]** Row decorations: orange "M" badge on rows (`pn-move-drag.png`) is a v1 marker with no counterpart in 11; check it is meant to survive.

Not raised: S10 design-system rows ("maude", "maude-v2" vs "Design system · Alligators brand system"), Home (S6), tab strip (desktop).

## 14 Editing — 3.4

Layers: Task 4 (select, enter a frame, resize, tidy, pen, shape all work) · IA 3.5 (inspector section order right: Position > Size > Layout > Fill > Corners > Border > Effects > Type > Interaction > Export > Advanced) · States 3.5 (undo history, paste-from-Figma line, 6000 px minimap) · Interaction 3.5 · Microcopy 4 · A11y 3 (artboard name contrast) · Density 3 (type drift in the inspector).

**Blockers**
1. **[a11y · ds-typography]** (RC1) Artboard name is the v1 in-artboard strip: mono, 10 px caps, scaled with zoom. At the zooms every S2 shot uses (≈ 29–50 %) it is a 3–5 px smear, and when selected it is azure text on the beige strip, ~2:1 contrast (`S2.V2/ed-ab-select.v2.png`, zoom crop confirms). 14 draws a constant 11 px sans label above the artboard, azure pill with white text when selected, and the size ("Desktop 1440 × 1543") in tabular figures (`_kit.css:427-451`). Files: `apps/studio/canvas-lib.tsx:476-486`; the name pill needs `--accent`/`--accent-fg`.
2. **[ds-typography · ds-aesthetic]** (RC1) Artboard menu, object menu, component picker, selection tag and minimap card are all mono, and the menus are near-black with hard-coded oklch (`S2.V2/ed-ab-menu.v2-sub.png`, `ed-obj-order.v2.png`, `ed-comp-pick.v2.png`, `ed-edge-huge.v2.png`). README: "Mono only in Advanced and code", islands are frosted `--island-bg`. Files: `context-menu.tsx:204`, `3-shell-maude.css:6291`, `canvas-hud-tokens.gen.ts:27`. Fix: re-skin `.dc-context-menu` with island tokens + `--font-body`; one change cures 14, 15 and 04.
3. **[ds-typography]** (RC3) Inspector segmented controls render in the UA button font, about 15 px beside 12 px rows: "Fits content | Fixed", "Flat SM MD LG", "Packed | Space between" (wraps to two lines), "Union / Subtract…" clipped at the panel edge (`S2.V2/ed-ab-select.v2.png`, `S2.V4/ed-lay-auto.v4-drag.png`, `ed-shape.v4-t1000.png`). `Segmented` in `client/inspector-controls.jsx:485`, `.st-cp-segbtn` at `3-shell-maude.css:3638` has no `font`. Add `font: inherit; font-size: var(--type-sm)`.

**Warnings**
- **[ds]** Preset/Kind/Content/On click, X/Y fields use the browser `<select>` chevron and heavy native look; canvas draws the DS select with its quiet chevron. `inspector-controls.jsx` `Select`.
- **[ux]** Name tag for a tall selection overlaps the project pill at top-left ("div · 1440 × 3600" is cut behind the pill, `ed-edge-huge.v2.png`); the align bar sits under a full-window selection (off-screen). Clamp below the top band.
- **[ux]** Shapes and unnamed elements are titled with their tag ("div Shape", "h1.t-title Text", "a Text"); canvas titles them with names ("Podklad", "Book a call"). Partly fixture (no names) but the Rectangle has `data-cd-id="rectangle"` and still reads "div".
- **[ds-objects]** New Rectangle default fill is a saturated blue not drawn in the canvas (`ed-shape.v4-t1000.png`); check it is an `--object-*` token, not a literal.
- **[ux]** Open (S): "Use a style" leaves the Type section on "No style" until re-select (`S2.V4` G1). Reset was fixed.
- **[ux]** Undo history rows say "Edit canvas · You · now" for ops without a label (`ed-edge-undo.v4-history.png`); S2.25 (`ca6f21a84`) fixes the nudge label, not re-shot.
- **[ux]** Verified-but-differs: artboard menu has Add comment + Advanced extras; tidy bar sits under the selection (minor).
- **[ux]** Not reachable: AI lease tip / hold ring (U), ⌘/ in browser, second collaborator.

Not raised: hover vocabulary (S2.5), artboard Copy/Paste, Export 1x row.

## 15 Annotations — 3.5

Layers: Task 4 (N→Preview with Sticky, gallery search, arrows rebind, sections, vote result on the canvas) · IA 3.5 · States 3.5 (dangling card, locked sticky, crowd mosaic at 12 % are good) · Interaction 3.5 · Microcopy 4 ("Annotations hidden. Press ⇧P to bring them back." + Show; pack order and credits right) · A11y 3.5 · Density 3.

**Blockers**
1. **[ds · ux]** Start-a-vote sheet and vote bar had no material (`S4.V3/gap-an-vote-sheet-unstyled.png`, `gap-an-vote-bar-unstyled.png`): mono text straight on the canvas, labels near-invisible, "Cancel" over an artboard, bar swallowing a click on the Homepage "+". **(fix claimed `1e4cca0f8` + `cbe135058` "island material", not re-shot.)** Hold the gate until a screenshot shows the island, then clear.
2. **[ds-typography · ds-aesthetic]** (RC1) Annotation context menu, the selected-sticky toolbar ("Resolve", "Turn into a comment" in bold mono on near-black), sticker gallery heading rows ("Stamps vote · one each · they count", "FigJam Doodle 24 · by CJ Xue", mono) and section labels ("Nápady 4", mono) (`S4.V2/an-sticky-menu.png`, `gap-an-sticky-toolbar.png`, `an-stk-gallery.png`, `S4.V3/gap-an-plan-kanban.png`). 15 uses sans throughout (no `font-mono` in `15 Annotations.css`). Files: `context-menu.tsx`, `annotations-context-toolbar.tsx`, `canvas-lib.tsx:379,3964,4017`, stickers gallery under `apps/studio/stickers/`.

**Warnings**
- **[ux]** Selected-sticky toolbar draws all ten papers + numeric size "14" + B/I/S/U and runs under/over the Canvases panel (`S4.V3/an-ai-read.png`, toolbar left edge hidden behind the panel); canvas has five papers + "+5", a size select and Turn-into-a-comment. S4.19 reworked it (`7766f8f28`), not re-shot.
- **[ux]** AI plan board: every card paints the same cream AI paper, sections carry no tone, columns are grey (`gap-an-plan-kanban.png`); canvas colour-codes by channel. Lead decision (conflicts with canvas 23).
- **[ux]** Fix claimed, not re-shot: undo of an artboard drag moving the live artboard (`d09b8e523`), picks arm under Hand (`7766f8f28`), Section opens Templates, Locked line + tip, time chip / "Not printed" tag / Export line for print (`4b62887a6`), AI-authored sticky converted thread name (`4b62887a6`), cmd-Z once for AI edit + resolve (open: G3 of V3, no commit named).
- **[ux]** "Stickers" gallery sits flush on the toolbar (12 px gap) and its footer credits wrap into three lines of 11 px; acceptable, tighten.
- **[ux]** Homepage web artboard rendered blank in Preview at 45–53 % once after a fit (verifier: flaky lazy paint, unreproduced). Worth a repro in a light-theme pass.
- **[ux]** Not reachable: viewer, figjam, stub-only (U).

Not raised: sticker pack order, Always box (03).

---

## Pass B quick scan (all five)
- Hardcoded values: shell CSS clean in the new `v2/*` files (tokens, `var(--space-*)`, `--type-*`); hard-coded oklch only in the v1 `.dc-context-menu` block and `canvas-hud-tokens.gen.ts`.
- Type roles: Home/panel titles right; mono leaks (RC1, `.st-dd-hd`, vote sheet, gallery) and the UA font on segments (RC3). Weights stop at 600 elsewhere.
- Surfaces/radii: islands, controls and chips on ladder (14/10/6); no raw radii seen.
- Icons: line, monochrome in Edit; Preview colours allowed; no emoji in chrome.
- Hard stops: glass fail none; gradient none seen; pastel none (objects live on the canvas); neumorphism none; 3D none; mascot none.
- Motion: not testable from stills; S3.14 composites match the 220/280 ms story.

## Verdict

```json
{
  "agent": "design-critic",
  "iter": 1,
  "gate": "wave-A",
  "scores": { "03-ai-chat": 3.6, "04-modes-present": 3.9, "11-nav-history": 4.0, "14-editing": 3.4, "15-annotations": 3.5 },
  "gate_bar": 4.0,
  "areas_passing": ["11-nav-history"],
  "blockers": 8,
  "warnings": 29,
  "top_blockers": [
    { "category": "ds-typography", "area": "14,15,04", "file": "apps/studio/context-menu.tsx:204 + 3-shell-maude.css:6291", "summary": "v1 .dc-context-menu is mono, near-black, hard-coded oklch on every artboard/object/annotation menu", "fix": "Re-skin with island tokens + --font-body (one change cures three areas)." },
    { "category": "a11y", "area": "14", "file": "apps/studio/canvas-lib.tsx:476", "summary": "Artboard name is a zoom-scaled mono 10px strip inside the artboard; azure-on-beige ~2:1 when selected", "fix": "Constant 11px sans label above the artboard, azure pill when selected (_kit.css:427)." },
    { "category": "ds-typography", "area": "14", "file": "apps/studio/client/styles/3-shell-maude.css:3638", "summary": "Inspector segmented controls fall back to the UA button font (~15px)", "fix": "font: inherit; font-size: var(--type-sm) on .st-cp-segbtn." },
    { "category": "ds", "area": "04", "file": "apps/studio/client/v2/inspect/inspect-panel.jsx:124", "summary": "Inspect panel has zero padding (island--pad has no CSS rule), wrapped labels, raw hex", "fix": "Add the pad rule; widen label column; swatch + token name." },
    { "category": "ds-status", "area": "03", "file": "apps/studio/client/v2/ai/PermissionCard.jsx:125", "summary": "'Not now' is btn--danger (red) on permission/offer/consent cards", "fix": "Plain btn btn--sm as 03 draws it." },
    { "category": "microcopy", "area": "03", "file": "apps/studio/ai-banner.tsx:189", "summary": "Banner says 'Claude (Maude chat) is editing this canvas'", "fix": "Suppress for the panel's own run; say 'AI' per CONTRACT 3." },
    { "category": "microcopy", "area": "03", "file": "apps/studio/client/v2/ai/Feed.jsx:407", "summary": "v1 status row 'Ready · Claude Code' (green dot) not in canvas 03", "fix": "Remove; keep only the working line + Stop." },
    { "category": "ds", "area": "15", "file": "apps/studio/client/v2/annotations/vote.css", "summary": "Vote sheet/bar unstyled in last shot; fix 1e4cca0f8 not re-shot", "fix": "Re-shoot; clear if the island material shows." }
  ],
  "opt_out_applied": "palette",
  "ds_blockers_downgraded": 0,
  "passed": false
}
```
