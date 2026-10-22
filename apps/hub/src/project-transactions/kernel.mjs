// The acceptance kernel — DDR-241 §1, §4–§6.
//
// One place decides whether a proposed action becomes an accepted revision:
//   1. validate the envelope and resolve a retained idempotency result;
//   2. authorize (a reader proposes nothing) and fence on the persistent epoch;
//   3. compute every operation against the accepted state in a private overlay
//      (three-way merge when a proposal's base is not the head, strict
//      generation/path checks for manifest operations, effect-aware undo);
//   4. validate the resulting values (source parser, sizes, path rules);
//   5. commit head + log + payloads + result atomically in the store;
//   6. only then publish, by handing the accepted values to `applyAccepted`.
//
// Proposals are processed one at a time per project — the store's parent
// revision check is the belt, this queue is the braces. Nothing here writes a
// document, a file or a socket; that is the caller's `applyAccepted`.

import { createHash, randomUUID } from 'node:crypto';

import { canvasSlugFromRel } from '../../../studio/canvas-slug.ts';
import { validateCanvasPath } from '../../../studio/sync/canvas-path.ts';
import { checkLane, LANE_NAMES, laneHash, mergeLane } from './lanes.mjs';
import { StoreConflict } from './store-core.mjs';

export const PROTOCOL = 1;
export const MAX_PROPOSAL_BYTES = 16 * 1024 * 1024;
export const MAX_OPERATIONS = 500;
export const EMPTY_HASH = laneHash('');

const TX_ID = /^[A-Za-z0-9_-]{8,128}$/;
const DOC_NAME = /^[A-Za-z0-9._/-]{1,300}$/;
// The studio's folder-name rule (canvas-create.ts NAME_RE): letters and
// numbers in any script, then spaces/underscores/hyphens — never a leading
// `_` (runtime state), `-` or `.`.
const DIR_COMPONENT = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,99}$/u;
const MAX_DIR_DEPTH = 16;
/** `origin.runId` / `origin.chatId` (V2-1.5 §5.1). */
const ORIGIN_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** `history.undo { actionIds }` takes 1–50 distinct ids (V2-1.5 §5.2). */
export const MAX_UNDO_TARGETS = 50;
const ACTION_ID_MAX = 160;
/** `fence.runId` (V2-1.15 §5.1 RunId) and the most leases one publish names. */
const RUN_ID = /^r_[A-Za-z0-9_-]{6,64}$/;
export const MAX_FENCE_LEASES = 200;
// S1.6 (S1-trash.md) — named versions, kept-aside versions, the shared Trash.
/** A version name: 1–80 characters (code points), no control characters. */
export const MAX_VERSION_NAME = 80;
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
/** `origin.trashed[].artboard`: 1–128 characters, no `/`, no control characters. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
const ARTBOARD_ID = /^[^/\u0000-\u001f\u007f-\u009f]{1,128}$/u;
export const MAX_TRASHED = 200;
/** `trash.clear { items }` names 1–500 items. */
export const MAX_CLEAR_ITEMS = 500;
const ENTRY = /^[A-Za-z0-9_-]{1,128}$/;
/** Lanes that make a version of a canvas (V2-1.9 §5.1 — never the comments lane). */
const VERSION_LANES = ['html', 'css', 'meta', 'annotations'];
/** The capability each operation needs (V2-1.7 §5.2; `auth.can`, project-level). */
const CAP_OF = {
  'lane.replace': 'edit',
  'doc.create': 'edit',
  'doc.move': 'edit',
  'doc.delete': 'trash',
  'dir.create': 'edit',
  'dir.move': 'edit',
  'dir.delete': 'edit',
  'history.undo': 'edit',
  'history.redo': 'edit',
  'history.restore': 'edit',
  'history.name': 'edit',
  'history.aside': 'edit',
  'trash.restore': 'trash',
  'trash.clear': 'delete',
};
/** Operations that must be a proposal's only one (S1-trash.md §3). */
const SOLE_OPS = new Set(['history.name', 'history.aside', 'trash.restore', 'trash.clear']);
/** The action kind each sole op commits as (the client's `kind` is not asked). */
const KIND_OF = {
  'history.name': 'name',
  'history.aside': 'aside',
  'trash.restore': 'restore',
  'trash.clear': 'trash.clear',
};

/** Codes whose rejection is terminal for these exact bytes (retained). */
const TERMINAL = new Set([
  'base-conflict',
  'source-invalid',
  'generation-stale',
  'dependency-missing',
  'invalid',
  'undo-conflict',
  'path-conflict',
  // A newer grant took the artboard; these bytes can never pass again.
  'lease-fenced',
  // V2-1.16 U1 (S9.5): final — a v2 client never renews on it.
  'not-in-scope',
  // S1.6: the item was cleared out of the trash; nothing brings it back.
  'cleared',
]);

const HTTP = {
  accepted: 200,
  invalid: 400,
  forbidden: 403,
  'source-invalid': 422,
  capacity: 413,
  'mode-off': 409,
  'epoch-stale': 409,
  'base-conflict': 409,
  'generation-stale': 409,
  'dependency-missing': 409,
  'transaction-id-reused': 409,
  'undo-conflict': 409,
  'path-conflict': 409,
  'lease-fenced': 409,
  'not-in-scope': 403,
  cleared: 409,
  retryable: 503,
};

