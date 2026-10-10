/**
 * @file       annotations/fields.ts — field-spec vocabulary + the validator engine
 * @scope      apps/studio/annotations/fields.ts
 * @purpose    The annotations-v2 element model (DDR-242) validates every record
 *             against a per-type field spec. This module is that vocabulary —
 *             number / string / enum / point / bind / text-style … — plus the
 *             one engine that walks a spec, clamps, rounds, and drops defaults
 *             (the canonical form). It is shared by the studio, the hub kernel
 *             (Node 24 type-stripping — keep this file free of `enum`,
 *             `namespace` and parameter properties) and the headless bins, so
 *             every writer produces byte-identical canonical records.
 *
 *             Peer data is UNTRUSTED (DDR-054). The engine never throws on
 *             bad input: a field that fails its spec falls back to its default
 *             (or makes the element invalid when it is `required`), unknown
 *             keys are dropped, and prototype keys never survive.
 */

/** Keys that must never survive a parse of untrusted JSON (DDR-054 §2g). */
export const DANGEROUS_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/** Coordinates and sizes round to 2 decimals; rotation to 0.1°. */
export const COORD_DP = 2;
/** Every coordinate is clamped into ±COORD_MAX (a peer can't park a node at 1e300). */
export const COORD_MAX = 1_000_000;

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/**
 * A JSON Schema (draft 2020-12) fragment describing what a field ACCEPTS without
 * repair — the strict, AI-write reading of the spec (contract V2-1.11 §5.2). The
 * lenient `parse` above it clamps, truncates and drops; the schema names the
 * values that survive a load unchanged (modulo rounding and default omission).
 * Descriptive only: no parse path reads it. `board-schema.ts` assembles the
 * generated `apps/studio/schema/annotations.v2.schema.json` from these.
 */
export type JsonSchema = { readonly [k: string]: unknown };

/**
 * A field spec. `parse` returns the clean value, or `undefined` when the raw
 * value is unusable (the engine then applies the default, or rejects the
 * element when the field is required). `def` is the implicit value: a field
 * equal to its default is OMITTED from the canonical record.
 */
export interface FieldSpec<T = unknown> {
  parse(raw: unknown): T | undefined;
  def?: T;
  required?: boolean;
  /** Structural equality for default-omission and change detection. */
  eq?(a: T, b: T): boolean;
  /** What the field accepts without repair (generated-schema source; never read by parse). */
  schema?: JsonSchema;
}

export function round(v: number, dp: number): number {
  const f = 10 ** dp;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export interface NumOpts {
  min?: number;
  max?: number;
  dp?: number;
  def?: number;
  required?: boolean;
}

export function num(opts: NumOpts = {}): FieldSpec<number> {
  const min = opts.min ?? -COORD_MAX;
  const max = opts.max ?? COORD_MAX;
  const dp = opts.dp ?? COORD_DP;
  return {
    def: opts.def,
    required: opts.required,
    schema: { type: 'number', minimum: min, maximum: max },
    parse(raw) {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
      return round(Math.min(max, Math.max(min, raw)), dp);
    },
  };
}

export interface StrOpts {
  max: number;
  re?: RegExp;
  def?: string;
  required?: boolean;
  /** Strip control / bidi / zero-width characters (display names). */
  plain?: boolean;
  /** Allow an empty string (else '' counts as absent). */
  allowEmpty?: boolean;
}

/** Control chars, C1, zero-width, bidi overrides/isolates, BOM. Newline/tab kept for text bodies. */
export function stripUnsafe(s: string, keepNewlines: boolean): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (keepNewlines && (cp === 0x0a || cp === 0x09)) {
      out += ch;
      continue;
    }
    const unsafe =
      cp <= 0x1f ||
      (cp >= 0x7f && cp <= 0x9f) ||
      (cp >= 0x200b && cp <= 0x200f) ||
      (cp >= 0x202a && cp <= 0x202e) ||
      (cp >= 0x2066 && cp <= 0x2069) ||
      cp === 0xfeff;
    if (!unsafe) out += ch;
  }
  return out;
}

