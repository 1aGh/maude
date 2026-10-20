// apps/studio/present/meta-schema.ts — S3.5: the `present` and `artboardMeta.<id>.notes` fields of a
// canvas `.meta.json` (V2-1.12 §5.1 R1/R2/R6; contract S3-present-session §7).
//
// PURE, two halves on purpose:
//   - STRICT for our own writers. `parsePresentPatch` takes the body of `PATCH /_api/present-meta` and
//     refuses anything that is not exactly the documented shape (an unknown key is a 400, never
//     ignored). `applyPresentPatch` writes only the members the patch names, and checks that every id
//     it writes is an artboard of the canvas (422 otherwise). What it writes always passes
//     `schema/canvas-meta.v2.schema.json` — test/present-meta-schema.test.ts holds the two together.
//   - TOLERANT for whatever a peer wrote. `readPresentState` never throws: a malformed member is
//     dropped, an id of an artboard that no longer exists is kept for the reader that knows the canvas
//     (present/order.ts drops it there). `applyPresentPatch` keeps every key it was not asked to change
//     — every other top-level key, `layout`, every other `artboardMeta[id]` field, and any `present`
//     member a newer peer added — in its place and with its value.
//
// The file carries no version (V2-1.12 §5.3): absence of `present` = canvas order, nothing skipped;
// absence of `notes` = no note. A v1 peer keeps both top-level keys on its own rewrites (fixtures H/I/J).

/** The schema's `$defs/artboardId` — what an id must look like to be stored here. */
export const PRESENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_IDS = 2000;
export const MAX_NOTE = 20000;
/** C22: the longest `maxFrames` a video artboard may store (the exporter's ceiling, kinds/meta.ts holds the same number). */
export const MAX_FRAMES_CEILING = 18_000;
/** S7.16: ruler markers of a video artboard (`artboardMeta[id].markers`, "Výkop · TD 1"): at most this many per video. */
export const MAX_MARKERS = 200;
/** S7.16: a marker's name, plain text. */
export const MAX_MARKER_NAME = 60;
/** The route body's whole vocabulary. */
export const PATCH_KEYS: readonly string[] = [
  'file',
  'present',
  'notes',
  'exports',
  'poster',
  'snap',
  'maxFrames',
  'markers',
  'madeFrom',
  'expected',
];
const PRESENT_KEYS: readonly string[] = ['order', 'skip'];

export interface PresentState {
  /** The stored order, or null = canvas order. */
  order: string[] | null;
  skip: string[];
  /** artboardId → note; only non-empty strings. */
  notes: Record<string, string>;
}

/** S8.8 — one export size of an artboard (`artboardMeta[id].exports`, decision
 *  maude/v2-S8-artboard-export-presets-in-meta). Raster formats carry a scale; svg has none. */
export interface ExportSize {
  format: 'png' | 'jpg' | 'svg';
  scale?: number;
}
export const EXPORT_FORMATS: readonly string[] = ['png', 'jpg', 'svg'];
/** The same range `ExportSpecV2` takes for `options.size.scale` (exporters/spec-v2.ts). */
export const EXPORT_SCALE_MIN = 0.25;
export const EXPORT_SCALE_MAX = 4;
export const MAX_EXPORT_SIZES = 8;
const EXPORT_SIZE_KEYS: readonly string[] = ['format', 'scale'];

/** S7.16 — one ruler marker: a comp frame and a short plain-text name. */
export interface Marker {
  frame: number;
  name: string;
}
const MARKER_KEYS: readonly string[] = ['frame', 'name'];
/** Plain text: no control characters (newlines, NUL…) and no markup brackets. */
const isMarkerName = (v: unknown): v is string => {
  if (typeof v !== 'string' || v.length > MAX_MARKER_NAME) return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 32 || c === 127 || c === 60 || c === 62) return false; // control characters and < >
  }
  return true;
};
const isMarkerFrame = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 2 ** 31 - 1;