class Reject extends Error {
  constructor(code, detail = {}) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Validate a directory path (first-class manifest directory). */
export function checkDirPath(path, groups) {
  if (typeof path !== 'string' || !path || path.length > 512) return 'not a path';
  const parts = path.split('/');
  if (parts.length > MAX_DIR_DEPTH) return 'nested too deep';
  if (path !== path.normalize('NFC')) return 'not NFC-normalized';
  for (const p of parts) {
    if (!DIR_COMPONENT.test(p) || p.endsWith(' ')) return 'invalid component';
  }
  if (groups?.length && !groups.some((g) => path === g || path.startsWith(`${g}/`))) {
    return 'outside every canvas group';
  }
  return null;
}

export function createKernel({
  store,
  projectId,
  applyAccepted = async () => {},
  canvasGroups = () => null,
  designRel = '.design',
  now = () => Date.now(),
  newId = () => randomUUID(),
  log = console,
}) {
  let queue = Promise.resolve();
  const serialize = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  /** Doc-name prefix (`ws/<w>/<b>/`) of a namespaced document name. */
  const prefixOf = (doc) => {
    const i = doc.lastIndexOf('/');
    return i < 0 ? '' : doc.slice(0, i + 1);
  };
  const slugOf = (doc) => doc.slice(doc.lastIndexOf('/') + 1);
  const docFor = (prefix, path) => `${prefix}${canvasSlugFromRel(path, designRel)}`;
  const groupPaths = () =>
    (canvasGroups() ?? []).map((g) => (typeof g === 'string' ? g : g.path)).filter(Boolean);

  function checkCanvasPath(doc, path) {
    const groups = canvasGroups();
    const verdict = validateCanvasPath({
      path,
      slug: slugOf(doc),
      designRel,
      canvasGroups: groups ?? undefined,
      allowUndeclaredGroup: !groups || groups.length === 0,
    });
    return verdict.ok ? null : (verdict.reason ?? 'invalid canvas path');
  }

  // ------------------------------------------------------------ envelope

  function parseEnvelope(bytes) {
    if (typeof bytes !== 'string' || bytes.length === 0)
      throw new Reject('invalid', { reason: 'empty body' });
    if (Buffer.byteLength(bytes, 'utf8') > MAX_PROPOSAL_BYTES)
      throw new Reject('capacity', { reason: 'proposal too large' });
    let p;
    try {
      p = JSON.parse(bytes);
    } catch {
      throw new Reject('invalid', { reason: 'not JSON' });
    }
    if (!p || typeof p !== 'object' || Array.isArray(p))
      throw new Reject('invalid', { reason: 'not an object' });
    if (p.protocol !== PROTOCOL) throw new Reject('invalid', { reason: 'unsupported protocol' });
    if (p.projectId !== projectId) throw new Reject('invalid', { reason: 'wrong project' });
    if (!Number.isSafeInteger(p.epoch) || p.epoch < 0)
      throw new Reject('invalid', { reason: 'bad epoch' });
    if (typeof p.transactionId !== 'string' || !TX_ID.test(p.transactionId)) {
      throw new Reject('invalid', { reason: 'bad transactionId' });
    }
    const a = p.action;
    if (!a || typeof a !== 'object' || !Array.isArray(a.operations) || a.operations.length === 0) {
      throw new Reject('invalid', { reason: 'action.operations required' });
    }
    if (a.operations.length > MAX_OPERATIONS)
      throw new Reject('capacity', { reason: 'too many operations' });
    if (
      p.dependsOn !== undefined &&
      (!Array.isArray(p.dependsOn) || p.dependsOn.some((d) => !TX_ID.test(d)))
    ) {
      throw new Reject('invalid', { reason: 'bad dependsOn' });
    }
    const label = typeof a.label === 'string' ? a.label.slice(0, 200) : null;
    const kind = typeof a.kind === 'string' && /^[a-z0-9.-]{1,64}$/.test(a.kind) ? a.kind : 'edit';
    const origin = {};
    if (p.origin && typeof p.origin === 'object') {
      for (const k of ['deviceId', 'sessionId', 'client']) {
        if (typeof p.origin[k] === 'string') origin[k] = p.origin[k].slice(0, 128);
      }
      // V2-1.5 §5.1 — which AI run / chat made it, and when the person made
      // it (their clock). Kept only when well-formed; anything else under these
      // names is dropped, never refused (a v1 client sends none of them).
      for (const k of ['runId', 'chatId']) {
        if (typeof p.origin[k] === 'string' && ORIGIN_ID.test(p.origin[k])) origin[k] = p.origin[k];
      }
      if (Number.isSafeInteger(p.origin.madeAt) && p.origin.madeAt >= 0)
        origin.madeAt = p.origin.madeAt;
      // S5.5 — a stopped AI run's publish (V2-1.5 §5.1 `partial`); only `true`.
      if (p.origin.partial === true) origin.partial = true;
      // S1.6 — an artboard-trash action names what it removed (S1-trash.md
      // §2). Kept only on kind `trash` and only when every entry is well
      // formed; otherwise dropped, never refused.
      const trashed = kind === 'trash' ? parseTrashed(p.origin.trashed) : null;
      if (trashed) origin.trashed = trashed;
    }
    return { p, label, kind, origin, fence: parseFence(p.fence) };
  }

  function parseTrashed(t) {
    if (!Array.isArray(t) || t.length < 1 || t.length > MAX_TRASHED) return null;
    const out = [];
    for (const x of t) {
      if (!x || typeof x !== 'object' || typeof x.artboard !== 'string') return null;
      if (!ARTBOARD_ID.test(x.artboard)) return null;
      out.push(
        typeof x.label === 'string'
          ? { artboard: x.artboard, label: x.label.slice(0, 200) }
          : { artboard: x.artboard }
      );
    }
    return out;
  }

  /**
   * V2-1.15 §5.3 — an AI run's publish carries its lease tokens:
   * `fence: { runId, leases: [{entry, artboard, token}] }`, at most 200. Absent
   * on every v1 proposal (and on undo / Keep). Malformed → `invalid`: a fence
   * that cannot be read must not be taken as "no fence".
   */
  function parseFence(f) {
    if (f === undefined || f === null) return null;
    const bad = (reason) => new Reject('invalid', { reason });
    if (typeof f !== 'object' || Array.isArray(f)) throw bad('bad fence');
    if (typeof f.runId !== 'string' || !RUN_ID.test(f.runId)) throw bad('bad fence.runId');
    if (!Array.isArray(f.leases) || f.leases.length > MAX_FENCE_LEASES)
      throw bad(`fence.leases takes at most ${MAX_FENCE_LEASES}`);
    const leases = f.leases.map((l) => {
      if (
        !l ||
        typeof l.entry !== 'string' ||
        !l.entry ||
        l.entry.length > 300 ||
        typeof l.artboard !== 'string' ||
        !l.artboard ||
        l.artboard.length > 128 ||
        !Number.isSafeInteger(l.token) ||
        l.token < 1
      )
        throw bad('bad fence lease');
      return { entry: l.entry, artboard: l.artboard, token: l.token };
    });
    return { runId: f.runId, leases };
  }

  // ------------------------------------------------------------ working state

  function createWork() {
    const docs = new Map(); // doc → state|null, lazily loaded
    const contents = new Map(); // hash → content
    const changed = new Map(); // doc → { lanes:Set, manifest:bool, writeId }
    const dirs = { add: new Set(), remove: new Set() };
    const effects = [];
    const blobs = new Map();
    // S1.6 — rows for the additive tables, written by the same commit.
    const names = [];
    const cleared = [];

    const toState = (h) =>
      h
        ? {
            ...h,
            orig: { ...h, lanes: { ...h.lanes } },
            lanes: Object.fromEntries(Object.entries(h.lanes).map(([k, v]) => [k, { ...v }])),
          }
        : null;
    async function load(doc) {
      if (!docs.has(doc)) {
        const heads = await store.heads([doc]);
        docs.set(doc, toState(heads[doc]));
      }
      return docs.get(doc);
    }
    /**
     * Load the heads of many documents in ONE store call. A cell's store is a
     * round trip away; an import chunk of a hundred canvases loaded its heads
     * one call per document (G2). Same states as `load`, fetched together.
     */
    async function prime(names) {
      const missing = names.filter((n) => !docs.has(n));
      if (missing.length < 2) return;
      const heads = await store.heads(missing);
      for (const n of missing) docs.set(n, toState(heads[n]));
    }
    async function content(hash) {
      if (!hash || hash === EMPTY_HASH) return '';
      if (contents.has(hash)) return contents.get(hash);
      const body = await store.blob(hash);
      if (body === null) throw new Reject('retryable', { reason: `payload ${hash} unavailable` });
      contents.set(hash, body);
      return body;
    }
    async function laneContent(state, lane) {
      return content(state?.lanes?.[lane]?.hash ?? null);
    }
    function mark(doc, what) {
      const c = changed.get(doc) ?? { lanes: new Set(), manifest: false, writeId: undefined };
      if (what === 'manifest') c.manifest = true;
      else c.lanes.add(what);
      changed.set(doc, c);
      return c;
    }
    /** Set a lane to `next` (already validated), recording an effect. */
    function setLane(state, lane, next, { op = 'replace', writeId } = {}) {
      const before = state.lanes[lane]?.hash ?? null;
      const after = next === '' ? null : laneHash(next);
      if ((before ?? EMPTY_HASH) === (after ?? EMPTY_HASH)) return false;
      const effect = `e_${newId()}`;
      if (after) {
        contents.set(after, next);
        blobs.set(after, next);
        state.lanes[lane] = { hash: after, effect };
      } else {
        state.lanes[lane] = { hash: null, effect };
      }
      effects.push({
        effect,
        doc: state.doc,
        entry: state.entry,
        lane,
        op,
        beforeHash: before,
        afterHash: after,
      });
      const c = mark(state.doc, lane);
      if (lane === 'annotations' && writeId) c.writeId = writeId;
      return true;
    }
    async function liveDocAt(path) {
      for (const [doc, st] of docs) {
        if (st && !st.retired && st.path === path) return doc;
      }
      const doc = await store.docByPath(path);
      if (!doc) return null;
      const st = await load(doc);
      return st && !st.retired && st.path === path ? doc : null;
    }
    return {
      docs,
      load,
      prime,
      content,
      laneContent,
      setLane,
      mark,
      dirs,
      effects,
      blobs,
      liveDocAt,
      changed,
      names,
      cleared,
    };
  }

  // ------------------------------------------------------------ operations

  async function opLaneReplace(work, op) {
    if (!LANE_NAMES.includes(op.lane)) throw new Reject('invalid', { reason: 'unknown lane' });
    if (typeof op.doc !== 'string' || !DOC_NAME.test(op.doc))
      throw new Reject('invalid', { reason: 'bad doc' });
    const named = await work.load(op.doc);
    if (!named || (named.retired && !named.movedTo))
      throw new Reject('dependency-missing', { doc: op.doc, reason: 'document not live' });
    if (op.generation !== undefined && op.generation !== named.generation) {
      throw new Reject('generation-stale', { doc: op.doc, generation: named.generation });
    }
    // A teammate moved the canvas after this edit was made: the edit follows
    // it to where it lives now. A move carries every lane byte for byte, so
    // the edit's base means the same thing there. Moved and then deleted has
    // no live continuation and stays a conflict.
    const st = named.retired ? await liveContinuation(work, named) : named;
    if (!st) throw new Reject('dependency-missing', { doc: op.doc, reason: 'document not live' });
    const checked = checkLane(op.lane, op.content, { path: st.path ?? `${slugOf(op.doc)}.tsx` });
    if (!checked.ok)
      throw new Reject(checked.code, { doc: op.doc, lane: op.lane, reason: checked.reason });
    const headHash = st.lanes[op.lane]?.hash ?? EMPTY_HASH;
    // The base may travel as CONTENT (`baseContent`): the literal value the
    // author's edit was derived from, which need not ever have been accepted
    // (a browser's view with its own pending strokes, an editor buffer). It
    // grants nothing `content` does not already: the merge result is validated
    // like any other value.
    const inlineBase = typeof op.baseContent === 'string' ? op.baseContent : null;
    if (inlineBase !== null && inlineBase.length > MAX_PROPOSAL_BYTES)
      throw new Reject('capacity', { reason: 'base too large' });
    const base =
      inlineBase !== null
        ? inlineBase === ''
          ? EMPTY_HASH
          : laneHash(inlineBase)
        : op.base === null || op.base === undefined
          ? EMPTY_HASH
          : op.base;
    let next = checked.content;
    let merged = false;
    /** S9.24 — elements held at the head's version (`objects: 'hold'`). */
    let conflicts = null;
    if (base !== headHash) {
      let baseContent;
      try {
        baseContent = inlineBase ?? (await work.content(base));
      } catch {
        throw new Reject('base-conflict', {
          doc: op.doc,
          lane: op.lane,
          reason: 'unknown base',
          head: headHash,
        });
      }
      const current = await work.laneContent(st, op.lane);
      const m = mergeLane(op.lane, baseContent, checked.content, current, {
        holdObjects: op.objects === 'hold',
      });
      if (!m.ok) throw new Reject('base-conflict', { doc: op.doc, lane: op.lane, head: headHash });
      const recheck = checkLane(op.lane, m.content, { path: st.path ?? `${slugOf(op.doc)}.tsx` });
      if (!recheck.ok)
        throw new Reject('base-conflict', {
          doc: op.doc,
          lane: op.lane,
          head: headHash,
          reason: recheck.reason,
        });
      next = recheck.content;
      merged = true;
      if (m.conflicts?.length) {
        // S9.24 — the held elements: the proposal's own board is kept aside in THIS action (the
        // loser's body is never lost, even if nobody ever opens the card), and the answer names
        // them so the proposer's Mac shows the card. No head moves for the aside (V2-1.9 §4.9).
        const asideHash = laneHash(checked.content);
        work.blobs.set(asideHash, checked.content);
        work.effects.push({
          effect: `e_${newId()}`,
          doc: st.doc,
          entry: st.entry,
          lane: '@aside',
          op: `aside.${op.lane}`,
          beforeHash: headHash === EMPTY_HASH ? null : headHash,
          afterHash: asideHash,
        });
        conflicts = m.conflicts.map((c) => ({
          id: c.id,
          type: c.type,
          fields: c.fields,
          mine: c.mine,
          theirs: c.theirs,
        }));
      }
    }
    work.setLane(st, op.lane, next, { writeId: op.writeId });
    const held = conflicts ? { conflicts } : {};
    if (st.doc !== op.doc)
      return { doc: op.doc, lane: op.lane, merged, followedTo: st.doc, ...held };
    return merged ? { doc: op.doc, lane: op.lane, merged: true, ...held } : null;
  }

  /** The live document a moved one continues as (same entry), or null. */
  async function liveContinuation(work, st) {
    for (const s of work.docs.values()) {
      if (s && !s.retired && s.entry === st.entry) return s;
    }
    const doc = await store.liveDocByEntry(st.entry);
    const live = doc ? await work.load(doc) : null;
    return live && !live.retired && live.entry === st.entry ? live : null;
  }

  async function opDocCreate(work, op) {
    if (typeof op.doc !== 'string' || !DOC_NAME.test(op.doc))
      throw new Reject('invalid', { reason: 'bad doc' });
    const reason = checkCanvasPath(op.doc, op.path);
    if (reason) throw new Reject('invalid', { reason: `path: ${reason}` });
    const existing = await work.load(op.doc);
    if (existing && !existing.retired)
      throw new Reject('path-conflict', { doc: op.doc, reason: 'document exists' });
    if (await work.liveDocAt(op.path)) throw new Reject('path-conflict', { path: op.path });
    const st = {
      doc: op.doc,
      entry: typeof op.entry === 'string' && TX_ID.test(op.entry) ? op.entry : `n_${newId()}`,
      generation: (existing?.generation ?? 0) + 1,
      path: op.path,
      retired: false,
      movedTo: null,
      lanes: {},
      // WHAT THE STORE STILL HOLDS FOR THIS NAME. A deleted document keeps its
      // head rows, so a create under the same name that claimed "expect
      // nothing" failed its compare-and-swap with `head-moved` — a retryable
      // code, which a durable outbox re-sent forever, silencing everything
      // queued behind it (plan T31/L20: the peer that was away still had the
      // canvas and proposed it as the deletion arrived).
      orig: existing?.orig ?? null,
    };
    work.docs.set(op.doc, st);
    const lanes = op.lanes && typeof op.lanes === 'object' ? op.lanes : {};
    for (const lane of Object.keys(lanes)) {
      const checked = checkLane(lane, lanes[lane], { path: op.path });
      if (!checked.ok)
        throw new Reject(checked.code, { doc: op.doc, lane, reason: checked.reason });
      work.setLane(st, lane, checked.content);
    }
    work.effects.push({
      effect: `e_${newId()}`,
      doc: op.doc,
      entry: st.entry,
      lane: '@manifest',
      op: 'create',
      afterPath: op.path,
    });
    const c = work.mark(op.doc, 'manifest');
    c.created = true;
    c.ops = ['create'];
    return null;
  }

  async function opDocDelete(work, op) {
    const st = await work.load(op.doc);
    if (!st || st.retired)
      throw new Reject('dependency-missing', { doc: op.doc, reason: 'document not live' });
    if (op.generation !== undefined && op.generation !== st.generation) {
      throw new Reject('generation-stale', { doc: op.doc, generation: st.generation });
    }
    st.retired = true;
    work.effects.push({
      effect: `e_${newId()}`,
      doc: op.doc,
      entry: st.entry,
      lane: '@manifest',
      op: 'delete',
      beforePath: st.path,
    });
    const c = work.mark(op.doc, 'manifest');
    c.deleted = true;
    return null;
  }

  async function opDocMove(work, op) {
    const st = await work.load(op.doc);
    if (!st || st.retired)
      throw new Reject('dependency-missing', { doc: op.doc, reason: 'document not live' });
    if (op.generation !== undefined && op.generation !== st.generation) {
      throw new Reject('generation-stale', { doc: op.doc, generation: st.generation });
    }
    const toPath = op.to?.path;
    const toDoc = op.to?.doc ?? docFor(prefixOf(op.doc), toPath ?? '');
    if (typeof toDoc !== 'string' || !DOC_NAME.test(toDoc))
      throw new Reject('invalid', { reason: 'bad target doc' });
    const reason = checkCanvasPath(toDoc, toPath);
    if (reason) throw new Reject('invalid', { reason: `path: ${reason}` });
    if (toDoc === op.doc) {
      // Same transport document (a case-only rename is not representable): nothing moves.
      return null;
    }
    const target = await work.load(toDoc);
    if (target && !target.retired) throw new Reject('path-conflict', { doc: toDoc });
    if (await work.liveDocAt(toPath)) throw new Reject('path-conflict', { path: toPath });
    const moved = {
      doc: toDoc,
      entry: st.entry,
      generation: (target?.generation ?? 0) + 1,
      path: toPath,
      retired: false,
      movedTo: null,
      lanes: {},
      // The destination name may have held a deleted document; its head rows
      // are what the swap must expect (see opDocCreate).
      orig: target?.orig ?? null,
    };
    work.docs.set(toDoc, moved);
    for (const [lane, h] of Object.entries(st.lanes)) {
      if (!h?.hash) continue;
      const body = await work.content(h.hash);
      work.setLane(moved, lane, body, { op: 'move' });
    }
    st.retired = true;
    st.movedTo = toPath;
    work.effects.push({
      effect: `e_${newId()}`,
      doc: toDoc,
      entry: st.entry,
      lane: '@manifest',
      op: 'move',
      beforePath: st.path,
      afterPath: toPath,
    });
    const from = work.mark(op.doc, 'manifest');
    from.retiredFor = toPath;
    const to = work.mark(toDoc, 'manifest');
    to.created = true;
    to.movedFrom = st.path;
    return null;
  }

  async function opDir(work, op, state) {
    const groups = groupPaths();
    if (op.op === 'dir.create') {
      const reason = checkDirPath(op.path, groups);
      if (reason) throw new Reject('invalid', { reason: `dir: ${reason}` });
      work.dirs.add.add(op.path);
      work.dirs.remove.delete(op.path);
      work.effects.push({
        effect: `e_${newId()}`,
        lane: '@dir',
        op: 'dir.create',
        afterPath: op.path,
      });
      return null;
    }
    if (op.op === 'dir.delete') {
      const reason = checkDirPath(op.path, groups);
      if (reason) throw new Reject('invalid', { reason: `dir: ${reason}` });
      const manifest = await store.manifest();
      const under = (p) => p === op.path || p.startsWith(`${op.path}/`);
      for (const d of manifest.dirs.filter(under)) {
        work.dirs.remove.add(d);
        work.dirs.add.delete(d);
        work.effects.push({
          effect: `e_${newId()}`,
          lane: '@dir',
          op: 'dir.delete',
          beforePath: d,
        });
      }
      for (const d of manifest.docs.filter((x) => !x.retired && x.path && under(x.path))) {
        await opDocDelete(work, { doc: d.doc });
      }
      return null;
    }
    // dir.move
    const fromReason = checkDirPath(op.from, groups);
    const toReason = checkDirPath(op.to, groups);
    if (fromReason || toReason)
      throw new Reject('invalid', { reason: `dir: ${fromReason ?? toReason}` });
    if (op.to === op.from || op.to.startsWith(`${op.from}/`))
      throw new Reject('invalid', { reason: 'cannot move a folder into itself' });
    const manifest = await store.manifest();
    const under = (p) => p === op.from || p.startsWith(`${op.from}/`);
    const rebase = (p) => `${op.to}${p.slice(op.from.length)}`;
    for (const d of manifest.dirs.filter(under)) {
      work.dirs.remove.add(d);
      work.dirs.add.add(rebase(d));
      work.effects.push({
        effect: `e_${newId()}`,
        lane: '@dir',
        op: 'dir.move',
        beforePath: d,
        afterPath: rebase(d),
      });
    }
    for (const d of manifest.docs.filter((x) => !x.retired && x.path && under(x.path))) {
      const toPath = rebase(d.path);
      await opDocMove(work, {
        doc: d.doc,
        to: { path: toPath, doc: docFor(prefixOf(d.doc), toPath) },
      });
    }
    void state;
    return null;
  }

  /**
   * The actions an undo/redo targets: `actionId` (one, v1) or `actionIds`
   * (V2-1.5 §5.2: 1–50 distinct ids). Both at once is malformed.
   */
  function undoTargets(op) {
    if (op.actionIds === undefined) return { ids: [op.actionId], many: false };
    const bad = (reason) => new Reject('invalid', { reason });
    if (op.actionId !== undefined) throw bad('actionId or actionIds, not both');
    const ids = op.actionIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_UNDO_TARGETS)
      throw bad(`actionIds takes 1–${MAX_UNDO_TARGETS} ids`);
    if (ids.some((id) => typeof id !== 'string' || !id || id.length > ACTION_ID_MAX))
      throw bad('bad actionIds');
    if (new Set(ids).size !== ids.length) throw bad('actionIds must be distinct');
    return { ids, many: true };
  }

