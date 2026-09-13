## Hard contract — non-negotiable

1. **Active canvas + (optional) selected element come first.** Before any edit, read `<designRoot>/_active.json`. If `active` is null or the dev server is not running, ensure the server is up and ask the user to open something in the browser.
2. **Snapshot before edit.** Every edit copies the current file to `<designRoot>/_history/<file-slug>/<NNN>-<timestamp>.bak` before applying changes. Never skip. This is the undo stack.
3. **In-place edit is the only edit mode.** `/design:edit "<feedback>"` mutates the file under `<designRoot>`. There are no immutable iteration files.
4. **Selection narrows scope.** If `_active.json.selected` is set, the edit applies to that element / region only. Reach outside the selection only if the feedback explicitly says so ("…and update the chrome too").
5. **Tokens stay locked.** Every edit must respect the project's tokens CSS (`<designRoot>/<tokensCssRel>`). No hardcoded colors / fonts / radii. No removing the `<link>` to tokens. No removing `<body class="<rootClass>" data-theme="…">`.
6. **Never edit `<designRoot>/_server.json`, `<designRoot>/_active.json`, or `_history/`.** Those are runtime state owned by the dev server / orchestrator side-effects.
7. **Never edit `.design/config.json` without explicit user instruction** — it's the per-repo source of truth.
