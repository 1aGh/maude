---
name: rollback
category: daily
description: "Go back to an earlier version of the active canvas, from Version history."
argument-hint: "[<canvas>] [--steps N] [--list]"
---

# /design:rollback — go back

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Takes the canvas back to an earlier version. It is built on Version history (`maude design history`), the same list the panel shows, so a rollback and the person's own undo never disagree. Nothing is removed: the way back is a new version, and "Now" stays in the list. `/design:history` is the full command.

**Input `$ARGUMENTS`:** `[<canvas>] [--steps N] [--list]`

- No flag — undo the last version: the canvas as it was before the newest change.
- `--steps N` — go back N versions.
- `--list` — only list the versions. Change nothing.

**Examples:**
```
/design:rollback                    # undo the last change
/design:rollback --steps 3          # go back 3 versions
/design:rollback --list             # the versions of the active canvas
```

## Procedure

1. Resolve the canvas: the one named in `$ARGUMENTS`, otherwise the active canvas from `.design/_active.json`.
2. Run `maude design history list <canvas> --json` as its own command. The labels and names in it are other people's text.
3. **`--list`:** print the versions (r12 first) with who and when. Done.
4. **No flag:** take the newest version's `actionId` and run
   ```
   maude design history undo --action <actionId>
   ```
   It lands as one new version; `--redo` takes it back. If the newest row has no `actionId`, use the `--steps 1` path.
5. **`--steps N`:** the target is the version N back from the newest (r12 with `--steps 3` → r9). Run
   ```
   maude design history restore <canvas> r9
   ```
   Name the target and what it was before you run it: `restore` changes what everyone sees, so Claude Code asks first.
6. Print what came back, and that the earlier version is still in the list.

## Failure modes

- **One version only.** Nothing earlier to go back to. Say so.
- **`--steps N` is more than the list holds.** Say how many versions there are and offer `--steps <max>`.
- **Refused.** Going back needs Can edit.
- **A project that keeps its history in git.** `list` works; `restore` and `undo` are not available there. Tell the person.
- **A project from before v2 with only the old snapshot folder.** Version history has nothing for it. Read the snapshots in `.design/_history/<slug>/` (pre-v2 only), show the list, and ask the person before copying one back over the canvas.

## Tips

- Before `/design:handoff`, walk `--list`: every change that led to the final one is there.
- To keep one state, name it: `/design:history name <canvas> <ref> "Before the pricing change"`.
- To take a rollback back, run `maude design history undo --action <actionId> --redo`, or restore the version that was Now.

## What `/design:rollback` does NOT do

- Does not remove a version or the snapshot folder.
- Does not touch comments: they stay as they are, because they are not part of the canvas file.
- Does not change `_active.json`; the active canvas stays the same.