export function str(opts: StrOpts): FieldSpec<string> {
  return {
    def: opts.def,
    required: opts.required,
    schema: {
      type: 'string',
      ...(opts.allowEmpty ? {} : { minLength: 1 }),
      maxLength: opts.max,
      ...(opts.re ? { pattern: opts.re.source } : {}),
    },
    parse(raw) {
      if (typeof raw !== 'string') return undefined;
      let v = opts.plain ? stripUnsafe(raw, false).trim() : raw.replace(/\r\n?/g, '\n');
      if (!opts.plain) v = stripUnsafe(v, true);
      if (v.length > opts.max) {
        // A patterned value (id, path, url, colour) is an identity — reject, never truncate.
        if (opts.re) return undefined;
        v = v.slice(0, opts.max);
      }
      if (!opts.allowEmpty && v === '') return undefined;
      if (opts.re && !opts.re.test(v)) return undefined;
      return v;
    },
  };
}

/** Multi-line body text. Empty is a valid value (a fresh sticky). */
export function text(max = 20_000): FieldSpec<string> {
  return { ...str({ max, allowEmpty: true }), def: '' };
}

export function bool(def = false): FieldSpec<boolean> {
  return {
    def,
    schema: { type: 'boolean' },
    parse(raw) {
      return typeof raw === 'boolean' ? raw : undefined;
    },
  };
}

export function oneOf<T extends string>(
  values: readonly T[],
  def?: T,
  required?: boolean
): FieldSpec<T> {
  const set = new Set<string>(values);
  return {
    def,
    required,
    schema: { type: 'string', enum: [...values] },
    parse(raw) {
      return typeof raw === 'string' && set.has(raw) ? (raw as T) : undefined;
    },
  };
}

/** `#rgb`, `#rrggbb`, `#rrggbbaa` — the only colour forms the palettes produce. */
export const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function color(def?: string, required?: boolean): FieldSpec<string> {
  return { ...str({ max: 9, re: COLOR_RE }), def, required };
}

/** A fill: a colour, or `null` for "no fill" (null is the default). */
export function fill(): FieldSpec<string | null> {
  return {
    def: null,
    schema: { type: ['string', 'null'], pattern: COLOR_RE.source },
    parse(raw) {
      if (raw === null) return null;
      return typeof raw === 'string' && COLOR_RE.test(raw) ? raw : undefined;
    },
  };
}

/** Element id — the stable identity external references (comments) hold. */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function id(required = false): FieldSpec<string> {
  return { ...str({ max: 64, re: ID_RE }), required };
}

/** Fractional z-order key (base-62 digits, see fractional-index.ts). */
export const INDEX_RE = /^[0-9A-Za-z]{1,64}$/;

export function stringList(maxItems: number, item: FieldSpec<string>): FieldSpec<string[]> {
  return {
    def: [],
    eq: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
    schema: { type: 'array', maxItems, uniqueItems: true, items: item.schema ?? {} },
    parse(raw) {
      if (!Array.isArray(raw)) return undefined;
      const out: string[] = [];
      for (const r of raw.slice(0, maxItems)) {
        const v = item.parse(r);
        if (v !== undefined && !out.includes(v)) out.push(v);
      }
      return out;
    },
  };
}

/** Flat `[x0, y0, x1, y1, …]` point list (pen ink). Odd trailing values are dropped. */
export function points(maxPoints: number): FieldSpec<number[]> {
  return {
    required: true,
    eq: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
    schema: {
      type: 'array',
      minItems: 2,
      maxItems: maxPoints * 2,
      items: { type: 'number', minimum: -COORD_MAX, maximum: COORD_MAX },
    },
    parse(raw) {
      if (!Array.isArray(raw)) return undefined;
      const n = Math.min(raw.length - (raw.length % 2), maxPoints * 2);
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        const v = raw[i];
        if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
        out.push(round(Math.min(COORD_MAX, Math.max(-COORD_MAX, v)), COORD_DP));
      }
      return out.length >= 2 ? out : undefined;
    },
  };
}

