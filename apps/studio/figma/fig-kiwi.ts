/**
 * @file       figma/fig-kiwi.ts — Kiwi schema + data decoder for the `.fig` door.
 * @scope      apps/studio/figma/fig-kiwi.ts
 * @purpose    Decode the two chunks of a `canvas.fig`: chunk[0] is the Kiwi
 *             SCHEMA the file carries for itself, chunk[1] is the DATA encoded
 *             against it. Ported from the documented reference implementation
 *             (`evanw/kiwi`) rather than depended on (DDR-221 D1).
 *
 * @invariant  THE ATTACKER SUPPLIES THE SCHEMA, NOT JUST THE DATA. This is the
 *             property that makes a `.fig` unlike every other parser input in
 *             the repo, and the source of most controls below (DDR-221 A8):
 *               - decoded objects use `Object.create(null)`, because field
 *                 names are schema-chosen and `o["__proto__"] = v` would
 *                 otherwise give a node an attacker-supplied prototype and
 *                 therefore phantom inherited fields (F3);
 *               - enum members decode to schema-chosen NAMES, so every value
 *                 leaving here is UNTRUSTED text and must be bounded before it
 *                 reaches a report (F1 — enforced at the sinks, not here);
 *               - root-type resolution is the CALLER's job and must be strict
 *                 (F2 — see `findRootDefinition`).
 *
 * @invariant  A LENGTH PREFIX IS A CLAIM ABOUT A BUFFER WE ALREADY HOLD. Every
 *             array length is bounded by the bytes actually remaining, so a
 *             `varuint` of 4 billion cannot allocate (DDR-221 D4).
 *
 * @invariant  DEPENDENCY-FREE and side-effect-free. No `node:*`, no IO.
 */

import { MAX_TREE_DEPTH } from './types.ts';

// ── Caps (DDR-221 D4, headroom measured in A1) ──────────────────────────────

/** Observed in the real schema: 627. */
export const MAX_DEFINITIONS = 8192;
/** Observed: 602 (on `NodeChange`). */
export const MAX_FIELDS_PER_DEF = 4096;
/** Observed: 38. */
export const MAX_IDENTIFIER_LEN = 256;
/** Bounds nested small arrays, which per-array caps alone do not. */
export const MAX_DECODED_VALUES = 5_000_000;
/** Absolute ceiling, on top of the remaining-bytes bound. */
export const MAX_ARRAY_LEN = 1_000_000;

export const KIND_ENUM = 0;
export const KIND_STRUCT = 1;
export const KIND_MESSAGE = 2;

/** Kiwi's builtin type ids are negative; non-negative indexes a definition. */
const TYPE_BOOL = -1;
const TYPE_BYTE = -2;
const TYPE_INT = -3;
const TYPE_UINT = -4;
const TYPE_FLOAT = -5;
const TYPE_STRING = -6;
const TYPE_INT64 = -7;
const TYPE_UINT64 = -8;

export class FigKiwiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FigKiwiError';
  }
}

export interface KiwiField {
  name: string;
  type: number;
  isArray: boolean;
  /** Enum member value, or MESSAGE field id. Always 0 for a STRUCT field. */
  value: number;
}

export interface KiwiDefinition {
  name: string;
  kind: number;
  fields: KiwiField[];
  /** MESSAGE field lookup by id, built once instead of scanning 602 fields per read. */
  byId?: Map<number, KiwiField>;
  /** ENUM member lookup by value. */
  byValue?: Map<number, string>;
}

export type KiwiSchema = KiwiDefinition[];

