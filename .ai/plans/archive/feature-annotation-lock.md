# Feature: Lock / unlock annotation elements

Validate docs and codebase patterns before implementing. Pay attention to existing naming, utils, and imports.

## Description

Whiteboard annotation elements (stickies, shapes, text, arrows, pen, media, sections) get a persistent
`locked` attribute. A locked element can still be **selected** (so it can be unlocked), but it can't be moved,
resized, rotated, deleted, erased or text-edited by accident. When an element is selected, the context toolbar and
the right-click menu offer **Lock / Unlock**, with a ⌘⇧L shortcut, the same binding Figma, FigJam and Miro use.

Source: [1aGh/maude#137](https://github.com/1aGh/maude/issues/137) (in-app report `r-d58fa261`, reporter text is
untrusted data): the reporter wants a lock or attribute on an object that stops accidental moves, plus a lock/unlock
option in the UI when the object is selected.

## User Story

As a person laying out a whiteboard, I want to lock a background section, a reference image or a finished diagram so
that I don't move or delete it by accident while I work around it.

## Problem

Every annotation element can be dragged, nudged, resized, marquee-grabbed, erased and deleted at any time. Large
background elements (sections, images) get grabbed whenever a drag starts on them. Nothing on the board can be pinned.

## Solution

1. **Model.** Add `locked: bool` to `TAIL_FIELDS` (`apps/studio/annotations/registry.ts`). It applies to every known
   type, is omitted when false (the canonical form omits defaults) and syncs per field like `groups`/`author`.
2. **View.** The Stroke view (DDR-244: the editing end state) carries `locked?: true`. `shared()` in
   `v1-adapter.ts` maps it in, and `strokesToElements` maps it back. Legacy SVG serialization keeps it as
   `data-locked` so paste and round-trips don't lose it.
3. **Enforcement, in two layers:**
   - **UI gating (UX).** Gestures never start on a locked element: no drag, resize/rotate handles or arrow-endpoint
     drag, no nudge, no text-edit double-click, and the eraser skips it. Marquee and select-all skip locked elements,
     so a big locked background never gets swept into a selection. A plain click still selects it.
   - **Commit guard (safety net).** `commitStrokes` is the single chokepoint for every UI mutation (about 10k lines
     of tools). A pure `guardLockedOps(prevMap, ops)` removes geometry patches, deletes and text changes on elements
     that are locked in `prev` and still locked after the batch. A batch that clears `locked` passes. Any tool path
     the gating misses (align, distribute, paste-replace, a future tool) still can't move a locked element.
4. **AI path.** `ai-read` exposes `locked: true`, so agents can see the lock. `ai-write` / `maude design annotate`
   refuses geometry, delete and text ops on locked elements with an explicit reason, unless the same request
   unlocks the element. The whiteboard skill documents this.
5. **Not a permission.** Any collaborator can unlock. Lock is protection against accidents, not access control. The
   server op API (`/_api/annotations/ops`), sync and undo do **not** enforce it. Enforcing it there would break
   peer-safe undo (an inverse batch from before the lock) and mixed-version peers. This gets recorded as a DDR.

## Metadata

