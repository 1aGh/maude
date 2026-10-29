// client/v2/shell/save-hold-notice.js — p8-a1-save-hold: the notice while a person's save waits behind an AI call.
//
// The studio holds a save to a file a running interpreter call names (ai/save-hold.ts) and says so on the
// inspector socket: `{ type: 'save-hold', payload: { file, state: 'held' | 'landed', warning?, text } }`.
// `held` shows "AI is changing this file… your change saves when it's done" (one notice per file, kept up
// while it waits — the server lands it within 10 s); `landed` takes it down, and a landing at the cap
// leaves its warning line instead. No new chrome: the shell's one notice stack.

import { dismissNotice, notify } from '../../../notifications.tsx';

const idOf = (file) => `save-hold:${file}`;
/** a hold ends within the server's 10 s cap (+ settle): a notice that outlives it is a lost message */
const HELD_MS = 15_000;

/** @param {{ file?: unknown, state?: unknown, warning?: unknown, text?: unknown } | null} p */
export function noteSaveHold(p, deps = { notify, dismissNotice }) {
  if (!p || typeof p.file !== 'string' || !p.file) return;
  const id = idOf(p.file);
  const text = typeof p.text === 'string' ? p.text.slice(0, 200) : '';
  if (p.state === 'held') {
    deps.notify({ id, kind: 'info', title: text, duration: HELD_MS });
    return;
  }
  if (p.state !== 'landed') return;
  deps.dismissNotice(id);
  if (p.warning && text) deps.notify({ id, kind: 'warning', title: text });
}
