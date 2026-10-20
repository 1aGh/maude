// client/v2/inspector/inspector-actions.js — S2.2: what the inspector's registry actions RUN.
//
//   inspector.copy-css   ⌘K "Copy CSS"          the selected element's declarations on the clipboard
//   element.copy-id      ⌘K "Copy element id"   its id on the clipboard
//   element.set-id       ⌘K "Edit element id…"  opens › Advanced and puts the cursor in the id field
//   element.clear-link   ⌘K "Clear link"        drops the object's On click link (one edit-op write)
//   inspector.copy-code  ⌘K "Copy code"         the element's JSX on the clipboard (S11.8; Can comment and up)
//   inspector.edit-css-as-text  ⌘K "Edit CSS as text…"  Advanced › CSS as one block (S11.8)
//   element.detach       ⌘K "Detach"            this instance becomes its own component (S11.8)
//   inspect.copy-code    ⌘K "Copy code"         the same, from the Inspect panel in Preview / Viewing (S3.11)
//   photo.apply-every-use  ⌘K "Apply to every use…"  the Photo section's sheet for the picture it shows (S8.15)
//
// The menu runner (client/v2/shell/menu-runner.js) calls `runInspectorAction(id)`; the mounted frame binds the
// handlers for the element it shows (frame.jsx), the same shape as left-panel-bus.js. With nothing bound
// (no inspector, no selection) the answer is one plain line instead of a silent no-op.

export const INSPECTOR_ACTION_IDS = Object.freeze([
  'inspector.copy-css',
  'element.copy-id',
  'element.set-id',
  'element.clear-link',
  // S11.8 — Inspector › Advanced, the code half (bound by the fold, advanced.jsx)
  'inspector.copy-code',
  'inspector.edit-css-as-text',
  'element.detach',
  // S2.17 — an instance's door to its main component (bound by kinds/instance.jsx; S10's `ds.go-to` does the going)
  'component.go-to-main',
  // S3.11 — the Inspect panel's primary action (bound by inspect-panel.jsx)
  'inspect.copy-code',
  // S8.15 — ⌘K "Apply to every use…": the Photo section's sheet (bound by v2/photo/photo-section.jsx)
  'photo.apply-every-use',
]);

/** @type {Map<string, () => Promise<string | null> | string | null>} */
const bound = new Map();

/**
 * @param {Record<string, () => Promise<string | null> | string | null | void>} handlers
 *   each returns the line to say afterwards (a toast), or nothing
 * @returns {() => void} unbind — removes only what this call set, so a late unmount never clears a newer frame
 */
export function bindInspectorActions(handlers) {
  const mine = [];
  for (const [id, fn] of Object.entries(handlers)) {
    if (!INSPECTOR_ACTION_IDS.includes(id)) continue;
    bound.set(id, fn);
    mine.push([id, fn]);
  }
  return () => {
    for (const [id, fn] of mine) if (bound.get(id) === fn) bound.delete(id);
  };
}

/** Run one of the three. Resolves to the line to show, or null. */
export async function runInspectorAction(id) {
  const fn = bound.get(id);
  if (!fn) return 'Select an object first.';
  const said = await fn();
  return typeof said === 'string' ? said : null;
}