  /**
   * The target actions in one store call when the home has `actions` (a cloud
   * cell answers 50 targets in one RPC, not 50); a store without it — an older
   * Durable Object during a rollout — is asked one id at a time.
   */
  async function loadActions(ids) {
    if (ids.length > 1 && typeof store.actions === 'function') {
      try {
        const got = await store.actions(ids);
        if (Array.isArray(got) && got.length === ids.length) return got;
      } catch (err) {
        if (err instanceof StoreConflict) throw err;
      }
    }
    const out = [];
    for (const id of ids) out.push(await store.action(id));
    return out;
  }

  /**
   * gate-a-fix4a — the targets' own undo / redo chain: an undo or redo by the
   * same actor whose `undoes` names a target, or a link of that chain (the redo
   * names the undo it re-applies). Returns `(ids) => Set` of the ids in it; the
   * action rows load once per undo, batched like the targets.
   */
  function ownHistoryOf(targets) {
    const family = new Set(targets.map((t) => t.actionId));
    const actor = targets[0]?.actor;
    const rows = new Map();
    const history = async (ids) => {
      const want = [...new Set(ids)].filter((id) => typeof id === 'string' && !rows.has(id));
      for (let i = 0; i < want.length; i += MAX_UNDO_TARGETS) {
        const chunk = want.slice(i, i + MAX_UNDO_TARGETS);
        const got = await loadActions(chunk);
        for (let j = 0; j < chunk.length; j++) rows.set(chunk[j], got[j] ?? null);
      }
      for (let grew = true; grew; ) {
        grew = false;
        for (const [id, a] of rows) {
          if (family.has(id) || !a || a.actor !== actor) continue;
          if (a.kind !== 'undo' && a.kind !== 'redo') continue;
          const of = Array.isArray(a.undoes) ? a.undoes : [a.undoes];
          if (of.some((x) => family.has(x))) {
            family.add(id);
            grew = true;
          }
        }
      }
      return new Set(ids.filter((id) => family.has(id)));
    };
    /**
     * P8-B2 — `steps` (later lane effects, oldest first) without the actor's round trips that came out to
     * nothing: an edit of the same actor whose undo / redo history leaves it where it began is not later work a
     * revert must rebase through. Without this, ⌘Z ⌘Z over two edits that touch side by side in one string (an
     * element's `style`: opacity, then corners) rebased the older edit's revert through the newer edit AND its
     * own undo; diff3 calls touching hunks a conflict, and the actor was told someone else had changed it.
     * Each edit and the undos / redos that name it (a redo names the undo it re-applies) form one family whose
     * on / off state is read in order, from how its first step found it (an undo found it on, a redo or the
     * edit itself found it off); if it ends where it started the whole family drops out. Anything whose
     * targets cannot be resolved to the actor's own edits is kept — nothing is dropped on a guess.
     */
    history.withoutRoundTrips = async (steps) => {
      // the undo / redo targets may lie outside `steps`; load them (and theirs) so a family can be followed
      for (let want = steps.map((x) => x.actionId), depth = 0; want.length && depth < 8; depth++) {
        await history(want);
        want = [];
        for (const id of rows.keys()) {
          const a = rows.get(id);
          if (!a || a.actor !== actor || (a.kind !== 'undo' && a.kind !== 'redo')) continue;
          for (const t of (Array.isArray(a.undoes) ? a.undoes : [a.undoes]).filter(Boolean))
            if (!rows.has(t)) want.push(t);
        }
      }
      const rootsOf = (id, seen = new Set()) => {
        if (seen.has(id)) return null;
        seen.add(id);
        const a = rows.get(id);
        if (!a || a.actor !== actor) return null;
        if (a.kind !== 'undo' && a.kind !== 'redo') return [id];
        const roots = new Set();
        for (const t of (Array.isArray(a.undoes) ? a.undoes : [a.undoes]).filter(Boolean)) {
          const r = rootsOf(t, seen);
          if (!r) return null;
          for (const x of r) roots.add(x);
        }
        return roots.size ? [...roots] : null;
      };
      const start = new Map(); // edit action id → in force before the first step touching it?
      const now = new Map();
      const rootsOfStep = new Map();
      for (const step of steps) {
        const a = rows.get(step.actionId);
        const roots = rootsOf(step.actionId);
        if (!a || !roots) continue;
        rootsOfStep.set(step.actionId, roots);
        const isMove = a.kind === 'undo' || a.kind === 'redo';
        for (const r of roots) {
          // the first step says how the family began: an undo found it on, a redo found it off, the edit itself
          // (inside `steps`) found it not yet made
          if (!start.has(r)) start.set(r, a.kind === 'undo');
          now.set(r, isMove ? a.kind === 'redo' : true);
        }
      }
      const settled = new Set([...now].filter(([r, on]) => on === start.get(r)).map(([r]) => r));
      if (settled.size === 0) return steps;
      return steps.filter((step) => {
        const roots = rootsOfStep.get(step.actionId);
        return !(roots && roots.every((r) => settled.has(r)));
      });
    };
    return history;
  }

