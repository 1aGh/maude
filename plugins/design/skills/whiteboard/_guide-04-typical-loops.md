## Typical loops

**Answer a sketch:** boot the server → `canvas-rects` → `read-annotations --rects` to understand every note's artboard + element context → `annotate --ops`/`--pin` to answer in place (stickies next to the things it comments on, connectors pointing at them) → `screenshot` to confirm the result renders cleanly.

**Act on the selected stickies:** `read-annotations --selection a,b,c --rects` → each entry's `targets` says which element or artboard it means (say it back to the user in one line before touching anything) → make the design change (`design:edit`) → `annotate --resolve a,b,c` for the ones the change answered (leave the others open; never resolve a locked one) → optionally `annotate --sticker project-status/<id> --to <ref>` to mark what was done or flagged.

**Review a design:** `canvas-rects` → `annotate --ops` with one sticky per finding, each `"to": "el:<artboard>/<id>"` so it points at what it means and follows it → `annotate --wrap-section --title "Review"` to gather the notes. The design itself does not change.

**Bring a FigJam board in:** `import-figma --board <url> --into <canvas.tsx>` lands it as one "From FigJam" section (comment threads become stickies carrying `source.author`, widgets become pictures); `read-annotations --in <section id>` reads it back.

**Make me a plan:** the user names a ritual/template ("retro board", "content calendar for next week", "map out the signup flow") → compose the matching preset above with their REAL content → `annotate --board [--near <artboard>]` → `screenshot`.

**Iterate on what's there:** `read-annotations` (narrow it with `--in <section>` / `--type`) to find the target id → `update` to reword/restyle it (only the fields you name change), `move` / `reparent` to relocate it or put it in another section, `reorder` to bring it forward/back — never `delete` + `create`, which loses the id (and whatever references it: comments, bound arrows).
