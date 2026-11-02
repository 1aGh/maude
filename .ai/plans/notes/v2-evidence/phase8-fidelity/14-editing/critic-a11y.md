# a11y-critic — 14 Editing (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/14 Editing.tsx` (+ `.css`) · impl frames `.claude/worktrees/agent-a55262287b808e562/.scr/impl/14-editing/` (lossless PNG, 1440×900) · standard: WCAG 2.1 AA (no project a11y-rules skill) · opt_out_applied: n/a — a11y enforces at every scope_

**Method.** Same as 13: every pair was read, contrast comes from impl pixels (modal bg vs 99.5th-percentile fg), and roles/keys/focus/motion come from code. The fixtures are plain-code Homepage / Combine-kampaň canvases with no named layers and no system styles. Generic names ("div", "No style") are therefore fixture, except where a name comes from Maude's own class (ed-text-edit).

**The board's a11y intent** is `ed-edge-keys` (`14 Editing.tsx:1728-1760`): F6 moves between panels and canvas. Tab / ⇧Tab walk objects in reading order, ↵ goes inside, esc steps out. Arrows nudge 1 px (⇧ 10 px). **⌘-arrows resize 1 px (⇧ 10 px).** ← → reorder in auto layout. R T F then ↵ adds at default size. ⌘D / ⌫ duplicate / remove. ⌥⌘G frames. ⌘/ asks AI. ? lists all shortcuts. VoiceOver hears "Services, frame, 3 items, in a row — 4 of 6. Press Return to go inside." The focus ring is thicker, with a halo, never mistaken for a selection (`14 Editing.css:172`, `.ed-sel--focus` = 2.5 px `--focus-ring` + 7 px `--accent-tint`).

## What matches (verified in code)

- F6 → `ui.cycle-region` (`actions/defs/ui.ts:33`).
- Tab / ⇧Tab → `object.select-next/prev` (`actions/defs/edit.ts:228-242`). The browser's tab is swallowed so focus never leaves the canvas (`editing/focus-model.tsx:268-273`).
- R T F + ↵ → `createDefault` (`focus-model.tsx:274-283`).
- Arrow nudge (`edit.ts:272-284`) and ←/→ reorder (`edit.ts:358-371`).
- Focus ring: 2.5 px + 7 px halo on its own token (`focus-model.tsx:46-68`). It is visible in `ed-edge-keys` impl, both themes.
- Polite live region speaking the board's sentence shape (`editing/aria-live.tsx:47-58`).
- Order badges are `aria-hidden` (`editing/tab-order.tsx:265`).
- Menus are `role="menu"` with ↑↓, → submenu, ← / esc back (`apps/studio/context-menu.tsx:383-600`). The first row's ring is visible in `ed-ab-menu`.
- Align bar is a labelled `toolbar` with labelled buttons (`editing/align-bar.tsx:188-207`).
- Undo history is a `role="menu"` (`client/v2/undo/undo-history.jsx:109-138`).
- Crop takes ↵ / esc (`editing/crop-mode.tsx:384`).
- Corner dots are labelled (`editing/corner-dots.tsx:372`).
- Paste bar is `role="status"` (`editing/paste-bar.tsx:328, 348`).
- Reduced motion: every editing overlay that animates carries its own `prefers-reduced-motion` block (align-bar, nudge, gap-bands, kind-dim, hold-rings, finder-drop, reorder-slot, token-ruler, ai-scope-outline). The toolbar morph collapses to 1 ms (`toolbars/toolbar-css.ts:215-218`).

## Root causes (count once each)

