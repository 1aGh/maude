// apps/studio/kinds/meta.ts — S7.1: the inner keys S7 owns in a canvas `.meta.json`'s reserved
// top-level `artboardMeta` map (V2-1.12 §5.1 R1/R2/R6; V2-1.10 §5.5; S7-slices Q8).
//
//   artboardMeta[id].poster     integer comp frame — the canvas picture and the export poster
//   artboardMeta[id].snap       "beat" | "off" — Snap to the beat in the Timeline
//   artboardMeta[id].maxFrames  integer ≤ 18 000 — C22 "Allow longer" for this artboard
//   artboardMeta[id].madeFrom   { artboard, label } — change-kind provenance (the copy's source)
//   artboardMeta[id].markers    [{ frame, name }] — ruler markers of a video ("Výkop", "TD 1"), ≤ 200, S7.16
//
// Never under `layout`, never inside `layout.artboards[]` (R6: v1's `patchCanvasMeta` drops both);
// a v1 peer keeps the top-level `artboardMeta` key on its own rewrites (probes H/I/J). Same two
// halves as present/meta-schema.ts:
//   - TOLERANT readers (`readArtboardVideoMeta`, the `resolved*` defaults): never throw; a malformed
//     member reads as absent, which means today's behaviour (R1).
//   - STRICT writer (`parseArtboardMetaPatch` + `applyArtboardMetaPatch`): exactly the documented
//     shape, every id an artboard of the canvas; writes only the members it is asked to, and keeps
//     every other key — `notes` / `madeBy` (S3 / V2-1.5), `exports` (S8), a newer peer's — in place.
// What it writes passes schema/canvas-meta.v2.schema.json (test/format-field-rules.test.ts).

/** The artboard id grammar of the schema's `$defs/artboardId`. */
export const ARTBOARD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const S7_ARTBOARD_KEYS = ['poster', 'snap', 'maxFrames', 'madeFrom', 'markers'] as const;
export type S7ArtboardKey = (typeof S7_ARTBOARD_KEYS)[number];

/** C22: one export goes up to 2 min at 30 fps unless the artboard allows longer. */
export const DEFAULT_MAX_FRAMES = 3600;
/** The exporter ceiling "Allow longer" may raise the cap to. */
export const MAX_FRAMES_CEILING = 18_000;
/** Today's `VideoComp` poster formula: 35 % of the length. */
export const DEFAULT_POSTER_FRACTION = 0.35;
export const SNAP_VALUES = ['beat', 'off'] as const;
export type SnapMode = (typeof SNAP_VALUES)[number];
export const MAX_MADE_FROM_LABEL = 200;
/** S7.16 — ruler markers: at most this many per video, each name plain text up to this long (present/meta-schema.ts holds the same numbers). */
export const MAX_MARKERS = 200;
export const MAX_MARKER_NAME = 60;
const MAX_IDS = 2000;

export interface MadeFrom {
  artboard: string;
  label: string;
}

export interface Marker {
  frame: number;
  name: string;
}

export interface ArtboardVideoMeta {
  markers?: Marker[];
  poster?: number;
  snap?: SnapMode;
  maxFrames?: number;
  madeFrom?: MadeFrom;
}

/** One artboard's patch: a value sets the key, null removes it, an absent key is left alone. */
export type ArtboardMetaPatch = Record<
  string,
  { [K in S7ArtboardKey]?: ArtboardVideoMeta[K] | null }
>;

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && ARTBOARD_ID_RE.test(v);
const isPoster = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isMaxFrames = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_FRAMES_CEILING;
const isSnap = (v: unknown): v is SnapMode =>
  typeof v === 'string' && (SNAP_VALUES as readonly string[]).includes(v);
const isMarkerName = (v: unknown): v is string => {
  if (typeof v !== 'string' || v.length > MAX_MARKER_NAME) return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 32 || c === 127 || c === 60 || c === 62) return false; // control characters and < >
  }
  return true;
};
/** A strict marker list: ≤ MAX_MARKERS, exactly { frame, name }, one per frame. null = not a valid list. */
function asMarkers(v: unknown): Marker[] | null {
  if (!Array.isArray(v) || v.length > MAX_MARKERS) return null;
  const out: Marker[] = [];
  const seen = new Set<number>();
  for (const x of v) {
    if (!isObj(x) || Object.keys(x).length !== 2) return null;
    if (!isPoster(x.frame) || seen.has(x.frame) || !isMarkerName(x.name)) return null;
    seen.add(x.frame);
    out.push({ frame: x.frame, name: x.name });
  }
  return out.sort((a, b) => a.frame - b.frame);
}
function asMadeFrom(v: unknown): MadeFrom | null {
  if (!isObj(v) || !isId(v.artboard)) return null;
  if (typeof v.label !== 'string' || v.label.length > MAX_MADE_FROM_LABEL) return null;
  return { artboard: v.artboard, label: v.label };
}

/** What a `.meta.json` (any writer, any version) says about one artboard's S7 keys. Never throws. */
export function readArtboardVideoMeta(meta: unknown, artboardId: string): ArtboardVideoMeta {
  const map = isObj(meta) && isObj(meta.artboardMeta) ? meta.artboardMeta : null;
  const entry = map && Object.hasOwn(map, artboardId) ? map[artboardId] : null;
  if (!isObj(entry)) return {};
  const out: ArtboardVideoMeta = {};
  if (isPoster(entry.poster)) out.poster = entry.poster;
  if (isSnap(entry.snap)) out.snap = entry.snap;
  if (isMaxFrames(entry.maxFrames)) out.maxFrames = entry.maxFrames;
  const mf = asMadeFrom(entry.madeFrom);
  if (mf) out.madeFrom = mf;
  // tolerant: keep the members that are valid, in frame order (a peer's half-bad list still draws what it can)
  if (Array.isArray(entry.markers)) {
    const good = entry.markers.filter((x) => isObj(x) && isPoster(x.frame) && isMarkerName(x.name));
    const list = asMarkers(good.slice(0, MAX_MARKERS)) ?? [];
    if (list.length) out.markers = list;
  }
  return out;
}

