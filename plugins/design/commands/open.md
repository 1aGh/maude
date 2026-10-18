---
name: open
category: daily
description: "Show a canvas, an artboard, an element or a panel in the Maude window."
argument-hint: "<canvas>[#artboard][@element] [--mode edit|preview|present] [--select all|none|annotations] | --panel <id>"
---

# /design:open — show it in Maude

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Moves the person's view in the Maude window: it never changes a file. It does what the person does with a click: open the canvas, zoom to an artboard, select an element, switch mode, open a panel.

**Input `$ARGUMENTS`:**

| Form | Shows |
|---|---|
| `<canvas>` | The canvas (design-root relative, `ui/home.tsx`; `.design/…` and absolute paths work too). |
| `<canvas>#<artboard>` | The canvas, zoomed to that artboard. |
| `<canvas>@<element>` | The canvas, with that element selected (the `data-cd-id`). |
| `--mode edit` / `preview` / `present` | The canvas in that mode. |
| `--select all` / `none` / `annotations` | Select every object, nothing, or every annotation. |
| `--panel <id>` | A panel or sheet, with no canvas: `trash`, `design-system`, `layers-panel`, `layers`, `inspector`, `settings`, `shortcuts`, `whats-new`. |

**Examples:**
```
/design:open ui/home.tsx#hero
/design:open ui/home.tsx@hero/cta --mode edit
/design:open ui/pitch.tsx --mode present
/design:open --panel trash
```

## Procedure

1. Run `maude design open $ARGUMENTS`. It is auto-allowed.
2. Print its line ("showing ui/home.tsx#hero in Maude").
3. Use it to show the result of your work, instead of describing where to look: open the artboard you changed, select the element you added.

## Failure modes

- **Exit 3.** No Maude window is showing this project. Open the project in Maude (or `maude design serve`) and try again.
- **Exit 1.** No such canvas. `maude design index` lists them.
- **Exit 2.** Usage: the canvas is a `.tsx` file, ids are plain ids, and `--panel` takes no canvas.

## What `/design:open` does NOT do

- Does not edit, save or select for anyone else; it moves this person's window.
- Does not open a second window or a browser tab. For a screenshot use `/design:screenshot`.
