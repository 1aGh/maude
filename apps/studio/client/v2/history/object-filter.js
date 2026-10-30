// client/v2/history/object-filter.js — S1.16: Version history, filtered to ONE object (V2-1.9 §5.9).
//
//   openHistory(target, opts)    the entry point for S2's object menu and S4's sticky menu:
//                                  openHistory({ element: ElementRef })      a canvas element
//                                  openHistory({ element: PendingElementRef }) one with no id yet — an editor's
//                                                                  studio stamps it first (queueStamp); a Can view /
//                                                                  Can comment person never causes that write
//                                  openHistory({ annotation: id, kind?: 'sticky' }) a sticky, arrow, sticker …
//                                  openHistory()                           the plain panel (clears the filter)
//   historyScope                 the filter itself: { path, key, tail } or null — the panel reads it, "All versions" clears it
//   setHistoryOpener(fn)         the shell registers what shows the panel (the dock's `changes` panel)
//   objectKey(target) · objectUrl(path, key) · tailFor(kind)   pure helpers (tests)
//
// The rows are the server's (`GET /_api/project/object-history`, history/object-history.ts): which versions touched
// the object, which were found by matching and offer no Restore, which were kept aside. This file only asks.

import { objectHistoryRequest } from '../../../history/surface-requests.ts';

/** Every sentence the object view says (CONTRACT §3–§4: what happened · what is safe · one verb). */
export const OBJECT_WORDS = Object.freeze({
  title: 'Version history',
  all: 'All versions',
  empty: 'No versions of this object yet.',
  emptyNote: 'It appears here once it has been changed.',
  failed: "Couldn't load this object's versions",
  failedNote: 'Your work is safe.',
  retry: 'Retry versions',
  matchedChip: 'Found by matching',
  matchedNote: 'Restore the artboard instead.',
  notKept: 'Not kept',
  restore: 'Restore',
  restoring: 'Restoring…',
  stopped: Object.freeze({
    ambiguous: 'Earlier versions are not shown — two elements looked alike.',
    'no-match': 'Earlier versions are not shown — it could not be matched.',
  }),
});

const ID = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,127}$/;

/** "this sticky" for a sticky, "this object" for everything else (the header's tail). */
export const tailFor = (kind) => (kind === 'sticky' ? 'this sticky' : 'this object');

/**
 * The key the server takes: `<artboard>/<id>` for a canvas element, the bare id for an annotation.
 * null for anything that cannot be asked yet (no authored id, a malformed id).
 */
export function objectKey(target) {
  if (!target || typeof target !== 'object') return null;
  if (typeof target.annotation === 'string')
    return ID.test(target.annotation) ? target.annotation : null;
  const el = target.element;
  if (el && typeof el === 'object' && typeof el.element === 'string') {
    const artboard = el.artboard;
    // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
    if (typeof artboard !== 'string' || !artboard || /[/\u0000-\u001f]/.test(artboard)) return null;
    return ID.test(el.element) ? `${artboard}/${el.element}` : null;
  }
  return null;
}

/** `GET /_api/project/object-history?path=…&object=…` — built by the one request builder. */
export function objectUrl(path, key) {
  const req = objectHistoryRequest({ path, object: key });
  return `${req.route}?${new URLSearchParams(req.query)}`;
}

// ── the filter ─────────────────────────────────────────────────────────────────────────────────

let scope = null;
const subs = new Set();
const emit = () => {
  for (const f of subs) f();
};

export const historyScope = Object.freeze({
  get: () => scope,
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  set(next) {
    if (scope && next && scope.path === next.path && scope.key === next.key) return;
    scope = next ? Object.freeze({ ...next }) : null;
    emit();
  },
  clear() {
    if (scope === null) return;
    scope = null;
    emit();
  },
});

let opener = null;
/** The shell registers what shows the panel; returns the unregister. */
export function setHistoryOpener(fn) {
  opener = fn;
  return () => {
    if (opener === fn) opener = null;
  };
}

/**
 * @param target  see the header
 * @param o.path       the canvas (repo-relative); an ElementRef carries its own `canvas`
 * @param o.canEdit    the session may edit this canvas — only then is a missing id stamped
 * @param o.queueStamp (PendingElementRef) → Promise<ElementRef | null>  S2's stamping seam
 * @returns { ok: true, key, path } | { ok: false, reason: 'no-canvas' | 'unstamped' | 'stamp-failed' | 'bad-target' }
 */
export async function openHistory(target, o = {}) {
  if (
    target === undefined ||
    target === null ||
    (!target.element && target.annotation === undefined)
  ) {
    historyScope.clear();
    opener?.();
    return { ok: true, key: null, path: o.path ?? null };
  }
  let t = target;
  const el = target.element;
  if (el && typeof el === 'object' && typeof el.element !== 'string') {
    // No authored id yet. Opening the history is a durable reference, which queues a stamp — for an
    // editor. A Can view / Can comment person never writes, so the panel stays plain for them.
    if (!o.canEdit || typeof o.queueStamp !== 'function') return { ok: false, reason: 'unstamped' };
    let stamped = null;
    try {
      stamped = await o.queueStamp(el);
    } catch {
      stamped = null;
    }
    if (!stamped || typeof stamped.element !== 'string')
      return { ok: false, reason: 'stamp-failed' };
    t = { element: stamped };
  }
  const key = objectKey(t);
  if (!key) return { ok: false, reason: 'bad-target' };
  const path = t.element?.canvas ?? o.path ?? scope?.path ?? null;
  if (!path) return { ok: false, reason: 'no-canvas' };
  historyScope.set({ path, key, tail: tailFor(target.kind) });
  opener?.();
  return { ok: true, key, path };
}
