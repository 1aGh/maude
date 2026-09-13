## Typical loops

**Answer a sketch:** boot the server → `canvas-rects` → `read-annotations --rects` to understand every note's artboard + element context → `annotate --ops`/`--pin` to answer in place (stickies next to the things it comments on, connectors pointing at them) → `screenshot` to confirm the result renders cleanly.

**Make me a plan:** the user names a ritual/template ("retro board", "content calendar for next week", "map out the signup flow") → compose the matching preset above with their REAL content → `annotate --board [--near <artboard>]` → `screenshot`.

**Iterate on what's there:** `read-annotations` to find the target id → `move`/`set-text`/`set-color` to nudge/reword/recolor it without losing its formatting, or `delete` + `create` for anything bigger.