  /** `(entry, lane)` — the unit a lane revert works on. */
  const laneKey = (e) => `${e.entry ?? e.doc}\u0000${e.lane}`;

  /**
   * Revert one `(entry, lane)` to the before-content of `first` — the OLDEST
   * target effect on it — rebased three-way through every later effect on that
   * lane except the targets' own (`targetIds`). Returns `{ applied }` or
   * `{ skipped }`.
   */
  async function revertLane(work, first, targetIds, many, ownHistory) {
    // The entry may have moved since; follow it to its live document — first in
    // this proposal's own state (a document this undo just revived is live here
    // and not yet in the store), then in the store.
    let liveDoc = null;
    for (const [doc, s] of work.docs) {
      if (s && !s.retired && first.entry && s.entry === first.entry) liveDoc = doc;
    }
    liveDoc ??= first.entry ? await store.liveDocByEntry(first.entry) : first.doc;
    const st = liveDoc ? await work.load(liveDoc) : null;
    if (!st || st.retired) {
      return { skipped: { doc: first.doc, lane: first.lane, reason: 'document no longer exists' } };
    }
    const before = await work.content(first.beforeHash);
    const head = st.lanes[first.lane];
    let target = before;
    if (head?.effect !== first.effect) {
      // A later effect owns the head. Rebase the revert through EVERY later
      // effect on this entry's lane, in order: a peer who touched what we
      // revert — even if they later wrote the same value back (ABA) — makes
      // that step a conflict instead of letting equal text hide their work.
      // The targets' own later effects are what is being undone: skipped. So is
      // their own undo / redo chain (⌘Z → ⇧⌘Z → ⌘Z names the same target again):
      // it is the targets' history, not later work, and rebasing through it
      // cancels out to "no change" — an undo-conflict on your own edit.
      const later = (await store.effectsAfter(first.entry, first.lane, first.rev)).filter(
        (x) => x.op !== 'move' && !targetIds.has(x.actionId)
      );
      const own = await ownHistory(later.map((x) => x.actionId));
      const chain = await ownHistory.withoutRoundTrips(later.filter((x) => !own.has(x.actionId)));
      let x = before;
      for (const step of chain) {
        const m = mergeLane(
          first.lane,
          await work.content(step.beforeHash),
          x,
          await work.content(step.afterHash)
        );
        if (!m.ok) {
          return {
            skipped: {
              doc: st.doc,
              lane: first.lane,
              reason: 'changed by someone else since',
              // Multi-target only, so a v1 single undo answers byte for byte as before.
              ...(many ? { conflictWith: step.actionId } : {}),
            },
          };
        }
        x = m.content;
      }
      target = x;
    }
    const checked = checkLane(first.lane, target, { path: st.path ?? undefined });
    if (!checked.ok) return { skipped: { doc: st.doc, lane: first.lane, reason: checked.reason } };
    return { applied: work.setLane(st, first.lane, checked.content, { op: 'undo' }) };
  }