export interface PresentPatch {
  file: string;
  present?: { order?: string[] | null; skip?: string[] | null } | null;
  notes?: Record<string, string | null>;
  /** artboardId → its sizes; null (or an empty list) takes the artboard back to its kind's default. */
  exports?: Record<string, ExportSize[] | null>;
  /** S7.8 — artboardId → its poster frame (a comp frame, ≥ 0); null takes it back to the 35 % default. */
  poster?: Record<string, number | null>;
  /** S7.12 — artboardId → Snap to the beat (`"beat"` · `"off"`); null takes it back to the default (on with a clear beat grid). */
  snap?: Record<string, 'beat' | 'off' | null>;
  /** S7.18 — artboardId → the longest one export of it may be (C22 "Allow longer", 1..18 000 frames); null = the 3 600 default. */
  maxFrames?: Record<string, number | null>;
  /** S7.16 — artboardId → its ruler markers, the WHOLE list (ascending by frame, one per frame); null or [] takes them all away. */
  markers?: Record<string, Marker[] | null>;
  /** S7.25 — artboardId → the artboard it was made from (Change kind's copy); null forgets it. */
  madeFrom?: Record<string, { artboard: string; label: string } | null>;
  expected?: string;
}

export type ParseResult =
  | { ok: true; patch: PresentPatch }
  | { ok: false; error: 'bad-body' | 'unknown-key' | 'bad-field'; field: string };

export type ApplyResult =
  | { ok: true; next: Record<string, unknown>; changed: boolean }
  | { ok: false; error: 'unknown-artboard' | 'duplicate'; ids: string[] };

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && PRESENT_ID_RE.test(v);

