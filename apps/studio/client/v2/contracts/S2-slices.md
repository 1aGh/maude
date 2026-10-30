# S2 Editing: slice plan (Phase 5, lane L1, after S3)

Planning spike for work package S2. Plan row: `.ai/plans/feature-maude-v2-redesign.md` § Phase 5 "S2 Editing".
Canvas: `.design/ui/v2/14 Editing.tsx` (26 artboards, 9 sections). Checklist: `.ai/plans/notes/v2-inventory/E-ds-editing-annotations.md`
§ "14 Editing" (l. 316–636) + cross-cutting (l. 924–996). Contracts this plan binds to: V2-1.2 (toolbars), V2-1.4
(element ids, canvas-only `data-cd-*`), V2-1.5 (undo projection), V2-1.6 (DS pinning, Detach), V2-1.9 (object menu ›
Version history, reverse words table), V2-1.12 (formats), V2-1.13 (`@maude/ds`, Tier-1 names), V2-1.15 §5.12
(`holding` awareness field). Gate 0: A10, A11, C16, D2, D6, D7, D18. Agreed with the neighbours on the team channel
(2026-10-18): plan-s3 (link format, click-handling boundary) and plan-s5 (op log ownership). Their answers are cited
where they bind.

## 1. Scope recap and what already exists

**S2 builds** every 14 behaviour:
- artboards: 8 handles, preset ruler, magenta smart guides + equal gaps, Tidy, ⌘D rhythm, rename in place;
- objects: enter frames, breadcrumb, multi-select, rotate, nudge, frame/unframe, z-order, lock, hide;
- auto layout with the token ruler and the reorder slot; constraints;
- text in place (Czech ties, Language, Case, style overrides);
- shapes with corner dots; Pen + Combine shapes; images + crop;
- components (⇧I, instances, variants, overrides, Detach);
- the 10-section inspector + Advanced (D18), the Interaction section (hover), the words → CSS writer;
- the co-edit soft lock (A10), Undo history, the Figma paste bar, the keyboard/VoiceOver model.

**Phase 4 and earlier already ship** (slices build on these, never redo them):
- Edit toolbar slots in `bridge/canvas-modes.ts` `MODE_TOOLS`. V/H live. F/T/I are momentary slots on today's insert
  verbs. R, P, ⇧I and More (Line · Ellipse · Polygon · Crop · Export area) are `pending: 'S2'`.
- `tool.<id>` actions are derived per slot (`actions/defs/tool.ts`).
- Inspector island opens on selection (`client/v2/shell/inspector-follow.js`). Its content is still v1:
  `client/inspector/{inspector-panel,css-knobs,artboard-knobs,layers,token-popover,css-vocab,color-picker}.jsx`, moved
  in V2-0.2 and not re-skinned.
- Left panel Canvases · Layers · Assets (`client/v2/left-panel/*`), Fold component (`client/v2/fold`), Search, "?".
- Registry `actions/defs/edit.ts`: undo/redo, copy/cut/paste, select all/none, `object.duplicate`,
  `edit.copy/paste-properties`, `object.select-child/parent/next`, `object.remove`, `object.nudge`.
  `PENDING_MENU_IDS` pins `edit.undo-history` → S2.
- V2-2.19 shipped `element-ids.ts` (stamper, `checkIds`, `stripCanvasOnly`), plus `applySetLocked`/`applySetHidden`
  in `canvas-edit.ts`, which **no route calls yet**. `canvas-shell.tsx` `lockedKeySet()` still reads the per-user
  `__canvas_meta__.locked`.
- Writers + routes: `/_api/edit-{css,text,attr,scope,array-src}`, `insert-{element,artboard,sequence}`,
  `duplicate-{element,artboard}`, `delete-{element,artboard}`, `resize-artboard`, `set-artboard-{hug,style,kind,label,guides,print}`,
  `reorder(-revert)`, `convert-to-absolute`, `detach-component`, `component-map`, `toggle-hide` (v1).
- Canvas machinery: snap guides (DDR-046 `--guide-magenta`, `use-snap-guides.tsx`), equal spacing
  (`equal-spacing-*`), spacing/grid handles, `ReorderDrag`, `MultiArtboardToolbar`, `ContextualToolbar`, `DCMiniMap`,
  `text-caret.ts`, `undo-stack.ts` (DDR-050 iframe stack).
- The `dgn` table holds `select`, `select-set`, `highlight`, `select-by-id`, `locked-set`, `layers-tree`, `*-request`, `record-edit`.

**Not built anywhere yet:** the local op log + `/_api/project/undo-stack`. **S5 owns it** (plan-s5: S5.1a kernel
pieces, S5.1b in-process kernel, S5.5 routes + the pure reducer `client/v2/undo/projection.js`). S2 consumes it.

## 2. Open questions resolved here

