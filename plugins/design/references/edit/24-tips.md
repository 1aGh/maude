## Tips

- **Pin-to-element edit** — hold **Cmd** (or Alt) in the canvas and hover — the element highlights. **Cmd+click** to select it. The status bar at the bottom shows `● selector — text`. The next `/design:edit "<feedback>"` edits **only that element**, not the whole file.
- **Esc inside the canvas** clears the selection. Or the `×` button in the status bar.
- **Tab switch clears the selection** automatically (selection is per-canvas).
- **Refresh canvas** — Cmd+R inside the iframe. If it doesn't work, click "↻ active" in the header.
- **Annotated screenshot** — `/design:screenshot` → open the PNG in Preview → circle things → `/design:edit "..." --screenshot <path>`. A selection-aware screenshot is the default if you have an element selected.

After editing, continue with `/design:edit "<more feedback>"`, `/design:screenshot`, `/design:critic`, or `/design:handoff`. `/design:rollback` if the edit didn't work out.
