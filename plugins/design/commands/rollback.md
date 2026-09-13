---
name: rollback
category: daily
description: "Restore one or more snapshots of the active canvas."
argument-hint: "[--steps N] [--list]"
---

# /design:rollback — undo edit

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Restores the previous state of the active canvas from `.design/_history/<slug>/`. Every `/design:edit "<feedback>"` took a snapshot **before** the edit; rollback restores that snapshot.

**Input `$ARGUMENTS`:** `[--steps N] [--list]`

- `--steps N` — how many steps back (default 1 = the last snapshot).
- `--list` — instead of undoing, just lists the available snapshots of the active canvas.

**Examples:**
```
/design:rollback                    # undo the last edit
/design:rollback --steps 3          # go back 3 edits
/design:rollback --list             # show history for the active canvas
```

## Procedure

Invoke skill `design` with the input: `rollback $ARGUMENTS`.

The skill:
1. Server lifecycle check.
2. Read `.design/_active.json` → the canvas path.
3. Computes `<slug>` from the path.
4. **`--list` mode:** `ls .design/_history/<slug>/` sorted desc by timestamp. Prints with an index (1 = newest) + size + ts. Done.
5. **Default mode:** takes the N-th snapshot back (default 1).
6. **Snapshot the CURRENT state first** — rollback is itself reversible. Writes the current state as `<NNN+1>-<ts>-pre-rollback.bak`.
7. `cp <chosen-snapshot> <canvas-file>`.
8. Print: which snapshot was restored, how many steps, the current snapshot count.
9. The user reloads the iframe (Cmd+R).

## Failure modes

- **No history for the active canvas** → fail: "No snapshots in `.design/_history/<slug>/`. No `/design:edit` has run yet."
- **`--steps N` > history count** → fail with the actual count + an offer of `--steps <max>`.

## Tips

- **Before `/design:handoff`, walk the history** via `--list` — you'll see every iteration that converged toward the final one.
- **Snapshots are gitignored.** If you want to preserve a specific state in git, copy it manually out of `_history/` (e.g. `cp .design/_history/.../005-*.bak .ai/decisions/DDR-NNN/visual-evidence.html`).
- **Rollback the rollback** — because the pre-rollback snapshot is saved too, you can `/design:rollback` a `/design:rollback` and return to the state before the first rollback.

## What `/design:rollback` does NOT do

- Doesn't delete `_history/<slug>/` (it stays forever, until the user manually removes it).
- Doesn't change `_active.json` (the active canvas stays the same).
- Doesn't modify `apps/web` or `apps/mobile` (handoff is a separate flow).