/** Bounds-checked cursor over the decoded chunk. */
class Reader {
  offset = 0;
  constructor(readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  byte(): number {
    if (this.offset >= this.bytes.length) throw new FigKiwiError('unexpected end of Kiwi data');
    return this.bytes[this.offset++];
  }

  /** LEB128. Refused past 5 bytes rather than shifted past the 32-bit width. */
  varuint(): number {
    let value = 0;
    let shift = 0;
    for (;;) {
      const b = this.byte();
      value |= (b & 0x7f) << shift;
      shift += 7;
      if ((b & 0x80) === 0) break;
      if (shift > 28) throw new FigKiwiError('malformed varuint: more than 5 bytes');
    }
    return value >>> 0;
  }

  varint(): number {
    const v = this.varuint();
    return v & 1 ? ~(v >>> 1) : v >>> 1;
  }

  /**
   * Kiwi's 64-bit varuint: 7 bits per byte with a continuation flag for the
   * first EIGHT bytes, then a NINTH byte that carries a full 8 bits (it has no
   * continuation flag — 8 x 7 + 8 = 64). Reading it as plain LEB128 treated that
   * last byte's top bit as "more follows" and walked into the next field, which
   * surfaced as `malformed varuint64: more than 10 bytes` on any value >= 2^63
   * (#155 §10).
   */
  varuint64(): bigint {
    let value = 0n;
    let shift = 0n;
    for (let i = 0; i < 8; i++) {
      const b = this.byte();
      value |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return value;
      shift += 7n;
    }
    return value | (BigInt(this.byte()) << 56n);
  }

  /** Zig-zag signed form of `varuint64`, same as `varint()` is of `varuint()`. */
  varint64(): bigint {
    const v = this.varuint64();
    return v & 1n ? ~(v >> 1n) : v >> 1n;
  }

  /**
   * Kiwi rotates a float's exponent into the low 8 bits so that zero and
   * denormals encode as a single 0 byte. Getting the FRAMING right and this
   * rotation wrong yields a stream that stays perfectly in sync while every
   * coordinate decodes as 0 — see DDR-221 A4, which is why a fixture geometry
   * assertion is a required test and not a nicety.
   */
  float(): number {
    if (this.remaining >= 1 && this.bytes[this.offset] === 0) {
      this.offset++;
      return 0;
    }
    if (this.remaining < 4) throw new FigKiwiError('unexpected end of Kiwi data reading a float');
    const b = this.bytes;
    const o = this.offset;
    let bits = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
    this.offset += 4;
    bits = ((bits << 23) | (bits >>> 9)) >>> 0;
    FLOAT_VIEW.setUint32(0, bits, true);
    return FLOAT_VIEW.getFloat32(0, true);
  }

  /** NUL-terminated UTF-8. An unterminated run refuses rather than overreading. */
  string(maxLen = MAX_IDENTIFIER_LEN * 64): string {
    const start = this.offset;
    const limit = Math.min(this.bytes.length, start + maxLen);
    let end = start;
    while (end < limit && this.bytes[end] !== 0) end++;
    if (end >= limit) {
      throw new FigKiwiError(
        end === this.bytes.length ? 'unterminated Kiwi string' : 'Kiwi string exceeds its limit'
      );
    }
    this.offset = end + 1;
    return TEXT_DECODER.decode(this.bytes.subarray(start, end));
  }
}

const FLOAT_VIEW = new DataView(new ArrayBuffer(4));
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: false });

function checkIdentifier(name: string, what: string): void {
  if (name.length === 0) throw new FigKiwiError(`Kiwi ${what} has an empty name`);
  if (name.length > MAX_IDENTIFIER_LEN) {
    throw new FigKiwiError(
      `Kiwi ${what} name is ${name.length} characters, over the ${MAX_IDENTIFIER_LEN} limit`
    );
  }
}

/**
 * Parse the schema chunk. Note that cyclic and self-referencing definitions are
 * LEGITIMATE — `Message`, `NodeChange` and `MessageType` all self-reference in
 * the real schema, so refusing cycles would refuse every real file (DDR-221
 * A2). Recursion is bounded at decode time by depth instead.
 */
