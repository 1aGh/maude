// generation/gen-sidecar.ts — `assets/<sha8>.gen.json`, format `maude.gen` v1: the provenance
// of one AI take (contract S8-asset-sidecars §5.2). One file per take, named by that take's own
// sha8; every take of a group carries the same `group` and `takes` (generation order, itself
// included).
//
// LENIENT on purpose: unknown keys are kept and never an error (V2-1.12 R8 binds only the frozen
// strict readers — `.footage.json`, `.edl.json`, `.photo.json`). A file this Maude cannot read
// (`v > 1`, malformed, over 16 KiB) is ABSENT: no "Made by AI" line, and nothing rewrites it.
// `schema/gen.v1.schema.json` mirrors this reader; test/gen-sidecar.test.ts holds them equal.
//
// Dependency-free.

export const GEN_FORMAT = 'maude.gen';
export const GEN_VERSION = 1;
export const GEN_MAX_BYTES = 16 * 1024;
export const GEN_PROMPT_MAX = 4000;
export const GEN_LICENCE_MAX = 300;
export const GEN_BY_MAX = 120;
export const GEN_TAKES_MAX = 8;

const ID_RE = /^[A-Za-z0-9._/-]{1,80}$/;
const SHA8_RE = /^[0-9a-f]{8}$/;
const GROUP_RE = /^[A-Za-z0-9_-]{1,64}$/;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

/** The keys this version knows; any other key rides along untouched. */
export interface GenSidecar {
  format: typeof GEN_FORMAT;
  v: typeof GEN_VERSION;
  prompt: string;
  provider: string;
  model: string;
  at: string;
  takes: string[];
  licence?: string;
  group?: string;
  /** the asker's display name (V2-1.5 attribution) — never an e-mail */
  by?: string;
  [extra: string]: unknown;
}

export interface GenValidation {
  ok: boolean;
  errors: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validate a parsed `.gen.json`. `self` (the file's own sha8, when the caller knows the name)
 * must be one of `takes`. Unknown keys are not checked.
 */
export function validateGen(input: unknown, o: { self?: string } = {}): GenValidation {
  if (!isObject(input)) return { ok: false, errors: ['root: must be an object'] };
  const errors: string[] = [];
  const str = (k: string, max: number, required: boolean) => {
    const v = input[k];
    if (v === undefined) {
      if (required) errors.push(`${k}: required`);
      return;
    }
    if (typeof v !== 'string') errors.push(`${k}: must be a string`);
    else if (v.length > max) errors.push(`${k}: at most ${max} characters`);
  };
  if (input.format !== GEN_FORMAT) errors.push(`format: must be "${GEN_FORMAT}"`);
  if (typeof input.v !== 'number' || !Number.isInteger(input.v) || input.v < 1)
    errors.push('v: must be a positive integer');
  else if (input.v > GEN_VERSION) errors.push(`v: ${input.v} is newer than this Maude reads`);
  str('prompt', GEN_PROMPT_MAX, true);
  for (const k of ['provider', 'model']) {
    const v = input[k];
    if (typeof v !== 'string' || !ID_RE.test(v))
      errors.push(`${k}: required, 1–80 of A-Z a-z 0-9 . _ / -`);
  }
  if (typeof input.at !== 'string' || !UTC_RE.test(input.at) || Number.isNaN(Date.parse(input.at)))
    errors.push('at: required, ISO-8601 UTC (…Z)');
  const takes = input.takes;
  if (
    !Array.isArray(takes) ||
    takes.length < 1 ||
    takes.length > GEN_TAKES_MAX ||
    !takes.every((t) => typeof t === 'string' && SHA8_RE.test(t))
  )
    errors.push(`takes: required, 1–${GEN_TAKES_MAX} lowercase sha8 values`);
  else if (o.self !== undefined && !takes.includes(o.self))
    errors.push(`takes: must include this take (${o.self})`);
  str('licence', GEN_LICENCE_MAX, false);
  if (input.group !== undefined && (typeof input.group !== 'string' || !GROUP_RE.test(input.group)))
    errors.push('group: 1–64 of A-Z a-z 0-9 _ -');
  str('by', GEN_BY_MAX, false);
  if (typeof input.by === 'string' && input.by.includes('@'))
    errors.push('by: a display name, never an e-mail');
  return { ok: errors.length === 0, errors };
}

/** Read a `.gen.json`'s text: the sidecar with every key it carries, or null (= absent). */
export function readGen(text: string, o: { self?: string } = {}): GenSidecar | null {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > GEN_MAX_BYTES)
    return null;
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  return validateGen(doc, o).ok ? (doc as GenSidecar) : null;
}