/** Ids of an unknown value: strings of the id grammar, once each, in order. */
function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of value.slice(0, MAX_IDS)) {
    if (!isId(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** What a `.meta.json` (any writer, any version) says about Present. Never throws. */
export function readPresentState(meta: unknown): PresentState {
  const m = isObj(meta) ? meta : {};
  const p = isObj(m.present) ? m.present : {};
  const order = idList(p.order);
  const notes: Record<string, string> = {};
  if (isObj(m.artboardMeta))
    for (const [id, entry] of Object.entries(m.artboardMeta)) {
      if (!isId(id) || !isObj(entry)) continue;
      const n = entry.notes;
      if (typeof n === 'string' && n !== '' && n.length <= MAX_NOTE) notes[id] = n;
    }
  return { order: order.length ? order : null, skip: idList(p.skip), notes };
}

/** One size of an unknown value, or null when it is not one (tolerant: a peer's malformed size is dropped). */
function sizeOf(v: unknown): ExportSize | null {
  if (!isObj(v) || typeof v.format !== 'string' || !EXPORT_FORMATS.includes(v.format)) return null;
  const format = v.format as ExportSize['format'];
  if (format === 'svg') return { format };
  const sc = v.scale;
  if (
    typeof sc !== 'number' ||
    !Number.isFinite(sc) ||
    sc < EXPORT_SCALE_MIN ||
    sc > EXPORT_SCALE_MAX
  )
    return null;
  return { format, scale: sc };
}

/** What a `.meta.json` (any writer, any version) says about each artboard's export sizes. Never throws. */
export function readExportPresets(meta: unknown): Record<string, ExportSize[]> {
  const out: Record<string, ExportSize[]> = {};
  const m = isObj(meta) ? meta : {};
  if (!isObj(m.artboardMeta)) return out;
  for (const [id, entry] of Object.entries(m.artboardMeta)) {
    if (!isId(id) || !isObj(entry) || !Array.isArray(entry.exports)) continue;
    const sizes = entry.exports
      .slice(0, MAX_EXPORT_SIZES)
      .map(sizeOf)
      .filter((x): x is ExportSize => x !== null);
    if (sizes.length) out[id] = sizes;
  }
  return out;
}

/** S7.8 — what a `.meta.json` says about each video artboard's poster frame (`artboardMeta[id].poster`). Never throws. */
export function readPosters(meta: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const m = isObj(meta) ? meta : {};
  if (!isObj(m.artboardMeta)) return out;
  for (const [id, entry] of Object.entries(m.artboardMeta)) {
    if (!isId(id) || !isObj(entry)) continue;
    const p = entry.poster;
    if (typeof p === 'number' && Number.isInteger(p) && p >= 0) out[id] = p;
  }
  return out;
}

/** S7.12 — what a `.meta.json` says about Snap to the beat per video artboard (`artboardMeta[id].snap`). Never throws. */
export function readSnaps(meta: unknown): Record<string, 'beat' | 'off'> {
  const out: Record<string, 'beat' | 'off'> = {};
  const m = isObj(meta) ? meta : {};
  if (!isObj(m.artboardMeta)) return out;
  for (const [id, entry] of Object.entries(m.artboardMeta)) {
    if (!isId(id) || !isObj(entry)) continue;
    if (entry.snap === 'beat' || entry.snap === 'off') out[id] = entry.snap;
  }
  return out;
}

/** S7.18 — what a `.meta.json` says about each video artboard's own length limit (`artboardMeta[id].maxFrames`). Never throws. */
export function readMaxFrames(meta: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const m = isObj(meta) ? meta : {};
  if (!isObj(m.artboardMeta)) return out;
  for (const [id, entry] of Object.entries(m.artboardMeta)) {
    if (!isId(id) || !isObj(entry)) continue;
    const n = entry.maxFrames;
    if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_FRAMES_CEILING)
      out[id] = n;
  }
  return out;
}

/** S7.16 — what a `.meta.json` says about each video artboard's ruler markers (`artboardMeta[id].markers`). Tolerant: a
 *  malformed member is dropped, the rest kept in frame order, at most MAX_MARKERS. Never throws. */
export function readMarkers(meta: unknown): Record<string, Marker[]> {
  const out: Record<string, Marker[]> = {};
  const m = isObj(meta) ? meta : {};
  if (!isObj(m.artboardMeta)) return out;
  for (const [id, entry] of Object.entries(m.artboardMeta)) {
    if (!isId(id) || !isObj(entry) || !Array.isArray(entry.markers)) continue;
    const byFrame = new Map<number, Marker>();
    for (const x of entry.markers) {
      if (isObj(x) && isMarkerFrame(x.frame) && isMarkerName(x.name))
        byFrame.set(x.frame, { frame: x.frame, name: x.name });
    }
    const list = [...byFrame.values()].sort((a, b) => a.frame - b.frame).slice(0, MAX_MARKERS);
    if (list.length) out[id] = list;
  }
  return out;
}

/** S7.25 — what a `.meta.json` says about where each artboard was made from (`artboardMeta[id].madeFrom`). Never throws. */
export function readMadeFrom(meta: unknown): Record<string, { artboard: string; label: string }> {
  const out: Record<string, { artboard: string; label: string }> = {};
  const m = isObj(meta) ? meta : {};
  if (!isObj(m.artboardMeta)) return out;
  for (const [id, entry] of Object.entries(m.artboardMeta)) {
    if (!isId(id) || !isObj(entry) || !isObj(entry.madeFrom)) continue;
    const { artboard, label } = entry.madeFrom;
    if (isId(artboard) && typeof label === 'string' && label.length <= 200)
      out[id] = { artboard, label };
  }
  return out;
}

/** An id array as the route accepts it: every member an id, at most MAX_IDS. Duplicates are the
 *  apply step's 422, so the caller can name them. */
function strictIds(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= MAX_IDS && v.every(isId);
}

/** The body of `PATCH /_api/present-meta`, checked exactly. */
export function parsePresentPatch(body: unknown): ParseResult {
  if (!isObj(body)) return { ok: false, error: 'bad-body', field: '' };
  for (const k of Object.keys(body))
    if (!PATCH_KEYS.includes(k)) return { ok: false, error: 'unknown-key', field: k };
  if (typeof body.file !== 'string' || !body.file || body.file.length > 1024)
    return { ok: false, error: 'bad-field', field: 'file' };
  const patch: PresentPatch = { file: body.file };
  if (body.expected !== undefined) {
    if (typeof body.expected !== 'string' || body.expected.length > 128)
      return { ok: false, error: 'bad-field', field: 'expected' };
    patch.expected = body.expected;
  }
  if (body.present !== undefined) {
    if (body.present === null) patch.present = null;
    else if (!isObj(body.present)) return { ok: false, error: 'bad-field', field: 'present' };
    else {
      const out: NonNullable<PresentPatch['present']> = {};
      for (const k of Object.keys(body.present)) {
        if (!PRESENT_KEYS.includes(k))
          return { ok: false, error: 'unknown-key', field: `present.${k}` };
        const v = body.present[k];
        if (v !== null && !strictIds(v))
          return { ok: false, error: 'bad-field', field: `present.${k}` };
        out[k as 'order' | 'skip'] = v as string[] | null;
      }
      patch.present = out;
    }
  }
  if (body.notes !== undefined) {
    if (!isObj(body.notes) || Object.keys(body.notes).length > MAX_IDS)
      return { ok: false, error: 'bad-field', field: 'notes' };
    const out: Record<string, string | null> = {};
    for (const [id, v] of Object.entries(body.notes)) {
      if (!isId(id)) return { ok: false, error: 'bad-field', field: 'notes' };
      if (v !== null && (typeof v !== 'string' || v.length > MAX_NOTE))
        return { ok: false, error: 'bad-field', field: `notes.${id}` };
      out[id] = v as string | null;
    }
    patch.notes = out;
  }
  if (body.exports !== undefined) {
    if (!isObj(body.exports) || Object.keys(body.exports).length > MAX_IDS)
      return { ok: false, error: 'bad-field', field: 'exports' };
    const out: Record<string, ExportSize[] | null> = {};
    for (const [id, v] of Object.entries(body.exports)) {
      if (!isId(id)) return { ok: false, error: 'bad-field', field: 'exports' };
      if (v === null) {
        out[id] = null;
        continue;
      }
      if (!Array.isArray(v) || v.length > MAX_EXPORT_SIZES)
        return { ok: false, error: 'bad-field', field: `exports.${id}` };
      const sizes: ExportSize[] = [];
      for (let i = 0; i < v.length; i++) {
        const at = `exports.${id}.${i}`;
        const e = v[i];
        if (!isObj(e)) return { ok: false, error: 'bad-field', field: at };
        for (const k of Object.keys(e))
          if (!EXPORT_SIZE_KEYS.includes(k))
            return { ok: false, error: 'bad-field', field: `${at}.${k}` };
        if (typeof e.format !== 'string' || !EXPORT_FORMATS.includes(e.format))
          return { ok: false, error: 'bad-field', field: `${at}.format` };
        if (e.format === 'svg') {
          if (e.scale !== undefined) return { ok: false, error: 'bad-field', field: `${at}.scale` };
          sizes.push({ format: 'svg' });
          continue;
        }
        if (
          typeof e.scale !== 'number' ||
          !Number.isFinite(e.scale) ||
          e.scale < EXPORT_SCALE_MIN ||
          e.scale > EXPORT_SCALE_MAX
        )
          return { ok: false, error: 'bad-field', field: `${at}.scale` };
        sizes.push({ format: e.format as 'png' | 'jpg', scale: e.scale });
      }
      out[id] = sizes;
    }
    patch.exports = out;
  }
  if (body.poster !== undefined) {
    if (!isObj(body.poster) || Object.keys(body.poster).length > MAX_IDS)
      return { ok: false, error: 'bad-field', field: 'poster' };
    const out: Record<string, number | null> = {};
    for (const [id, v] of Object.entries(body.poster)) {
      if (!isId(id)) return { ok: false, error: 'bad-field', field: 'poster' };
      if (v !== null && !(typeof v === 'number' && Number.isInteger(v) && v >= 0))
        return { ok: false, error: 'bad-field', field: `poster.${id}` };
      out[id] = v;
    }
    patch.poster = out;
  }
  if (body.snap !== undefined) {
    if (!isObj(body.snap) || Object.keys(body.snap).length > MAX_IDS)
      return { ok: false, error: 'bad-field', field: 'snap' };
    const out: Record<string, 'beat' | 'off' | null> = {};
    for (const [id, v] of Object.entries(body.snap)) {
      if (!isId(id)) return { ok: false, error: 'bad-field', field: 'snap' };
      if (v !== null && v !== 'beat' && v !== 'off')
        return { ok: false, error: 'bad-field', field: `snap.${id}` };
      out[id] = v;
    }
    patch.snap = out;
  }
  if (body.maxFrames !== undefined) {
    if (!isObj(body.maxFrames) || Object.keys(body.maxFrames).length > MAX_IDS)
      return { ok: false, error: 'bad-field', field: 'maxFrames' };
    const out: Record<string, number | null> = {};
    for (const [id, v] of Object.entries(body.maxFrames)) {
      if (!isId(id)) return { ok: false, error: 'bad-field', field: 'maxFrames' };
      if (
        v !== null &&
        !(typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_FRAMES_CEILING)
      )
        return { ok: false, error: 'bad-field', field: `maxFrames.${id}` };
      out[id] = v;
    }
    patch.maxFrames = out;
  }
  if (body.markers !== undefined) {
    if (!isObj(body.markers) || Object.keys(body.markers).length > MAX_IDS)
      return { ok: false, error: 'bad-field', field: 'markers' };
    const out: Record<string, Marker[] | null> = {};
    for (const [id, v] of Object.entries(body.markers)) {
      if (!isId(id)) return { ok: false, error: 'bad-field', field: 'markers' };
      if (v === null) {
        out[id] = null;
        continue;
      }
      if (!Array.isArray(v) || v.length > MAX_MARKERS)
        return { ok: false, error: 'bad-field', field: `markers.${id}` };
      const list: Marker[] = [];
      const seen = new Set<number>();
      for (let i = 0; i < v.length; i++) {
        const at = `markers.${id}.${i}`;
        const x = v[i];
        if (!isObj(x)) return { ok: false, error: 'bad-field', field: at };
        for (const k of Object.keys(x))
          if (!MARKER_KEYS.includes(k))
            return { ok: false, error: 'unknown-key', field: `${at}.${k}` };
        if (!isMarkerFrame(x.frame) || seen.has(x.frame))
          return { ok: false, error: 'bad-field', field: `${at}.frame` };
        if (!isMarkerName(x.name)) return { ok: false, error: 'bad-field', field: `${at}.name` };
        seen.add(x.frame);
        list.push({ frame: x.frame, name: x.name });
      }
      out[id] = list.sort((a, b) => a.frame - b.frame);
    }
    patch.markers = out;
  }
  if (body.madeFrom !== undefined) {
    if (!isObj(body.madeFrom) || Object.keys(body.madeFrom).length > MAX_IDS)
      return { ok: false, error: 'bad-field', field: 'madeFrom' };
    const out: Record<string, { artboard: string; label: string } | null> = {};
    for (const [id, v] of Object.entries(body.madeFrom)) {
      if (!isId(id)) return { ok: false, error: 'bad-field', field: 'madeFrom' };
      if (v === null) {
        out[id] = null;
        continue;
      }
      if (
        !isObj(v) ||
        Object.keys(v).length !== 2 ||
        !isId(v.artboard) ||
        typeof v.label !== 'string' ||
        v.label.length > 200
      )
        return { ok: false, error: 'bad-field', field: `madeFrom.${id}` };
      out[id] = { artboard: v.artboard, label: v.label };
    }
    patch.madeFrom = out;
  }
  return { ok: true, patch };
}

const dupes = (ids: readonly string[]): string[] => {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const id of ids) (seen.has(id) ? out : seen).add(id);
  return [...out];
};

/** `obj` with `key` set to `value` in place (or appended), or removed when `value` is undefined. */
function withKey(
  obj: Record<string, unknown>,
  key: string,
  value: unknown
): Record<string, unknown> {
  if (value === undefined) {
    if (!Object.hasOwn(obj, key)) return obj;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) if (k !== key) out[k] = v;
    return out;
  }
  return { ...obj, [key]: value };
}

