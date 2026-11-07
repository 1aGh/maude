// client/v2/shell/still-bridge.js — #212 §5 (T2.2): the shell's side of the persisted overview stills.
//
// The canvas frame (untrusted origin, DDR-054) posts `stills-want { file }` once and `still-put { file, artboard,
// sig, bytes }` for each still it drew. Before reading or writing anything the shell checks, in order:
//   1. origin + the `active` gate (acceptFromCanvas): `e.source` is the shell's own iframe for `activePath`;
//   2. `file === activePath` — the frame's word may only NARROW the shell's own state, never pick the canvas;
//   3. that iframe's own `src` is a plain open (no version `sha`, embed, follow, hide-chrome, thumbnail);
//   4. the project index has a row for the canvas.
// Then it picks the key itself: the index `pid`, the frame's capability for that canvas (`frameCapFor`, C4 — per
// subject and per canvas) and the index row's source hashes. The answer (`stills`) goes to that window alone.
// Contract: client/v2/contracts/212-still-cache.md §5.

import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { frameCapFor } from '../../frame-cap.js';
import { indexSnapshotNow } from '../canvases/use-canvas-index.js';
import { stillStore } from './still-store.js';

export const STILL_BRIDGE_TYPES = Object.freeze(['stills-want', 'still-put']);
/** How long a `stills-want` waits for the first index snapshot (ms). */
export const STILL_INDEX_WAIT_MS = 4000;
/** A frame opened with any of these is not today's plain canvas: nothing is stored or answered for it. */
const NOT_PLAIN = ['sha', 'embed', 'follow', 'hide-chrome', 'thumbnail'];

export const isStillBridgeMessage = (m) =>
  !!m && typeof m === 'object' && (m.dgn === 'stills-want' || m.dgn === 'still-put');

/** A plain open of the canvas: the shell's own iframe `src` carries no version / embed / follow / capture flag. */
export function plainFrameSrc(src) {
  if (typeof src !== 'string' || !src) return false;
  let q;
  try {
    q = new URL(src, 'http://x').searchParams;
  } catch {
    return false;
  }
  return !NOT_PLAIN.some((k) => q.has(k));
}

const designRelOf = (path, designRel) => {
  const root = String(designRel || '.design').replace(/^\/+|\/+$/g, '');
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
};

/** The first index snapshot (the Canvases panel's read), waited for up to `ms`. */
function snapshotSoon(index, ms) {
  const now = index.get();
  if (now || ms <= 0) return Promise.resolve(now);
  return new Promise((res) => {
    let off = () => {};
    const t = setTimeout(() => {
      off();
      res(index.get());
    }, ms);
    off = index.subscribe(() => {
      const s = index.get();
      if (!s) return;
      clearTimeout(t);
      off();
      res(s);
    });
  });
}

/**
 * The key parts for the active canvas, or null when there is no key to give (no row, no pid).
 * `scope` = the frame's capability (C4) — a MAC over the canvas path under the opener's per-subject key.
 */
export function stillKeyFor(snapshot, { activePath, designRel, frameKey }) {
  if (!snapshot || typeof snapshot.pid !== 'string' || !snapshot.pid) return null;
  const rel = designRelOf(activePath, designRel);
  const row = Array.isArray(snapshot.canvases)
    ? snapshot.canvases.find((c) => c?.rel === rel)
    : null;
  if (!row || typeof row.srcHash !== 'string' || !row.srcHash) return null;
  const scope = frameCapFor(frameKey, rel) ?? `rel:${rel}`;
  const src = `${row.srcHash}:${row.metaHash ?? '-'}:${row.depsHash ?? '-'}`;
  return { pid: snapshot.pid, scope, src };
}

/**
 * One canvas→shell still message. `ctx`: `{ canvasOrigin, activePath, frame (the shell's iframe element for
 * activePath), designRel, frameKey, store?, index?, waitMs? }`. Resolves to what it did (tests read it):
 * 'refused' | 'stored' | 'not-stored' | 'answered' | 'no-key'.
 */
export async function handleStillBridge(e, ctx) {
  const win = ctx.frame?.contentWindow ?? null;
  const activePath = ctx.activePath;
  if (!win || typeof activePath !== 'string' || !activePath) return 'refused';
  const m = acceptFromCanvas(e, { canvasOrigin: ctx.canvasOrigin, active: win });
  if (!m || (m.dgn !== 'stills-want' && m.dgn !== 'still-put')) return 'refused';
  if (m.file !== activePath) return 'refused';
  const src = ctx.frame.getAttribute?.('src') ?? ctx.frame.src;
  if (!plainFrameSrc(src)) return 'refused';
  const index = ctx.index ?? indexSnapshotNow;
  const store = ctx.store ?? stillStore();
  const keyCtx = { activePath, designRel: ctx.designRel, frameKey: ctx.frameKey };
  if (m.dgn === 'still-put') {
    const key = stillKeyFor(index.get(), keyCtx);
    if (!key) return 'no-key';
    const ok = await store.put({ ...key, artboard: m.artboard, sig: m.sig, bytes: m.bytes });
    return ok ? 'stored' : 'not-stored';
  }
  const snap = await snapshotSoon(index, ctx.waitMs ?? STILL_INDEX_WAIT_MS);
  const key = stillKeyFor(snap, keyCtx);
  if (!key) return 'no-key';
  const items = await store.list(key);
  // the frame may have changed canvas while the store answered: then it gets nothing
  if (
    ctx.frame?.contentWindow !== win ||
    !plainFrameSrc(ctx.frame.getAttribute?.('src') ?? ctx.frame.src)
  )
    return 'refused';
  try {
    win.postMessage({ dgn: 'stills', file: activePath, items }, ctx.canvasOrigin);
  } catch {
    /* detached */
  }
  return 'answered';
}
