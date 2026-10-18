// client/v2/diagnostics/resync-model.js — S11.11: Resync's words, as pure functions (06 ad-trace).
//
//   progress  "Resyncing… 1 204 of 1 318"
//   result    "Resync done — 3 files sent, nothing else differed."
//
// The numbers come from the server's trace (sync/resync-trace.ts, riding `GET /_sync-status` as
// `resync`). The same sentences are printed by `maude design sync resync`, so a toast, the Diagnostics
// card and a terminal never say different things about one resync. Leaf module: no imports.

/** `1318` → `1 318` (plain space — the canvases' grouping, and the log line's). */
export function groupDigits(n) {
  return String(Math.max(0, Math.trunc(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

const files = (n) => `${groupDigits(n)} file${n === 1 ? '' : 's'}`;

/** "Resyncing… 1 204 of 1 318" — or just "Resyncing…" until the file count is known. */
export function resyncProgressText(view) {
  if (!view || !(view.total > 0)) return 'Resyncing…';
  return `Resyncing… ${groupDigits(view.done)} of ${groupDigits(view.total)}`;
}

/** 0–100 for the bar, or null when there is nothing to measure yet. */
export function resyncPercent(view) {
  if (!view || !(view.total > 0)) return null;
  return Math.max(0, Math.min(100, Math.round((view.done / view.total) * 100)));
}

/**
 * The sentence a finished resync gets (the toast, the card, the verb).
 * @param view  `{ state: 'done' | 'attention', summary: { checked, sent, fetched, conflicts } }`
 */
export function resyncResultText(view) {
  const s = view?.summary ?? { sent: 0, fetched: 0, conflicts: 0 };
  const moved = [];
  if (s.sent > 0) moved.push(`${files(s.sent)} sent`);
  if (s.fetched > 0) moved.push(`${files(s.fetched)} fetched`);
  if (view?.state === 'attention') {
    return `Resync stopped early — ${moved.length ? `${moved.join(', ')} so far. ` : ''}Sync details says why.`;
  }
  if (s.conflicts > 0) {
    const c = `${groupDigits(s.conflicts)} conflict${s.conflicts === 1 ? '' : 's'} to look at in Sync details`;
    return `Resync done — ${[...moved, c].join(', ')}.`;
  }
  if (moved.length === 0) return 'Resync done — nothing differed.';
  return `Resync done — ${moved.join(', ')}, nothing else differed.`;
}

/** Does a finished resync need the person (so the toast points at Sync details)? */
export const resyncNeedsYou = (view) =>
  view?.state === 'attention' || (view?.summary?.conflicts ?? 0) > 0;
