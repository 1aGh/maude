# design-critic — Phase 4 gate, v2 shell (iter 2)

_2026-10-18 · scope: the Maude v2 app shell, not a canvas · evidence: `gate/01-empty.png` … `gate/07-shortcuts.png` (1440×900, browser shell, scratch copy of `e2e-fixture`) · references: CONTRACT §1–§6, kit tokens `colors_and_type.css`, `.design/ui/v2/_kit.tsx` look · opt_out_scope: not passed, defaulted to `palette`_

## TL;DR

**Overall 4.1 / 5 (iter 1: 3.1). Blockers: 1 (evidence only). Warnings: 9. Verdict: fix-and-retry, one re-capture.**

7 of 8 iteration-1 blockers are fixed and visible in the new shots. The one still open is not a code defect I can see: `07-shortcuts.png` still shows the Canvases search focused and no sheet, exactly as in iteration 1, so the "?" sheet (V2-4.6, "Keys and tools that moved") has not been seen by anyone. The source and a unit test say "?" now wins over "/" (`actions/keys.ts` L152–156, `test/v2-gate-keys.test.ts`), so this is most likely a capture issue: the harness' key event probably has no `code: 'Slash'`, or the shot predates the fix. Re-shoot by opening Menu › Help › Keyboard shortcuts (or ⌘K "Keyboard shortcuts") instead of a synthetic keypress, plus one frame with the "Keys and tools that moved" fold open. Score clears 4.0; I only re-score if the sheet shows a defect.

### Scores (iter 1 → iter 2)

| Dimension | Iter 1 | Iter 2 | Why |
| --- | --- | --- | --- |
| Composition / hierarchy | 3.5 | 4.3 | Real v2 empty state, one panel header with one fold control, count is a plain numeral. |
| Island material & spacing | 3.5 | 4.2 | Toasts now sit 84 px above the bottom edge, centred, clear of the panel (kit `bottom: space-4 + 56 + space-3`). 17 px margins unchanged. |
| Typography roles | 2.5 | 4.1 | Sentence-case eyebrows (`UI canvases`, `Account`, `Look`), Settings body in sans, keycaps 18 px high in the body font (kit 20). |
| Toolbars | 3.5 | 3.6 | Unchanged. Docks still ≈ 31 px buttons (kit 40 Edit / 48 Preview); Preview dock (317 px) is not a size up from Edit (180 px). Edit has 5 of 9 tools (accepted S2 scope, mentioned once). |
| Overlaps | 2.5 | 4.4 | Chip and toast collisions gone. Only a queued-toast peek card (02) and the Settings bottom clip remain. |
| State clarity | 3.5 | 3.7 | "Hide panels" now reads pressed (03). Still: artboard keeps its azure selection outline in Preview, mode segments are glyph-only, no-canvas dimming is uneven. |
| Copy | 2.5 | 4.0 | Empty state, key labels and Settings are on contract words. ⌘K and toast copy still carry v1 phrasing. |
| Accessibility | 3.0 | 4.3 | Measured below: every meaningful text ≥ 5.0:1. Focus rings and the Settings selected-tab fill are present. Dock targets 31 px pass 2.5.8, miss the 44 px guideline. |
| DS / brand fidelity | 3.0 | 4.2 | Mark lifted verbatim, bubble glyph, kit keycaps. ⌘K selected tile is solid azure, menu has no icons or separators. |
| **Overall (mean)** | **3.1** | **4.1** | Gate ≥ 4.0. |

## Iteration-1 blockers

