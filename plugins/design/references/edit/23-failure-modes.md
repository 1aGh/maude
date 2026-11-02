## Failure modes

Each failure is told in the Maude voice (`contract-voice`): what happened, what is safe, the one thing to do.

- **Server won't start (10s timeout)** → stop with the `cat $DESIGN_ROOT/_server.log` instruction. The canvas is unchanged.
- **`maude design` exits 3 (no Maude window is running for the project)** → open the project in Maude (or `maude design serve`) and try again.
- **`_active.json` missing / `active = null`** → "No canvas is open. Open one in Maude, then try again."
- **Active path is not `.tsx`** → "The active canvas must be a TSX file."
- **A write is denied** (`artboard-busy`, `soft-locked`, `out-of-scope`, `lease-lost`, `read-only`) → do not retry the same edit and never work around it with Bash; follow the table in step 4.5 and say what was left alone.
- **A write breaks the canvas** (it no longer parses or draws) → the hooks put the file back at that edit and say why. Fix the cause and write again. The earlier version is in Version history.
- **Edit breaks the tokens link / root class / adds hardcoded colors** → fix it with another Edit (step 6) and say what drifted.
- **A write the hooks cannot snapshot (a file over 4 MB)** → say there is no step to undo before you make it.
- **Selected element's markup appears several times in the file** → use the path to disambiguate, or ask the person to select a more specific object.
- **Stale selection** (`selected.file !== active`) → ignore it, edit canvas-wide, and say so once in the result.
