/**
 * @file       annotations/registry.ts — the element-type registry (DDR-242 §1)
 * @scope      apps/studio/annotations/registry.ts
 * @purpose    One place that knows every element type. Validation, canonical
 *             form, geometry and capabilities all dispatch through here, so a
 *             new type is ONE definition file plus a line in `DEFS` — never
 *             another `if (tool === …)` chain across the codebase.
 *
 *             An UNKNOWN `type` (a newer peer's new tool) is kept verbatim —
 *             bounded and sanitized — and rendered as a placeholder, so an
 *             older client can never erase what it does not understand.
 */

import { MAX_ELEMENT_BYTES, MAX_GROUPS_PER_ELEMENT } from './constants.ts';
import { artboardIdField, sourceField, timeRangeField } from './elements/_shared.ts';
import { arrow } from './elements/arrow.model.ts';
import { ballot } from './elements/ballot.model.ts';
import { image, link, mediaref } from './elements/media.model.ts';
import { pen } from './elements/pen.model.ts';
import { section } from './elements/section.model.ts';
import { shape } from './elements/shape.model.ts';
import { stamp } from './elements/stamp.model.ts';
import { sticky } from './elements/sticky.model.ts';
import { textEl } from './elements/text.model.ts';
import { vote } from './elements/vote.model.ts';
import {
  bool,
  DANGEROUS_KEYS,
  type FieldSpec,
  type FieldSpecMap,
  INDEX_RE,
  id,
  jsonEq,
  oneOf,
  parseFields,
  record,
  sanitizeJson,
  str,
  stringList,
} from './fields.ts';
import type { AnnotationElement, ElementDef } from './types.ts';

const DEFS: readonly ElementDef[] = [
  sticky,
  textEl,
  shape,
  arrow,
  pen,
  image,
  link,
  mediaref,
  section,
  // Format 2 (V2-1.12 R4): new kinds are new types — a format-1 peer keeps
  // them verbatim as unknown types (probe C).
  stamp,
  vote,
  ballot,
];

const TYPES = new Map(DEFS.map((d) => [d.type, d]));
export const REGISTRY: ReadonlyMap<string, ElementDef> = TYPES;

/**
 * Register an element type at runtime — a plugin, or a test proving that a new
 * type is one definition (the conformance suite's `stamp`). A built-in type
 * cannot be replaced.
 */
export function registerElementType(def: ElementDef): void {
  if (!TYPE_RE.test(def.type) || def.type in Object.prototype) {
    throw new Error(`invalid element type "${def.type}"`);
  }
  const cur = TYPES.get(def.type);
  if (cur && DEFS.includes(cur)) throw new Error(`"${def.type}" is a built-in element type`);
  TYPES.set(def.type, def);
  specCache.delete(def.type);
  extCache.delete(def.type);
}

/**
 * Drop a type `registerElementType` added — a plugin unloading, or a test that registered one and must
 * not leave it in the process-wide registry (it would land in `annotationsJsonSchema()` for every later
 * file). A built-in type cannot be removed.
 */
export function unregisterElementType(type: string): void {
  const cur = TYPES.get(type);
  if (!cur) return;
  if (DEFS.includes(cur)) throw new Error(`"${type}" is a built-in element type`);
  TYPES.delete(type);
  specCache.delete(type);
  extCache.delete(type);
}

export const TYPE_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** Fields every element carries first, in canonical order. */
export const HEAD_FIELDS: FieldSpecMap = {
  id: id(true),
  type: str({ max: 32, re: TYPE_RE, required: true }),
  parent: id(),
  index: str({ max: 64, re: INDEX_RE, required: true }),
};

/** Fields every element carries last, in canonical order. */
export const TAIL_FIELDS: FieldSpecMap = {
  groups: stringList(MAX_GROUPS_PER_ELEMENT, id()),
  author: record({
    kind: oneOf(['ai', 'human'] as const, undefined, true),
    name: str({ max: 64, plain: true }),
    id: str({ max: 64, plain: true }),
  }),
  /** Protected against accidental edits in the UI (a UX guard, not a permission). */
  locked: bool(),
};

