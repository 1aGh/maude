## Failure modes

- **Server won't start (10s timeout)** → fail with a `cat $DESIGN_ROOT/_server.log` instruction.
- **`_active.json` missing / `active = null`** → fail: "Open a file in the browser tab, click on it, then try again."
- **Active path is not `.tsx`** → fail: "The active canvas must be a TSX file."
- **Snapshot fail (no disk / permission)** → refuse, don't edit.
- **Edit breaks the tokens link / rootClass / hardcoded colors** → automatic rollback from the snapshot, report.
- **Selected element's outerHTML appears multiple times in the file** → use dom_path to disambiguate or fail with a suggestion to narrow the selection (Cmd+Click a more specific child).
- **Stale selection** (`selected.file !== active`) → ignore the selection, edit canvas-wide, flag once in the response.