/**
 * Apply a parsed patch to the current meta object. `known` = the canvas's artboard ids, or null when
 * the canvas renders artboards a parse cannot list (then only the id grammar is checked). Pure: the
 * input is never mutated.
 */
export function applyPresentPatch(
  current: Record<string, unknown>,
  patch: PresentPatch,
  known: ReadonlySet<string> | null
): ApplyResult {
  const written: string[] = [];
  const dup: string[] = [];
  if (patch.present)
    for (const k of PRESENT_KEYS) {
      const v = patch.present[k as 'order' | 'skip'];
      if (!Array.isArray(v)) continue;
      written.push(...v);
      dup.push(...dupes(v));
    }
  if (dup.length) return { ok: false, error: 'duplicate', ids: [...new Set(dup)] };
  for (const [id, v] of Object.entries(patch.notes ?? {})) if (v) written.push(id);
  for (const [id, v] of Object.entries(patch.exports ?? {})) if (v?.length) written.push(id);
  for (const [id, v] of Object.entries(patch.poster ?? {})) if (v !== null) written.push(id);
  for (const [id, v] of Object.entries(patch.snap ?? {})) if (v !== null) written.push(id);
  for (const [id, v] of Object.entries(patch.maxFrames ?? {})) if (v !== null) written.push(id);
  for (const [id, v] of Object.entries(patch.markers ?? {})) if (v?.length) written.push(id);
  for (const [id, v] of Object.entries(patch.madeFrom ?? {})) if (v !== null) written.push(id);
  if (known) {
    const unknown = [...new Set(written.filter((id) => !known.has(id)))];
    if (unknown.length) return { ok: false, error: 'unknown-artboard', ids: unknown };
  }

  let next = current;
  if (patch.present === null) next = withKey(next, 'present', undefined);
  else if (patch.present) {
    let p: Record<string, unknown> = isObj(current.present) ? current.present : {};
    for (const k of PRESENT_KEYS) {
      if (!Object.hasOwn(patch.present, k)) continue;
      const v = patch.present[k as 'order' | 'skip'];
      p = withKey(p, k, v?.length ? [...v] : undefined);
    }
    next = withKey(next, 'present', Object.keys(p).length ? p : undefined);
  }
  if (patch.notes && Object.keys(patch.notes).length) {
    let map: Record<string, unknown> = isObj(current.artboardMeta) ? current.artboardMeta : {};
    for (const [id, v] of Object.entries(patch.notes)) {
      const entry: Record<string, unknown> = isObj(map[id])
        ? (map[id] as Record<string, unknown>)
        : {};
      const e = withKey(entry, 'notes', v ? v : undefined);
      map = withKey(map, id, Object.keys(e).length ? e : undefined);
    }
    next = withKey(next, 'artboardMeta', Object.keys(map).length ? map : undefined);
  }
  // S8.8 — the artboard's export sizes: the same entry, the same keep-everything-else rule.
  if (patch.exports && Object.keys(patch.exports).length) {
    let map: Record<string, unknown> = isObj(next.artboardMeta) ? next.artboardMeta : {};
    for (const [id, v] of Object.entries(patch.exports)) {
      const entry: Record<string, unknown> = isObj(map[id])
        ? (map[id] as Record<string, unknown>)
        : {};
      const e = withKey(entry, 'exports', v?.length ? v.map((x) => ({ ...x })) : undefined);
      map = withKey(map, id, Object.keys(e).length ? e : undefined);
    }
    next = withKey(next, 'artboardMeta', Object.keys(map).length ? map : undefined);
  }
  // S7.8 — the video artboard's poster frame: the same entry, the same keep-everything-else rule.
  if (patch.poster && Object.keys(patch.poster).length) {
    let map: Record<string, unknown> = isObj(next.artboardMeta) ? next.artboardMeta : {};
    for (const [id, v] of Object.entries(patch.poster)) {
      const entry: Record<string, unknown> = isObj(map[id])
        ? (map[id] as Record<string, unknown>)
        : {};
      const e = withKey(entry, 'poster', v === null ? undefined : v);
      map = withKey(map, id, Object.keys(e).length ? e : undefined);
    }
    next = withKey(next, 'artboardMeta', Object.keys(map).length ? map : undefined);
  }
  // S7.12 — Snap to the beat: the same entry, the same keep-everything-else rule.
  if (patch.snap && Object.keys(patch.snap).length) {
    let map: Record<string, unknown> = isObj(next.artboardMeta) ? next.artboardMeta : {};
    for (const [id, v] of Object.entries(patch.snap)) {
      const entry: Record<string, unknown> = isObj(map[id])
        ? (map[id] as Record<string, unknown>)
        : {};
      const e = withKey(entry, 'snap', v === null ? undefined : v);
      map = withKey(map, id, Object.keys(e).length ? e : undefined);
    }
    next = withKey(next, 'artboardMeta', Object.keys(map).length ? map : undefined);
  }
  // S7.18 — a video artboard's own length limit: the same entry, the same keep-everything-else rule.
  if (patch.maxFrames && Object.keys(patch.maxFrames).length) {
    let map: Record<string, unknown> = isObj(next.artboardMeta) ? next.artboardMeta : {};
    for (const [id, v] of Object.entries(patch.maxFrames)) {
      const entry: Record<string, unknown> = isObj(map[id])
        ? (map[id] as Record<string, unknown>)
        : {};
      const e = withKey(entry, 'maxFrames', v === null ? undefined : v);
      map = withKey(map, id, Object.keys(e).length ? e : undefined);
    }
    next = withKey(next, 'artboardMeta', Object.keys(map).length ? map : undefined);
  }
  // S7.16 — a video artboard's ruler markers: the same entry, the same keep-everything-else rule.
  if (patch.markers && Object.keys(patch.markers).length) {
    let map: Record<string, unknown> = isObj(next.artboardMeta) ? next.artboardMeta : {};
    for (const [id, v] of Object.entries(patch.markers)) {
      const entry: Record<string, unknown> = isObj(map[id])
        ? (map[id] as Record<string, unknown>)
        : {};
      const e = withKey(entry, 'markers', v?.length ? v.map((x) => ({ ...x })) : undefined);
      map = withKey(map, id, Object.keys(e).length ? e : undefined);
    }
    next = withKey(next, 'artboardMeta', Object.keys(map).length ? map : undefined);
  }
  // S7.25 — where a Change-kind copy was made from: the same entry, the same keep-everything-else rule.
  if (patch.madeFrom && Object.keys(patch.madeFrom).length) {
    let map: Record<string, unknown> = isObj(next.artboardMeta) ? next.artboardMeta : {};
    for (const [id, v] of Object.entries(patch.madeFrom)) {
      const entry: Record<string, unknown> = isObj(map[id])
        ? (map[id] as Record<string, unknown>)
        : {};
      const e = withKey(entry, 'madeFrom', v === null ? undefined : { ...v });
      map = withKey(map, id, Object.keys(e).length ? e : undefined);
    }
    next = withKey(next, 'artboardMeta', Object.keys(map).length ? map : undefined);
  }
  return { ok: true, next, changed: JSON.stringify(next) !== JSON.stringify(current) };
}