/**
 * Format-2 extension fields every known type carries (V2-1.12 R5, contract S4
 * §2): typed here, serialized after `TAIL_FIELDS` in sorted key order. A
 * format-1 reader keeps them as opaque extension keys in the same place, so
 * both readers write the same bytes.
 *
 *  - `parentArtboard` — membership: the artboard the annotation rides with
 *    (Q3). `x`/`y` stay WORLD coordinates (R2).
 *  - `source` — `{kind, author?}`: where it came from (a FigJam import, a
 *    comment turned into a sticky, a template).
 *  - `timeRange` — `{artboard, start, end}`: a time pin on a video artboard.
 */
export const COMMON_EXT_FIELDS: FieldSpecMap = {
  parentArtboard: artboardIdField(),
  source: sourceField(),
  timeRange: timeRangeField(),
};

const specCache = new Map<string, FieldSpecMap>();
const extCache = new Map<string, FieldSpecMap>();

/**
 * Typed format-2 extension fields of a known type (common + its own), keys in
 * SORTED order — the order they serialize in. Null for an unknown type. While
 * `withFormat1Reader` runs, every type has none (the 1.x reading).
 */
export function extSpecOf(type: string): FieldSpecMap | null {
  if (!isKnownType(type)) return null;
  if (format1Depth > 0) return EMPTY_SPEC;
  const cached = extCache.get(type);
  if (cached) return cached;
  const def = REGISTRY.get(type) as ElementDef;
  const merged: Record<string, FieldSpec<unknown>> = { ...COMMON_EXT_FIELDS, ...(def.ext ?? {}) };
  const base = specOf(type) as FieldSpecMap;
  const out: Record<string, FieldSpec<unknown>> = {};
  for (const k of Object.keys(merged).sort()) {
    // R5: an extension key is field-shaped and never shadows a format-1 field.
    if (!UNKNOWN_KEY_RE.test(k) || Object.hasOwn(base, k) || DANGEROUS_KEYS.has(k)) {
      throw new Error(`"${type}.${k}" is not a valid extension field`);
    }
    out[k] = merged[k] as FieldSpec<unknown>;
  }
  extCache.set(type, out);
  return out;
}

const EMPTY_SPEC: FieldSpecMap = Object.freeze({});
let format1Depth = 0;

/**
 * Run `fn` with the FORMAT-1 reading of the registry: no typed extension
 * fields, so every format-2 field is an opaque, preserved extension key and
 * every format-2 type parses as an unknown type — exactly what a 1.x peer
 * (V2-2.14 lossless readers) does with a format-2 board. For the mixed-peer
 * tests and the migrator's `--strip` accounting; never on a product path.
 */
export function withFormat1Reader<T>(fn: () => T): T {
  format1Depth++;
  try {
    return fn();
  } finally {
    format1Depth--;
  }
}

/** True while `withFormat1Reader` runs. */
export function readingAsFormat1(): boolean {
  return format1Depth > 0;
}

/** Full canonical field spec (head + type fields + tail) of a known type. */
export function specOf(type: string): FieldSpecMap | null {
  if (format1Depth > 0 && FORMAT2_TYPES.has(type)) return null;
  const cached = specCache.get(type);
  if (cached) return cached;
  const def = REGISTRY.get(type);
  if (!def) return null;
  const spec = { ...HEAD_FIELDS, ...def.fields, ...TAIL_FIELDS };
  specCache.set(type, spec);
  return spec;
}

export function defOf(type: string): ElementDef | null {
  if (format1Depth > 0 && FORMAT2_TYPES.has(type)) return null;
  return REGISTRY.get(type) ?? null;
}

export function isKnownType(type: string): boolean {
  if (format1Depth > 0 && FORMAT2_TYPES.has(type)) return false;
  return REGISTRY.has(type);
}

/** Element types format 2 added (V2-1.12 R4). A format-1 peer keeps them as unknown types. */
export const FORMAT2_TYPES: ReadonlySet<string> = new Set([stamp.type, vote.type, ballot.type]);