- **Ticket**: [1aGh/maude#137](https://github.com/1aGh/maude/issues/137) — Lock annotation objects
- **Type**: New Capability
- **Complexity**: Medium (one new field, many interaction sites, one shared chokepoint)
- **App/Package**: `apps/studio`
- **Affected Systems**: annotations v2 model/registry, Stroke view adapter, annotations layer (gestures, keyboard,
  context menu, store API), context toolbar, AI read/write, whiteboard skill docs, What's New feed
- **Dependencies**: none new

---

## Context References

### Must-Read Files

> When consuming this section during `/flow:execute`, **read every file listed here in parallel in a single assistant message**.

- `apps/studio/annotations/registry.ts` (lines 66–100) — `HEAD_FIELDS` / `TAIL_FIELDS` / `specOf`; `locked` goes in TAIL. Validation drops unknown keys on known types (line ~113), which matters for mixed-version peers.
- `apps/studio/annotations/fields.ts` — field spec builders (find the bool builder used by e.g. `dashed`).
- `apps/studio/annotations/v1-adapter.ts` (lines 69–80 `shared()`, ~295 `strokesToElements`, ~422 map form) — the element ⇄ Stroke seam.
- `apps/studio/annotations-model.ts` (lines ~74–95 Stroke shared fields incl. `groupIds`; ~1026 `data-group-ids` SVG serialize; ~1446 parse) — mirror `groupIds` for `locked`.
- `apps/studio/annotations/ops.ts` (lines 36–61 `Op`, 431 `diffToOps`) — op shapes the guard filters.
- `apps/studio/annotations/ui/edit-actions.ts` — `patchOp`, `styleOps`, `expandGroups`, `deleteOps` (add `lockOps`).
- `apps/studio/annotations-layer.tsx`:
  - ~690–710 + ~1440–1530 — the `store` API (`groupSelection` etc.); add `setLocked(ids, locked)`.
  - ~1320–1375 — `commitStrokes` (guard insertion point).
  - ~2510–2560 — pointerdown on a stroke → select / drag start.
  - ~2700–2745 — move gesture; ~2756–2805 marquee (`marqueeHits`); ~2900–2915 group resize.
  - ~1498–1510 — handle-drag (resize/rotate) path.
  - ~2940–2990 — dblclick → text edit.
  - ~3760–3830 — keyboard: arrow nudge, Backspace/Delete, action dispatcher (`duplicate` at ~3820).
  - ~1148 — eraser.
  - ~4600–4690 — right-click context menu.
- `apps/studio/annotations-context-toolbar.tsx` (735–760 group callbacks; ~1001 `canGroup`; 1375–1400 group buttons) — where Lock/Unlock lives.
- `apps/studio/annotations/ai-read.ts`, `apps/studio/annotations/ai-write.ts`, `apps/studio/annotations/board-text.ts` — AI contract.
- `apps/studio/annotations/containment.ts` — `marqueeHits`.
- `plugins/design/skills/whiteboard/SKILL.md` — AI-facing docs.
- `.ai/archive/decisions/DDR-242-annotations-v2-element-model.md`, `DDR-244-...stroke-view-is-the-editing-end-state.md`.

### Files to Create

- `apps/studio/annotations/lock.ts` — `isLocked(el)`, `guardLockedOps(prev, ops)` (pure, React-free), `LOCK_GUARDED_FIELDS`.
- `apps/studio/test/annotations-lock.test.ts` — model, adapter round-trip, guard, AI write refusal.
- `.ai/archive/decisions/DDR-246-annotation-lock-is-a-ux-guard-not-a-permission.md` (number per next free; graph-native via `/flow:record-ddr`).

### Design canvases

No canvas under `.design/` matches `annotation-lock` / `lock`. The toolbar follows the existing context-toolbar
icon-button pattern, so no new mockup is needed.

### Patterns to Follow

`groups` is the exact precedent for a cross-type tail field: registry `TAIL_FIELDS` → `shared()` → Stroke `groupIds`
→ `data-group-ids` → `strokesToElements` → toolbar `canUngroup` + store `ungroupSelection` + context-menu item + ⌘⇧G.
Mirror it at every hop.

```ts
// v1-adapter.ts shared()
if (Array.isArray(el.groups) && el.groups.length) out.groupIds = [...(el.groups as string[])];
// → add
if (el.locked === true) out.locked = true;
```

---

## Design Decisions

### Interaction model (Miro-style, as the issue asks)

| Action on a locked element | Behaviour |
| --- | --- |
| Click | Selects it. Shows a lock badge on the selection outline and **no** resize/rotate handles |
| Drag / nudge / resize / rotate / arrow-endpoint drag | Ignored; cursor stays `default` |
| Delete / Backspace / Cut / eraser | No-op on the locked part of the selection |
| Double-click | No text edit |
| Marquee / ⌘A | Skips locked elements |
| Copy / Duplicate | Allowed. The duplicate comes out **unlocked** |
| Bring forward / back | Allowed (z-order is not a move) |
| Style changes | Not offered: a locked selection's toolbar collapses to Lock/Unlock |
| Group containing a locked member | Selecting the group selects all members; move/delete are blocked for the whole group (a group moves as one) |
| Section (container) moves | Locked children move with it (their x/y are parent-relative, so nothing changes in the record). A locked section can't move; its unlocked children still can |
| Deleting a section with locked descendants | Blocked; the toolbar says why ("contains locked items") |

**Mixed selection** (some locked): the toolbar shows **Lock**, which locks all of them. When everything is locked it
shows **Unlock**. ⌘⇧L toggles by the same rule.

### Components

| Component | Source | Notes |
| --- | --- | --- |
| Context toolbar icon button | `annotations-context-toolbar.tsx` `.dc-annot-ctx-ibtn` | new Lock/Unlock button in the group/align cluster |
| Context menu item | `annotations-layer.tsx` `item()` | `lock` / `unlock`, shortcut `⌘⇧L` |

### Icons

| Icon | Library | Size | Usage |
| --- | --- | --- | --- |
| `IconLock` / `IconLockOpen` | Lucide `lock` / `lock-open`, inlined into `canvas-icons.tsx` the same way as the existing icons | 16 | toolbar button + selection badge |

### Tokens

Reuse the existing toolbar surface (`CTX_SURFACE`) and the selection-outline accent. No new tokens.

### Custom Components Needed

| Component | Reason | Extends |
| --- | --- | --- |
| Lock badge on the selection outline | marks why handles are missing | the existing selection-outline `<g>` |

---

## Tasks

Execute in order. Each task is atomic and testable. **Before every `bun test` run: `git status apps/studio/dist/`,
and revert dist changes afterwards (CLAUDE.md). Run the studio suite alone (memory: parallel runs contaminate).**

### ✅ Task 1: ADD `locked` to the element model — completed

- **Do**: `TAIL_FIELDS.locked = bool()` (default false → omitted) in `registry.ts`. Add `locked?: true` to the shared
  `Stroke` fields in `annotations-model.ts`. Serialize as `data-locked="1"` and parse it back next to `data-group-ids`.
- **Pattern**: `groups` / `groupIds`.
- **Gotcha**: canonical key order. TAIL order is `groups, author, locked`. Check `annotations-v2-schema.test.ts`
  fixtures for byte-determinism expectations.
- **Validate**: `cd apps/studio && bun test test/annotations-v2-schema.test.ts`

### ✅ Task 2: UPDATE the Stroke view adapter — completed

- **Do**: `shared()` emits `locked: true`, and `strokesToElements` writes `locked: true` back. A view without the
  flag means unlocked.
- **Validate**: new round-trip cases in `test/annotations-lock.test.ts` (element → strokes → elements is
  byte-identical, locked and unlocked).

### ✅ Task 3: CREATE `annotations/lock.ts` + commit guard — completed

- **Do**: `guardLockedOps(prev: Map<string, AnnotationElement>, ops: Op[]): { ops: Op[]; blocked: number }`.
  - For an id locked in `prev`: drop `delete`. On a `patch`, strip guarded fields (`x y w h rot points from to
    parent text label title` and any type's geometry fields; derive from the registry as far as possible, see the
    gotcha) **unless** the same patch sets `locked` to false/unset. Keep `index` (z-order) and `locked`.
  - `put` over an existing locked id (replace): treat it like a patch.
  - Block the `delete` of a container whose descendants are locked (resolve through `parent`).
- **Wire**: in `commitStrokes`, run the guard on `ops` before `applyOpsLocal`. When `blocked > 0`, also rebase the
  view (the optimistic preview already showed the move) by calling `setPreview(null)` and re-rendering from the
  board. Also guard the text-session branch.
- **Gotcha**: guarded fields must be **allow-listed as kept** (`index`, `locked`, `groups`) rather than deny-listed,
  so a future geometry field is guarded by default.
- **Validate**: unit tests: move, resize, delete, a text patch on a locked element all → filtered; a batch with
  `unset: ['locked']` + move passes; z-order passes; container delete with a locked child is blocked.

### ✅ Task 4: ADD store API + edit action — completed

- **Do**: `lockOps(scene, ids, locked)` in `ui/edit-actions.ts` (`expandGroups` first). Add
  `store.setLocked(ids, locked)` to the annotations-layer store interface (~699) and its implementation (~1448),
  committed as one undo step labelled `lock` / `unlock`.
- **Validate**: undo/redo of lock restores the flag (extend `test/annotations-v2-interaction.test.ts`).

### ✅ Task 5: UPDATE gesture gating in `annotations-layer.tsx` — completed

- **Do**: compute `lockedIds` from the view. Gate:
  - pointerdown on a stroke: select it, but don't arm drag/move when any expanded-selection member is locked;
  - handle rendering: no resize/rotate handles or arrow-endpoint dots for a locked selection;
  - arrow nudge, Backspace/Delete, Cut: filter out locked ids (no-op if nothing is left);
  - dblclick text edit: return early for a locked element;
  - eraser: skip locked strokes;
  - marquee (`marqueeHits` input) and select-all: exclude locked;
  - duplicate/paste: strip `locked` from copies.
- **Gotcha**: the right-click menu still opens on a locked element, which is how a click-through-heavy user reaches
  Unlock.
- **Validate**: interaction tests in `test/annotations-v2-interaction.test.ts` (drag a locked element: its position
  doesn't change; marquee over it: not selected).

### ✅ Task 6: ADD UI affordances — completed

- **Do**: a context toolbar Lock/Unlock icon button (mixed → Lock). A locked selection collapses the toolbar to that
  button + copy. Context menu items `lock` / `unlock` with `⌘⇧L`. Keyboard ⌘⇧L toggles. A lock badge on the
  selection outline. `data-testid="annot-ctx-lock"` / `annot-ctx-unlock`. `aria-label` + `aria-pressed`.
- **Gotcha**: check that ⌘⇧L isn't taken globally in `client/app.jsx` / Tauri menus (a grep of `annotations-layer`
  found nothing).
- **Validate**: `/flow:utils-verify`; manual check in the browser.

### ✅ Task 7: UPDATE the AI contract — completed

- **Do**: `ai-read` / `board-text` emit `locked: true`. `ai-write` rejects geometry/delete/text changes on locked
  elements with reason `locked` unless the same op unlocks. The `maude design annotate` error message names the
  element and says how to unlock. Update `plugins/design/skills/whiteboard/SKILL.md`.
- **Gotcha**: re-check the AI-read byte gate (DDR-244 §3, ≥ 2.8×). One optional bool shouldn't move it, but measure.
- **Validate**: `bun test test/annotate-write.test.ts` + new cases in `annotations-lock.test.ts`.

### ✅ Task 8: VERIFY mixed-version + sync behaviour — completed

- **Do**: tests showing that (a) a peer's patch that doesn't touch `locked` never removes it (field-level sync), and
  (b) an element round-trips through `sync/codec.ts` with `locked` intact. Write down that pre-lock clients drop the
  unknown key on validate and can still move locked elements, which is acceptable for a UX guard. Test **both
  directions** (cloud → desktop and desktop → cloud) per memory `maude-sync-test-both-directions`.
- **Validate**: `bun test test/sync-codec.test.ts test/annotations-sync.test.ts test/annotations-lock.test.ts`

### ✅ Task 9: RECORD decision + What's New — completed

- **Do**: `/flow:record-ddr`: "Annotation lock is a UX guard enforced in the UI and at `commitStrokes`, not a
  server-side permission." Cover the rejected alternatives: server enforcement (breaks peer-safe undo + old peers),
  FigJam click-through model (the issue asks for select-then-unlock). Add a What's New entry via the
  `whats-new-entry` skill, with a spotlight on the toolbar Lock button. Then rebuild the client bundle
  release-minified (`cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`) and commit
  `dist/client.bundle.js` + `dist/styles.css` only if the client sources changed.
- **Validate**: `scripts/check-import-coherence.sh`

---

## Execution notes (2026-10-05)

- **Deviation, Task 4:** `setLocked` lives in the annotations-layer store and works on the Stroke view, like
  `groupSelection`. The store methods all work there, so `ui/edit-actions.ts` got no `lockOps`. `isAllLocked` and
  `lockedStrokeIds` are in `annotations/lock.ts`.
- **Store-level gating:** `translateStrokes` and `deleteStrokes` filter locked elements themselves, so keyboard
  nudge, Delete, Cut and the toolbar delete are all covered in one place.
- **Select-all:** the annotation layer has no ⌘A, so there was nothing to gate.
- **Found:** a pre-lock client strips `locked` from the whole board on its next op batch (`applyOpsToReplica` →
  `writeReplica`). Recorded in DDR-246 § Consequences.
- **Fixed a latent order-dependent test:** `canvas-lib-graph.test.ts` checked the shared `ops.ts` instance, so any
  earlier file importing a server entry point turned it red. It now checks a fresh, query-busted instance.

## Validation

1. **Lint**: `pnpm lint`
2. **Types**: `cd apps/studio && bunx tsc --noEmit && ../../scripts/check-tsc-coverage.sh`
3. **Tests**: `cd apps/studio && bun test test/annotations-*.test.ts test/annotate-write.test.ts test/sync-codec.test.ts` (alone, then the full studio suite)
4. **Build**: `pnpm build` (then `git status apps/studio/dist/` and revert any unintended regen)
5. **Scenario**: extend `.ai/scenarios/annotations-v2/spec.md` with a lock flow (web-desktop only; the whiteboard
   isn't a mobile surface)
6. **Design System Guard / A11y**: toolbar button labelled, focusable, `aria-pressed`; lock badge has no text-only meaning
7. **Manual**: two browser peers. A locks an element and B sees it locked. B unlocks and moves it, and A sees the
   move. Undo of the lock on A. Lock a section with children and drag the section.

## Scenario Coverage

| Scenario | Covers | Status |
| --- | --- | --- |
| `annotations-v2` | board edit flows | ✅ existing, extend |
| `annotations-v2` → *lock flow* | select → ⌘⇧L → drag (no move) → Unlock → drag (moves) → undo | 🆕 |

## Acceptance Criteria

- [x] Locked element: selectable, not movable/resizable/rotatable/deletable/erasable/text-editable via any UI path
- [x] Marquee and ⌘A skip locked elements; the duplicate of a locked element is unlocked
- [x] Lock/Unlock in the toolbar, the context menu and ⌘⇧L; undoable; syncs to peers
- [x] The commit guard blocks a locked-element change even when gating is bypassed (unit-tested)
- [x] AI write refuses locked edits with a clear reason; AI read shows `locked`
- [x] DDR recorded; What's New entry pending; the whiteboard skill updated
- [x] Studio suite green; tsc 0 errors; no unintended `dist/` changes

## Retro

- **Worked:** `groups` was an exact precedent for a cross-type tail field, so the model → adapter → UI path was mechanical. Routing every UI mutation through `commitStrokes` meant one guard covered 10k lines of tools.
- **Worked:** the mutation check (disable the lock, watch the tests go red) caught two e2e tests that were vacuous: they dragged a section by an empty inside spot, which starts a marquee, not a drag. A positive control (same gesture moves the section once unlocked) fixed them. Do this for every "X does nothing" test.
- **Didn't:** the plan assumed ⌘A select-all and `edit-actions.ts` helpers that don't exist; both were dropped. Grep for the named hook before planning a task around it.
- **Didn't:** a unit test importing `ai-write.ts` wired the shared `ops.ts` text merge and turned an order-dependent test red; fixed the test, not the import.
- **Next time:** a `/flow:plan` for a UI feature should list the browser e2e (`apps/studio/test/e2e/*.e2e.mjs`) as a task, not leave it to `/done`. E2E found no feature bugs here, but it is the only layer that proves the gestures.
- **Open:** a pre-lock client strips every lock on its next edit (DDR-246). No fix possible client-side.