export interface PresentIdIssues {
  duplicates: { list: 'order' | 'skip'; id: string }[];
  unknown: { where: string; id: string }[];
}

/** What `maude design check` reports about a sidecar's Present ids (raw, before any tolerant drop):
 *  ids listed twice in `present.order` / `present.skip`, and ids — in those lists or carrying a note
 *  — that are not artboards of the canvas (`known` null = the canvas lists artboards a parse can't). */
export function presentIdIssues(meta: unknown, known: ReadonlySet<string> | null): PresentIdIssues {
  const m = isObj(meta) ? meta : {};
  const p = isObj(m.present) ? m.present : {};
  const out: PresentIdIssues = { duplicates: [], unknown: [] };
  for (const list of ['order', 'skip'] as const) {
    const v = p[list];
    if (!Array.isArray(v)) continue;
    const ids = v.filter((x): x is string => typeof x === 'string');
    for (const id of dupes(ids)) out.duplicates.push({ list, id });
    if (known)
      for (const id of new Set(ids))
        if (!known.has(id)) out.unknown.push({ where: `present.${list}`, id });
  }
  if (known && isObj(m.artboardMeta))
    for (const [id, entry] of Object.entries(m.artboardMeta))
      if (isObj(entry) && typeof entry.notes === 'string' && entry.notes && !known.has(id))
        out.unknown.push({ where: `artboardMeta.${id}.notes`, id });
      else if (
        isObj(entry) &&
        Array.isArray(entry.exports) &&
        entry.exports.length &&
        !known.has(id)
      )
        out.unknown.push({ where: `artboardMeta.${id}.exports`, id });
  return out;
}
