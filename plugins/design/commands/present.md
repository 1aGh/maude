---
name: present
category: daily
description: "Set the order, skipped artboards and speaker notes for Present, then open the canvas in Present."
argument-hint: "<canvas> [--order a,b,c] [--skip x,y] [--notes <artboard>=<text>] [--open]"
---

# /design:present — Present order, notes and the link

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Present plays a canvas's artboards one by one. This command sets what "Order and notes…" in Maude sets, and opens the canvas in Present. Present itself runs in the Maude window; it needs a person to drive it.

**Input `$ARGUMENTS`:**

| Flag | Meaning |
|---|---|
| `<canvas>` | The canvas, design-root relative. Default: the active canvas. |
| `--order a,b,c` | The artboard ids in the order they play. Artboards left out follow in canvas order. |
| `--skip x,y` | Artboards that stay on the canvas but are left out of the run. |
| `--notes <artboard>=<text>` | Speaker notes for one artboard (plain text, up to 20 000 characters). |
| `--open` | Open the canvas in Present when the changes are done. |

**Examples:**
```
/design:present ui/pitch.tsx --order cover,reel,poster --skip banner-fb
/design:present ui/pitch.tsx --notes cover="Last year 86 players came."
/design:present ui/pitch.tsx --open
```

## Procedure

1. **Order and notes.** They live in the canvas's `.meta.json`, as the top-level keys `present` (`order`, `skip`) and `artboardMeta.<id>.notes`. Read the format in [Per-canvas metadata sidecar](../skills/design/_guide-17-per-canvas-metadata-sidecar.md) (section "Present order, skipped artboards and speaker notes"), then edit the file. Every id is the `id` of an artboard in the canvas. Keep every other key as you found it. Needs Can edit.
2. **Check.** `maude design check --strict <Canvas>.meta.json` reports an unknown id or a duplicate.
3. **Open.** With `--open`, or when the person asks to see it:
   ```
   maude design open <canvas> --mode present
   ```
   Add `#<artboard>` to start at one artboard. In a project linked to a team hub, this also prints the presentation link viewers follow (Can view and up).
4. **Tell the person.** What changed (order, skipped, notes) and, if opened, that Present is showing in the Maude window.

## Failure modes

- **Exit 3 from `open`.** No Maude window is showing this project. Open it in Maude and try again.
- **Unknown artboard id.** List the ids with `maude design index <canvas>` and ask which one was meant.
- **No presentation link printed.** The project is not linked to a team hub, or the hub is on this Mac. Viewers have nothing to follow yet.

## What `/design:present` does NOT do

- Does not drive Present. Next and Previous are the person's keys.
- Does not open the presenter view on a second display; that needs a person at the Mac.
- Does not put notes under `layout`. A v1 peer's layout write would erase them.
