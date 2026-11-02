// client/v2/shell/save-hold-notice.js — p8-a1-save-hold: the notice while a person's save waits behind an AI call.
//
// The studio holds a save to a file a running interpreter call names (ai/save-hold.ts) and says so on the
// inspector socket: `{ type: 'save-hold', payload: { file, state: 'held' | 'landed', warning?, text } }`.
// `held` shows "AI is changing this file… your change saves when it's done" (one notice per file, kept up
// while it waits — the server lands it within 10 s); `landed` takes it down, and a landing at the cap
// leaves its warning line instead. No new chrome: the shell's one notice stack.
//
// Close finishes the save: while a notice is up, closing the tab or the window (`pagehide`) asks the studio
// to land those files now (`POST /_api/diagnostics/save-hold-flush`, a beacon — it outlives the page).

import { dismissNotice, notify } from '../../../notifications.tsx';

export const FLUSH_ROUTE = '/_api/diagnostics/save-hold-flush';

const idOf = (file) => `save-hold:${file}`;
/** a hold ends within the server's 10 s cap (+ settle): a notice that outlives it is a lost message */
const HELD_MS = 15_000;

/** the files this page was told are held, until it hears they landed */
const held = new Set();
let armed = false;

/** Land this page's held saves now (the page is going away). True when a request went out. */
export function flushHeldSaves(nav = globalThis.navigator, fetchImpl = globalThis.fetch) {
  if (!held.size) return false;
  const body = JSON.stringify({ files: [...held] });
  try {
    // text/plain: a beacon with a JSON type is not a simple request and would never leave
    if (nav?.sendBeacon?.(FLUSH_ROUTE, new Blob([body], { type: 'text/plain' }))) return true;
  } catch {
    /* fall through to a keepalive fetch */
  }
  try {
    void fetchImpl?.(FLUSH_ROUTE, { method: 'POST', body, keepalive: true }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

function arm(win) {
  if (armed || !win?.addEventListener) return;
  armed = true;
  win.addEventListener('pagehide', () => void flushHeldSaves());
}

/** @param {{ file?: unknown, state?: unknown, warning?: unknown, text?: unknown } | null} p */
export function noteSaveHold(p, deps = { notify, dismissNotice, win: globalThis.window }) {
  if (!p || typeof p.file !== 'string' || !p.file) return;
  const id = idOf(p.file);
  const text = typeof p.text === 'string' ? p.text.slice(0, 200) : '';
  if (p.state === 'held') {
    held.add(p.file);
    arm(deps.win);
    deps.notify({ id, kind: 'info', title: text, duration: HELD_MS });
    return;
  }
  if (p.state !== 'landed') return;
  held.delete(p.file);
  deps.dismissNotice(id);
  if (p.warning && text) deps.notify({ id, kind: 'warning', title: text });
}

/** Tests only. */
export function resetSaveHoldNoticeForTest() {
  held.clear();
  armed = false;
}
