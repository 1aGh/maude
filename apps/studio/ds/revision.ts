// Design-system revisions — V2-1.6 §5.6. A revision freezes a system's working files
// (`colors_and_type.css`, `components.json`, `preview/_components.css`, `tokens.json`) into one
// immutable, content-addressed `revisions/<id>.json`, with two deterministic CSS siblings the
// canvas origin can serve. Pure: no filesystem access — callers pass bytes and a reader, and the
// DS engine (S10.2) does the tmp + rename writes in the order `revisionWritePlan` returns.
//
// A hub- or peer-supplied revision is untrusted (DDR-054). `verifyRevision` is what makes it safe
// to render: it grants no new capability (the same peer could push the live CSS), it only proves
// the bytes are the ones the id names.

import { createHash } from 'node:crypto';

export const REVISION_FORMAT = 'maude.ds-revision';
export const REVISION_V = 1;
/** ≤ 2 MiB per revision file (the `TOKENS_MAX_BYTES` precedent, §5.18). */
export const REVISION_MAX_BYTES = 2 * 1024 * 1024;
/** the components sibling's source, relative to `<ds.path>` */
export const COMPONENTS_CSS_KEY = 'preview/_components.css';
export const DEFAULT_TOKENS_KEY = 'colors_and_type.css';

const ID_RE = /^[0-9a-f]{64}$/;
const SYSTEM_RE = /^[a-z][a-z0-9-]{0,63}$/;
// Same pattern as ds-revision-v1.schema.json `files` — relative, no `..`, no leading `/`.
const FILE_KEY_RE = /^(?!\/)(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9 ._/-]{0,255}$/;

export interface RevisionFile {
  sha256: string;
  text: string;
}

export interface RevisionBody {
  files: Record<string, RevisionFile>;
  format: typeof REVISION_FORMAT;
  schemaVersion: 1;
  system: string;
  v: 1;
}

export interface BuiltRevision {
  id: string;
  body: RevisionBody;
  /** the on-disk bytes of `revisions/<id>.json` */
  bytes: string;
}

export type RevisionErrorCode = 'ds-revision-too-large' | 'ds-revision-invalid';

export class DsRevisionError extends Error {
  readonly code: RevisionErrorCode;
  readonly status: number;
  constructor(code: RevisionErrorCode, message: string) {
    super(message);
    this.name = 'DsRevisionError';
    this.code = code;
    this.status = code === 'ds-revision-too-large' ? 413 : 422;
  }
}

/**
 * The §5.6 canonical form: object keys sorted by UTF-16 code unit at every depth (the default
 * `Array.prototype.sort` order), no whitespace, strings and numbers exactly as `JSON.stringify`
 * writes them, arrays in order. A value JSON can't represent is refused, never dropped.
 */
