// client/v2/assets/import-toast.js — S8.22b: the ONE toast after files are added (Assets › Add files…, the picker).
//
// Every arrival that has something to say gets its line from `importLine` (import-lines.js); a plain photo that landed
// says nothing. Several files make one toast, not one each: the first two lines, then how many more. When this Mac is
// offline the "Kept on this Mac" line is said once, last — the files wait here and go up by themselves (S8.19 lane).
//
// Pure: results in, `{ tone, text } | null` out. The caller owns the toast.

import { ARRIVAL_LINES, importLine } from './import-lines.js';

const SHOWN = 2;
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const moreText = (n) => `And ${WORDS[n] ?? n} more.`;

/** One upload result → the route's answer shape `importLine` reads. A plain failure (no `reason`) is the panel's own error. */
export function answerOf(result) {
  if (!result || typeof result !== 'object') return null;
  if ('path' in result) return { ok: true, ...result };
  return typeof result.reason === 'string' ? { ok: false, reason: result.reason } : null;
}

/**
 * @param {Array<{ name?: string, result: object }>} entries  each file as the person knows it, with what the upload said
 * @param {{ offline?: boolean }} [opts]
 * @returns {{ tone: 'info' | 'warn', text: string } | null}
 */
export function arrivalNote(entries, { offline = false } = {}) {
  const lines = [];
  let landed = 0;
  for (const e of entries ?? []) {
    const answer = answerOf(e?.result);
    if (!answer) continue;
    if (answer.ok) landed += 1;
    const line = importLine(answer, { name: e.name });
    if (line) lines.push(line);
  }
  const waits = offline && landed > 0;
  if (!lines.length && !waits) return null;
  const head = lines.slice(0, SHOWN).map((l) => l.text);
  const rest = lines.length - head.length;
  // the offline sentence belongs to every file, so it never counts among "more"
  const parts = [
    ...head,
    ...(rest > 0 ? [moreText(rest)] : []),
    ...(waits ? [ARRIVAL_LINES.offline()] : []),
  ];
  return { tone: lines.some((l) => l.tone === 'warn') ? 'warn' : 'info', text: parts.join(' ') };
}

/** Show it: a note becomes one toast (`ok` = success styling). A no-op without a toast or a note. */
export function toastArrivals(toast, entries, opts) {
  const note = arrivalNote(entries, opts);
  if (note) toast?.(note.text, note.tone === 'info');
  return note;
}