/** The artboard's length cap in frames (C22): its own "Allow longer" or 3 600. */
export function resolvedMaxFrames(meta: unknown, artboardId: string): number {
  return readArtboardVideoMeta(meta, artboardId).maxFrames ?? DEFAULT_MAX_FRAMES;
}

/** The poster frame for a comp `lengthFrames` long: the stored one (clamped into the comp), else 35 %. */
export function resolvedPoster(meta: unknown, artboardId: string, lengthFrames: number): number {
  const len = Number.isFinite(lengthFrames) && lengthFrames > 0 ? Math.floor(lengthFrames) : 0;
  const last = Math.max(0, len - 1);
  const stored = readArtboardVideoMeta(meta, artboardId).poster;
  if (stored !== undefined) return Math.min(stored, last);
  return Math.min(Math.round(len * DEFAULT_POSTER_FRACTION), last);
}

/** Snap to the beat: the stored choice, else on exactly when the comp has a music clip with a grid. */
export function resolvedSnap(meta: unknown, artboardId: string, hasBeatGrid: boolean): SnapMode {
  return readArtboardVideoMeta(meta, artboardId).snap ?? (hasBeatGrid ? 'beat' : 'off');
}

export type PatchParse =
  | { ok: true; patch: ArtboardMetaPatch }
  | { ok: false; error: 'bad-body' | 'unknown-key' | 'bad-field'; field: string };

/** A patch body `{ [artboardId]: { poster?, snap?, maxFrames?, madeFrom? } }`, checked exactly. */
export function parseArtboardMetaPatch(body: unknown): PatchParse {
  if (!isObj(body) || Object.keys(body).length > MAX_IDS)
    return { ok: false, error: 'bad-body', field: '' };
  const patch: ArtboardMetaPatch = {};
  for (const [id, raw] of Object.entries(body)) {
    if (!isId(id) || !isObj(raw)) return { ok: false, error: 'bad-field', field: id };
    const one: ArtboardMetaPatch[string] = {};
    for (const [k, v] of Object.entries(raw)) {
      const field = `${id}.${k}`;
      if (!(S7_ARTBOARD_KEYS as readonly string[]).includes(k))
        return { ok: false, error: 'unknown-key', field };
      if (v === null) {
        one[k as S7ArtboardKey] = null;
        continue;
      }
      if (k === 'poster' && !isPoster(v)) return { ok: false, error: 'bad-field', field };
      if (k === 'snap' && !isSnap(v)) return { ok: false, error: 'bad-field', field };
      if (k === 'maxFrames' && !isMaxFrames(v)) return { ok: false, error: 'bad-field', field };
      if (k === 'markers') {
        const list = asMarkers(v);
        if (!list) return { ok: false, error: 'bad-field', field };
        one.markers = list;
        continue;
      }
      if (k === 'madeFrom') {
        const mf = asMadeFrom(v);
        if (!mf || Object.keys(v as object).length !== 2)
          return { ok: false, error: 'bad-field', field };
        one.madeFrom = mf;
        continue;
      }
      (one as Record<string, unknown>)[k] = v;
    }
    patch[id] = one;
  }
  return { ok: true, patch };
}

export type PatchApply =
  | { ok: true; next: Record<string, unknown>; changed: boolean }
  | { ok: false; error: 'unknown-artboard'; ids: string[] };

/** `obj` with `key` set in place (or appended), or removed when `value` is undefined. Pure. */
function withKey(
  obj: Record<string, unknown>,
  key: string,
  value: unknown
): Record<string, unknown> {
  if (value !== undefined) return { ...obj, [key]: value };
  if (!Object.hasOwn(obj, key)) return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (k !== key) out[k] = v;
  return out;
}

/**
 * Apply a parsed patch to the current meta object. `known` = the canvas's artboard ids (null when the
 * canvas builds artboards a parse cannot list — then only the id grammar is checked). Removing a key
 * is always allowed, so a stale id can be cleaned up. The input is never mutated; an entry left empty
 * is dropped, and so is an `artboardMeta` left empty.
 */
export function applyArtboardMetaPatch(
  current: Record<string, unknown>,
  patch: ArtboardMetaPatch,
  known: ReadonlySet<string> | null
): PatchApply {
  if (known) {
    const unknown = Object.entries(patch)
      .filter(([id, one]) => !known.has(id) && Object.values(one).some((v) => v !== null))
      .map(([id]) => id);
    if (unknown.length) return { ok: false, error: 'unknown-artboard', ids: unknown };
  }
  let map: Record<string, unknown> = isObj(current.artboardMeta) ? current.artboardMeta : {};
  for (const [id, one] of Object.entries(patch)) {
    let entry: Record<string, unknown> = isObj(map[id]) ? (map[id] as Record<string, unknown>) : {};
    for (const k of S7_ARTBOARD_KEYS) {
      if (!Object.hasOwn(one, k)) continue;
      const v = one[k];
      entry = withKey(
        entry,
        k,
        v === null
          ? undefined
          : k === 'madeFrom'
            ? { ...(v as MadeFrom) }
            : k === 'markers'
              ? (v as Marker[]).map((m) => ({ ...m }))
              : v
      );
    }
    map = withKey(map, id, Object.keys(entry).length ? entry : undefined);
  }
  const next = withKey(current, 'artboardMeta', Object.keys(map).length ? map : undefined);
  return { ok: true, next, changed: JSON.stringify(next) !== JSON.stringify(current) };
}