  /**
   * Effect-aware compensation of one accepted action (DDR-241 §6) — or of
   * several as ONE action (V2-1.5 §5.2, "Undo this chat"): lanes revert to the
   * oldest target's before-content, rebased through everyone else's later
   * work; manifest and directory effects compensate newest target first.
   */
  async function opUndo(work, op, auth) {
    const { ids, many } = undoTargets(op);
    const targets = [];
    const found = await loadActions(ids);
    for (const t of found) {
      if (!t) throw new Reject('dependency-missing', { reason: 'unknown action' });
      // V2-1.16 U1: someone else's action may sit on a canvas a canvas-only
      // session cannot see, so it answers exactly as an unknown id — never
      // "yours only", which would confirm the id exists. A project session
      // keeps the v1 answer.
      if (auth.inScope && t.actor !== auth.actor)
        throw new Reject('dependency-missing', { reason: 'unknown action' });
      if (t.actor !== auth.actor)
        throw new Reject('forbidden', { reason: 'undo targets your own actions' });
      targets.push(t);
    }
    // S1.6 — a cleared trash item stays gone (S1-trash.md §3): a cleared
    // artboard-trash action is no target (its removal is then "someone else's
    // later work" the rebase keeps); a cleared canvas is not revived below.
    const { keys: clearedKeys, gone } = await clearedForUndo(targets);
    const skippedCleared = [];
    for (let i = targets.length - 1; i >= 0; i--) {
      if (!gone.has(targets[i].actionId)) continue;
      const first = targets[i].effects.find((e) => LANE_NAMES.includes(e.lane));
      skippedCleared.unshift({ doc: first?.doc ?? null, reason: 'cleared' });
      targets.splice(i, 1);
    }
    if (targets.length === 0) throw new Reject('undo-conflict', { skipped: skippedCleared });
    const targetIds = new Set(targets.map((t) => t.actionId));
    const ownHistory = ownHistoryOf(targets);
    // The oldest target effect on each (entry, lane): where its revert starts.
    // Within one action, the effect whose after is a sibling's before precedes it.
    const firstOn = new Map();
    for (const t of [...targets].sort((a, b) => a.revision - b.revision)) {
      for (const e of t.effects) {
        if (!LANE_NAMES.includes(e.lane) || e.op === 'move') continue;
        const k = laneKey(e);
        const prior = firstOn.get(k);
        if (!prior || (prior.actionId === e.actionId && e.afterHash === prior.beforeHash))
          firstOn.set(k, e);
      }
    }
    const reverted = new Set();
    const skipped = [...skippedCleared];
    let applied = 0;
    const effects = [...targets]
      .sort((a, b) => b.revision - a.revision)
      .flatMap((t) => [...t.effects].reverse());
    // Manifest and directory effects first (newest target first, effects in
    // reverse): a revived document must be live before its lanes revert, and a
    // document this undo deletes needs no lane revert — it is retired with its
    // lanes as they stand, so the redo's revive brings them back whole.
    const deletedHere = new Set();
    for (const e of effects) {
      if (LANE_NAMES.includes(e.lane)) continue;
      if (e.lane === '@manifest') {
        if (e.op === 'create') {
          const st = await work.load(e.doc);
          if (!st || st.retired || st.entry !== e.entry) {
            skipped.push({ doc: e.doc, reason: 'already gone' });
            continue;
          }
          await opDocDelete(work, { doc: e.doc });
          deletedHere.add(e.entry);
          applied++;
        } else if (e.op === 'delete') {
          if (clearedKeys.has(`${e.entry}\u0000\u0000${e.rev}`)) {
            skipped.push({ doc: e.doc, reason: 'cleared' });
            continue;
          }
          const st = await work.load(e.doc);
          if (!st?.retired || (await work.liveDocAt(e.beforePath))) {
            skipped.push({ doc: e.doc, reason: 'path is taken again' });
            continue;
          }
          st.retired = false;
          st.movedTo = null;
          st.generation += 1;
          work.effects.push({
            effect: `e_${newId()}`,
            doc: e.doc,
            entry: st.entry,
            lane: '@manifest',
            op: 'create',
            afterPath: st.path,
          });
          const c = work.mark(e.doc, 'manifest');
          c.created = true;
          c.revived = true;
          applied++;
        } else if (e.op === 'move') {
          const st = await work.load(e.doc);
          if (
            !st ||
            st.retired ||
            st.path !== e.afterPath ||
            (await work.liveDocAt(e.beforePath))
          ) {
            skipped.push({ doc: e.doc, reason: 'moved or edited again since' });
            continue;
          }
          await opDocMove(work, {
            doc: e.doc,
            to: { path: e.beforePath, doc: docFor(prefixOf(e.doc), e.beforePath) },
          });
          applied++;
        }
        continue;
      }
      if (e.lane === '@dir') {
        if (e.op === 'dir.create') {
          work.dirs.remove.add(e.afterPath);
          work.dirs.add.delete(e.afterPath);
        } else if (e.op === 'dir.delete') {
          work.dirs.add.add(e.beforePath);
        } else if (e.op === 'dir.move') {
          work.dirs.remove.add(e.afterPath);
          work.dirs.add.add(e.beforePath);
        }
        work.effects.push({
          effect: `e_${newId()}`,
          lane: '@dir',
          op: `undo.${e.op}`,
          beforePath: e.afterPath,
          afterPath: e.beforePath,
        });
        applied++;
      }
    }
    // Then one lane revert per (entry, lane), from the oldest target on it.
    for (const e of effects) {
      if (!LANE_NAMES.includes(e.lane)) continue;
      if (e.op === 'move') continue; // a move's lane copy is the manifest effect's job
      const k = laneKey(e);
      if (reverted.has(k)) continue;
      reverted.add(k);
      if (e.entry && deletedHere.has(e.entry)) continue;
      const r = await revertLane(work, firstOn.get(k) ?? e, targetIds, many, ownHistory);
      if (r.skipped) skipped.push(r.skipped);
      else if (r.applied) applied++;
    }
    if (applied === 0) throw new Reject('undo-conflict', { skipped });
    return {
      skipped,
      undoes: many ? ids.filter((id) => !gone.has(id)) : targets[0].actionId,
      many,
    };
  }