| # | Blocker | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Count chip over header and first row | **Fixed** | `01`, `02`, `04`–`07`: "4" is a plain right-aligned numeral at x≈236, y≈192, in the header row, `--fg-2` (5.8:1). |
| 2 | Toasts on the panel, stacked | **Fixed** (residual warning) | `01` What's new and `02` You’re in Edit: centred x 541–899, bottom edge y 816 (84 px above the bottom), above the toolbar in `02`, nothing under them. A narrower second card still peeks 12 px above in `02`. |
| 3 | `--fg-3` used for real text | **Fixed** | Measured on `01`, `02`, `04`, `05`, `06`: search placeholder 5.05:1, "Local project" / Advanced / UI canvases / count 5.77:1, empty-state body 5.23:1, ⌘K group labels 5.56:1, ⌘K footer 5.56 / 5.09:1, Settings captions and version 5.56–5.77:1, toast body 8.9:1. Samples are exactly `--fg-2` (98,102,109). Lowest is 5.05:1. |
| 4 | v1 empty-state copy | **Fixed** | `01`: "No canvas open / Open a canvas from the Canvases panel, or start a new one." No "screen", no dead pointer, no port or version, no splash lockup. |
| 5 | `07` does not show the sheet | **Not fixed (evidence)** | `07` is the same screen as iteration 1: search field focused with caret, no overlay. See TL;DR. |
| 6 | Shortcut labels disagree with CONTRACT | **Fixed** | `04`: Version history ⌥⌘H, Export… ⇧⌘E, Settings… ⌘,. `05`: New canvas and Open design system view carry no chip (no wrong "N" / "S"), Handoff ⇧⌘H, Comments ⇧⌘M, Inspector ⇧⌘I, modifier order ⌥⇧⌘ throughout. Registry test pins ⌘N (desktop) or none (browser). |
| 7 | Pill mark was a bare spark | **Fixed** | `01`–`07` pill (3× crop of `02`): azure tile, bottom-right corner squared, white four-point star. `project-pill.jsx` L30–39 path data is identical to `assets/logos/mark.svg`. |
| 8 | Unidentifiable Comments glyph | **Fixed** | `02`/`03` cluster (3× crop of `03`): speech bubble with a visible tail, first control after the status word. |

## New blockers

None found in the seven shots. (The sheet itself is unreviewed, so "none" excludes it.)

## Warnings, ranked

1. **[ux · state] Preview hides the save status entirely, including "Not saved" and "Offline".** `client/v2/shell/share-cluster.css` L322–327 sets `display:none` on `.st-faces`, `.st-saved` and `.st-share-act` whenever `data-mode="preview"`. Preview is where stickies, comments and markers are written, and CONTRACT §6 says *Not saved* shows "only while it is true, with one action (Retry)". `03` shows the cluster with no word at all. Keep the compact rule for *Saved* / *Local project*, but let non-ok tones (Not saved, Offline) through, or confirm the callout stack always carries them in Preview.
2. **[ds] Docks are undersized against the kit.** `02`, `03`: ≈ 31 px buttons and 14–16 px glyphs vs kit 40 / 18 (Edit) and 48 / 22 (Preview, "a size bigger"). Preview should read larger than Edit; it does not.
3. **[ux · state] Preview still looks editable.** `03`: the artboard keeps the 2 px azure selection outline; the pressed mode segment (white + 1 px azure ring) is the same signal as keyboard focus; mode segments are glyph-only; with no canvas (`01`) Share dims but mode switch, Comments and Exports do not.
4. **[microcopy · ds] ⌘K is closer but still v1 in places.** `05`: "Generate with AI…" (§3: Ask AI), "Toggle comments panel" (menu says Comments), "Open design system view" is offered although the project has no Design system row, the pre-type list has no canvases and no Ask AI row (V2-4.6 done-when), the selected row's icon tile is solid azure (azure is reserved for AI and the primary action), the input chip says ⌘K (reference: esc), and Settings / Open design system view / Open inspector share one sliders glyph.
5. **[microcopy] Toast copy.** `02`: "Click selects, like Figma. Switch to Preview at the top right to use the live mock." (`client/shell/util.js` L177–180) — say what happens, not what it resembles. `01`: What's-new is a three-line changelog sentence; straight apostrophe in "What's" vs curly in "You’re"; "See all (2)" is an underlined black link, the kit uses a ghost button in `--accent-text`. The peek card behind the toast in `02` is fine if it means "one more queued", but nothing says so.
6. **[ds] Project menu structure.** `04`: nine rows with no separators or icons (kit groups views / history-share-export / diagnostics-settings), and the pill shows no open state (caret does not flip, no pressed tint). Order, labels and chevrons match CONTRACT §1. No "Back to Home" is correct for a browser shell (V2-4.9).
7. **[ux · task] The empty state has no door.** `01`: the copy says "start a new one" but the only way is the unlabeled + in the panel header or ⌘K. A "New canvas" button under the line closes it.
8. **[ux] Settings sheet clips mid-row.** `06`: the Minimap description is cut at the bottom edge with no padding or fade; reads as a layout bug even if it is scroll.
9. **[ux · scope note, mention once] Edit toolbar has Select · Hand · Frame · Text · Image.** Shape R, Pen P and Component ⇧I are S2 (Phase 5), data-pending in `bridge/canvas-modes.ts` MODE_TOOLS. The AI chat island needs a Claude account and the canvas content is the fixture's. Not scored.

