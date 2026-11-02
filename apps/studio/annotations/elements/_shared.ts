/**
 * @file       annotations/elements/_shared.ts — helpers shared by element definitions
 * @scope      apps/studio/annotations/elements/_shared.ts
 * @purpose    Box fields, text-style fields and the rotation-aware box
 *             hit-test most element types reuse. A new element type composes
 *             these; it never re-implements them.
 */

import {
  bool,
  DANGEROUS_KEYS,
  type FieldSpec,
  type FieldSpecMap,
  fieldValue,
  id,
  jsonEq,
  num,
  oneOf,
  record,
  str,
} from '../fields.ts';
import type { AnnotationElement, Box } from '../types.ts';

export const ALIGNS = ['left', 'center', 'right'] as const;
export const LISTS = ['bullet', 'number'] as const;

/** Geometry of every box-shaped element. `w`/`h` are always normalized (≥ 0). */
export const BOX_FIELDS: FieldSpecMap = {
  x: num({ required: true }),
  y: num({ required: true }),
  w: num({ min: 0, required: true }),
  h: num({ min: 0, required: true }),
};

export const ROT_FIELD: FieldSpecMap = { rot: num({ min: -180, max: 180, dp: 1, def: 0 }) };

/** Whole-element text formatting (DDR-091: list markers are render-only). */
export function textStyleFields(defAlign: (typeof ALIGNS)[number]): FieldSpecMap {
  return {
    bold: bool(),
    italic: bool(),
    strike: bool(),
    underline: bool(),
    list: oneOf(LISTS),
    align: oneOf(ALIGNS, defAlign),
  };
}

export function n(el: AnnotationElement, key: string): number {
  const v = el[key];
  return typeof v === 'number' ? v : 0;
}

export function boxOf(el: AnnotationElement): Box {
  return { x: n(el, 'x'), y: n(el, 'y'), w: n(el, 'w'), h: n(el, 'h') };
}

export function rotOf(el: AnnotationElement): number {
  return n(el, 'rot');
}