| # | cause | spec | impl (measured / code) | owner | sev |
|---|---|---|---|---|---|
| E1 | **Dark: the bottom toolbar is a light island with pale glyphs** (same as 13 D1). `--island-bg` resolves to the canvas project's light-only DS token, and the ink is the dark `--maude-chrome-fg-1`. Hits every reachable artboard in dark. | dark island, light glyphs (board `Toolbar`, both themes) | `#dee1e2` island, `#b7bbc0` glyphs = **1.47:1** (3:1 needed). Light: 9.0:1. | `apps/studio/toolbars/toolbar-css.ts:23-24` | blocker |
| E2 | **Inspector segmented controls show the selected option by fill only** (same as 13 D2): Spacing Packed \| Space between, Shadow Flat \| SM \| MD \| LG, Fit Fill \| Fit \| Crop \| Tile, Height Fits \| Fixed. | `3-kit-maude-v2.css:93-101` (bg-2 + shadow + 1 px accent inset), board `.ed-n--focus` / `.k-seg-b[aria-pressed]` | **1.19 L / 1.28 D** fill difference (measured on `ed-lay-auto`) | `client/styles/3-shell-maude.css:3619-3621` | blocker |

## Per artboard

| id | theme | difference | spec | impl | owner file:line | sev |
|---|---|---|---|---|---|---|
| ed-ab-select | L/D | Name chip, handles (`aria-hidden`, pointer only; the keyboard route is the inspector W/H), artboard inspector. Height Fits/Fixed seg → E2. | — | — | `editing/artboard-handles.tsx:415-427` | (E2), D (E1) |
| ed-ab-resize | L/D | Preset ruler + hint chips render. The size pill value reads wrong during the drag (INDEX). That is a visual issue, not a11y. | — | — | — | D (E1) |
| ed-ab-arrange | L/D | Guides and gap chips are not in frame (driving). Inspector Shadow seg → E2. | — | — | — | (E2), D (E1) |
| ed-ab-tidy | L/D | Align bar labelled. The dashed preview is not shown (hover not driven). | — | — | — | D (E1) |
| ed-ab-menu | L | Matches in lens: `role="menu"`, keyboard, visible ring on row 1, "Move to trash" 4.97:1. | — | — | `context-menu.tsx:433-600` | none |
| ed-ab-menu | D | Menu passes ("Move to trash" 4.92:1, rows 14.7:1). E1 toolbar. | — | — | — | (E1) |
| ed-obj-enter | L/D | Breadcrumb and title say "div" (fixture: unnamed plain code). E2 on Spacing. | — | — | — | (E2), D (E1) |
| ed-obj-multi | L/D | The multi-selection did not form (driving). Mixed-value fields cannot be checked. Shadow seg → E2. | — | — | — | (E2), D (E1) |
| ed-obj-order | L/D | Object menu is keyboard-operable. The locked-object tip ("Logo is locked — unlock") and Layers lock/eye are not reached. Spacing seg → E2. | — | — | — | (E2), D (E1) |
| ed-lay-auto | L/D | E2 measured here. The token stops menu and ruler are not shown (fixture: no space tokens bound). | — | — | — | (E2), D (E1) |
| ed-lay-reorder | L/D | The reorder pill "… moves 3 of 5" is clipped by the left window edge, so its words are cut off. The keyboard ← → equivalent exists. | pill next to the card | clipped off-screen | `editing/reorder-slot.tsx` (pill placement) | warning |
| ed-lay-free | L/D | Constraints are native `<select>`. Shadow seg → E2. | — | — | — | (E2), D (E1) |
| ed-text-edit | L/D | **Maude's own editing class leaks into the object's name.** The inspector title / layer name reads "h1.dc-text-editing", and the same label feeds crumbs and the announce. Also, the board's **Language row** (Čeština) is missing, so a text object has no way to carry `lang`. | "Titulek", Language Čeština | "h1.dc-text-editing"; no Language | `apps/studio/canvas-shell.tsx:439-449` (`layerLabel` uses `realClasses`, which does not drop `dc-text-editing`, added at `:3429`) | warning (name), warning (i18n) |
| ed-text-style | L/D | No text style exists to override (fixture). Shadow seg → E2. | — | — | — | (E2), D (E1) |
| ed-shape | L/D | A text node was selected instead of the shape (driving). Shadow seg → E2. | — | — | — | (E2), D (E1) |
| ed-pen | L | Hint bar shows (pen keys). The point inspector (X/Y, Corner type) is the board's keyboard route for editing points, and it is not reached. | point inspector | not reached | `editing/pen/` | warning |
| ed-pen | D | Same as light, plus E1. | — | — | — | (E1) |
| ed-img | L/D | Crop mode + "↵ done · esc cancel" match. The **Zoom** field (the keyboard way to scale inside the crop) is missing. Fit seg → E2. | Zoom 128 % field | none | `client/v2/inspector/sections` (image) | warning, (E2), D (E1) |
| ed-comp-pick | L | Picker: `role="dialog"` `aria-modal` `aria-label="Components"`, labelled search, rows with a `:focus-visible` 2 px ring, variant chips `role="group"`. | — | — | `client/v2/inspector/component-picker.jsx:212-306`, `component-picker.css:84-88` | none |
| ed-comp-pick | D | E1 | — | — | — | (E1) |
| ed-comp-instance | L/D | Instance inspector. No overrides made, so the override dots are not shown (fixture). Spacing seg → E2. | — | — | — | (E2), D (E1) |
| ed-inspector | L/D | Interaction / Export / "Tokens it uses" are not shown (content). Shadow seg → E2. | — | — | — | (E2), D (E1) |
| ed-edge-ask | L/D | Inline composer + "1 element" chip. **Order badges ("1.3.2.1 …") sit over the selection and composer while asking.** They are `aria-hidden` but visually cover the content, and the board draws none. | outline + tag only | numbered pills overlay | `editing/tab-order.tsx:214-265` (shown on keyboard modality) | warning |
| ed-edge-huge | L/D | Page fits, chip shown. No minimap / "looking at" line. That is content, not a lens difference. | — | — | — | D (E1) |
| ed-edge-undo | L | Undo history popover is a keyboard menu. AI and people rows are absent (signed out, solo). | — | — | `undo-history.jsx:109-138` | none |
| ed-edge-undo | D | E1 | — | — | — | (E1) |
| ed-edge-keys | L/D | Mostly as designed (see "What matches"). Three differences. **(1) No ⌘-arrow resize chord.** The keymap has no `⌘↑↓←→` binding (`actions/keymap.gen.ts`, `actions/defs/edit.ts`). The inspector W/H fields are the only keyboard resize, so this is a warning rather than a 2.1.1 failure. (2) Badges overlap each other (1.1 sits on 1.2) because they are pinned at each child's top-left. (3) The spoken name falls back to the tag ("div, frame, …") on unnamed nodes (`crumbs.ts:43-54`). That is fixture-driven, but plain-code canvases are common. | ⌘ ↑↓←→ resize; legible 1–6 badges | none; overlapping badges | `actions/defs/edit.ts` (missing def), `editing/tab-order.tsx:148-175, 186-212` | warning ×2 (+ fixture note) |

## Unreachable (spec-only)

| id | what makes it reachable | sev |
|---|---|---|
| ed-edge-ai | A signed-in AI run in the lane (stubbed signed-out). When reached, check that the AI-owned region tag is announced: `editing/ai-scope-outline.tsx` draws it, and its skeleton shimmer has a reduced-motion block. | blocker |
| ed-edge-tereza | A second synced collaborator (presence ring + read-only fields). When reached, check that "Tereza is editing" is text, not only the sky ring colour. | blocker |
| ed-edge-paste | A real Figma clipboard + Figma connection (the synthetic paste fetches through Figma). `paste-bar.tsx` is `role="status"`. | blocker |

```json
{"canvas":"14 Editing","critic":"a11y-critic","blockers":5,"warnings":8,"verified_ids":["ed-ab-menu·light","ed-comp-pick·light","ed-edge-undo·light","ed-ab-tidy·light"]}
```