## Pass A — UX (7 layers)

- **Task.** Find or start a canvas, work, switch mode. The pill, panel, cluster and toolbar each own one verb and sit where the reference puts them; `01` now says one true thing. Gap: no button in the empty state (W7).
- **IA / hierarchy.** One saturated element (Share), single panel header, numeral count. Menu order matches §1.
- **States.** Panels-hidden is clear (`03`). Preview drops the save word (W1). Not captured: loading, error, empty search, "Nothing called …".
- **Interaction.** Focus rings visible on Canvases tab, Search, menu rows, Settings tab. Selected row actions (⋮, trash) now appear only on hover (visible in `02`, absent in `05`/`07`), fixed from iteration 1. Dock targets 31 px.
- **Microcopy.** Good: "No canvas open", "Search canvases…", "Local project", "Done", ⌘K placeholder, "↑↓ move ↵ open". Open: W4, W5.
- **Cross-platform parity.** Browser shell only; cannot judge desktop or cloud from these shots.
- **Accessibility.** Contrast closed (table above). The Settings selected tab now has a `--bg-3` fill (238,240,243) next to the ring, not ring alone. W3 notes ring vs pressed duplication.

## Pass B — DS compliance

- **Tokens.** Sampled greys are exactly `--fg-0/1/2`; no off-token text colours. Source not audited here (no canvas HTML).
- **Type.** Eyebrows `--type-xs` semibold `--fg-2` sans, Settings sans, keycaps body font. Weights ≤ semibold.
- **Surfaces & radii.** Solid white islands on `--bg-0`, hairline edge, soft shadow, 17 px margins; toast and sheet use the same recipe.
- **Icons & brand.** One line family; Mark is the stored specimen; spark glyph is again only the AI's. No emoji.
- **Hard-stops scan.** glass: pass · gradient: pass · pastel: pass · neumorphism: pass · 3D: pass · mascot: pass.

## What is working (keep)

Slot layout and margins, Preview toolbar glyph set and order, project menu order and chevrons, ⌘K field/groups/keycaps/footer, Settings nav (General · Connections · Advanced), one-word status, toast placement rule.

## Evidence notes

- Contrast: max-contrast text pixel vs modal background colour per region, 25 regions, script in the session scratchpad (`contrast2.py`). Anti-aliasing makes these lower bounds.
- `05`/`06` sit under a light scrim; the sampled regions are inside the modals, not the dimmed shell.
- Not reviewed: the "?" sheet, AI panel, inspector, zoom island, Layers/Assets tabs, Home, timeline.

---

## Verdict

