## Hard contract — non-negotiable

1. **Active canvas + (optional) selected element come first.** Before any edit, read `<designRoot>/_active.json`. If `active` is null or the dev server is not running, ensure the server is up and ask the user to open something in the browser.
2. **Snapshot before edit.** Every edit copies the current file to `<designRoot>/_history/<file-slug>/<NNN>-<timestamp>.bak` before applying changes. Never skip. This is the undo stack.
3. **In-place edit is the only edit mode.** `/design:edit "<feedback>"` mutates the file under `<designRoot>`. There are no immutable iteration files.
4. **Selection narrows scope.** If `_active.json.selected` is set, the edit applies to that element / region only. Reach outside the selection only if the feedback explicitly says so ("…and update the chrome too").
5. **Tokens stay locked.** Every edit must respect the project's tokens CSS (`<designRoot>/<tokensCssRel>`). No hardcoded colors / fonts / radii. No removing the `<link>` to tokens. No removing `<body class="<rootClass>" data-theme="…">`.
6. **Never edit `<designRoot>/_server.json`, `<designRoot>/_active.json`, or `_history/`.** Those are runtime state owned by the dev server / orchestrator side-effects.
7. **Never edit `.design/config.json` without explicit user instruction** — it's the per-repo source of truth.
8. **Keep every `data-cd-*` attribute — element ids are stable.** Keep every `data-cd-*` attribute on every element you keep, byte for byte; never copy an id onto a second element; never change or unlock an element that carries `data-cd-locked` — tell the person to unlock it (⇧⌘L). Comments, locks, bound arrows and undo point at `data-cd-id`, so:
   - An element you move, wrap, restyle or re-text keeps its `data-cd-*` attributes. Rewriting a whole artboard is no exception: carry them onto the same elements.
   - A copy you make (duplicate, a repeated card) drops `data-cd-id` and `data-cd-locked`; give it a new id or none.
   - `data-cd-id` is always a plain string literal (`data-cd-id="see-pricing"`), never `{…}`. A new id is optional: lowercase words joined by `-`, at most 48 characters, never 8 hex characters, unique in the file.
   - A locked element stays exactly as it is — attributes, text and where it sits. Its parent may change around it.
   - `data-cd-hidden` and `data-cd-locked` are written by the person's gestures (Hide, Lock), never by you.
   - The post-edit id check blocks a lost, duplicated or expression-valued id and a changed locked element, and names the element and its line. Fix it with your own one-line Edit (put the id back on that element). The id is not the layer name: the name is `data-dc-element`.