  async function opRestore(work, op) {
    if (!Number.isSafeInteger(op.revision) || op.revision < 0)
      throw new Reject('invalid', { reason: 'bad revision' });
    const manifest = await store.manifest();
    const docs =
      Array.isArray(op.docs) && op.docs.length
        ? op.docs
        : manifest.docs.filter((d) => !d.retired).map((d) => d.doc);
    // A canvas "version" is its design, not its conversation: comments are
    // not rolled back unless asked for explicitly.
    const lanes = Array.isArray(op.lanes)
      ? LANE_NAMES.filter((l) => op.lanes.includes(l))
      : LANE_NAMES.filter((l) => l !== 'comments');
    for (const doc of docs) {
      const st = await work.load(doc);
      if (!st || st.retired) continue;
      for (const lane of lanes) {
        const hash = await store.laneAt(doc, lane, op.revision);
        const content = await work.content(hash);
        const checked = checkLane(lane, content, { path: st.path ?? undefined });
        if (!checked.ok) continue;
        work.setLane(st, lane, checked.content, { op: 'restore' });
      }
    }
    return null;
  }

  // ------------------------------------------- S1.6: names, aside, trash

  /**
   * A canvas-only session's judge (S9.5 `inScope.after`) on one canvas path,
   * asked BEFORE an op can answer anything that names the canvas — unknown,
   * cleared, not in the trash all read `not-in-scope` (U1). No-op for a
   * project role.
   */
  function judge(auth, path) {
    const r = auth.inScope?.after([typeof path === 'string' ? path : null]);
    if (r) throw new Reject(r.code, r.detail);
  }

  /**
   * The per-op role gate (S1-trash.md §5): `auth.can(cap)` is project-level.
   * A caller without `can` keeps today's behaviour, except `trash.clear`
   * (`delete`, owner-only), which then fails closed. Clear-out is
   * project-level, so a canvas-only session is out of scope for it.
   */
  function gate(opName, auth) {
    const cap = CAP_OF[opName];
    if (!cap) return; // the switch answers `invalid`
    if (cap === 'delete' && auth.inScope) throw new Reject('not-in-scope', {});
    const can = typeof auth.can === 'function' ? auth.can : (c) => c !== 'delete';
    if (!can(cap)) {
      throw new Reject('forbidden', {
        reason:
          cap === 'delete'
            ? 'only the project owner can clear out the trash'
            : 'this account can view but not edit',
      });
    }
  }

  /** The store's trash readers, or `invalid` (final) on a home without them. */
  function trashStore() {
    if (typeof store.trash !== 'function' || typeof store.trashCleared !== 'function')
      throw new Reject('invalid', { reason: 'the trash needs the team server to be updated' });
    return store;
  }

  /** The doc an op names, followed to its live continuation after a move. */
  async function namedDoc(work, doc) {
    if (typeof doc !== 'string' || !DOC_NAME.test(doc))
      throw new Reject('invalid', { reason: 'bad doc' });
    const named = await work.load(doc);
    const st = named?.retired && named.movedTo ? await liveContinuation(work, named) : named;
    return { named, st: st && !st.retired ? st : null };
  }

  /**
   * V2-1.9 §5.4 — the newest revision ≤ `revision` that changed the canvas
   * (`entry`): a version lane or `@manifest` effect on it, of an action that
   * is not a `name` / `comment`. Null when there is none.
   */
  async function snapRevision(entry, revision) {
    let before = revision + 1;
    for (let page = 0; page < 1000; page++) {
      const rows = await store.history({ entry, before, limit: 200 });
      for (const a of rows) {
        if (a.revision > revision || a.kind === 'name' || a.kind === 'comment') continue;
        const touches = (a.effects ?? []).some(
          (e) => e.entry === entry && (VERSION_LANES.includes(e.lane) || e.lane === '@manifest')
        );
        if (touches) return a.revision;
      }
      if (rows.length < 200) return null;
      before = rows[rows.length - 1].revision;
    }
    return null;
  }

  /** `history.name { doc, revision, name | null }` — V2-1.9 §5.4. */
  async function opHistoryName(work, op, auth, state) {
    let name = null;
    if (op.name !== null) {
      if (typeof op.name !== 'string') throw new Reject('invalid', { reason: 'bad name' });
      name = op.name.trim();
      const len = [...name].length;
      if (len < 1 || len > MAX_VERSION_NAME || CONTROL.test(name))
        throw new Reject('invalid', {
          reason: `a name is 1–${MAX_VERSION_NAME} characters, no control characters`,
        });
    }
    if (!Number.isSafeInteger(op.revision) || op.revision < 1 || op.revision > state.revision)
      throw new Reject('invalid', { reason: 'bad revision' });
    const { named, st } = await namedDoc(work, op.doc);
    judge(auth, (st ?? named)?.path);
    if (!st) throw new Reject('dependency-missing', { doc: op.doc, reason: 'document not live' });
    const target = await snapRevision(st.entry, op.revision);
    if (target === null)
      throw new Reject('invalid', { reason: 'no version of this canvas at or before it' });
    work.effects.push({
      effect: `e_${newId()}`,
      doc: st.doc,
      entry: st.entry,
      lane: '@name',
      op: name === null ? 'name.clear' : 'name',
      beforePath: st.path,
    });
    work.names.push({ entry: st.entry, targetRev: target, name });
    return { named: { entry: st.entry, rev: target, name }, label: name };
  }

  /**
   * `history.aside { doc, lane, content, label? }` — V2-1.9 decision 9: the
   * version a person did not keep, recorded as an `@aside` effect with its body
   * as a blob. No head moves; `laneAt`, `effectsAfter` and undo read real lane
   * names only, so nothing else sees it.
   */
  async function opHistoryAside(work, op, auth) {
    if (!LANE_NAMES.includes(op.lane)) throw new Reject('invalid', { reason: 'unknown lane' });
    const { named, st } = await namedDoc(work, op.doc);
    judge(auth, (st ?? named)?.path);
    if (!st) throw new Reject('dependency-missing', { doc: op.doc, reason: 'document not live' });
    const checked = checkLane(op.lane, op.content, { path: st.path ?? `${slugOf(st.doc)}.tsx` });
    if (!checked.ok)
      throw new Reject(checked.code, { doc: op.doc, lane: op.lane, reason: checked.reason });
    const before = st.lanes[op.lane]?.hash ?? null;
    const after = checked.content === '' ? null : laneHash(checked.content);
    const label = typeof op.label === 'string' ? op.label.slice(0, 200) : undefined;
    if ((before ?? EMPTY_HASH) === (after ?? EMPTY_HASH)) return { label };
    if (after) work.blobs.set(after, checked.content);
    work.effects.push({
      effect: `e_${newId()}`,
      doc: st.doc,
      entry: st.entry,
      lane: '@aside',
      op: `aside.${op.lane}`,
      beforeHash: before,
      afterHash: after,
    });
    return { label };
  }

  /**
   * A free `<name> N.<ext>` next to `path` (S1 Q3), or null. A name that
   * already ends in ` N` counts on from it ("a 2" → "a 3"), as Finder does.
   */
  async function freeRestorePath(work, prefix, path) {
    const m = /^(.*?)(\.[A-Za-z0-9]+)?$/.exec(path);
    const base = m[1].replace(/ \d{1,2}$/, '');
    for (let n = 2; n <= 99; n++) {
      const candidate = `${base} ${n}${m[2] ?? ''}`;
      const doc = docFor(prefix, candidate);
      if (!DOC_NAME.test(doc) || checkCanvasPath(doc, candidate)) continue;
      if (await work.liveDocAt(candidate)) continue;
      const t = await work.load(doc);
      if (t && !t.retired) continue;
      return { path: candidate, doc };
    }
    return null;
  }

  /** The path a canvas-only judge sees for an entry: in the trash, cleared, or live. */
  async function pathOfEntry(work, entry, item) {
    if (item) return item.path;
    const live = await store.liveDocByEntry(entry);
    if (live) return (await work.load(live))?.path ?? null;
    const cleared = (await store.trashCleared({ entry })).find((c) => c.artboard === '');
    if (!cleared) return null;
    const [a] = await store.history({ entry, before: cleared.rev + 1, limit: 1 });
    const del = a?.effects?.find((e) => e.entry === entry && e.lane === '@manifest');
    return del?.beforePath ?? null;
  }