```json
{
  "agent": "design-critic",
  "iter": 2,
  "scope": "phase4-shell",
  "score": 4.1,
  "dimensions": {
    "composition_hierarchy": 4.3,
    "island_material_spacing": 4.2,
    "typography_roles": 4.1,
    "toolbars": 3.6,
    "overlaps": 4.4,
    "state_clarity": 3.7,
    "copy": 4.0,
    "accessibility": 4.3,
    "ds_brand_fidelity": 4.2
  },
  "iter1_blockers_fixed": 7,
  "iter1_blockers_open": 1,
  "blockers": 1,
  "warnings": 9,
  "top_blockers": [
    { "category": "ux", "line": null, "where": "gate/07-shortcuts.png", "summary": "Still shows the Canvases search focused, no shortcuts sheet; the V2-4.6 sheet and its 'Keys and tools that moved' fold are unreviewed. Source (actions/keys.ts L152-156) and test/v2-gate-keys.test.ts say '?' now opens it, so likely a capture issue.", "fix": "Re-capture by opening Menu > Help > Keyboard shortcuts (or Cmd+K 'Keyboard shortcuts'), plus one frame with the moved-keys fold open." }
  ],
  "opt_out_applied": "palette",
  "ds_blockers_downgraded": 0,
  "passed": false
}
```

---

# Iter 2b addendum — the "?" sheet (`gate/07-shortcuts.png`, `gate/07b-shortcuts-moved-fold.png`)

_Supersedes the verdict above. The other six shots are not re-scored._

## Blocker 5 (evidence) — closed

`07` now shows the sheet, opened with a literal "?". Iter-1 blocker 5 is closed: **8 of 8 iteration-1 blockers fixed.** `07b` is pixel-identical to `07` except a 540–868 × 848–896 strip at the bottom (see W4), so it does not show the "Keys and tools that moved" fold; the fold sits below the scroll fold. I reviewed it from source instead (W5).

## One new blocker

1. **[a11y · contrast / ds-tokens] The sheet's "Find a shortcut" placeholder is the browser default, 4.44:1.** `07`, x 848–935, y 103–117. Text is exactly `#757575` on the field fill `(249,251,253)`, 13 px. WCAG 1.4.3 needs 4.5:1. `.so-find input` in `client/v2/search/search.css` L140–148 has no `::placeholder` rule, so Chromium's default colour shows; every other placeholder I measured is `--fg-2` (5.05:1). Fix: `.so-find input::placeholder { color: var(--fg-2) }` (≈ 5.6:1). Not subject to opt-out. Worth a grep for other inputs without a `::placeholder` rule.

## Sheet review against CONTRACT §2 and §5

Score for the sheet alone: **3.9** (keys 4.0 · type 4.3 · layout 3.3 · a11y 3.9). With it added to the nine dimensions the mean is 4.07, so overall stays **4.1**.

**Right.** All twelve tool keys match §2: V H F T I, and N C M A E S under "Preview tools" with the line "The key switches to Preview". ⌥⌘P Preview, ⇧P Annotations, ⌘K, ⌘\, ⇧⌘M, `?` (+ ⌘?), F1, ⌥⌘H, ⇧⌘E, ⇧⌘H, ⌘,, ⌘1–9, ⇧0, esc, ⇧⌘L, ⌘D, ⌫. Modifier order is ⌥⇧⌘ throughout (⌥⇧⌘C / ⌥⇧⌘V), return key is ↵. Keycaps are kit-sized: the "V" cap measures 20 × 20 (kit `.kbd`: 20 high, min 20), body font. Group titles are 11 px semibold `--fg-2` (§5 panel-title role, 5.77:1), row labels 9.2:1, "or" separators 4.75:1. Focus lands in Find, with a visible ring. Title, Find and close sit in one header row.

**Warnings, ranked**

