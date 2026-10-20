## Markers on the ruler, and long videos (Maude 2)

A 4-minute match has moments worth naming: the kick-off, a touchdown, half-time. A **marker** is a flag on the
Timeline's ruler at one of them. It is part of the cut — a collaborator sees it, and so do you — so it lives
in the canvas `.meta.json`, not in the person's browser.

| What the person does | What an agent writes |
| --- | --- |
| Add a marker here (⌘K) | `artboardMeta.<artboardId>.markers`: a list of `{ "frame": 420, "name": "Výkop" }` in the canvas `.meta.json`. `frame` is a whole number ≥ 0 of the comp (seconds × fps); `name` is plain text up to 60 characters (no line breaks, no `<` or `>`). One marker per frame, at most 200 per video, in frame order. |
| Remove the marker here | Take that entry out of the list; remove the key to clear them all. |
| Jump to the next marker | Nothing to write: it moves the playhead. Read the list from `GET /_api/canvas-meta?file=<canvas>`. |

Write the **whole** list each time and keep every other key of the `artboardMeta` entry (`poster`, `snap`,
`maxFrames`…) as you found it. The studio saves through `PATCH /_api/present-meta { file, markers: { <id>: [...] } }`,
which needs Can edit and refuses a malformed marker with the field name.

Folding tracks ("Text · 18") and the clip names hiding when a long video is zoomed out are the person's own
view of the Timeline: nothing to write, and ⌘K finds any clip by name.
