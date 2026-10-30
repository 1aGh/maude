# design-critic — Phase 4 gate, v2 shell (iter 1)

_2026-10-17 · scope: the Maude v2 app shell, not a canvas · evidence: `01-empty.png` … `07-shortcuts.png` (1440×900, local browser shell, scratch fixture `e2e-fixture`) · references: `.design/ui/v2/01 Create Flow.tsx`, `11 Projects and Navigation.tsx`, `_kit.tsx/.css`, `.design/system/maude-v2/CONTRACT.md` · opt_out_scope: not passed, defaulted to `palette` (full DS enforcement)_

## TL;DR

**Overall 3.1 / 5 — below the 4.0 gate.** Blockers: 8 · Warnings: 13 · Verdict: **fix-and-retry**

The composition is right and close to the reference: project pill top-left, Share cluster top-right, one floating left panel, bottom-centre dock, solid island material, consistent 17 px margins, and a Preview toolbar that matches the annotation set. What holds the score down is a handful of visible defects (a stray count chip, toasts parked over the panel), real contrast failures, stale v1 copy on the first-impression surface, a missing shortcuts-sheet screenshot, and typography that still reads v1 (mono-caps eyebrows, mono Settings body, tiny keycaps). All of it is fixable without redesign. Fix the 8 blockers and the top 4 warnings and I expect ≈ 4.0–4.2.

### Scores

| Dimension | Score | Why |
| --- | --- | --- |
| Composition / hierarchy | 3.5 | Slots, margins and the one saturated Share button match the reference. Empty state (01) is a v1 page, not the v2 one. |
| Island material & spacing | 3.5 | Radii, soft shadow, white solid fill and 17 px outer margins are consistent (measured: pill, cluster, panel, inspector icon all sit at 17 px; cluster and icon share a right edge at x=1422). Dock is undersized vs the kit. |
| Typography roles | 2.5 | Mono-caps eyebrows where CONTRACT §5 / `.island-title` say 11 px semibold sans `--fg-2`; Settings body in v1 mono; keycaps ≈ 8–9 px mono vs `.kbd` 11 px body font. |
| Toolbars | 3.5 | Preview: right tools, right order, right pressed style. Edit: 5 of 9 tools, and both docks ≈ 25–35 % smaller than the kit. |
| Overlaps | 2.5 | "4" chip over the group header and the first row; toasts over the panel; stacked toast ghost. |
| State clarity (Edit vs Preview) | 3.5 | Reads from toolbar swap + active segment, but icon-only, selection outline persists in Preview, and disabled treatment is uneven with no canvas. |
| Copy | 2.5 | "screen", "sidebar", "Generate with AI…", "like Figma", "live mock", contradictory select instructions, port and version leaked. |
| Accessibility | 3.0 | `--fg-3` (disabled grade) used for meaningful text at 2.7–3.0:1. Focus rings present. Targets ≥ 24 px. |
| DS / brand fidelity | 3.0 | Pill mark is a bare spark, not the DS Mark. Unreadable comment glyph. Menu lacks the kit's icons and separators. |
| **Overall (mean)** | **3.1** | Gate is ≥ 4.0. |

Principle I used for severity. **Blocker** = a visible defect or overlap, an a11y failure, wrong or misleading information, missing evidence, or a brand-identity error. **Warning** = style drift from the kit that lowers the score but does not break a task.

## Blockers (must fix)

1. **[ux · overlap] Count chip "4" detached from its row** — `01`, `02`, `04`, `05`, `06`, `07`, left panel at ≈ x 36–55, y 208–246. An outlined vertical capsule holding "4" floats over the "UI CANVASES" header text and the "Cut" row's file icon. It reads as a rendering bug on every screenshot that shows the panel. Reference (`01-cf-big-tree`): the count is a plain right-aligned tabular numeral inside the header row ("2026 … 16"). Fix: put the group count in the header row's right slot as a plain `--type-xs` tabular numeral, no capsule, no absolute positioning. (Not `.st-row-badge` — that one is the accent-filled open-count pill with `margin-left:auto`; the chip here is a different element in the group header, `apps/studio/client/tree/tree.jsx`.)