1. **[ux · layout] Alias noise and dangling "or".** About 60 keycaps. Redo shows three chips (⇧⌘Z or ⌘Y or ⇧⌘Y) wrapped with "or" left at the line end; "Go to artboard" lists nine chips over five rows with an "or" ending every row; Nudge does the same. §2 gives one key per action. Show the primary chord, collapse the rest ("⌥⌘1–9" as "Show tab" already writes ⌘1–9; "← → ↑ ↓ · ⇧ moves 10 px"), and keep ⇧⌘K / ⇧⌘F / ⇧⌘Y / ⌘? in the fold or drop them.
2. **[ux · layout] The forced 3 × 2 grid leaves holes and clips.** A blank band under "Edit tools" (y 310–375) and a 220 px void under "Panels and AI", while "Canvas" and "Objects" run off the dialog: "Lock / unlock" is cut mid-row at the bottom edge (y 833–845). Timeline, Present and the moved-keys fold are not visible without scrolling, and nothing hints at that. Flow the groups in columns, or add a bottom fade.
3. **[microcopy · contract keys] Two rows state keys that §2 gives to something else.** "Select all ⌘A or ⇧⌘A": §2 gives ⇧⌘A to *Select all annotations*. The registry has `select.all` carrying v1's ⇧ alias (`actions/defs/edit.ts` L96–99) while `select.all-annotations` has no key. "Group ⌘G / Ungroup ⇧⌘G" are annotation-scoped (`actions/defs/annotation.ts` L19–20) but listed under Objects with no qualifier. §2's Edit meanings (⌥⌘G Frame selection, ⇧⌘G Remove frame) are absent, which fits Phase 5. The sheet is true to what is bound; label it ("annotations") until the keys land.
4. **[ux · state] Confirm the What's-new toast's resting position with a canvas open.** The 848–896 strip in `07b` is the What's-new toast showing through the scrim, about 113 px lower than in `01`: it overlaps the toolbar and its "See all (2)" sits at y ≈ 897, at the window edge. It may be a mid-rise frame (nothing in `07` yet); `02` and `01` show correct resting positions for the other toast and the no-canvas case. Not counted. If it is the resting position, it is iteration-1 blocker 2 again for this toast kind.
5. **[ux · fold, from source] "Keys and tools that moved" is not visible in any shot.** `MOVED_KEYS` (`actions/help.ts` L32–95) covers §2's list except two rows: "Toggle theme → ⌘K Theme + Settings" and "New video… → ⌘K New video". The `note` field is not rendered (`shortcuts-overlay.jsx` L162–168), so "P is the design Pen in Edit" and "⌘E is unbound" never show. It opens at first look (`HELP_FOLD`), but two screens down.
6. **[microcopy] Low:** "Panels and AI" has no AI row in the browser shell (⌘/ is desktop-only); the group title promises one. Edit tools list 5 of 8 keys (Shape R, Pen P, Component ⇧I are S2, accepted).

## Final count and verdict

Blockers: **1** (placeholder contrast, one CSS line). Warnings: 9 from before + 5 from the sheet (W1–W3, W5, W6; W4 is a confirm item), so 14. Everything else from iter 2 stands.

```json
{
  "agent": "design-critic",
  "iter": "2b",
  "scope": "phase4-shell",
  "score": 4.1,
  "sheet_score": 3.9,
  "iter1_blockers_fixed": 8,
  "blockers": 1,
  "warnings": 14,
  "top_blockers": [
    { "category": "a11y", "line": null, "where": "gate/07-shortcuts.png, sheet 'Find a shortcut' placeholder; client/v2/search/search.css L140-148", "summary": "Placeholder uses the browser default #757575 on the field fill: 4.44:1, needs 4.5:1; no ::placeholder rule.", "fix": "Add .so-find input::placeholder { color: var(--fg-2) }." }
  ],
  "confirm": ["What's-new toast overlaps the toolbar and runs off the window bottom in 07b: transient or resting position?"],
  "opt_out_applied": "palette",
  "ds_blockers_downgraded": 0,
  "passed": false
}
```