export function parseKiwiSchema(bytes: Uint8Array): KiwiSchema {
  const r = new Reader(bytes);
  const count = r.varuint();
  if (count > MAX_DEFINITIONS) {
    throw new FigKiwiError(
      `Kiwi schema declares ${count} definitions, over the ${MAX_DEFINITIONS} limit`
    );
  }

  const defs: KiwiDefinition[] = [];
  for (let i = 0; i < count; i++) {
    const name = r.string();
    checkIdentifier(name, 'definition');
    const kind = r.byte();
    if (kind !== KIND_ENUM && kind !== KIND_STRUCT && kind !== KIND_MESSAGE) {
      throw new FigKiwiError(`Kiwi definition "${name}" has unknown kind ${kind}`);
    }
    const fieldCount = r.varuint();
    if (fieldCount > MAX_FIELDS_PER_DEF) {
      throw new FigKiwiError(
        `Kiwi definition "${name}" declares ${fieldCount} fields, over the ${MAX_FIELDS_PER_DEF} limit`
      );
    }
    const fields: KiwiField[] = [];
    for (let f = 0; f < fieldCount; f++) {
      const fieldName = r.string();
      checkIdentifier(fieldName, 'field');
      fields.push({
        name: fieldName,
        type: r.varint(),
        isArray: r.byte() !== 0,
        value: r.varuint(),
      });
    }
    defs.push({ name, kind, fields });
  }

  if (r.remaining !== 0) {
    throw new FigKiwiError(`Kiwi schema has ${r.remaining} trailing bytes`);
  }

  // Type indexes must resolve. A dangling index would otherwise surface as a
  // confusing decode error deep inside the data chunk.
  for (const def of defs) {
    for (const field of def.fields) {
      if (field.type >= 0 && field.type >= defs.length) {
        throw new FigKiwiError(
          `Kiwi field "${def.name}.${field.name}" references type index ${field.type}, out of range`
        );
      }
      if (field.type < TYPE_UINT64) {
        throw new FigKiwiError(
          `Kiwi field "${def.name}.${field.name}" has unknown builtin type ${field.type}`
        );
      }
    }
    if (def.kind === KIND_MESSAGE) {
      def.byId = new Map(def.fields.map((f) => [f.value, f]));
    } else if (def.kind === KIND_ENUM) {
      def.byValue = new Map(def.fields.map((f) => [f.value, f.name]));
    }
  }

  return defs;
}

/**
 * Resolve the document root STRICTLY (DDR-221 A8/F2).
 *
 * Locating the root by name alone is attacker-steerable: a hostile schema can
 * omit `Message`, define two, or make it a STRUCT. Decoding the data against
 * the wrong root does not necessarily fail — Kiwi MESSAGE framing is
 * self-terminating — so it can yield a structurally valid, semantically WRONG
 * tree, which is precisely the silent wrongness D3 exists to prevent.
 */
export function findRootDefinition(
  schema: KiwiSchema,
  rootName: string,
  arrayField: string,
  elementName: string
): number {
  const matches: number[] = [];
  for (let i = 0; i < schema.length; i++) {
    if (schema[i].name === rootName) matches.push(i);
  }
  if (matches.length === 0) throw new FigKiwiError(`Kiwi schema has no "${rootName}" definition`);
  if (matches.length > 1) {
    throw new FigKiwiError(`Kiwi schema defines "${rootName}" ${matches.length} times`);
  }

  const index = matches[0];
  const def = schema[index];
  if (def.kind !== KIND_MESSAGE) {
    throw new FigKiwiError(`Kiwi "${rootName}" is not a message`);
  }
  const field = def.fields.find((f) => f.name === arrayField);
  if (!field?.isArray || field.type < 0) {
    throw new FigKiwiError(`Kiwi "${rootName}" has no "${arrayField}" array`);
  }
  if (schema[field.type]?.name !== elementName) {
    throw new FigKiwiError(`Kiwi "${rootName}.${arrayField}" is not an array of "${elementName}"`);
  }
  return index;
}

interface DecodeState {
  values: number;
}

