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
import { arrow } from './elements/arrow.model.ts';
import { image, link, mediaref } from './elements/media.model.ts';
import { pen } from './elements/pen.model.ts';
import { section } from './elements/section.model.ts';
import { shape } from './elements/shape.model.ts';
import { sticky } from './elements/sticky.model.ts';
import { textEl } from './elements/text.model.ts';
import {
  DANGEROUS_KEYS,
  type FieldSpecMap,
  INDEX_RE,
  id,
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
];

export const REGISTRY: ReadonlyMap<string, ElementDef> = new Map(DEFS.map((d) => [d.type, d]));

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
};

const specCache = new Map<string, FieldSpecMap>();

/** Full canonical field spec (head + type fields + tail) of a known type. */
export function specOf(type: string): FieldSpecMap | null {
  const cached = specCache.get(type);
  if (cached) return cached;
  const def = REGISTRY.get(type);
  if (!def) return null;
  const spec = { ...HEAD_FIELDS, ...def.fields, ...TAIL_FIELDS };
  specCache.set(type, spec);
  return spec;
}

export function defOf(type: string): ElementDef | null {
  return REGISTRY.get(type) ?? null;
}

export function isKnownType(type: string): boolean {
  return REGISTRY.has(type);
}

export type ElementResult =
  | { ok: true; el: AnnotationElement }
  | { ok: false; reason: string; id?: string };

const UNKNOWN_KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const MAX_UNKNOWN_KEYS = 64;

/**
 * Validate one untrusted record into its canonical form. Never throws. A known
 * type is parsed field-by-field in spec order (unknown keys dropped, defaults
 * omitted); an unknown type keeps its head fields plus a bounded, sanitized
 * copy of the rest (keys sorted, so its bytes are deterministic too).
 */
export function validateElement(raw: unknown): ElementResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'not an object' };
  }
  const r = raw as Record<string, unknown>;
  const rawId = typeof r.id === 'string' ? r.id : undefined;
  const spec = typeof r.type === 'string' ? specOf(r.type) : null;
  let el: Record<string, unknown>;
  if (spec) {
    const res = parseFields(spec, r);
    if (!res.ok) return { ok: false, reason: res.reason, id: rawId };
    el = res.value;
  } else {
    const head = parseFields(HEAD_FIELDS, r);
    if (!head.ok) return { ok: false, reason: head.reason, id: rawId };
    el = { ...head.value };
    // Field-shaped keys only, and a bounded number of them: the keys become
    // Y.Map field names on every peer (security review, low).
    const rest = Object.keys(r)
      .filter(
        (k) => !Object.hasOwn(HEAD_FIELDS, k) && !DANGEROUS_KEYS.has(k) && UNKNOWN_KEY_RE.test(k)
      )
      .sort()
      .slice(0, MAX_UNKNOWN_KEYS);
    for (const k of rest) {
      const v = sanitizeJson(r[k]);
      if (v !== undefined) el[k] = v;
    }
  }
  if (el.parent !== undefined && el.parent === el.id) {
    return { ok: false, reason: 'element is its own parent', id: rawId };
  }
  if (JSON.stringify(el).length > MAX_ELEMENT_BYTES) {
    return { ok: false, reason: 'element exceeds the per-element byte cap', id: rawId };
  }
  return { ok: true, el: el as AnnotationElement };
}