  /**
   * `trash.restore { entry }` — S1 Q3: the canvas comes back with the SAME
   * entry, in place when its path is free, else at `<name> 2`.
   */
  async function opTrashRestore(work, op, auth) {
    if (typeof op.entry !== 'string' || !ENTRY.test(op.entry))
      throw new Reject('invalid', { reason: 'bad entry' });
    trashStore();
    const [item] = (await store.trash({ entry: op.entry })).canvases;
    judge(auth, await pathOfEntry(work, op.entry, item));
    if (!item) {
      const cleared = (await store.trashCleared({ entry: op.entry })).some(
        (c) => c.artboard === ''
      );
      if (cleared && !(await store.liveDocByEntry(op.entry)))
        throw new Reject('cleared', { reason: 'cleared out of the trash' });
      throw new Reject('dependency-missing', { reason: 'not in the trash' });
    }
    const st = await work.load(item.doc);
    if (st?.retired && !st.movedTo && st.entry === op.entry && !(await work.liveDocAt(item.path))) {
      st.retired = false;
      st.movedTo = null;
      st.generation += 1;
      work.effects.push({
        effect: `e_${newId()}`,
        doc: st.doc,
        entry: st.entry,
        lane: '@manifest',
        op: 'create',
        afterPath: st.path,
      });
      const c = work.mark(st.doc, 'manifest');
      c.created = true;
      c.revived = true;
      return null;
    }
    const target = await freeRestorePath(work, prefixOf(item.doc), item.path);
    if (!target) throw new Reject('path-conflict', { reason: 'no free name to restore to' });
    const existing = await work.load(target.doc);
    const back = {
      doc: target.doc,
      entry: op.entry,
      generation: (existing?.generation ?? 0) + 1,
      path: target.path,
      retired: false,
      movedTo: null,
      lanes: {},
      orig: existing?.orig ?? null,
    };
    work.docs.set(target.doc, back);
    for (const lane of LANE_NAMES) {
      const hash = await store.laneAt(item.doc, lane, item.rev);
      if (!hash) continue;
      const checked = checkLane(lane, await work.content(hash), { path: target.path });
      if (!checked.ok)
        throw new Reject(checked.code, { doc: target.doc, lane, reason: checked.reason });
      work.setLane(back, lane, checked.content);
    }
    work.effects.push({
      effect: `e_${newId()}`,
      doc: target.doc,
      entry: op.entry,
      lane: '@manifest',
      op: 'create',
      beforePath: item.path,
      afterPath: target.path,
    });
    const c = work.mark(target.doc, 'manifest');
    c.created = true;
    return null;
  }

  /**
   * `trash.clear { items? }` — S1 Q4: owner-only clear-out. One `@trash`
   * effect and one `trash_cleared` row per item; lane bodies stay (Q4 default).
   */
  async function opTrashClear(work, op) {
    trashStore();
    let ids = null;
    if (op.items !== undefined) {
      const bad = (reason) => new Reject('invalid', { reason });
      if (!Array.isArray(op.items) || op.items.length < 1 || op.items.length > MAX_CLEAR_ITEMS)
        throw bad(`items takes 1–${MAX_CLEAR_ITEMS} ids`);
      for (const id of op.items) {
        if (typeof id !== 'string') throw bad('bad item id');
        const c = /^canvas:(.+)$/.exec(id);
        const a = /^artboard:([^/]+)\/(.+)$/.exec(id);
        if (c ? !ENTRY.test(c[1]) : !a || a[1].length > ACTION_ID_MAX || !ARTBOARD_ID.test(a[2]))
          throw bad('bad item id');
      }
      if (new Set(op.items).size !== op.items.length) throw bad('items must be distinct');
      ids = op.items;
    }
    const { canvases, artboards } = await store.trash();
    const byId = new Map([...canvases, ...artboards].map((i) => [i.id, i]));
    const cleared = [];
    const skipped = [];
    for (const id of ids ?? [...byId.keys()]) {
      const item = byId.get(id);
      if (!item) {
        skipped.push({
          id,
          reason: (await wasCleared(id)) ? 'already cleared' : 'not in the trash',
        });
        continue;
      }
      work.effects.push({
        effect: `e_${newId()}`,
        doc: item.doc,
        entry: item.entry,
        lane: '@trash',
        op: 'trash.clear',
        beforePath: item.path ?? null,
      });
      const artboard = item.artboard ?? '';
      work.cleared.push({ entry: item.entry, artboard, rev: item.rev });
      cleared.push({
        id,
        entry: item.entry,
        artboard,
        rev: item.rev,
        doc: item.doc,
        path: item.path ?? null,
      });
    }
    return { cleared, skipped };
  }

  /** Was this (now absent) item id cleared before? */
  async function wasCleared(id) {
    const c = /^canvas:(.+)$/.exec(id);
    if (c) return (await store.trashCleared({ entry: c[1] })).some((x) => x.artboard === '');
    const [, actionId, artboard] = /^artboard:([^/]+)\/(.+)$/.exec(id);
    const a = await store.action(actionId);
    const first = a?.effects?.find((e) => LANE_NAMES.includes(e.lane) && e.entry);
    if (!first) return false;
    return (await store.trashCleared({ entry: first.entry })).some(
      (x) => x.artboard === artboard && x.rev === a.revision
    );
  }

  /**
   * Undo after a clear-out (S1-trash.md §3): the targets that are cleared
   * artboard-trash actions, and the cleared canvas keys (`entry\0\0rev`).
   * Empty on a store home without the trash readers (nothing was cleared).
   */
  async function clearedForUndo(targets) {
    const keys = new Set();
    if (typeof store.trashCleared !== 'function') return { keys, gone: new Set() };
    const entries = new Set();
    for (const t of targets) {
      for (const e of t.effects ?? []) {
        if (e.entry && (t.kind === 'trash' || (e.lane === '@manifest' && e.op === 'delete')))
          entries.add(e.entry);
      }
    }
    for (const entry of entries) {
      for (const c of await store.trashCleared({ entry })) {
        keys.add(`${c.entry}\u0000${c.artboard}\u0000${c.rev}`);
      }
    }
    const gone = new Set();
    for (const t of targets) {
      const trashed =
        t.kind === 'trash' && Array.isArray(t.origin?.trashed) ? t.origin.trashed : [];
      const first = t.effects?.find((e) => LANE_NAMES.includes(e.lane) && e.entry);
      if (
        first &&
        trashed.some((x) => keys.has(`${first.entry}\u0000${x.artboard}\u0000${t.revision}`))
      )
        gone.add(t.actionId);
    }
    return { keys, gone };
  }

  // ------------------------------------------------------------ submit

