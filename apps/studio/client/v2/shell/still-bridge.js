// client/v2/shell/still-bridge.js — #212 §5 (T2.2): the shell's side of the persisted overview stills.
//
// The canvas frame (untrusted origin, DDR-054) posts `stills-want { file }` once and `still-put { file, artboard,
// sig, bytes }` for each still it drew. Before reading or writing anything the shell checks, in order:
//   1. origin + the `active` gate (acceptFromCanvas): `e.source` is the shell's own iframe for `activePath`;
//   2. `file === activePath` — the frame's word may only NARROW the shell's own state, never pick the canvas;
//   3. that iframe's own `src` is a plain open (no version `sha`, embed, follow, hide-chrome, thumbnail);
//   4. the project index has a row for the canvas.
// Then it picks the key itself: the index `pid`, a SHA-256 of the frame's capability for that canvas (`frameCapFor`,
// C4 — per subject and per canvas) and the index row's source hashes. The answer (`stills`) goes to that window
// alone, once per window, its buffers transferred.
//
// A WRITE needs one thing more: no sibling. Every canvas frame mounted at once shares the one canvas origin, so a
// sibling can run code in the active frame's realm (the C4 named gap) and post `still-put` as it — a forged still
// that would outlive the sibling. So the shell stores nothing while another frame of the canvas origin is mounted,
// and nothing for the rest of the session once one was (`createSiblingGuard`: the sibling may have changed the
// active frame's realm, or the origin's own state, before it left).
// Contract: client/v2/contracts/212-still-cache.md §5.

import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { frameCapFor, sha256 } from '../../frame-cap.js';
import { indexSnapshotNow } from '../canvases/use-canvas-index.js';
import { stillStore } from './still-store.js';

export const STILL_BRIDGE_TYPES = Object.freeze(['stills-want', 'still-put']);
/** How long a `stills-want` waits for the first index snapshot (ms). */
export const STILL_INDEX_WAIT_MS = 4000;
/** A frame opened with any of these is not today's plain canvas: nothing is stored or answered for it. */
const NOT_PLAIN = ['sha', 'embed', 'follow', 'hide-chrome', 'thumbnail'];

/**
 * The sibling guard: watches the shell's own iframes (kept-alive tabs, the System gallery, a version view — any
 * frame) and remembers every origin that ever had two frames mounted at once. `mayWrite(frame, origin)`: `frame`
 * is the only frame of `origin` mounted now, and no two ever were this session.
 * `doc`/`Observer` are injectable (tests); a missing one = no guard = no write.
 */
export function createSiblingGuard({
  doc = typeof document !== 'undefined' ? document : null,
  Observer = typeof MutationObserver === 'function' ? MutationObserver : null,
} = {}) {
  if (!doc || typeof doc.querySelectorAll !== 'function' || !Observer) return null;
  const crowded = new Set();
  const originOf = (f) => {
    const src = f?.src || f?.getAttribute?.('src');
    if (typeof src !== 'string' || !src) return null;
    try {
      const o = new URL(src, doc.baseURI || undefined).origin;
      return o && o !== 'null' ? o : null;
    } catch {
      return null;
    }
  };
  const framesOf = (origin) =>
    [...doc.querySelectorAll('iframe')].filter((f) => originOf(f) === origin);
  const sweep = () => {
    const count = new Map();
    for (const f of doc.querySelectorAll('iframe')) {
      const o = originOf(f);
      if (o) count.set(o, (count.get(o) ?? 0) + 1);
    }
    for (const [o, n] of count) if (n > 1) crowded.add(o);
  };
  const isFrame = (n) => n?.nodeName === 'IFRAME' || !!n?.querySelector?.('iframe');
  const obs = new Observer((records) => {
    for (const r of records ?? [])
      if (isFrame(r.target) || [...(r.addedNodes ?? [])].some(isFrame)) return void sweep();
  });
  obs.observe(doc, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
  sweep();
  return {
    mayWrite(frame, origin) {
      sweep();
      if (!frame || crowded.has(origin)) return false;
      const fs = framesOf(origin);
      return fs.length === 1 && fs[0] === frame;
    },
    stop: () => obs.disconnect(),
  };
}

/** The page's guard: started when the shell loads this module, before any canvas frame is mounted. */
const pageGuard = createSiblingGuard();
/** Frame windows already answered: one `stills-want` answer per window. */
const answeredWins = new WeakSet();

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

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
/** The stored scope: a SHA-256 of the frame capability (or of the plain path) — never the capability itself. */
export const stillScopeOf = (cap) =>
  hex(sha256(new TextEncoder().encode(`maude-still-scope-v1\n${cap}`)));

/**
 * The key parts for the active canvas, or null when there is no key to give (no row, no pid).
 * `scope` = a SHA-256 of the frame's capability (C4) — a MAC over the canvas path under the opener's per-subject key.
 */
export function stillKeyFor(snapshot, { activePath, designRel, frameKey }) {
  if (!snapshot || typeof snapshot.pid !== 'string' || !snapshot.pid) return null;
  const rel = designRelOf(activePath, designRel);
  const row = Array.isArray(snapshot.canvases)
    ? snapshot.canvases.find((c) => c?.rel === rel)
    : null;
  if (!row || typeof row.srcHash !== 'string' || !row.srcHash) return null;
  const scope = stillScopeOf(frameCapFor(frameKey, rel) ?? `rel:${rel}`);
  const src = `${row.srcHash}:${row.metaHash ?? '-'}:${row.depsHash ?? '-'}`;
  return { pid: snapshot.pid, scope, src };
}

/**
 * One canvas→shell still message. `ctx`: `{ canvasOrigin, activePath, frame (the shell's iframe element for
 * activePath), designRel, frameKey, store?, index?, waitMs?, guard? }`. Resolves to what it did (tests read it):
 * 'refused' | 'siblings' | 'stored' | 'not-stored' | 'answered' | 'once' | 'no-key'.
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
    const guard = ctx.guard === undefined ? pageGuard : ctx.guard;
    if (!guard?.mayWrite(ctx.frame, ctx.canvasOrigin)) return 'siblings';
    const key = stillKeyFor(index.get(), keyCtx);
    if (!key) return 'no-key';
    const ok = await store.put({ ...key, artboard: m.artboard, sig: m.sig, bytes: m.bytes });
    return ok ? 'stored' : 'not-stored';
  }
  if (answeredWins.has(win)) return 'once';
  answeredWins.add(win);
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
    win.postMessage(
      { dgn: 'stills', file: activePath, items },
      ctx.canvasOrigin,
      items.map((it) => it.bytes)
    );
  } catch {
    /* detached */
  }
  return 'answered';
}
