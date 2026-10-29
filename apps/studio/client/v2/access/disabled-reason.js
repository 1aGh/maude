// client/v2/access/disabled-reason.js — why a control is off, in one place (p8-dead-reasons, Michal 2026-10-29:
// "every button must do something"). A disabled control says why: a tooltip (`title`) plus `aria-description`.
//
// No new copy: every line here is a line the studio already says somewhere else (the pin
// test/disabled-reason.test.ts checks each one still appears outside this file). When a state has no line
// here, reuse the line its own surface already shows (pass the string) rather than writing a new one.
//
//   reasonProps(off, kind)   → `{ title, 'aria-description' }` while `off`, else `{}` — spread it on the control
//   disabledReason(kind)     → the line (a kind below, or any existing line passed through as is)
//   editReason(ctx)          → the inspector's kind for a read-only object (the role, or no source id)

export const REASONS = Object.freeze({
  // the viewer role (Can view) — the same line Preview's door says (ds/preview-mode.js `doorViewOnly`)
  viewer: 'You can view this project. Ask a project owner for edit access.',
  // a file-level door in a browser tab (menu-runner / ds/advanced-host.jsx `NO_FINDER`)
  macApp: 'Open this project in the Mac app to work with its files.',
  // Home opened in a browser — the line Home's own callout says (home/home-app.jsx)
  homeBrowser: 'This page is open in a browser. Projects open from the desktop app only.',
  // an element the inspector cannot write to (no source id) — inspector/css-knobs.jsx says it in place
  cantEditHere: 'This can’t be edited here. Ask AI in the chat to change it.',
  // nothing open to act on (export/copy-png.js, export/copy-command.js `noCanvas`)
  noCanvas: 'Open a canvas first.',
  // an Undo history row that was undone already — the undo toast's own word
  undone: 'Undone.',
  // a row whose undo was refused because someone changed it since (history `undoFailed`)
  stale: 'Someone changed this since — nothing was undone.',
});

/** The line for a kind, or the string itself when it is already a line (an existing surface's own words). */
export function disabledReason(kind) {
  if (typeof kind !== 'string' || !kind) return null;
  return Object.hasOwn(REASONS, kind) ? REASONS[kind] : kind;
}

/** The inspector's reason for a read-only object: the role (`ctx.readOnly`), else an element it cannot write. */
export function editReason(ctx) {
  return ctx?.readOnly ? 'viewer' : 'cantEditHere';
}

/** Props that say why a control is off: spread on the control next to its `disabled` / `aria-disabled`. */
export function reasonProps(off, kind) {
  if (!off) return {};
  const why = disabledReason(kind);
  return why ? { title: why, 'aria-description': why } : {};
}