2. **[ux · overlap] Toasts sit on the left panel and stack into each other** — `01` (What's new, x 16–376, y 646–816) and `02` (You're in Edit, x 16–376, y 717–816, with a second card's top edge and blue bar peeking out 10 px above at y ≈ 707). Both are anchored bottom-left, cover the full width of the 233 px panel and run 126 px into the canvas. In this 4-canvas fixture they hide only empty panel space; in a real 90-canvas project they cover canvas rows and Recent. In the second shot the hidden card reads as a glitch. Reference `.k-toast--dock`: horizontally centred on the window, docked just above the toolbar (`bottom: space-4 + 56px + space-3`). The bottom-left corner is also where the kit puts the zoom/undo island. Fix: dock toasts centre-bottom above the toolbar, show one at a time (queue the second), never over a panel.

3. **[a11y · contrast] Disabled-grade `--fg-3` used for real text** — measured on the screenshots (conservative, anti-aliased lower bounds): ⌘K group labels "CANVAS" / "VIEW" ≈ 3.0:1 (`05`), ⌘K footer "Type to search" ≈ 2.9:1 (`05`), empty-state caption "CANVAS · E2E-FIXTURE / v1.9.1 / localhost:4418" ≈ 2.8:1 (`01`), Search placeholder ≈ 2.7:1 (`01`). The sampled colour is exactly `oklch(.70 .008 250)`, the `--fg-3` "disabled" token. WCAG 1.4.3 needs 4.5:1 at these sizes (10–11 px). Same-screenshot comparison: `--fg-2` text (panel title, "Local project", "Advanced") measures ≈ 5.7:1. Fix: labels and hints use `--fg-2` (the kit's `.island-title` already does); placeholder at `--fg-2` too. Not subject to opt-out.

4. **[microcopy] The no-canvas empty state is v1 copy that contradicts the contract and the shipped Edit toast** — `01`, centre. (a) "Pick a **screen** from the list…" — "screen" is a banned word (§3: canvas / artboard). (b) "or open **Design system** above it" — no Design system row exists in the panel in this shot, so the sentence points at nothing. (c) "To select something on the canvas: hold ⌘ and hover… ⌘⇧+click selects more than one" directly contradicts `02`'s toast "Click selects, like Figma." — one of them is stale. (d) The mono caption exposes `v1.9.1 / localhost:4418` to people who never see a terminal. (e) The wordmark lockup is a v1 splash. Fix: rewrite to contract words, one true selection instruction (or none), drop port and version from this surface (they live in Menu › Diagnostics).

5. **[ux · evidence] `07-shortcuts.png` does not show the shortcuts sheet** — it shows the Canvases search field focused (blue ring, caret, empty) and no overlay. Either "?" did not open the sheet and the keypress fell through to the "/" focus-search binding (⇧/ matching "/"), or the capture is wrong. V2-4.6's "?" sheet with the "Keys and tools that moved" fold is therefore unreviewed. Fix: re-capture with the sheet visible. If "?" really focuses search, make ⇧/ not match the "/" binding.

6. **[microcopy · contract keys] Shortcut labels disagree with CONTRACT §1–§2** — `04`: "Version history **⇧⌘G**" (contract: **⌥⌘H**; ⇧⌘G is *Remove frame* in Edit, so a held-over binding would collide on a selected frame). `05`: "New canvas **N**" (contract: **⌘N**; N is Sticky), "Open design system view **S**" (S is Section; that key was retired for the pinned Design system row), and "⌘⇧M", "⌘⇧I" where the same list correctly writes "⇧⌘E" (§2: modifier order ⌥⇧⌘). If these are the live v1 bindings, either land the v2 keys in this phase (rule: a v2 key lands in the same change that removes the v1 binding it collides with) or show the key that is actually bound. Right now the menu and the toolbar tooltips claim the same keys.

7. **[ds-icons · brand] The project pill's mark is a bare azure spark, not the DS Mark** — `01`–`07`, pill at x 24–38. Every reference pill uses `Mark` (azure rounded tile with the white star), and the lockup in the middle of `01` of the same screenshot shows the correct tile. The spark glyph is the AI's reserved glyph (§7, "an AI action…"); using it as the app's identity blurs brand and AI. Source: `Mark()` in `apps/studio/client/v2/shell/project-pill.jsx` L30–35 is a one-path star with `fill: currentColor`. Fix: lift the stored specimen's Mark (tile + star, 22 px) verbatim — DDR-141 Tier-0, never redrawn.

8. **[ds-icons] Unidentifiable control in the Share cluster** — `02`/`03`, x ≈ 1142, between "Local project" and the mode switch. It is the Comments button (`data-testid="share-cluster-comments"`) and its glyph (`StIcon name="comment"`, `apps/studio/client/shell/icons.jsx` L353–355) is a rounded square with one squared corner and no tail, so at 16 px it reads as an empty box, a "stop" or a frame. It is the only unlabeled-looking control in a cluster of recognisable glyphs, and Comments is a primary Preview task. Fix: use the kit's `comment` bubble (visible tail); keep the aria-label and tooltip.

## Warnings (should fix)

- **[ds-typography] Mono-caps eyebrows everywhere** — "CANVASES", "UI CANVASES" (`01`–`07`), "CANVAS" / "VIEW" (`05`), "ACCOUNT" / "LOOK" / "CANVAS AND VIEW" (`06`). CONTRACT §5 and `.island-title`: `--type-xs` (11), `--w-semibold`, `--fg-2`, sans. Reference group titles are sentence case ("Studio site · 5 canvases", "Recent", "Alligators brand").
- **[ds-typography] Settings body is v1 mono inside a v2 sheet** — `06`: titles ("Theme", "Light", "Maude Cloud"), descriptions and the version line are mono; the nav and "Done" are sans. Body text comes from v1 `apps/studio/client/panels/SettingsPanel.jsx` (≈ L1157) and its copy still says "menubar, sidebar" (banned: *panel*, *toolbar*). Mono is for tabular numbers and keys only.
- **[ds-typography] Keycaps too small and the wrong font** — `04`, `05`: mono ≈ 8–9 px, the ⇧ is barely legible. Kit `.kbd`: body font, 11 px, 20 px high, min-width 20.
- **[ds] Docks are undersized against the kit** — measured on `02`/`03`: buttons ≈ 31 × 31 px with ≈ 14–16 px glyphs (pitch ≈ 35 px, Preview dock 318 px wide, ≈ 38 px tall). Kit: Edit buttons 40 × 40 / 18 px glyphs; Preview buttons 48 × 48 / 22 px glyphs ("a size bigger than Edit", 493 px wide). Here Preview is not bigger than Edit. Targets still clear WCAG 2.5.8 (24 px) but not the kit or the 44 px guideline.
- **[ux] Edit toolbar has 5 of 9 tools** — `02`: Select · Hand · Frame · Text · Image. CONTRACT §2 / V2-4.5: + Shape R · Pen P · Component ⇧I · More. Fine if Shape/Pen/Component are S2 (Phase 5); then record the exception in the plan, because the phase gate names this toolbar.
- **[ia] Left panel header is doubled** — `02`: the Canvases / Layers / Assets switcher already names the tab, then a second row repeats "CANVASES" with + / new-folder / **a second panel-fold icon** (x 227, y 123) under the first (x 235, y 86). Reference: one switcher, one fold control, then Search. The extra row costs ≈ 52 px of list height.
- **[ia] Project menu is flatter than the contract** — `04`: no leading Search row, no "Back to Home" (reasonable in a browser shell; V2-4.9 covers it), no icons, and no group separators (reference: four groups — views, history/share/export, diagnostics/settings). Nine undivided rows read as one list. Open state on the pill (caret flip / pressed tint) is also missing.
- **[ux · ⌘K] Pre-type state skips the main job** — `05`: none of the four canvases appear, there is no Ask AI last row (V2-4.6 done-when), and "Generate with AI…" is the v1 name (§3: "Ask AI"). Three different commands (Settings…, Open design system view, Open inspector) share the sliders glyph. The selected row paints its icon tile solid azure, which reads as an AI or primary action (§7 reserves azure for those). The input chip says ⌘K; the reference shows esc.
- **[ux · state] Edit vs Preview relies on icons alone** — `02`/`03`: the three mode segments are glyph-only; the pressed segment's white fill with a 1 px azure ring is the same as a keyboard focus ring. In Preview, the artboard keeps the 2 px blue selection outline, so the design still looks selected and editable. With no canvas (`01`) Share dims but the mode switch, Comments and Exports do not.
- **[microcopy] Toast copy** — `02`: "Click selects, **like Figma**. Switch to Preview at the top right to use the **live mock**." Say what happens, not what it resembles: "Click selects. Switch to Preview (top right) to use the design live." `01`: What's-new toast is a three-line changelog (> 60 ch lines), the apostrophe is straight here and curly in "You’re", and "See all (2)" is an underlined black link where the kit uses a ghost button in `--accent-text`.
- **[ux] Row actions always on the selected row** — `02`: "⋮" and a trash icon show on the selected row without hover, 16 px apart. Reveal on hover/focus; the trash is undoable (§7) but the neighbour is a menu.
- **[ux] Settings sheet clips mid-row** — `06`: the "Minimap" row and its toggle are cut by the sheet's bottom edge with no padding or fade. Looks like a layout bug even if it is scroll.
- **[ds] No AI entry point in any shot** — the kit bottom-right folded spark icon (AI chat panel) and the bottom-left zoom/undo island are absent. Confirm they are gated off in the scratch fixture (no Claude account, View › Advanced › Zoom controls off by default). If they are always present in v2, the first-flow ("Home → AI drafts") has no door.

## Pass A — UX (7 layers)

### Task
The shell's job is "find or start a canvas, work on it, switch mode, reach everything else". The pill (project/canvas), the left panel (find), the cluster (mode, share) and the dock (tools) each own one verb and sit where the reference puts them, so the primary action is clear within two seconds on `02`. On `01` the task is muddy: the page tells you to pick a "screen", points to a Design system row that is not there, and then explains ⌘-hover selection — three tasks in one block.

### IA / hierarchy
Hierarchy is carried by space and a single saturated element (Share), which is right. The left panel's order (switcher, search, group, rows, Trash, Advanced) matches the reference minus the pinned Design system row. The doubled header row and the stray count chip make the panel's top third noisier than the reference. In the menu (`04`) the missing separators flatten File/Edit/View/Help, Version history/Share/Export and Diagnostics/Settings into one list.

### States
No-canvas (`01`): dock hidden (good), Share dimmed (good), mode switch / Comments / Exports not dimmed (inconsistent). Preview (`03`): panels folded to corner icons with the pressed "Hide panels" button — consistent with the kit; faces and the status word drop out (kit `zen` does the same), so the save state disappears exactly while you annotate. No loading, error or empty-search states were captured; the left-panel search, ⌘K "Nothing called…" and Settings error states are untested here.

### Interaction
Keyboard: the project menu, ⌘K and Settings all show visible azure focus rings; the left Search has a clear focus state (`07`). Hit targets: dock ≈ 31 px, row actions ≈ 16 px, keycaps are not targets. The "?" key appears to fall through to "/" (blocker 5). Shortcut chips disagree with the contract (blocker 6), which will mislead muscle memory.

### Microcopy
Good: "Local project" as one status word, "Search canvases…" with "/" chip, ⌘K placeholder "Search canvases, actions, or ask AI…", footer "↑↓ move ↵ open", "Done". Not good: see blocker 4, blocker 6, the toast, "Generate with AI…", and Settings "menubar, sidebar". The contract's own empty line ("Your canvas is ready. Ask AI for a first draft, or start drawing.") is a different state; the no-canvas-open page needs its own v2 words.

### Cross-platform parity
Local browser shell only, so parity with the desktop and cloud shells cannot be judged from these shots. The cluster correctly omits tabs and Home. `shell-parity` will have to cover the pill's Back to Home and the status word variants.

### Accessibility
Blocker 3 (contrast) is real and not subject to opt-out. Positive: focus rings visible on menu items, Settings tab and Search; selected Settings tab has a fill (`--bg-3`) and weight change, not only the ring (`settings.css` L62); aria names are present on cluster buttons (source). Minor: the 1 px azure ring on the pressed mode segment duplicates the focus-ring look, so keyboard focus and "current mode" are visually the same signal.

## Pass B — DS compliance

### Hardcoded values
Not auditable from screenshots; no canvas HTML. The sampled greys (143,146,152 and 98,102,109) match `--fg-3` and `--fg-2` exactly, so the shell is using tokens, just the wrong role for labels.

### Type
Roles that drift from §5: eyebrows (mono caps instead of `.island-title`), Settings body (mono), keycaps (mono, ≈ 8–9 px vs `.kbd`). Weights stay at or under semibold. Panel row text and the pill (semibold project name + regular canvas name) match the kit.

### Surfaces & radii
Solid white islands on `--bg-0` with the soft shadow and hairline edge; radii consistent (pill, cluster, panel ≈ `--radius-lg`, dock `--radius-xl`). Outer margins 17 px everywhere (pill, panel, cluster, inspector icon, bottom). Gap pill → panel and cluster → inspector icon ≈ 15 px. No cards-with-shadows misuse. Toasts use the island recipe but are positioned off-spec.

### Components
Panel switcher, search field, rows with accent left bar on selection, segmented mode switch, Share button, dock pressed style (tint + underline), Preview toolbar glyph set: faithful. Divergent: dock size, project-menu structure, toast placement, keycap, count chip, comment glyph.

### Icons & brand
Line family is consistent (≈ 1.5 px stroke). The pill mark and comment glyph are the two misses. Three ⌘K commands share one glyph. No emoji, no multicolour.

### Hard-stops scan
glass: pass · gradient: pass · pastel: pass · neumorphism: pass · 3D: pass · mascot: pass

## What is working (keep)

- Slot layout and 17 px margin system; panels fold to corner icons and come back with ⌘\.
- Preview toolbar: Hand | Sticky · Comment · Marker · Arrow · Shape · Text · Stickers · Section, with the sub-menu chevrons on Marker and Shape — matches CONTRACT §2.
- Project menu order and submenu chevrons match CONTRACT §1; Settings has General · Connections · Advanced; the sheet has a real nav, "Done" and a version line.
- ⌘K layout (field, grouped rows, kbd chips, footer) is close to the reference; Share dims with no canvas.

## Evidence notes

- I rendered the references at 100 % zoom in an isolated scratch project (`…/scratchpad/refrender`, port 4431, `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`, stopped afterwards) and compared 01 `cf-select-tweak`, `cf-sticky-comment`, `cf-blank`, `cf-big-tree`, `cf-search-k` and 11 `pn-ds`. In my render the kit's Stage came out in the dark palette even with `data-theme="light"` set, so I compared structure, size, type and copy, and used the tokens' light values for colour.
- Measurements are from your 1440 × 900 PNGs; contrast figures are anti-aliasing-conservative.
- The fixture canvas has overlapping text in its own artboard ("Seed section" chip over the paragraph, `02`/`03`). That is fixture content, not shell, but it reads as a shell defect in gate evidence. Use a clean fixture or the reference artboards for the re-shoot.
- Not reviewed: any AI panel, inspector, zoom island, Layers/Assets tabs, Home, video timeline (none are in the shots).

## Top fixes, in order

1. Blocker 1: move the group count into the header row as a plain numeral. (`01`–`07`, left panel)
2. Blocker 2: centre-dock toasts above the toolbar, one at a time. (`01`, `02`)
3. Blocker 3: `--fg-3` → `--fg-2` for labels, hints, placeholder. (`05`, `01`)
4. Blocker 4: rewrite the no-canvas empty state to contract words. (`01`)
5. Blocker 5: re-shoot `07` with the sheet open; fix "?" vs "/" if real. (`07`)
6. Blocker 6: make the shortcut labels true (⌥⌘H, ⌘N, ⇧⌘ order) or land the keys. (`04`, `05`)
7. Blockers 7 and 8: lift the DS Mark into the pill; draw a bubble for Comments. (`02`, `03`)
8. Then the two typography warnings (eyebrows, Settings body), keycap size and dock scale — together worth ≈ +0.4.

---

## Verdict

```json
{
  "agent": "design-critic",
  "iter": 1,
  "scope": "phase4-shell",
  "score": 3.1,
  "dimensions": {
    "composition_hierarchy": 3.5,
    "island_material_spacing": 3.5,
    "typography_roles": 2.5,
    "toolbars": 3.5,
    "overlaps": 2.5,
    "state_clarity": 3.5,
    "copy": 2.5,
    "accessibility": 3.0,
    "ds_brand_fidelity": 3.0
  },
  "blockers": 8,
  "warnings": 13,
  "top_blockers": [
    { "category": "ux", "line": null, "where": "01-07 left panel, group-header count capsule at ~x36-55,y208-246", "summary": "Count chip '4' detached from its row, overlaps the UI CANVASES header text and the Cut row icon", "fix": "Render the group count as a plain right-aligned tabular numeral in the header row." },
    { "category": "ux", "line": null, "where": "01 What's-new toast, 02 You're-in-Edit toast (bottom-left, x16-376)", "summary": "Toasts sit over the left panel and stack into each other; reference docks them centred above the toolbar", "fix": "Centre-dock toasts above the toolbar, one at a time, never over a panel." },
    { "category": "a11y", "line": null, "where": "05 group labels and footer hint, 01 empty-state caption and search placeholder", "summary": "--fg-3 (disabled grade) used for real text: 2.7-3.0:1 measured, needs 4.5:1", "fix": "Use --fg-2 for labels, hints and placeholder." },
    { "category": "microcopy", "line": null, "where": "01 empty state", "summary": "v1 copy: 'screen', pointer to a Design system row that is absent, select instruction contradicts the Edit toast, port and version exposed", "fix": "Rewrite to CONTRACT words, one true selection instruction, drop port and version." },
    { "category": "ux", "line": null, "where": "07-shortcuts.png", "summary": "Screenshot shows the Canvases search focused, not the shortcuts sheet; '?' may fall through to the '/' binding", "fix": "Re-capture with the sheet open; make shift+/ not match the '/' binding if the bug is real." },
    { "category": "microcopy", "line": null, "where": "04 Version history, 05 New canvas / Open design system view / Comments / Inspector chips", "summary": "Shortcut labels disagree with CONTRACT (⇧⌘G vs ⌥⌘H, N vs ⌘N, S retired, ⌘⇧ order)", "fix": "Show the key that is actually bound, or land the v2 keys in this phase; write modifiers as ⌥⇧⌘." },
    { "category": "ds-icons", "line": null, "where": "01-07 project pill mark; apps/studio/client/v2/shell/project-pill.jsx L30-35", "summary": "Pill uses a bare azure spark (the AI's reserved glyph) instead of the DS Mark tile", "fix": "Lift the stored DS Mark (tile + star) verbatim." },
    { "category": "ds-icons", "line": null, "where": "02/03 share-cluster-comments; apps/studio/client/shell/icons.jsx L353-355", "summary": "Comments glyph is a tail-less rounded square, unidentifiable at 16px", "fix": "Use the kit comment bubble with a visible tail." }
  ],
  "opt_out_applied": "palette",
  "ds_blockers_downgraded": 0,
  "passed": false
}
```
