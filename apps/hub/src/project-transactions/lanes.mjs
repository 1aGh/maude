// Lane semantics for accepted revisions — DDR-241 §4–§5.
//
// A canvas document carries five persistent lanes. Each lane has ONE canonical
// text form (what the store hashes and keeps), a validator, a three-way merge
// for when a proposal's base is not the current head, and an applier that
// writes the accepted value into the Hocuspocus document. Only the kernel calls
// the applier, so the accepted document has a single writer.

import { createHash } from 'node:crypto';

import {
  annotationsLaneValue,
  canonicalAnnotations,
} from '../../../studio/annotations/board-text.ts';
import { applyOps, diffToOps } from '../../../studio/annotations/ops.ts';
import { readReplica, writeReplica } from '../../../studio/annotations/replica.ts';
import { parseBoard, serializeBoard } from '../../../studio/annotations/schema.ts';
import {
  MAX_ANNOTATIONS_BYTES,
  MAX_COMMENTS_BYTES,
  MAX_CSS_BYTES,
  MAX_HTML_BYTES,
  MAX_META_BYTES,
} from '../../../studio/sync/limits.ts';
import { mergeSource } from '../../../studio/sync/source-merge.ts';
import { sourceError } from '../../../studio/sync/source-validation.ts';

export const LANE_NAMES = Object.freeze(['html', 'css', 'meta', 'annotations', 'comments']);

const CAPS = {
  html: MAX_HTML_BYTES,
  css: MAX_CSS_BYTES,
  meta: MAX_META_BYTES,
  annotations: MAX_ANNOTATIONS_BYTES,
  comments: MAX_COMMENTS_BYTES,
};

const WRITE_ID = /^[a-zA-Z0-9_-]{1,96}$/;

export function laneHash(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

const byteLength = (s) => Buffer.byteLength(s, 'utf8');

function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Normalize + validate one lane value. Returns `{ok, content}` or
 * `{ok:false, code, reason}`. `path` is the canvas body path (for the parser).
 */
export function checkLane(lane, raw, { path = 'canvas.tsx' } = {}) {
  if (!LANE_NAMES.includes(lane))
    return { ok: false, code: 'invalid', reason: `unknown lane ${lane}` };
  if (typeof raw !== 'string')
    return { ok: false, code: 'invalid', reason: 'lane content must be a string' };
  if (byteLength(raw) > CAPS[lane])
    return { ok: false, code: 'capacity', reason: `${lane} exceeds its size limit` };
  if (lane === 'html') {
    const error = raw.length ? sourceError(path, raw) : null;
    return error
      ? { ok: false, code: 'source-invalid', reason: error }
      : { ok: true, content: raw };
  }
  if (lane === 'css') return { ok: true, content: raw };
  if (lane === 'meta') {
    if (raw === '') return { ok: true, content: raw };
    const parsed = parseJson(raw);
    if (!parsed.ok || !isPlainObject(parsed.value)) {
      return { ok: false, code: 'invalid', reason: 'meta must be a JSON object' };
    }
    return { ok: true, content: raw };
  }
  if (lane === 'annotations') {
    // DDR-242 — the lane value is the canonical annotations board. A legacy
    // SVG (a pre-v2 history blob, or a v1 client) is upconverted through the
    // v1→v2 migration instead of refused: restore/undo across the upgrade keep
    // working, and a v1 client's edit still lands as a per-element diff.
    if (raw === '') return { ok: true, content: raw };
    const content = annotationsLaneValue(raw);
    return content === null
      ? { ok: false, code: 'invalid', reason: 'annotations must be an annotations board' }
      : { ok: true, content };
  }
  // comments — a JSON array of objects; canonical form is compact JSON.
  const parsed = parseJson(raw === '' ? '[]' : raw);
  if (!parsed.ok || !Array.isArray(parsed.value)) {
    return { ok: false, code: 'invalid', reason: 'comments must be a JSON array' };
  }
  if (!parsed.value.every(isPlainObject)) {
    return { ok: false, code: 'invalid', reason: 'every comment must be an object' };
  }
  const list = stripDangerousKeys(parsed.value);
  return { ok: true, content: list.length ? JSON.stringify(list) : '' };
}

function stripDangerousKeys(value) {
  if (Array.isArray(value)) return value.map(stripDangerousKeys);
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = stripDangerousKeys(v);
  }
  return out;
}

/**
 * Elements of an annotations lane value. History blobs written before DDR-242
 * are SVG — they go through the migration too, never through a JSON parse
 * that would read them as an EMPTY board (and an undo/restore would then
 * delete everything — the DDR-223 failure shape).
 */
function boardElements(text) {
  if (text === '') return [];
  const canonical = canonicalAnnotations(text);
  return canonical === null ? [] : parseBoard(canonical).elements;
}

// ---------------------------------------------------------------- merge

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Three-way merge of JSON values; arrays of `{id}` objects merge by id. */
function mergeJson(base, ours, theirs) {
  if (same(ours, theirs)) return { ok: true, value: ours };
  if (same(base, ours)) return { ok: true, value: theirs };
  if (same(base, theirs)) return { ok: true, value: ours };
  if (isPlainObject(base) && isPlainObject(ours) && isPlainObject(theirs)) {
    const out = {};
    for (const k of new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(base)])) {
      const m = mergeJson(base[k], ours[k], theirs[k]);
      if (!m.ok) return m;
      if (m.value !== undefined) out[k] = m.value;
    }
    return { ok: true, value: out };
  }
  if (isIdArray(base) && isIdArray(ours) && isIdArray(theirs)) return mergeById(base, ours, theirs);
  return { ok: false };
}