/**
 * Decode the data chunk against the schema. Returns plain data: prototype-less
 * objects, arrays, numbers, bigints, booleans and strings.
 */
export function decodeKiwi(bytes: Uint8Array, schema: KiwiSchema, rootIndex: number): unknown {
  const r = new Reader(bytes);
  const state: DecodeState = { values: 0 };
  const value = readValue(r, schema, rootIndex, 0, state);
  if (r.remaining !== 0) {
    throw new FigKiwiError(`Kiwi data has ${r.remaining} trailing bytes`);
  }
  return value;
}

function readValue(
  r: Reader,
  schema: KiwiSchema,
  type: number,
  depth: number,
  state: DecodeState
): unknown {
  if (++state.values > MAX_DECODED_VALUES) {
    throw new FigKiwiError(`Kiwi data exceeds the ${MAX_DECODED_VALUES}-value budget`);
  }
  if (depth > MAX_TREE_DEPTH) {
    throw new FigKiwiError(`Kiwi data nests deeper than ${MAX_TREE_DEPTH} levels`);
  }

  if (type < 0) {
    switch (type) {
      case TYPE_BOOL:
        return r.byte() !== 0;
      case TYPE_BYTE:
        return r.byte();
      case TYPE_INT:
        return r.varint();
      case TYPE_UINT:
        return r.varuint();
      case TYPE_FLOAT:
        return r.float();
      case TYPE_STRING:
        return r.string();
      case TYPE_INT64:
        return r.varint64();
      case TYPE_UINT64:
        return r.varuint64();
      default:
        throw new FigKiwiError(`unknown Kiwi builtin type ${type}`);
    }
  }

  const def = schema[type];
  if (!def) throw new FigKiwiError(`Kiwi type index ${type} is out of range`);

  if (def.kind === KIND_ENUM) {
    const raw = r.varuint();
    // UNTRUSTED: the member NAME is schema-chosen (DDR-221 A8/F1). Unknown
    // values keep a code-owned shape so nothing attacker-written can pose as a
    // recognised member.
    return def.byValue?.get(raw) ?? `UNKNOWN_${raw}`;
  }

  // `Object.create(null)`: field names are schema-chosen, and on a plain object
  // `o["__proto__"] = v` would set this node's prototype to attacker data,
  // giving it phantom inherited fields (DDR-221 A8/F3).
  const out = Object.create(null) as Record<string, unknown>;

  if (def.kind === KIND_STRUCT) {
    for (const field of def.fields) {
      out[field.name] = readField(r, schema, field, depth + 1, state);
    }
    return out;
  }

  for (;;) {
    const id = r.varuint();
    if (id === 0) break;
    const field = def.byId?.get(id);
    if (!field) {
      throw new FigKiwiError(`Kiwi message "${def.name}" has no field with id ${id}`);
    }
    out[field.name] = readField(r, schema, field, depth + 1, state);
  }
  return out;
}

function readField(
  r: Reader,
  schema: KiwiSchema,
  field: KiwiField,
  depth: number,
  state: DecodeState
): unknown {
  if (!field.isArray) return readValue(r, schema, field.type, depth, state);

  const length = r.varuint();
  if (length > MAX_ARRAY_LEN) {
    throw new FigKiwiError(
      `Kiwi array "${field.name}" declares ${length} elements, over the ${MAX_ARRAY_LEN} limit`
    );
  }
  // A length prefix is a claim about a buffer we already hold. Even a
  // zero-byte element type cannot produce more elements than bytes remain,
  // because every element consumes at least the byte that terminates it.
  if (length > r.remaining) {
    throw new FigKiwiError(
      `Kiwi array "${field.name}" declares ${length} elements with only ${r.remaining} bytes left`
    );
  }

  const items = new Array(length);
  for (let i = 0; i < length; i++) {
    items[i] = readValue(r, schema, field.type, depth, state);
  }
  return items;
}