/** Rotate (px, py) around (cx, cy) by `deg` clockwise. */
export function rotatePoint(
  px: number,
  py: number,
  cx: number,
  cy: number,
  deg: number
): [number, number] {
  if (deg === 0) return [px, py];
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

/** Inverse-rotate a probe into the element's local (unrotated) frame. */
export function toLocal(el: AnnotationElement, box: Box, px: number, py: number): [number, number] {
  const rot = rotOf(el);
  if (rot === 0) return [px, py];
  return rotatePoint(px, py, box.x + box.w / 2, box.y + box.h / 2, -rot);
}

export function inBox(b: Box, px: number, py: number, tol: number): boolean {
  return px >= b.x - tol && px <= b.x + b.w + tol && py >= b.y - tol && py <= b.y + b.h + tol;
}

export function pointSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Minimum grab tolerance of solid cards (v1 parity: cards have no stroke width, so 2). */
export const CARD_MIN_TOL = 2;

/** Solid card: the whole (rotated) box is hittable, with at least `minTol` slack. */
export function solidBoxHit(
  el: AnnotationElement,
  px: number,
  py: number,
  tol: number,
  minTol = CARD_MIN_TOL
): boolean {
  const b = boxOf(el);
  const [lx, ly] = toLocal(el, b, px, py);
  return inBox(b, lx, ly, Math.max(tol, minTol));
}

export function translateBox(
  el: AnnotationElement,
  dx: number,
  dy: number
): Record<string, unknown> {
  return { x: n(el, 'x') + dx, y: n(el, 'y') + dy };
}

export function resizeBox(_el: AnnotationElement, box: Box): Record<string, unknown> {
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}

/** Read a field with its spec default applied. */
export function get<T>(spec: FieldSpecMap, el: AnnotationElement, key: string): T {
  return fieldValue(spec, el, key) as T;
}

// ─── Format-2 extension field specs (V2-1.12 R1–R5, contract S4 §2) ──────────
//
// The typed readings of fields a format-1 reader keeps as opaque extension
// keys (V2-2.14 P2). Every one is optional and default-omitted (R1),
// display-ignorable (R2) and lives in its own key — never a new shape in an
// existing field (R3). Values are sanitizeJson fixed points (plain strings, flat
// records, fixed nested key order), so a format-1 reader keeps the exact bytes a
// format-2 writer produced (R5).

/** DCArtboard id grammar (mirrors `element-ids.ts` ARTBOARD_WHERE_RE — that
 *  module pulls oxc-parser, which the hub kernel must not load). */
export const ARTBOARD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
/** Authored element id (mirrors `element-ids.ts` ELEMENT_ID_RE; ≤ 48, never 8-hex). */
export const ELEMENT_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const COMPUTED_ID_RE = /^[0-9a-f]{8}$/;

export type ParsedHostRef =
  | { kind: 'ab'; artboard: string }
  | { kind: 'el'; artboard: string; element: string; occurrence?: number };

/**
 * Parse a canvas bind host (V2-1.4 §4.8): `ab:<artboard>` or
 * `el:<artboard>/<element>[#<occurrence>]`. Null when it is not one. A computed
 * (8-hex) element id is never a durable reference (V2-1.4).
 */
export function parseHostRef(ref: unknown): ParsedHostRef | null {
  if (typeof ref !== 'string' || ref.length > 200) return null;
  if (ref.startsWith('ab:')) {
    const artboard = ref.slice(3);
    return ARTBOARD_ID_RE.test(artboard) ? { kind: 'ab', artboard } : null;
  }
  if (!ref.startsWith('el:')) return null;
  const body = ref.slice(3);
  const slash = body.indexOf('/');
  if (slash <= 0) return null;
  const artboard = body.slice(0, slash);
  let element = body.slice(slash + 1);
  let occurrence: number | undefined;
  const hash = element.indexOf('#');
  if (hash >= 0) {
    const occ = element.slice(hash + 1);
    if (!/^(?:0|[1-9][0-9]{0,3})$/.test(occ)) return null;
    occurrence = Number(occ);
    element = element.slice(0, hash);
  }
  if (!ARTBOARD_ID_RE.test(artboard)) return null;
  if (element.length > 48 || !ELEMENT_ID_RE.test(element) || COMPUTED_ID_RE.test(element))
    return null;
  return occurrence === undefined
    ? { kind: 'el', artboard, element }
    : { kind: 'el', artboard, element, occurrence };
}

const HOST_REF_PATTERN =
  '^(?:ab:[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}|el:[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}/[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:#(?:0|[1-9][0-9]{0,3}))?)$';

/** An `ab:` / `el:` ref field. */
export function hostRefField(required = false): FieldSpec<string> {
  return {
    required,
    schema: { type: 'string', maxLength: 200, pattern: HOST_REF_PATTERN },
    parse: (raw) => (parseHostRef(raw) ? (raw as string) : undefined),
  };
}

function isRec(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const unit = num({ min: 0, max: 1, dp: 3 });
const coordReq = num({ required: true });
const sizeReq = num({ min: 0, required: true });
const hostLabel = str({ max: 200, plain: true, required: true });

/**
 * An arrow end bound to an artboard or a canvas element (`startHost` /
 * `endHost`, contract S4 Q1): `ref` names the host, `nx`/`ny` an optional
 * magnet on its box (both or neither), `label` the name a dangling end's card
 * shows, `box` the host's last resolved WORLD box. The arrow's own `start` /
 * `end` stay free points caching the last resolved endpoint, so a format-1 peer
 * draws the arrow frozen where it was. Dangling is derived, never stored (Q2).
 */
export function canvasHostField(): FieldSpec<Record<string, unknown>> {
  const refF = hostRefField(true);
  return {
    eq: jsonEq,
    schema: {
      type: 'object',
      required: ['ref', 'label'],
      properties: {
        ref: refF.schema,
        nx: unit.schema,
        ny: unit.schema,
        label: hostLabel.schema,
        box: {
          type: 'object',
          required: ['x', 'y', 'w', 'h'],
          properties: {
            x: coordReq.schema,
            y: coordReq.schema,
            w: sizeReq.schema,
            h: sizeReq.schema,
          },
          additionalProperties: false,
        },
      },
      // A magnet is both coordinates or neither.
      anyOf: [
        { required: ['nx', 'ny'] },
        { not: { anyOf: [{ required: ['nx'] }, { required: ['ny'] }] } },
      ],
      additionalProperties: false,
    },
    parse(raw) {
      if (!isRec(raw)) return undefined;
      const ref = refF.parse(raw.ref);
      const label = hostLabel.parse(raw.label);
      if (ref === undefined || label === undefined) return undefined;
      const out: Record<string, unknown> = { ref };
      const nx = unit.parse(raw.nx);
      const ny = unit.parse(raw.ny);
      if (nx !== undefined && ny !== undefined) {
        out.nx = nx;
        out.ny = ny;
      }
      out.label = label;
      if (isRec(raw.box)) {
        const x = coordReq.parse(raw.box.x);
        const y = coordReq.parse(raw.box.y);
        const w = sizeReq.parse(raw.box.w);
        const h = sizeReq.parse(raw.box.h);
        if (x !== undefined && y !== undefined && w !== undefined && h !== undefined)
          out.box = { x, y, w, h };
      }
      return out;
    },
  };
}

/** Membership: the artboard an annotation rides with (Q3). `x`/`y` stay WORLD. */
export function artboardIdField(required = false): FieldSpec<string> {
  return { ...str({ max: 128, re: ARTBOARD_ID_RE }), required };
}

/** ISO-8601 UTC instant (`Date#toISOString()` form, seconds or milliseconds). */
export const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
export function isoTimeField(required = false): FieldSpec<string> {
  return { ...str({ max: 32, re: ISO_UTC_RE }), required };
}

/** A person as the board names them (display name or account id). */
export function personField(required = false): FieldSpec<string> {
  return { ...str({ max: 64, plain: true }), required };
}

/** An open lowercase vocabulary word: a new value never reshapes the field (R3). */
export const WORD_RE = /^[a-z][a-z0-9-]{0,31}$/;
export function wordField(required = false): FieldSpec<string> {
  return { ...str({ max: 32, re: WORD_RE }), required };
}

/** `resolved: { by, at }` — who resolved a sticky, and when. Absent = open. */
export function resolvedField(): FieldSpec<Record<string, unknown>> {
  return record({ by: personField(true), at: isoTimeField(true) });
}

/**
 * `timeRange: { artboard, start, end }` — a time pin on a video artboard, in
 * seconds (S7's playhead reads it). A reversed range (`end < start`) is invalid.
 */
export function timeRangeField(): FieldSpec<Record<string, unknown>> {
  const t = num({ min: 0, max: 86_400, dp: 3, required: true });
  const inner = record({ artboard: artboardIdField(true), start: t, end: t });
  return {
    ...inner,
    parse(raw) {
      const v = inner.parse(raw);
      if (!v) return undefined;
      return (v.end as number) >= (v.start as number) ? v : undefined;
    },
  };
}

/**
 * `source: { kind, author? }` — where an element came from (`figjam`,
 * `comment`, `template`, …) and, for imported feedback, its original author.
 * `kind` is an open word, so a new source never reshapes the field (R3).
 */
export function sourceField(): FieldSpec<Record<string, unknown>> {
  return record({ kind: wordField(true), author: personField() });
}

/** A sticker / stamp catalogue id (a pack id or an item id). */
export const CATALOG_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export function catalogIdField(required = false): FieldSpec<string> {
  return { ...str({ max: 64, re: CATALOG_ID_RE }), required };
}

/** `sticker: { pack, id, flip? }` on an image placed from the Stickers gallery. */
export function stickerField(): FieldSpec<Record<string, unknown>> {
  return record({ pack: catalogIdField(true), id: catalogIdField(true), flip: bool() });
}

/** What a vote, ballot or stamp points at: an annotation id or an `ab:` / `el:` ref. */
export function targetField(required = false): FieldSpec<string> {
  const ann = id();
  const host = hostRefField();
  return {
    required,
    schema: { anyOf: [ann.schema ?? {}, host.schema ?? {}] },
    parse: (raw) => ann.parse(raw) ?? host.parse(raw),
  };
}

/**
 * `{ [target]: count }` — dots per target (a ballot's picks, a vote's tallies).
 * Keys come out sorted (the canonical order); counts are integers ≥ 1.
 */
export function countMapField(maxKeys: number): FieldSpec<Record<string, number>> {
  const key = targetField(true);
  return {
    def: {},
    eq: jsonEq as (a: Record<string, number>, b: Record<string, number>) => boolean,
    schema: {
      type: 'object',
      maxProperties: maxKeys,
      propertyNames: key.schema ?? {},
      additionalProperties: { type: 'integer', minimum: 1, maximum: 9999 },
    },
    parse(raw) {
      if (!isRec(raw)) return undefined;
      const out: Record<string, number> = {};
      let n = 0;
      for (const k of Object.keys(raw).sort()) {
        if (n >= maxKeys) break;
        if (DANGEROUS_KEYS.has(k) || key.parse(k) === undefined) continue;
        const v = raw[k];
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) continue;
        out[k] = Math.min(9999, v);
        n++;
      }
      return out;
    },
  };
}

/** FNV-1a 32-bit from `seed`, base 36, 7 chars. */
function fnv(s: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}

const FIRST_PART_RE = /^[A-Za-z0-9_-]+$/;
const LATER_PART_RE = /^[A-Za-z0-9_]+$/;

/**
 * A deterministic element id for "one of these per (parts)": readable
 * `<prefix>-<p0>-<p1>…` when that is unambiguous (only the first part may hold
 * a `-`, all parts in the id alphabet) and fits 64 chars; otherwise
 * `<prefix>-<64-bit digest of the parts>`. Pure — every peer derives the same
 * id, so a second write of the same thing is an upsert, never a second element.
 */
export function deterministicId(prefix: string, parts: readonly string[]): string {
  const readable =
    parts.length > 0 &&
    FIRST_PART_RE.test(parts[0] as string) &&
    parts.slice(1).every((p) => LATER_PART_RE.test(p));
  const raw = [prefix, ...parts].join('-');
  if (readable && raw.length <= 64) return raw;
  const key = JSON.stringify(parts);
  return `${prefix}-${fnv(key, 0x811c9dc5)}${fnv(key, 0x050c5d1f)}`;
}