  async function process(bytes, auth) {
    const { p, label, kind, origin, fence } = parseEnvelope(bytes);
    const proposalHash = sha256(bytes);
    const actor = auth.actor;
    const tx = p.transactionId;

    const prior = await store.result(actor, tx);
    if (prior) {
      if (prior.proposalHash === proposalHash) return { replay: true, result: prior.result };
      throw new Reject('transaction-id-reused', { transactionId: tx });
    }
    if (auth.readOnly)
      throw new Reject('forbidden', { reason: 'this account can view but not edit' });
    const state = await store.state();
    if (state.mode !== 'transactions') throw new Reject('mode-off', { mode: state.mode });
    if (p.epoch !== state.epoch) throw new Reject('epoch-stale', { epoch: state.epoch });
    for (const dep of p.dependsOn ?? []) {
      const r = await store.result(actor, dep);
      if (!r || r.result?.status !== 'accepted')
        throw new Reject('dependency-missing', { dependsOn: dep });
    }

    const work = createWork();
    await work.prime([
      ...new Set(
        (Array.isArray(p.action.operations) ? p.action.operations : [])
          .map((op) => op?.doc)
          .filter((d) => typeof d === 'string')
      ),
    ]);
    // S1.6 — a named / aside / trash op is its proposal's only operation.
    const ops = p.action.operations;
    const sole = ops.find((op) => op && SOLE_OPS.has(op.op))?.op ?? null;
    if (sole && ops.length !== 1)
      throw new Reject('invalid', { reason: `${sole} must be the only operation` });
    // V2-1.16 L4 (S9.5): a canvas-only session's ops, judged before any runs.
    const inScope = auth.inScope ?? null;
    const outOfScope = await inScope?.before(p.action.operations, async (d) =>
      typeof d === 'string' ? ((await work.load(d))?.path ?? null) : null
    );
    if (outOfScope) throw new Reject(outOfScope.code, outOfScope.detail);
    const merged = [];
    let undo = null;
    let extra = null;
    for (const op of p.action.operations) {
      if (!op || typeof op !== 'object') throw new Reject('invalid', { reason: 'bad operation' });
      gate(op.op, auth);
      let r = null;
      switch (op.op) {
        case 'lane.replace':
          r = await opLaneReplace(work, op);
          break;
        case 'doc.create':
          r = await opDocCreate(work, op);
          break;
        case 'doc.delete':
          r = await opDocDelete(work, op);
          break;
        case 'doc.move':
          r = await opDocMove(work, op);
          break;
        case 'dir.create':
        case 'dir.delete':
        case 'dir.move':
          r = await opDir(work, op, state);
          break;
        case 'history.undo':
        case 'history.redo':
          undo = await opUndo(work, op, auth);
          break;
        case 'history.restore':
          r = await opRestore(work, op);
          break;
        // S1.6 (S1-trash.md §3).
        case 'history.name':
          extra = await opHistoryName(work, op, auth, state);
          break;
        case 'history.aside':
          extra = await opHistoryAside(work, op, auth);
          break;
        case 'trash.restore':
          r = await opTrashRestore(work, op, auth);
          break;
        case 'trash.clear':
          extra = await opTrashClear(work, op);
          break;
        default:
          throw new Reject('invalid', {
            reason: `unsupported operation ${String(op.op).slice(0, 40)}`,
          });
      }
      if (r) merged.push(r);
    }

    const touched = inScope?.after(
      [...work.changed.keys()].map((d) => work.docs.get(d)?.path ?? null)
    );
    if (touched) throw new Reject(touched.code, touched.detail);

    const actionId = `a_${newId()}`;
    const docsRows = [];
    const heads = [];
    for (const [doc, c] of work.changed) {
      const st = work.docs.get(doc);
      if (!st) continue;
      if (c.manifest || c.lanes.size) {
        docsRows.push({
          doc,
          entry: st.entry,
          generation: st.generation,
          path: st.path,
          retired: st.retired,
          movedTo: st.movedTo,
        });
      }
      for (const lane of c.lanes) {
        const orig = st.orig?.lanes?.[lane]?.hash ?? null;
        heads.push({
          doc,
          lane,
          hash: st.lanes[lane]?.hash ?? null,
          effect: st.lanes[lane]?.effect ?? '',
          expectHash: orig,
        });
      }
    }
    if (!work.effects.length) {
      // Everything the proposal asked for is already the accepted state.
      const res = {
        protocol: PROTOCOL,
        status: 'accepted',
        projectId,
        epoch: state.epoch,
        transactionId: tx,
        proposalHash,
        noop: true,
        revision: state.revision,
      };
      await store.recordResult({ actor, tx, proposalHash, result: res });
      return { result: res };
    }
    // S1.6 — a sole op commits as its own kind; `name` takes the name as its
    // label; the kernel (never the client) stamps what the log must carry.
    const actionKind = sole ? KIND_OF[sole] : kind;
    const actionLabel =
      extra && Object.hasOwn(extra, 'label') && extra.label !== undefined ? extra.label : label;
    const actionOrigin = extra?.named
      ? { ...origin, named: extra.named }
      : extra?.cleared?.length
        ? { ...origin, cleared: work.cleared }
        : origin;
    const result = {
      protocol: PROTOCOL,
      status: 'accepted',
      projectId,
      epoch: state.epoch,
      transactionId: tx,
      proposalHash,
      actorId: actor,
      origin: actionOrigin,
      actionId,
      label: actionLabel,
      kind: undo ? (p.action.operations[0].op === 'history.redo' ? 'redo' : 'undo') : actionKind,
      effects: work.effects.map((e) => ({ effect: e.effect, doc: e.doc, lane: e.lane, op: e.op })),
      merged,
      ...(undo?.skipped?.length ? { skipped: undo.skipped } : {}),
      // A multi-target undo names what it undid; a single one answers as in v1.
      ...(undo?.many ? { undoes: undo.undoes } : {}),
      ...(extra?.named ? { named: extra.named } : {}),
      ...(extra?.cleared ? { cleared: extra.cleared.map((c) => c.id) } : {}),
      ...(extra?.skipped?.length ? { skipped: extra.skipped } : {}),
    };
    let committed;
    try {
      committed = await store.commit({
        epoch: state.epoch,
        parentRevision: state.revision,
        tx,
        actor,
        proposalHash,
        actionId,
        kind: result.kind,
        label: actionLabel,
        origin: actionOrigin,
        committedAt: now(),
        undoes: undo?.undoes ?? null,
        blobs: [...work.blobs].map(([hash, body]) => ({
          hash,
          body,
          size: Buffer.byteLength(body, 'utf8'),
        })),
        docs: docsRows,
        heads,
        dirs: { add: [...work.dirs.add], remove: [...work.dirs.remove] },
        effects: work.effects,
        result,
        ...(fence ? { fence } : {}),
        ...(work.names.length ? { names: work.names } : {}),
        ...(work.cleared.length ? { cleared: work.cleared } : {}),
      });
    } catch (err) {
      if (err instanceof StoreConflict) {
        if (err.code === 'lease-fenced') {
          throw new Reject('lease-fenced', {
            reason: 'another AI run was given this artboard since',
            keys: (err.keys ?? []).map((k) => ({
              entry: k.entry,
              artboard: k.artboard,
              token: k.token,
              fence: k.fence,
            })),
          });
        }
        throw new Reject(err.code === 'epoch-stale' ? 'epoch-stale' : 'retryable', {
          reason: err.message,
        });
      }
      throw new Reject('retryable', { reason: 'store unavailable' });
    }

    // PUBLISH — strictly after the durable commit. A failure here does not undo
    // the acceptance; `reconcile()` re-applies the accepted heads.
    const changes = [];
    for (const [doc, c] of work.changed) {
      const st = work.docs.get(doc);
      if (!st) continue;
      const lanes = {};
      for (const lane of c.lanes) lanes[lane] = await work.laneContent(st, lane);
      changes.push({
        doc,
        path: st.path,
        entry: st.entry,
        generation: st.generation,
        lanes,
        created: !!c.created,
        revived: !!c.revived,
        deleted: !!c.deleted,
        retiredFor: c.retiredFor ?? null,
        movedFrom: c.movedFrom ?? null,
        writeId: c.writeId,
      });
    }
    try {
      await applyAccepted({
        revision: committed.revision,
        actionId,
        changes,
        dirs: { add: [...work.dirs.add], remove: [...work.dirs.remove] },
        actor,
        // S1.6 — what a clear-out removed: the publisher deletes the per-Mac
        // `_trash/` copies and the hub quarantine for these (S1 Q4).
        ...(extra?.cleared?.length ? { trashCleared: extra.cleared } : {}),
      });
    } catch (err) {
      log.error?.(
        `[transactions] publish of revision ${committed.revision} failed: ${err.message}`
      );
    }
    return { result: committed.result };
  }

  async function submit(bytes, auth) {
    return serialize(async () => {
      let proposalHash = null;
      try {
        proposalHash = typeof bytes === 'string' ? sha256(bytes) : null;
        const { result } = await process(bytes, auth);
        const status = result?.status === 'rejected' ? (HTTP[result.code] ?? 409) : HTTP.accepted;
        return { status, body: result };
      } catch (err) {
        if (!(err instanceof Reject)) {
          log.error?.(`[transactions] proposal failed: ${err.stack ?? err.message}`);
          return {
            status: HTTP.retryable,
            body: { protocol: PROTOCOL, status: 'rejected', code: 'retryable' },
          };
        }
        const state = await store.state().catch(() => ({ revision: null, epoch: null }));
        let tx = null;
        try {
          tx = JSON.parse(bytes)?.transactionId ?? null;
        } catch {
          /* invalid JSON */
        }
        const body = {
          protocol: PROTOCOL,
          status: 'rejected',
          code: err.code,
          transactionId: typeof tx === 'string' ? tx : null,
          proposalHash,
          currentRevision: state.revision,
          epoch: state.epoch,
          ...err.detail,
        };
        if (
          TERMINAL.has(err.code) &&
          typeof tx === 'string' &&
          TX_ID.test(tx) &&
          proposalHash &&
          auth?.actor
        ) {
          await store
            .recordResult({ actor: auth.actor, tx, proposalHash, result: body })
            .catch(() => {});
        }
        return { status: HTTP[err.code] ?? 409, body };
      }
    });
  }

  return {
    submit,
    /** The hash of a lane as it stood at `revision` (null when unset then). */
    laneAt: (doc, lane, revision) => store.laneAt(doc, lane, revision),
    async transaction(actor, tx) {
      const r = await store.result(actor, tx);
      return r ? r.result : null;
    },
    bootstrap: () => store.manifest(),
    revisions: (q) => store.revisions(q),
    history: (q) => store.history(q),
    state: () => store.state(),
    blob: (hash) => store.blob(hash),
    // S1.6 — additive readers (S1-trash.md §4); empty on a home without them.
    names: async (entry) => (typeof store.names === 'function' ? store.names(entry) : []),
    trash: async (q) =>
      typeof store.trash === 'function' ? store.trash(q) : { canvases: [], artboards: [] },
    trashCleared: async (q) =>
      typeof store.trashCleared === 'function' ? store.trashCleared(q) : [],
  };
}
