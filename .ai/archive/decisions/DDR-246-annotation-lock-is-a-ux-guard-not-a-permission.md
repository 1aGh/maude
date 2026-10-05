# DDR-246 — Annotation lock is a UX guard, not a permission

- **Status:** Accepted
- **Date:** 2026-10-05
- **Scope:** `repo:maude`, `dept:dev`
- **Extends:** [DDR-242](./DDR-242-annotations-v2-element-model.md), [DDR-244](./DDR-244-annotations-v2-stroke-view-is-the-editing-end-state.md)
- **Source:** [1aGh/maude#137](https://github.com/1aGh/maude/issues/137), plan `.ai/plans/feature-annotation-lock.md`

## Context

People asked for a way to pin whiteboard items (a background section, a reference image, a finished diagram) so
they stop getting dragged, nudged, erased or deleted by accident. The issue asks for a lock attribute on the object
and a lock/unlock option in the UI when the object is selected.

## Decision

1. **Model.** `locked: bool` is a `TAIL_FIELDS` entry, so every known element type carries it. It is omitted when
   false and syncs per field like `groups` / `author`. The Stroke view carries `locked?: true` (legacy SVG:
   `data-locked`). A shape's anchored label inherits its host's lock (`lockedStrokeIds`).
2. **Select-then-unlock (Miro), not click-through (FigJam).** A locked element is selectable. Its context toolbar
   collapses to Lock/Unlock, it shows a lock badge and no resize, rotate or connector handles, and it can't be
   dragged, nudged, double-click edited, erased, cut or deleted. Marquee skips it. Copies (duplicate, Alt+drag,
   paste) start unlocked. ⌘⇧L toggles the lock; a mixed selection locks all of it. A selection holding a locked
   member doesn't move as a unit. A section holding a locked element can't be deleted. Its locked children ride along
   when the section itself moves (their coordinates are parent-relative, so the records don't change).
3. **Two enforcement layers.** UI gesture gating handles the UX. `guardLockedOps` (`annotations/lock.ts`) is the
   safety net in `commitStrokes`, the single chokepoint every UI mutation passes through. It drops deletes and every
   patched field outside the allow-list `index | groups | locked`, unless the same batch unlocks. Because the
   exempt set is an allow-list, a geometry field added later is guarded by default.
4. **AI writes are refused, not filtered.** `AiBatch.apply` throws a `… is locked` error that names the unlock op, so
   an agent never makes a silent partial edit. `read-annotations` exposes `locked: true`.
5. **Not a permission.** Anyone can unlock. The server op API, sync and undo do not enforce the lock.

## Alternatives rejected

- **Server-side enforcement** (`/_api/annotations/ops`, the replica). It would break peer-safe undo (an inverse
  batch recorded before the lock must still apply) and reject pre-lock peers' ops. It would also turn an
  accident guard into an access-control claim the product doesn't make.
- **FigJam click-through** (a locked item ignores clicks and only the context menu reaches it). The issue asks for
  lock/unlock on the selected object, and click-through makes a locked background impossible to inspect.
- **Deny-listing geometry fields in the guard.** It fails open for every future geometry field.

## Consequences

- **Mixed-version peers strip the lock.** A client that predates this field drops `locked` when it validates the
  replica. Its next op batch rewrites the whole replica (`applyOpsToReplica` → `writeReplica` deletes keys it didn't
  keep), which unlocks **every** element on that board. This can't be fixed on the old client. It is acceptable for a
  UX guard, and desktop auto-update plus version-matched cloud cells keep the window short. A future field of the
  same kind has the same exposure.
- Undo of an edit made before the lock still applies to the now-locked element (undo replays through
  `applyOpsLocal`, not `commitStrokes`). This is intentional: undo is explicit.