export type ElementResult =
  | { ok: true; el: AnnotationElement }
  | { ok: false; reason: string; id?: string };

const UNKNOWN_KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const MAX_UNKNOWN_KEYS = 64;

/**
 * The keys of `r` that `known` does not name, field-shaped and bounded, with
 * their sanitized values, in sorted order. Shared by both branches below.
 */
function extensionFields(
  r: Record<string, unknown>,
  known: FieldSpecMap,
  typed: FieldSpecMap | null
): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  // Field-shaped keys only, and a bounded number of them: the keys become
  // Y.Map field names on every peer (security review, low). Typed format-2
  // fields and still-unknown keys share ONE sorted run and one bound — the
  // order and the cut a format-1 reader applies (R5).
  const rest = Object.keys(r)
    .filter((k) => !Object.hasOwn(known, k) && !DANGEROUS_KEYS.has(k) && UNKNOWN_KEY_RE.test(k))
    .sort()
    .slice(0, MAX_UNKNOWN_KEYS);
  for (const k of rest) {
    const f = typed && Object.hasOwn(typed, k) ? (typed[k] as FieldSpec<unknown>) : null;
    if (f) {
      // A typed extension field is parsed like any field: invalid → dropped,
      // default → omitted (R1). Its canonical value is a sanitizeJson fixed
      // point, so a format-1 reader keeps these exact bytes.
      const v = f.parse(r[k]);
      if (v === undefined) continue;
      if (f.def !== undefined && (f.eq ? f.eq(v, f.def) : jsonEq(v, f.def))) continue;
      out.push([k, v]);
      continue;
    }
    const v = sanitizeJson(r[k]);
    if (v !== undefined) out.push([k, v]);
  }
  return out;
}

/** Head keys in head order, then every other key sorted (the unknown-type order). */
function sortNonHead(el: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(HEAD_FIELDS)) if (Object.hasOwn(el, k)) out[k] = el[k];
  for (const k of Object.keys(el).sort()) if (!Object.hasOwn(HEAD_FIELDS, k)) out[k] = el[k];
  return out;
}

/**
 * Validate one untrusted record into its canonical form. Never throws. A known
 * type is parsed field-by-field in spec order (defaults omitted); an unknown
 * type keeps its head fields. BOTH then keep a bounded, sanitized copy of the
 * keys their spec does not name, sorted, after everything else — so a newer
 * peer's fields survive this reader byte-for-byte (V2-1.12 P2 / R5: on a known
 * type they land after `TAIL_FIELDS`, exactly where a v2 writer puts them).
 * A key the spec DOES name but whose value is invalid is still dropped.
 */
export function validateElement(raw: unknown): ElementResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'not an object' };
  }
  const r = raw as Record<string, unknown>;
  const rawId = typeof r.id === 'string' ? r.id : undefined;
  if (typeof r.type === 'string' && r.type in Object.prototype) {
    return { ok: false, reason: 'reserved element type', id: rawId };
  }
  const spec = typeof r.type === 'string' ? specOf(r.type) : null;
  let el: Record<string, unknown>;
  if (spec) {
    const res = parseFields(spec, r);
    if (!res.ok) return { ok: false, reason: res.reason, id: rawId };
    el = { ...res.value };
    for (const [k, v] of extensionFields(r, spec, extSpecOf(r.type as string))) el[k] = v;
    if (defOf(r.type as string)?.sortedKeys) el = sortNonHead(el);
  } else {
    const head = parseFields(HEAD_FIELDS, r);
    if (!head.ok) return { ok: false, reason: head.reason, id: rawId };
    el = { ...head.value };
    for (const [k, v] of extensionFields(r, HEAD_FIELDS, null)) el[k] = v;
  }
  if (el.parent !== undefined && el.parent === el.id) {
    return { ok: false, reason: 'element is its own parent', id: rawId };
  }
  if (JSON.stringify(el).length > MAX_ELEMENT_BYTES) {
    return { ok: false, reason: 'element exceeds the per-element byte cap', id: rawId };
  }
  return { ok: true, el: el as AnnotationElement };
}