/** Deep structural equality over JSON values (records, arrays, primitives). */
export function jsonEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => jsonEq(v, bb[i]));
  }
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.hasOwn(b as object, k)) return false;
    if (!jsonEq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/** A nested record with its own field spec (e.g. an arrow end, a shape label). */
export function record(
  spec: FieldSpecMap,
  opts: { required?: boolean; def?: Record<string, unknown> } = {}
): FieldSpec<Record<string, unknown>> {
  return {
    required: opts.required,
    def: opts.def,
    eq: jsonEq,
    schema: specMapSchema(spec),
    parse(raw) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
      const r = parseFields(spec, raw as Record<string, unknown>);
      return r.ok ? r.value : undefined;
    },
  };
}

/** Try each alternative in order; the first that parses wins. */
export function either<T>(...alts: FieldSpec<T>[]): FieldSpec<T> {
  return {
    eq: jsonEq as (a: T, b: T) => boolean,
    schema: { anyOf: alts.map((a) => a.schema ?? {}) },
    parse(raw) {
      for (const a of alts) {
        const v = a.parse(raw);
        if (v !== undefined) return v;
      }
      return undefined;
    },
  };
}

export type FieldSpecMap = Readonly<Record<string, FieldSpec<unknown>>>;

/**
 * The closed object schema of a field-spec map: every key its spec, `required`
 * where the spec is, nothing else (`additionalProperties: false`). A field with no
 * declared schema (a plugin's custom spec) accepts any value here.
 */
export function specMapSchema(spec: FieldSpecMap): JsonSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [k, f] of Object.entries(spec)) {
    properties[k] = f.schema ?? {};
    if (f.required) required.push(k);
  }
  return {
    type: 'object',
    ...(required.length ? { required } : {}),
    properties,
    additionalProperties: false,
  };
}

export type ParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string };

function isDefault(spec: FieldSpec<unknown>, v: unknown): boolean {
  if (spec.def === undefined) return false;
  return spec.eq ? spec.eq(v, spec.def) : jsonEq(v, spec.def);
}

/**
 * Walk `spec` over `raw` in SPEC ORDER (that order is the canonical key order),
 * dropping unknown keys and default-valued fields. Required fields that fail
 * make the record invalid; optional ones fall back to (omitted) defaults.
 */
export function parseFields(spec: FieldSpecMap, raw: Record<string, unknown>): ParseResult {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(spec)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    const f = spec[key] as FieldSpec<unknown>;
    const has = Object.hasOwn(raw, key);
    const v = has ? f.parse(raw[key]) : undefined;
    if (v === undefined) {
      if (f.required) return { ok: false, reason: `field "${key}" missing or invalid` };
      continue;
    }
    if (isDefault(f, v)) continue;
    out[key] = v;
  }
  return { ok: true, value: out };
}

/** The value of `key` on a canonical record, falling back to the spec default. */
export function fieldValue(spec: FieldSpecMap, rec: Record<string, unknown>, key: string): unknown {
  if (Object.hasOwn(rec, key)) return rec[key];
  return spec[key]?.def;
}

/**
 * Safe JSON parse for untrusted text: a reviver drops prototype keys at every
 * depth (DDR-054 §2g). Returns `undefined` on malformed input — never throws.
 */
export function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text, (k, v) => (DANGEROUS_KEYS.has(k) ? undefined : v));
  } catch {
    return undefined;
  }
}

/**
 * Bounded generic JSON sanitizer for UNKNOWN element types (forward-compat
 * passthrough): primitives, arrays and plain objects only, depth ≤ 4, ≤ 256
 * keys/items per level, strings capped, prototype keys dropped. Returns
 * `undefined` when the value is not representable.
 */
export function sanitizeJson(raw: unknown, depth = 0): Json | undefined {
  if (raw === null) return null;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === 'string') return stripUnsafe(raw, true).slice(0, 20_000);
  if (depth >= 4 || typeof raw !== 'object') return undefined;
  if (Array.isArray(raw)) {
    const out: Json[] = [];
    for (const v of raw.slice(0, 256)) {
      const s = sanitizeJson(v, depth + 1);
      if (s !== undefined) out.push(s);
    }
    return out;
  }
  const out: { [k: string]: Json } = {};
  for (const k of Object.keys(raw as object).slice(0, 256)) {
    if (DANGEROUS_KEYS.has(k) || k.length > 64) continue;
    const s = sanitizeJson((raw as Record<string, unknown>)[k], depth + 1);
    if (s !== undefined) out[k] = s;
  }
  return out;
}