const isIdArray = (v) =>
  Array.isArray(v) && v.every((x) => isPlainObject(x) && typeof x.id === 'string');

/** Merge lists of identified records: independent adds/edits/removes combine. */
function mergeById(base, ours, theirs) {
  const index = (list) => new Map(list.map((x) => [x.id, x]));
  const b = index(base);
  const o = index(ours);
  const t = index(theirs);
  const merged = new Map();
  for (const id of new Set([...b.keys(), ...o.keys(), ...t.keys()])) {
    const m = mergeJson(b.get(id), o.get(id), t.get(id));
    if (!m.ok) return m;
    if (m.value !== undefined) merged.set(id, m.value);
  }
  // Order: theirs' order first (the accepted state), then our new records.
  const order = [...theirs.map((x) => x.id), ...ours.map((x) => x.id)];
  const seen = new Set();
  const out = [];
  for (const id of order) {
    if (seen.has(id) || !merged.has(id)) continue;
    seen.add(id);
    out.push(merged.get(id));
  }
  return { ok: true, value: out };
}

/**
 * Merge `ours` (the proposal) and `theirs` (the current head), both derived
 * from `base`. `{ok:true, content}` or `{ok:false}` — an overlap is a
 * `base-conflict` for the caller, never a guess.
 */
export function mergeLane(lane, base, ours, theirs) {
  if (ours === theirs || theirs === base) return { ok: true, content: ours };
  if (ours === base) return { ok: true, content: theirs };
  if (lane === 'html' || lane === 'css') {
    const m = mergeSource(base, ours, theirs);
    return m.ok ? { ok: true, content: m.merged } : { ok: false };
  }
  if (lane === 'annotations') {
    // DDR-242 §4 — replay what the proposal changed (base → ours) onto the
    // head as element ops: different elements / fields never conflict, the
    // same field follows acceptance order, the same text merges by character.
    const board = (t) => new Map(boardElements(t).map((e) => [e.id, e]));
    const ops = diffToOps(board(base), board(ours));
    const r = applyOps(board(theirs), ops);
    return { ok: true, content: r.state.size ? serializeBoard([...r.state.values()]) : '' };
  }
  const parse = (s, empty) => (s === '' ? { ok: true, value: empty } : parseJson(s));
  const empty = lane === 'comments' ? [] : {};
  const [pb, po, pt] = [base, ours, theirs].map((s) => parse(s, empty));
  if (!pb.ok || !po.ok || !pt.ok) return { ok: false };
  const m =
    lane === 'comments'
      ? mergeById(pb.value, po.value, pt.value)
      : mergeJson(pb.value, po.value, pt.value);
  if (!m.ok) return m;
  if (lane === 'comments')
    return { ok: true, content: m.value.length ? JSON.stringify(m.value) : '' };
  return { ok: true, content: JSON.stringify(m.value) };
}

// ---------------------------------------------------------------- apply

function applyText(yText, next) {
  const current = yText.toString();
  if (current === next) return false;
  let prefix = 0;
  const maxPrefix = Math.min(current.length, next.length);
  while (prefix < maxPrefix && current.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  const maxSuffix = Math.min(current.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix &&
    current.charCodeAt(current.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++;
  }
  if (prefix > 0 && /[\uD800-\uDBFF]/.test(current[prefix - 1] ?? '')) prefix--;
  if (suffix > 0 && /[\uDC00-\uDFFF]/.test(current[current.length - suffix] ?? '')) suffix--;
  const del = current.length - prefix - suffix;
  if (del > 0) yText.delete(prefix, del);
  const ins = next.slice(prefix, next.length - suffix);
  if (ins) yText.insert(prefix, ins);
  return true;
}

/**
 * Write one accepted lane value into a Y.Doc. The caller wraps the whole
 * action in one `doc.transact(…, origin)`. Single writer (the kernel), so a
 * whole-array replace is safe here — the #112 duplication needed two writers.
 */
export function applyLane(doc, lane, content, { writeId } = {}) {
  if (lane === 'html' || lane === 'css' || lane === 'meta')
    return applyText(doc.getText(lane), content);
  if (lane === 'annotations') {
    // DDR-242 §5 — the per-element replica; only changed elements / fields
    // become updates. The author's action id rides along for echo suppression.
    const elements = boardElements(content);
    // '' on a doc that never held a board stays "no value" (no marker written).
    if (!elements.length && readReplica(doc) === null) return false;
    return writeReplica(doc, elements, undefined, {
      ...(typeof writeId === 'string' && WRITE_ID.test(writeId) ? { actionId: writeId } : {}),
    });
  }
  const arr = doc.getArray('comments');
  const next = content === '' ? [] : JSON.parse(content);
  if (JSON.stringify(arr.toArray()) === JSON.stringify(next)) return false;
  if (arr.length) arr.delete(0, arr.length);
  if (next.length) arr.push(next);
  return true;
}

/** Read one lane's current value out of a Y.Doc (the accepted replica). */
export function readLane(doc, lane) {
  if (lane === 'html' || lane === 'css' || lane === 'meta') return doc.getText(lane).toString();
  if (lane === 'annotations') {
    const r = readReplica(doc);
    return r === null || r.elements.length === 0 ? '' : serializeBoard(r.elements);
  }
  const list = doc.getArray('comments').toArray();
  return list.length ? JSON.stringify(list) : '';
}