| # | Question | Decision · why |
| --- | --- | --- |
| Q1 | How do the ~25 new structural ops reach the server? | **One dispatch route** `POST /_api/edit-op` (main origin only, `minRole: edit`) over pure writers `edit-ops/<op>.ts`. Precedent: `/_api/clip-edit`. Twenty-five routes and twenty-five `*-request` messages would bloat the route table and the dgn table, and the parity test would gain 25 rows instead of 1 dispatch with an op list. Existing `/_api/edit-*` routes stay as they are. |
| Q2 | One dgn message per op? | **No:** one `edit-op` (canvas → shell) + `edit-op-result` (shell → canvas). `op` is the registry action id, so menus, keys and ⌘K run the same path. |
| Q3 | Undo for new ops before S2.20 (DDR-050 stack)? | Every write is one kernel action (op-log projects: all local after S5.1b, plus transactions-mode links). Only legacy-hub links fall back: an `edit-op` CommandRecord whose undo is `op: 'revert' {writeId}`, a three-way revert of that write (V2-1.5 Q5 fallback, `sync/source-merge.ts`). No positional-id records. |
| Q4 | Who owns On click? | **S3** (plan-s3): `data-cd-link` (canvas `path#artboard`, or `https:`/`http:` only), `applySetLink`, action `element.set-link`. S2's Interaction section calls it. S2 owns **On hover** only. |
| Q5 | Hover format: inline style can't express `:hover`. | `data-hover="<preset>"` from a closed vocabulary (`lift-resting`, `lift-floating`, `lift-sheet`, `darken`, `underline`). canvas-lib injects one fixed rule set; handoff/HTML export turns it into `:hover` CSS. It is **outside** `data-cd-*`: it is design and must export. No `formatVersion` bump: v1 renders the element and ignores the attribute (same reasoning as V2-1.4 §8 V2-1.12). Written into `S2-hover-format.md` by S2.5's first commit. |
| Q6 | Combine shapes needs boolean geometry; `draw/` has none. | **Non-destructive SVG composition** in one `<svg>`: union = one `<path>` of the subpaths, `fill-rule="nonzero"`; subtract = `<mask>`; intersect = `<clipPath>`; exclude = `fill-rule="evenodd"`. The operands stay editable and it exports identically as SVG. A destructive Flatten (needs a clipping dependency + a DDR-071-style dependency DDR) is out of v2.0 and gets a Progress-log line. |
| Q7 | "Auto · space between" in the Gap menu vs the Spacing segment (inventory #12) | One property, two entry points. The Gap menu's "Auto" row sets Spacing = Space between (`justify-content: space-between`); both controls show the same state. |
| Q8 | ⌫ on an object: Trash or undo? (inventory #10) | V2-1.5 C17: an ordinary edit action ("Remove ⌫"). Artboards are `kind: 'trash'` ("Move to trash ⌫"). Words per CONTRACT §3. |
| Q9 | Lock/hide store | V2-1.4/V2-2.19: shared `data-cd-locked` / `data-cd-hidden` in the TSX. S2.6 wires the writers to `edit-op` and switches `lockedKeySet()` to read the DOM attributes. It never reintroduces per-user locks (V2-2.14 migrates old ones). |
| Q10 | People's soft lock: enforced? | No (V2-1.15): people = awareness `holding`, advisory. Only AI holds are enforced (`409 held-by-ai` on `edit-op` and `/_api/edit-*`). |
| Q11 | Undo history click | "Undo to here" = one `POST undo {actionIds}` (V2-1.5 §5.4). |
| Q12 | Kind and Theme placement (D6, undrawn) | Kind chip = artboard kind (C16). Kind is a row in the artboard inspector. Theme sits under that inspector's Advanced. Fit / Reset position / Convert to absolute / Open Timeline go in the artboard menu › Advanced ▸. |
| Q13 | Before S10: the ⇧I picker's Patterns group, and "Update <X> for every canvas…" | The picker reads `system/<ds>/components.json` + `@maude/ds` exports (Brand = Logo/Icon, Components = manifest). The Patterns group renders only when S10 serves patterns. "Update … for every canvas…" renders only once S10 registers `ds.review-update` (the `PENDING_MENU_IDS` pattern, pinned by a test). |
| Q14 | Export area (More) | A transient region tool: it draws a box and opens the export sheet (⇧⌘E) with Scope = that region. It writes nothing to the file. Needs S8's sheet to take `region` (cross-lane request, §2 cross-lane table). |
| Q15 | Object Export and Photo (C21, D16) | S8 fills the inspector Export section and owns Photo. S2 provides the section slot (`client/v2/inspector/slots.js`) and the Adjust… / Remove background entries. Until S8 lands, the v1 "Export selection…" stays in object menu › Advanced (nothing deleted). |

**Cross-lane contracts (needed before the slice named):**

| Contract | Writer | Needed by |
| --- | --- | --- |
| `S3-links-format.md` (`data-cd-link`, `element.set-link`, `https:` allowed, trusted open) | S3.0 | S2.5 |
| `S5-kernel-foundation.md` + S5.1b local kernel + S5.5 `undo-stack`/`undo{actionIds}` + `client/v2/undo/projection.js` | S5 | S2.20 |
| V2-1.15 run registry `objects` + `409 held-by-ai` + the S5 composer component | S5 | S2.18, S2.19 |
| Hub `sanitizeHoldingState` + `beforeHandleAwareness` actor overwrite (V2-1.15 §5.12/§5.3; `apps/hub/src/server.mjs`, `files-ctl.mjs`) | L4 hub lane (S9), opus | S2.18 |
| `S10-ds-review-entry.md`: `ds.review-update {canvas, target: typeRole/component}` and "Go to <component>" deep link | S10 | S2.12, S2.17 (rows hidden until then) |
| Export sheet `region` param + inspector Export section filling `slots.js` | S8 | S2.13 (Export area), S2.4 (slot only) |
| `S2-edit-ops.md` (this file §3a, frozen as its own note) | S2.1 | S12 (skill), S4 (`el:` rects unchanged), S5 (⌘/ scope) |
| `S2-hover-format.md` | S2.5 | S3 (Preview plays hover), S8 (handoff) |

## 3. Slice table

### 3a. Interfaces every slice codes against (S2.1 freezes them in `S2-edit-ops.md`)

```ts
// edit-ops/types.ts
type ElementRef = { artboard: string; element: string; occurrence?: number }; // V2-1.4 §7
interface EditOpRequest {
  file: string;              // canvas path, designRoot-relative
  op: EditOpId;              // == registry action id, e.g. 'object.frame'
  targets: ElementRef[];     // stamped first if they carry no authored id (V2-1.4 rule 3)
  params?: Record<string, unknown>;
  expectRev?: string;        // refuse with 409 'stale' when the file moved underneath
}
type EditOpResult =
  | { ok: true; actionId: string | null; writeId: string; created?: ElementRef[] }
  | { ok: false; code: 'held-by-ai' | 'locked' | 'stale' | 'invalid' | 'forbidden'; message: string };
// edit-ops/<op>.ts — pure, no IO
export const op: { id: EditOpId; apply(source: string, req: EditOpRequest): { source: string; created?: ElementRef[] } };
```

Rules:
- one request = one file write = one kernel action;
- `data-cd-*` is never written by the words writer;
- tokens stay `var(--…)` with Tier-1 names only (V2-1.13);
- every op has a `canvas-tsx.md` section ("the same result by hand") and a parity test: route result ≡ the documented file edit, as goldens.

Words → CSS: `edit-ops/words-css.ts` (pure, shared by the inspector and the server) exports `toCss(words)` /
`toWords(css, tokens)`. `toWords` is the reverse table V2-1.9 reuses. The table is inventory §H verbatim, plus
`data-hover` (Q5); On click belongs to S3 (Q4).

Canvas side: `apps/studio/editing/` (new, S2-owned). `editing/index.tsx` mounts once in `canvas-shell.tsx`;
each slice adds its own `editing/<area>.tsx` plus one append-only line in `editing/index.tsx`. The inspector is
`client/v2/inspector/` (new): `frame.jsx`, `sections/<name>.jsx`, `kinds/<kind>.jsx` (frame · text · image ·
path · shape · instance · artboard · multi) and `slots.js`, with append-only registries.

### 3b. Slices

Columns: **Rows** = ledger artboard rows made verifiable (`14/…`) · **Model** · **Deps** · **Turns** (estimate).
Testids follow `<area>-<thing>[-<id>]` (`insp-*`, `edit-*`, `ab-*`, `obj-menu-*`); every re-emitted v1 testid is
named in the slice. "Lead patch" = a shared file the slice asks for, never edits.

| ID | Title | Rows | Files owned | Lead patch requests | Model | Deps | Done-when (observable) | Red-first tests | e2e / scenario | Turns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **S2.1** | Edit foundation, the selection model, enter frames, breadcrumb | ed-obj-enter | `editing/index.tsx`, `editing/selection.tsx`, `editing/crumbs.ts`, `edit-ops/{types,dispatch,revert}.ts`, `routes/edit.ts`, `S2-edit-ops.md`, `client/v2/inspector/crumbs.jsx`, `test/edit-op-*.test.ts` | `routes/index.ts` allSpecs += `editRoutes`; dgn table += `edit-op` / `edit-op-result`, `select` payload += `refs: ElementRef[]`, `crumbs`, `kind`; one mount line in `canvas-shell.tsx` (L1 window: S2 holds it); registry `object.enter` (↵ / double-click), `object.step-out` (esc, under `ui.step-back`) | **opus**: route table + dgn bridge semantics, revert fallback | S3 done (L1) | Click selects the top object, double-click goes inside, esc steps out one level; dashed parent outline; tag "Brand systems · 400 × 232"; crumbs "Desktop › Services › Brand systems" + esc kbd in the inspector; Layers mirrors both ways; a click on a locked object selects its parent; `POST /_api/edit-op` refuses non-editors (403), the canvas origin (404/405) and AI-held targets (409) | dispatch refuses a viewer · in neither canvas allowlist (`GET → 405`, parity) · esc ladder · crumbs from a nested fixture · revert round-trip on a legacy link | `apps/desktop/e2e/scenarios/edit-enter-frames.e2e.ts` (coordinates: iframe not DOM-reachable) | 150 |
| **S2.2** | Inspector frame + Advanced (D18) *(shell-only)* | — (D18 home) | `client/v2/inspector/{frame,advanced,kinds/index,slots}.jsx`, `inspector.css`; moves `client/inspector/*` behind it | `view.inspector` / `view.inspector-on-select` unchanged; remove the v1 Designer/Advanced toggle binding (rule 13); registry `inspector.copy-css`, `element.copy-id`, `element.set-id` (agent: file) | sonnet | — (parallel with S3) | One kind chip (C16); numbered section scaffold with "+" adders and explainer lines; "› Advanced" folds hold the **unchanged** v1 raw editor. Re-emitted: `css-panel`, `inspector-custom-css`, `inspector-html-attrs`, `inspector-grid-tracks`, `inspector-body-layout`, `.insp-cp-idtag`, `.insp-cp-tok…`, `inspector-select…`. Element id field renames the id and every durable reference (V2-1.4 §5.5; refused while held). Designer is the only default | nothing-deleted rows A-css-tab, A-tag-and-class, A-custom-css, A-html-attrs, A-token-popover, A-grid-tracks, A-body-layout, A-inspector-vocabulary, A-selected-element-s-selector flip to their v2 home · id rename rewrites the references in a fixture | studio `test/e2e/inspector-advanced.e2e.mjs` | 120 |
| **S2.3** | Words → CSS writer + Position · Size · Layout *(shell-only)* | — | `edit-ops/words-css.ts`, `client/v2/inspector/sections/{position,size,layout}.jsx`, `client/v2/inspector/token-chip.jsx` | — | sonnet | S2.2 | Hug/Fill/Fixed select · Clip content · Direction seg (row/column/grid/free) · Gap token · Spacing Packed/Space between · Padding H/V with per-side · Align 3×3 · Constraints widget + selects · X/Y/Rotation. Chips use 13's names. "V 10 · not a token" + **Bind** = nearest token. Writes go through `/_api/edit-css` with Tier-1 names only | the words table as goldens, both directions (`toWords(toCss(x)) == x`) · Bind picks the nearest stop · no alias names emitted (`ds-check` S2 rule on the output) | — (S2.5 covers it) | 140 |
| **S2.4** | Fill · Corners · Border · Effects · Type + Mixed *(shell-only)* | — | `sections/{fill,corners,border,effects,type}.jsx`, `kinds/multi.jsx` | — | sonnet | S2.3 | Fill (+ adds colour/gradient/image) · Corners with unlink → ↖↗↙↘ · Border (+ width, Inside/Centre/Outside) on boxes, Stroke on lines/paths · Shadow seg from the DS elevation names (Flat/Resting/Floating/Sheet or the system's own) · Opacity · Type (text inside). Multi: shared values, "Mixed", mixed swatches, "Changes go to all 3. Text settings show when only text is selected." | Border position → CSS (inside = inset box-shadow) goldens · Mixed reducer · elevation names come from the system | — | 120 |
| **S2.5** | Interaction (hover) + Export slot + full-inspector assembly *(shell-only)* | ed-inspector | `sections/{interaction,export-slot}.jsx`, `S2-hover-format.md`, canvas-lib hover rule set (**lead patch**, see next column) | `canvas-lib.tsx` += the `data-hover` rule set (L1 file, one block); `handoff.ts` emits `:hover` (S8 consulted); registry `element.set-hover` (agent: file) | sonnet | S2.4, S3.0 `S3-links-format.md` | ed-inspector matches: 10 sections in order + Advanced last ("CSS · tokens · id"), On click via `element.set-link` (S3), On hover "Lift to Floating", Export section slot (S8 fills; empty slot shows the presets per kind, C21), every explainer line verbatim; on-canvas padding bands + tag "Book a call · 148 × 44 · Hug" | hover attribute survives `stripCanvasOnly` and exports as `:hover` · section order pinned · copy goldens per CONTRACT §3 | ledger evidence ed-inspector | 100 |
| **S2.6** | Object menu + frame/unframe, z-order, lock, hide, nudge | ed-obj-order | `editing/object-menu.tsx`, `editing/nudge.tsx`, `editing/lock-badge.tsx`, `edit-ops/{frame,unframe,z-order,lock,hide,select-matching}.ts`, `client/inspector/layers.jsx` → `client/v2/inspector/layers-row-tools.jsx` | registry `object.frame` (⌥⌘G, ⌘G alias, `when: mode=edit`), `object.unframe` (⇧⌘G edit), `object.bring-front` ⌘], `object.bring-forward` ], `object.send-backward` [, `object.send-back` ⌘[, `object.lock` ⇧⌘L (edit; `annotation.lock` keeps Preview), `object.hide`, `object.select-matching`; remove the v1 element-menu bindings they replace (rule 13); `PENDING_MENU_IDS` += S1's `history.object` row until S1 registers it | sonnet | S2.1 | Menu rows/order exactly as inventory §B (Ask AI ⌘/ … Advanced ▸ Copy CSS · element id · Export selection… (until S8) · Remove ⌫); ⌥⌘G wraps into "Frame · stacked ↓"; ⇧⌘G disabled when not applicable; lock badge + "Logo is locked · ⇧⌘L unlocks"; hide greys the row and keeps it in Layers; ↓ 1 px / ⇧↓ 10 px; ⌥ shows distances; `lockedKeySet()` reads `data-cd-locked`. Re-emitted: `canvas-menu-item-copy-css`, `canvas-menu-item-copy-id`, copy/paste style | ⇧⌘L in Edit never hits a quiet sticky (inventory #19) · ⌘G in Edit = frame, in Preview = group (scope test) · lock is shared (two clients) · frame/unframe goldens keep ids, the new frame gets a new id · nothing-deleted D6 element rows + A-copy-css/-id/-style | `edit-object-ops.e2e.ts` | 150 |
| **S2.7** | Multi-select, the align bar, rotate | ed-obj-multi | `editing/align-bar.tsx` (objects + artboards), `editing/rotate-handle.tsx`, `edit-ops/{align,distribute,rotate}.ts` | registry `align.{left,hcentre,right,top,vmiddle,bottom}`, `distribute.{h,v}`, `object.rotate`; `ContextualToolbar` retired in the same commit (D7: align bar + object menu Advanced ▸) | sonnet | S2.6, S2.4 | ⇧-click/marquee; align bar "3 objects" (no Tidy) with tooltips; magenta guide + chip "X 64"; rotate handle outside a corner, "Rotate · ⇧ 15°"; Rotation row; Mixed inspector (S2.4) | align/distribute goldens · ⇧ snaps to 15° · D7 nothing-deleted row moves home | `edit-multi.e2e.ts` | 120 |
| **S2.8** | Artboard select + resize presets + artboard inspector + long pages | ed-ab-select, ed-ab-resize, ed-edge-huge | `editing/artboard-handles.tsx` (8 handles), `editing/preset-ruler.tsx`, `editing/sticky-name.tsx`, `editing/minimap-context.tsx`, `client/v2/inspector/kinds/artboard.jsx` (supersedes `artboard-knobs.jsx`) | `--guide` token in maude-v2 tokens + HUD gen (V2-2.6 generator, DDR-046 rename `--guide-magenta` → `--guide`); `canvas-lib.tsx` DCArtboard handle hooks (L1); registry `artboard.add-width` | sonnet | S2.1 | Name turns azure + "1440 × 1573"; 8 handles; edge drag snaps on the ruler (Tablet 834 · Laptop 1280 · Desktop 1440) with a ghost and "Laptop · 1280 × 1573"; ⌘ ignores presets, ⌥ resizes from the centre; a bottom-edge drag switches Height to Fixed; inspector Preset · Size · Fits content/Fixed · Clip · Background token · Layout · Kind row · Theme under Advanced · Other widths "Add a width" · Export slot; a 6000 px page keeps its name stuck to the top, shows the contextual minimap with sections, "You're looking at 1727–5636 of 6000." | preset snap math (world units, DDR snap-tolerance) · bottom-edge → Fixed · minimap sections from top-level children · nothing-deleted A-artboard-theme, A-body-layout | `edit-artboards.e2e.ts` (part 1) | 150 |
| **S2.9** | Arrange: smart guides, equal gaps, Tidy | ed-ab-arrange, ed-ab-tidy | `editing/artboard-guides.tsx` (re-skin of `use-snap-guides` / `SnapGuideOverlay`), `editing/tidy-preview.tsx`, `edit-ops/tidy.ts` (meta positions, Plane A) | registry `artboard.tidy`; `MultiArtboardToolbar` retired for the align bar | sonnet | S2.7, S2.8 | Lifted shadow while dragging; top-edge guide + soft bottom guide; equal-gap chips "80" ×3 in `--guide`; bubble "X 3480 · Y 0"; marquee/⇧-click → one parent box with 8 handles; align bar "4 artboards" + **Tidy up**; dashed preview "One row, even gaps"; inspector "4 artboards" Mixed, "Changes go to all 4." | guides never use the selection azure (token test) · tidy is one action and ⌘Z restores · positions stay out of `.view.json` (DDR-115) | `edit-artboards.e2e.ts` (part 2) | 130 |
| **S2.10** | Artboard menu, ⌘D rhythm, duplicate at another width, rename in place | ed-ab-menu | `editing/artboard-menu.tsx`, `editing/rename-in-place.tsx`, `edit-ops/duplicate-at-width.ts` (wraps `applyDuplicateArtboard`) | registry `artboard.duplicate-at-width`, `artboard.rename`, `artboard.duplicate` (⌘D, artboard selection), `artboard.ask-ai` (⌘/ → S5); the artboard menu's Advanced ▸ = Fit just this artboard · Reset position · Convert layout to absolute · Open Timeline (S7) | sonnet | S2.9 | Menu rows as §A; ⌘D lands at the row's existing gap, selected "Desktop 2", and repeats the rhythm; ⌥-drag duplicates; Duplicate at another width ▸ Laptop/Tablet/Mobile/Custom width…; double-click the name → a field that grows, háčky kept; ↵ saves, esc cancels, tab moves to the next artboard's name; Move to trash ⌫ (kind trash) | gap-rhythm math · tab order follows rows · Czech names round-trip · D6 artboard rows + A-reset-position, A-convert-layout move home | `edit-artboards.e2e.ts` (part 3) | 120 |
| **S2.11** | Layout: auto layout, the reorder slot, free placement + constraints | ed-lay-auto, ed-lay-reorder, ed-lay-free | `editing/{gap-bands,token-ruler,reorder-slot,place-freely}.tsx` (re-skin of `use-spacing-handles` / `ReorderDrag`), `edit-ops/{place-freely,constraints}.ts`, `kinds/frame.jsx` | registry `object.place-freely`, `object.reorder-earlier/later` (← → in auto layout); `layout.convert-to-absolute` re-homed under Layout › Advanced | sonnet | S2.6, S2.3 | Bands tinted in the guide colour with chips; dragging a gap shows the token ruler (12 · 16 · 24 · 32 · 48), "⌘ any number · ⌥ every gap at once"; Gap menu per Q7; reorder: the card follows 1:1, the numbered slot opens, neighbours slide on `--dur-panel` `--ease-out` (reduced motion: they jump, the slot fades in), esc puts it back, ⌥ copies, dragging out sets Place freely; Layers shows the same slot; constraints keep "Datum" 64 from the corner on the 9:16 copy | token ruler stops from the system · reorder = one action · Place freely writes CSS, not `data-cd-*` (V2-1.4) · reduced-motion path | `edit-layout.e2e.ts` | 150 |
| **S2.12** | Text in place, styles, Czech ties | ed-text-edit, ed-text-style | `editing/text-in-place.tsx` (on `text-caret.ts`), `edit-ops/{text-style,czech-ties,text-detach}.ts`, `kinds/text.jsx` | registry `text.set-language`, `text.set-case`, `text.reset-style`, `text.detach-style`, `text.use-style`; `tool.el-text` stops being momentary (T: click to type) — `MODE_TOOLS` patch: drop `insert: 'text'` | sonnet | S2.4, `S10-ds-review-entry.md` (row hidden until then) | Double-click shows a caret with the edit-tone ring; Style "Aa Plakát ⌄" from `components.json` `typeRoles`; Resizing Width/Height/Fixed; Case As typed/AA; Language "Čeština" writes `lang` and NBSP after v k s z o u i a plus „quotes"; tie arcs while editing; override dot "Changed here" + "Size differs from Plakát." + Reset; Detach → "No style" + Use a style | ties: every one-letter word, never inside a URL/code · override detection = computed vs role · detach inlines exactly the role's values · Czech copy goldens | `canvas-text-editing.e2e.ts` (rewritten deliberately) | 140 |
| **S2.13** | Frame/Shape tools, More (Line, Ellipse, Polygon, Export area), corner dots | ed-shape | `editing/draw-tools.tsx`, `editing/corner-dots.tsx`, `edit-ops/{insert-shape,corner-radius}.ts`, `kinds/shape.jsx` | `MODE_TOOLS`: drop `pending:'S2'` from el-shape, line, ellipse, polygon, slice; F becomes a draw tool (an artboard on empty canvas, a frame inside one); old R/O bindings die (D2, rule 13) | sonnet | S2.4, S8 `region` param for Export area | R → drag draws "Podklad · 216 × 216"; one dot inside each corner, the lit one dragged with chip "8"; More popover; Corners unlink ↖↗↙↘; Border (+) with Position; Effects from the elevation names; Export area opens ⇧⌘E with that region | Ellipse reachable only through More (D2) · corner-radius goldens per corner · Export area writes nothing to the file | `edit-shapes.e2e.ts` | 120 |
| **S2.14** | Pen + Combine shapes | ed-pen | `editing/pen/{draw,points,handles}.tsx`, `edit-ops/{path,combine}.ts` (path model on `draw/geometry.ts`), `kinds/path.jsx` | `MODE_TOOLS`: drop `pending` from el-pen (P); Pen B → Marker M already moved (D2); registry `shape.combine.{union,subtract,intersect,exclude}` | sonnet | S2.13 | Click = sharp point, drag = smooth; ⇧ 45° chip; "Click here to close"; ↵/esc finishes an open path; double-click a path → points, handles, the previous curve dashed, chips Smooth/Sharp; ⌥-drag breaks a handle; ⌫ removes a point; Path chip "Pen · 4 points"; Stroke token + width + Ends; Combine per Q6, disabled for one ("Two or more") | path model round-trips the SVG `d` · combine output renders identically after export (SVG golden) · point-type toggle | `edit-pen.e2e.ts` | 150 |
| **S2.15** | Images, crop mode, the Figma paste bar | ed-img, ed-edge-paste | `editing/{image-drop,crop-mode,paste-bar}.tsx`, `edit-ops/{image-fit,crop}.ts`, `kinds/image.jsx` | `MODE_TOOLS`: drop `insert:'image'` (I stays → Assets) and `pending` from crop; registry `image.crop`, `image.replace`, `figma.make-editable` (agent: cli → S8's figma verb); paste detection of the Figma clipboard MIME in the shell paste path (`app.jsx` residue or `client/v2/shell` paste handler) | sonnet | S2.4; S8 `/_api/figma/*` Make editable + Photo (12) | I → Assets tab; a dropped tile fills the frame cropped to fit; ↵ places onto the selected artboard (CONTRACT §7); double-click → crop with a faded ghost, brackets, "↵ done · esc cancel"; inspector thumb + "4032 × 3024" + Replace… · Fit Fill/Fit/Crop/Tile · Zoom · Adjust… / ✦ Remove background (open S8's Photo); Figma paste → image + bar "Pasted from Figma as an image of “Hero / v3”." + Make editable + the Dev Mode line | fit/crop → object-fit/position goldens · Figma payload detection fixture · "edits apply to this use only" (rule photo-edits) | `edit-images.e2e.ts` | 140 |
| **S2.16** | Component picker ⇧I and placement | ed-comp-pick | `client/v2/inspector/component-picker.jsx` (shell panel via `tool-panel-open`), `editing/place-ghost.tsx`, `edit-ops/insert-component.ts`, `routes/edit.ts` += `GET /_api/ds/components` | `MODE_TOOLS`: drop `pending` from component (⇧I); dgn += `place-component` (shell → canvas) | sonnet | S2.1; patterns group when S10 serves them | Popover "Search components" + system line; groups Brand / Components (variant chips Plné / Obrys) / Patterns (Q13); footer Open Design system; the ghost follows the pointer, snaps to the centre guide, a click places it linked (`import { … } from "@maude/ds"`); ↵ places into the selected frame; a left-out canvas gets `data-ds-rev="head"` (V2-1.6) | insert adds the import once · `data-ds-rev` only on left-out canvases · picker hidden for non-editors and refused server-side | `edit-components.e2e.ts` (part 1) | 120 |
| **S2.17** | Instances: override, swap, reset, detach, go to main | ed-comp-instance | `kinds/instance.jsx`, `edit-ops/{swap-variant,reset-overrides,detach-instance}.ts` | registry `component.swap-variant`, `component.reset`, `component.detach` (reuses `/_api/detach-component` for local components), `component.go-to-main` (→ S10 deep link); nothing-deleted A-edit-scope-local-shared-detach | sonnet | S2.16, `S10-ds-review-entry.md` | Inspector kind "Instance"; Component + Variant selects ("Your text and colour come along"); Content Text/Fill dots; "2 changes from Tlačítko." + Reset; "Update Tlačítko for every canvas…" (Q13); Go to Tlačítko · Detach with its line; a swap keeps text and overrides | swap preserves children + overrides · detach = a plain frame with the identical look (render diff = 0) · reset drops only the overrides | `edit-components.e2e.ts` (part 2) | 130 |
| **S2.18** | Holds: people soft lock (A10) + AI holds read-only | ed-edge-tereza, ed-edge-ai | `editing/hold-rings.tsx`, `client/v2/inspector/view-mode.jsx` (`ed-insp--view`), `use-collab.tsx` `holding` field (L1), `collab/awareness-bridge.ts` sanitizer client half | hub sanitizer patch (L4, see §2 cross-lane table); `409 held-by-ai` check in `/_api/edit-*` + `edit-op` (http.ts residue: lead) reading the V2-1.15 registry | **opus**: co-edit/awareness concurrency, AI enforcement | S2.2, S5 run registry `objects`, hub patch | Tereza's sky ring + name tag + cursor; you can select; the inspector goes view mode (every value readable, Interaction included) with "Tereza is editing See pricing. You can look; the fields open when she moves on." + **Comment** (S9 composer); frees on deselect / blur / 30 s idle / disconnect, by the receiver's clock. AI: spark-dashed outline only on Footer, tag "AI is drawing the footer", click → "Footer is AI's until it's done · Stop in the AI chat", inspector line; everything else editable | `holding` set/clear matrix (focus, gesture, 30 s, blur, disconnect) · a foreign `actor` is ignored · a hold from a read-only connection is dropped · a write on an AI-held object → 409 while a person's hold → allowed (advisory) · two-client test both directions (memory: test sync both ways) | `apps/desktop/e2e/scenarios/multiplayer/edit-soft-lock.e2e.ts` | 150 |
| **S2.19** | ⌘/ on a selection, in place | ed-edge-ask | `editing/ask-bubble.tsx` (anchors S5's composer component), `editing/ai-scope-outline.tsx` | registry `ai.ask-selection` ⌘/ (selection attached; stamps targets before `run.begin`, V2-1.4 §5.6) | sonnet | S2.18, S5 composer + run registry | 3 cards selected → ⌘/ → the bubble anchored under the selection; AI outline on the selection only, "AI is adding a link to 3 cards", skeleton lines; "One step — ⌘Z undoes all of it · the rest of the page stays yours"; the folded AI icon shows a dot | scope = ElementRef[] stamped before begin · writes outside the scope refused by the hook (V2-1.18, S5's test reused) | `edit-ask-ai.e2e.ts` | 90 |
| **S2.20** | ⌘Z projection + Undo history | ed-edge-undo | `client/v2/undo/{undo-history,use-undo-projection}.jsx` (on S5's `projection.js`), `editing/undo-preview.tsx` (highlight), `undo-hud.tsx` retirement path | registry `edit.undo-history` (leaves `PENDING_MENU_IDS`); `edit.undo`/`edit.redo` defs stay the lead's, rebound to the projection; dgn `dgn:'undo'/'redo'` only for non-op-log projects (V2-1.2 feed); `/_api/project/undo` is S5's | **opus**: undo/kernel concurrency | S5.1b, S5.5 | Menu › Edit › Undo history… → popover "newest first"; rows You/AI with ⌘Z on the top row ("Footer — 14 changes, one step"); hovering lights the area "Would undo · 14 changes"; a click undoes to there as one step; the foot shows "Tereza's changes are hers to undo." + Version history ⌥⌘H; ⌘Z/⇧⌘Z run the projection; the iframe keeps no durable stack in op-log mode | V2-1.5 matrix rows owned by S2 (U-keys: ⌘Z on pending, stale skip toast, redo cleared by an AI landing, HMR keeps the stack) · no positional-id record in op-log mode | `edit-undo.e2e.ts` + S5's interleaving scenario | 140 |
| **S2.21** | Keyboard only + VoiceOver + keyboard creation | ed-edge-keys | `editing/{focus-model,tab-order,aria-live}.tsx`, `client/v2/shell/f6-cycle.js` | registry `object.select-next/prev` (tab / ⇧tab, exists: re-scope), `ui.cycle-region` F6, `tool.create-default` (↵ after R/T/F) | sonnet | all S2 canvas slices | Tab order = reading order, badges 1…6 / 4.1…4.3; the focus ring is thicker with a halo (never mistaken for selection); F6 cycles panels ↔ canvas (native + iframe); VoiceOver says "Services, frame, 3 items, in a row — 4 of 6. Press Return to go inside."; R/T/F then ↵ adds one at its default size | reading-order walker over a fixture · ARIA strings goldens · focus-ring token ≠ selection token · axe 0 blockers on the inspector | `edit-keyboard.e2e.ts` + `/flow:validate-a11y` evidence | 120 |

Total: 21 slices (one over the expected 12–20, so that no Sonnet slice exceeds ~150 turns; the lead may merge S2.9 +
S2.10 if S2.9 comes in under budget). Opus: S2.1, S2.18, S2.20.

**Every slice also:**
- re-skins to `maude-v2` tokens only (no hex, weights ≤ 600, tabular live numbers);
- uses copy verbatim from inventory §3;
- regenerates `shell-parity.json` when it changes chrome;
- adds its `canvas-tsx.md` section and its part of `plugins/design/skills/design/_guide-editing-v2.md` (new, S2-owned; the SKILL.md pointer line is a lead/S12 patch);
- adds a UI-path ≡ file-path contract test (rule 14);
- rebuilds `dist/` release-minified (lead commits it);
- records fidelity evidence per artboard in the ledger, hash-pinned.

## 4. Ledger coverage

Every `package: S2` artboard row lands in exactly one slice:

| Row | Slice | Row | Slice | Row | Slice |
| --- | --- | --- | --- | --- | --- |
| 14/ed-ab-select | S2.8 | 14/ed-lay-auto | S2.11 | 14/ed-comp-instance | S2.17 |
| 14/ed-ab-resize | S2.8 | 14/ed-lay-reorder | S2.11 | 14/ed-inspector | S2.5 |
| 14/ed-ab-arrange | S2.9 | 14/ed-lay-free | S2.11 | 14/ed-edge-ai | S2.18 |
| 14/ed-ab-tidy | S2.9 | 14/ed-text-edit | S2.12 | 14/ed-edge-ask | S2.19 |
| 14/ed-ab-menu | S2.10 | 14/ed-text-style | S2.12 | 14/ed-edge-tereza | S2.18 |
| 14/ed-obj-enter | S2.1 | 14/ed-shape | S2.13 | 14/ed-edge-huge | S2.8 |
| 14/ed-obj-multi | S2.7 | 14/ed-pen | S2.14 | 14/ed-edge-undo | S2.20 |
| 14/ed-obj-order | S2.6 | 14/ed-img | S2.15 | 14/ed-edge-paste | S2.15 |
| | | 14/ed-comp-pick | S2.16 | 14/ed-edge-keys | S2.21 |

26 of 26, none assigned elsewhere. S2.19 and S2.18 depend on S5 pieces but stay S2's rows, because the in-canvas
overlay is S2's. 01 `cf-undo-ai` is S5.15's row (plan-s5); its done-when waits for S2.20.

**`home` rows S2 closes:**
- G0-D/D2: Shape R and Pen P in S2.13/S2.14; Ellipse under More in S2.13.
- G0-D/D6: object menu in S2.6, artboard menu + Advanced ▸ in S2.10, Kind + Theme in the artboard inspector in S2.8.
- G0-D/D7: align bar in S2.7.
- G0-D/D18: S2.2.
- Nothing-deleted rows marked "until S2": A-selected-element-s-selector, A-css-tab-raw-properties, A-tag-and-class,
  A-custom-css-property-rows, A-html-attribute-rows, A-token-popover-per-design-system, A-grid-tracks-editor,
  A-body-layout-select, A-inspector-vocabulary-advanced-designer (S2.2); A-copy-css, A-copy-data-cd-id,
  A-copy-style-paste-style (S2.6); A-convert-layout-to-absolute (S2.10/S2.11); A-artboard-theme (S2.8);
  A-reset-position-fit-just-this-artboard (S2.10); A-edit-scope-local-shared-detach (S2.17).
- D16 (Photo knobs) is S8's home. S2.15 only provides the Adjust… / Remove background entries.

**`rule` rows:**
- S2 closes `00/rule/designer-vocabulary` (S2.2 + the words table in S2.3).
- S2 contributes to `00/rule/photo-edits-apply-to-one-use` (S2.15 line; S8 owns) and
  `00/rule/figma-arrives-as-an-exact-picture` (S2.15 paste; S8 owns import).
- No other rule row is S2's.

## 5. Risks and run order

**Risks.**
1. `canvas-shell.tsx` (4,642 lines) and `canvas-lib.tsx` are L1-shared. S2.1 builds the one `editing/` mount so
   later slices add files, not hunks. Any slice that still needs a `CanvasRouter` change names the function in its
   hand-back. S3 touches only the Preview/Viewing/Present branches of `classify()`/`CanvasRouter` and MeasureOverlay
   (plan-s3).
2. `canvas-edit.ts` (6,228 lines): new writers go to `edit-ops/*.ts`. Only S2.6 (lock/hide wiring) and S2.17
   (detach reuse) call into it.
3. Undo and holds are risk classes (Opus) and wait on S5. If S5.1b slips, S2.20 waits: no S2 fallback stack, V2-1.5
   forbids a second log.
4. External links in Preview need S3's Opus opener slice (S3.6b). S2's Interaction section works either way: the
   chip copy stays, and the named fallback is Copy link.
5. Combine shapes is non-destructive in v2.0 (Q6). A designer may expect Flatten; log it in the Progress log, not as
   silent scope loss.
6. The canvas iframe is unreachable by DOM selectors (memory). Canvas e2e uses coordinates from `canvas-rects` or
   structural routes, never iframe selectors.

**Run order.**
- **Shell track (separate worktree, starts now, alongside S3 on L1):** S2.2 → S2.3 → S2.4 → S2.5 (S2.5 also needs
  S3.0's format note). These touch only `client/v2/inspector/*`, `edit-ops/words-css.ts` and docs.
  S2.5's canvas-lib hover block is one lead-applied patch.
- **L1 (serial, after S3):** S2.1 first, alone; it owns the mount, the route file and the dgn messages. After S2.1
  the lead may run **two L1 worktrees** on disjoint tracks, since each slice adds its own `editing/*` and
  `edit-ops/*` files plus one append-only registration line:
  - Track A, objects and layout: S2.6 → S2.7 → S2.11 → S2.12.
  - Track B, artboards: S2.8 → S2.9 (needs S2.7's align bar; start after S2.7 merges) → S2.10.
  - Track C, tools, after Track B frees `canvas-lib` DCArtboard hooks: S2.13 → S2.14 → S2.15 → S2.16 → S2.17.
- **After S5.1b/S5.5 and the run registry:** S2.18 → S2.19, and S2.20 (S2.20 can run beside S2.18 once both S5
  pieces exist).
- **Last:** S2.21 (keyboard/VoiceOver sweep over everything).
- `MODE_TOOLS` and registry patches arrive as one lead commit per slice, so `test/project-menu-model.test.ts` and
  the registry uniqueness test (per scope) move with the slice that lands the action.
