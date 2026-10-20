## What `/design:new` does NOT do

- Does not create `.ai/design-sessions/` (concept dropped).
- Does not generate an "iteration 001". The canvas is the file, and its changes are in Version history.
- Does not overwrite an existing canvas (the create refuses a name already taken, or too close to one).
- Does not write the canvas file or its `.meta.json` by hand, or copy a template: the create does, so the canvas matches the one ⌘N makes.
- Does not write the active-canvas file. It shows the new canvas with `maude design open`, which moves the person's view and changes no file.
- **Does not make a single-page wrapper** — always a canvas of artboards, each with a kind and size.