export function canonicalJson(v: unknown): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string':
    case 'boolean':
      return JSON.stringify(v);
    case 'number':
      if (!Number.isFinite(v)) throw new TypeError('canonicalJson: a non-finite number');
      return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: a ${typeof v} is not JSON`);
  }
}

/** lowercase hex sha256 of the UTF-8 bytes of `text` */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

/** id = sha256(UTF-8(canonical(body))) */
export function revisionId(body: unknown): string {
  return sha256Hex(canonicalJson(body));
}

/** `o[k] = v` that a `__proto__` key can't turn into a prototype change. */
function setOwn(o: Record<string, unknown>, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort())
      setOwn(out, k, sortDeep((v as Record<string, unknown>)[k]));
    return out;
  }
  return v;
}

/** On-disk bytes: the same sorted keys, 2-space indent, LF, one trailing newline. */
export function serializeRevision(body: RevisionBody): string {
  return `${JSON.stringify(sortDeep(body), null, 2)}\n`;
}

/** Freeze `files` (keys relative to `<ds.path>`) into a revision. Throws `DsRevisionError`. */
export function buildRevision(system: string, files: Record<string, string>): BuiltRevision {
  if (!SYSTEM_RE.test(system))
    throw new DsRevisionError('ds-revision-invalid', `not a system name: ${system.slice(0, 80)}`);
  const keys = Object.keys(files).sort();
  if (!keys.length) throw new DsRevisionError('ds-revision-invalid', 'a revision needs a file');
  const out: Record<string, RevisionFile> = {};
  for (const k of keys) {
    if (!FILE_KEY_RE.test(k))
      throw new DsRevisionError(
        'ds-revision-invalid',
        `not a revision file key: ${k.slice(0, 80)}`
      );
    const text = files[k];
    if (typeof text !== 'string')
      throw new DsRevisionError('ds-revision-invalid', `${k}: a revision file is text`);
    setOwn(out, k, { sha256: sha256Hex(text), text });
  }
  const body: RevisionBody = {
    files: out,
    format: REVISION_FORMAT,
    schemaVersion: 1,
    system,
    v: REVISION_V,
  };
  const bytes = serializeRevision(body);
  const size = Buffer.byteLength(bytes, 'utf8');
  if (size > REVISION_MAX_BYTES)
    throw new DsRevisionError(
      'ds-revision-too-large',
      `this revision is ${size} bytes; the limit is ${REVISION_MAX_BYTES}`
    );
  return { id: revisionId(body), body, bytes };
}

export type VerifyResult =
  | { ok: true; body: RevisionBody }
  | { ok: false; reason: 'invalid' | 'unreadable'; detail: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** The ds-revision-v1 schema, checked structurally (no Ajv at runtime). */
function shapeError(doc: Record<string, unknown>): string | null {
  const allowed = new Set(['files', 'format', 'schemaVersion', 'system', 'v']);
  for (const k of Object.keys(doc)) if (!allowed.has(k)) return `unknown key ${k.slice(0, 40)}`;
  if (doc.schemaVersion !== 1) return 'schemaVersion is not 1';
  if (typeof doc.system !== 'string' || !SYSTEM_RE.test(doc.system)) return 'bad system';
  if (!isObj(doc.files)) return 'files is not an object';
  const entries = Object.entries(doc.files);
  if (!entries.length) return 'files is empty';
  for (const [k, f] of entries) {
    if (!FILE_KEY_RE.test(k)) return `bad file key ${k.slice(0, 40)}`;
    if (!isObj(f)) return `${k.slice(0, 40)} is not an entry`;
    for (const fk of Object.keys(f))
      if (fk !== 'sha256' && fk !== 'text') return `${k.slice(0, 40)}: unknown key`;
    if (typeof f.sha256 !== 'string' || !ID_RE.test(f.sha256)) return `${k.slice(0, 40)}: sha256`;
    if (typeof f.text !== 'string') return `${k.slice(0, 40)}: text`;
  }
  return null;
}

/**
 * Integrity, for every reader every time (§5.6): the id names the canonical body, and every file
 * entry's sha256 names its text. An invalid revision is never rendered and never repaired; an
 * unknown `v` is unreadable (the caller falls back, §5.8).
 */
export function verifyRevision(id: string, fileText: string): VerifyResult {
  const bad = (detail: string): VerifyResult => ({ ok: false, reason: 'invalid', detail });
  if (typeof id !== 'string' || !ID_RE.test(id)) return bad('the file name is not a revision id');
  if (typeof fileText !== 'string') return bad('not text');
  if (Buffer.byteLength(fileText, 'utf8') > REVISION_MAX_BYTES) return bad('over 2 MiB');
  let doc: unknown;
  try {
    doc = JSON.parse(fileText);
  } catch {
    return bad('not JSON');
  }
  if (!isObj(doc)) return bad('not an object');
  if (doc.format !== REVISION_FORMAT) return bad('not a maude.ds-revision');
  if (doc.v !== REVISION_V) {
    if (typeof doc.v === 'number' && Number.isInteger(doc.v) && doc.v > REVISION_V)
      return { ok: false, reason: 'unreadable', detail: `revision format v${doc.v}` };
    return bad('bad v');
  }
  const shape = shapeError(doc);
  if (shape) return bad(shape);
  let canonId: string;
  try {
    canonId = revisionId(doc);
  } catch {
    return bad('not canonical JSON');
  }
  if (canonId !== id) return bad('the content does not match its id');
  for (const [k, f] of Object.entries(doc.files as Record<string, RevisionFile>))
    if (sha256Hex(f.text) !== f.sha256) return bad(`${k.slice(0, 40)}: text does not match sha256`);
  return { ok: true, body: doc as unknown as RevisionBody };
}

export interface RevisionWrite {
  /** relative to `<ds.path>` */
  path: string;
  text: string;
}

/**
 * The deterministic siblings (never authoritative): `<id>.tokens.css` = the tokens entry's text,
 * `<id>.components.css` = `preview/_components.css`'s text. A file absent from the revision has
 * no sibling.
 */
export function revisionSiblings(
  id: string,
  body: RevisionBody,
  tokensKey: string = DEFAULT_TOKENS_KEY
): RevisionWrite[] {
  const out: RevisionWrite[] = [];
  const tokens = body.files[tokensKey];
  if (tokens) out.push({ path: `revisions/${id}.tokens.css`, text: tokens.text });
  const comps = body.files[COMPONENTS_CSS_KEY];
  if (comps) out.push({ path: `revisions/${id}.components.css`, text: comps.text });
  return out;
}

/**
 * What a publish of `rev` must write, in the §5.6 order — `<id>.json`, the siblings, the working
 * files — skipping every file whose bytes are already right, so an empty publish writes nothing.
 * `head.json` is the engine's, written last (§5.7). `read(rel)` returns a file's current text
 * (relative to `<ds.path>`) or null. A revision file is never rewritten: a valid one under the id
 * is kept whatever its formatting; an invalid one refuses (never repaired).
 */
export function revisionWritePlan(
  read: (rel: string) => string | null,
  rev: BuiltRevision,
  working: Record<string, string>,
  tokensKey: string = DEFAULT_TOKENS_KEY
): RevisionWrite[] {
  const out: RevisionWrite[] = [];
  const revPath = `revisions/${rev.id}.json`;
  const existing = read(revPath);
  if (existing === null) out.push({ path: revPath, text: rev.bytes });
  else if (existing !== rev.bytes) {
    const v = verifyRevision(rev.id, existing);
    if (!v.ok)
      throw new DsRevisionError(
        'ds-revision-invalid',
        `${revPath} exists and is invalid (${v.detail}); it is never repaired`
      );
  }
  for (const s of revisionSiblings(rev.id, rev.body, tokensKey))
    if (read(s.path) !== s.text) out.push(s);
  for (const k of Object.keys(working).sort())
    if (read(k) !== working[k]) out.push({ path: k, text: working[k] });
  return out;
}
