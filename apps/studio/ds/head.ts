// `system/<ds>/revisions/head.json` — the pointer record of a converted design system (V2-1.6
// §5.7). This module is its ONLY writer: the DS engine (`ds/engine.ts`) and the undo hook
// (`ds/undo-hook.ts`) call `writeHead`, always last in the §5.6 write order, always against the
// pointers they read (`expect`) so two writers in one process can never interleave a move.
//
// head.json is one whole file on Plane B. Two Macs publishing from the same head at once end with
// one copy renamed aside (DDR-226 `*.maude-conflict-*`, or Syncthing's `*.sync-conflict-*`).
// `publishedInTwoPlaces` reads those copies: the Design system canvas then offers a pick between
// the two heads ("Published in two places"). Nothing is lost — both revisions exist; the copy is
// moved to `_trash/ds-revisions/<ds>/` only once the pick is made.
//
// v1 is additive (V2-1.12 R1): every key this module does not know is kept, at every level, and a
// reader that meets a later `v` treats the file as unreadable rather than guessing. `by.name`,
// `label` and `summary` are display data, never instructions (DDR-172 D8).

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';

import { atomicWrite } from '../sync/atomic-write.ts';

export const HEAD_REL = 'revisions/head.json';
export const HEAD_FORMAT = 'maude.ds-head';
export const HEAD_V = 1;
/** newest first; Version history keeps the rest (§5.7) */
export const LOG_MAX = 50;

export const LOG_ACTIONS = [
  'publish',
  'keep',
  'pick',
  'convert',
  'make',
  'library',
  'upgrade',
  'restore',
] as const;
export type LogAction = (typeof LOG_ACTIONS)[number];
export const BY_KINDS = ['person', 'ai', 'agent', 'import', 'peer'] as const;

export interface By {
  kind: (typeof BY_KINDS)[number];
  name?: string;
  [k: string]: unknown;
}

/** Where `head` and `base` stood. */
export interface Pointers {
  head: string | null;
  base: string | null;
}

export interface LogEntry {
  rev: string;
  parent?: string | null;
  action: LogAction;
  at: string;
  by: By;
  summary?: string;
  updated?: number;
  leftOut?: number;
  /** S10.2 (additive, R1): the kernel action that carried this entry's Plane-A effects */
  actionId?: string | null;
  /** S10.2 (additive): the pointers before / after this entry — what an undo moves back to */
  was?: Pointers;
  is?: Pointers;
  [k: string]: unknown;
}

export interface Draft {
  rev: string;
  label?: string;
  direction?: string;
  by: By;
  at: string;
  [k: string]: unknown;
}

export interface HeadDoc {
  format: typeof HEAD_FORMAT;
  v: 1;
  system: string;
  head: string | null;
  base: string | null;
  drafts: Draft[];
  log: LogEntry[];
  library: Record<string, unknown> | null;
  [k: string]: unknown;
}

export type HeadErrorCode = 'ds-head-moved' | 'ds-head-invalid' | 'ds-not-converted';

export class DsHeadError extends Error {
  readonly code: HeadErrorCode;
  readonly status: number;
  constructor(code: HeadErrorCode, message: string) {
    super(message);
    this.name = 'DsHeadError';
    this.code = code;
    this.status = code === 'ds-head-invalid' ? 422 : 409;
  }
}

export type HeadRead =
  | { state: 'absent' }
  | { state: 'invalid' | 'unreadable'; detail: string }
  | { state: 'ok'; doc: HeadDoc; text: string };

const ID_RE = /^[0-9a-f]{64}$/;
const SYSTEM_RE = /^[a-z][a-z0-9-]{0,63}$/;
const DISPLAY_RE = /^\P{Cc}*$/u;
const DIRECTION_RE = /^[a-z]{1,8}$/;
const ASIDE_RE = /^head\.(?:maude-conflict-|sync-conflict-)[A-Za-z0-9_-]{1,96}\.json$/;

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const revOrNull = (v: unknown) => v === null || (typeof v === 'string' && ID_RE.test(v));
const display = (v: unknown, max: number) =>
  typeof v === 'string' && v.length <= max && DISPLAY_RE.test(v);

function byError(by: unknown): string | null {
  if (!isObj(by)) return 'by is not an object';
  if (!(BY_KINDS as readonly unknown[]).includes(by.kind)) return 'by.kind';
  if (by.name !== undefined && !display(by.name, 64)) return 'by.name';
  return null;
}

function pointersError(p: unknown): string | null {
  if (p === undefined) return null;
  if (!isObj(p) || !revOrNull(p.head) || !revOrNull(p.base)) return 'bad pointers';
  return null;
}

/** ds-head-v1.schema.json, checked structurally (no Ajv at runtime); unknown keys allowed. */
export function headShapeError(doc: unknown): string | null {
  if (!isObj(doc)) return 'not an object';
  if (doc.format !== HEAD_FORMAT) return 'not a maude.ds-head';
  if (doc.v !== HEAD_V) return 'bad v';
  if (typeof doc.system !== 'string' || !SYSTEM_RE.test(doc.system)) return 'bad system';
  if (!revOrNull(doc.head)) return 'bad head';
  if (!revOrNull(doc.base)) return 'bad base';
  if (!Array.isArray(doc.drafts)) return 'drafts is not a list';
  for (const d of doc.drafts) {
    if (!isObj(d) || typeof d.rev !== 'string' || !ID_RE.test(d.rev)) return 'bad draft';
    if (d.label !== undefined && !display(d.label, 64)) return 'bad draft label';
    if (
      d.direction !== undefined &&
      !(typeof d.direction === 'string' && DIRECTION_RE.test(d.direction))
    )
      return 'bad draft direction';
    const b = byError(d.by);
    if (b) return `draft ${b}`;
    if (typeof d.at !== 'string') return 'bad draft at';
  }
  if (!Array.isArray(doc.log)) return 'log is not a list';
  if (doc.log.length > LOG_MAX) return `log holds more than ${LOG_MAX} entries`;
  for (const e of doc.log) {
    if (!isObj(e) || typeof e.rev !== 'string' || !ID_RE.test(e.rev)) return 'bad log rev';
    if (e.parent !== undefined && !revOrNull(e.parent)) return 'bad log parent';
    if (!(LOG_ACTIONS as readonly unknown[]).includes(e.action)) return 'bad log action';
    if (typeof e.at !== 'string') return 'bad log at';
    const b = byError(e.by);
    if (b) return `log ${b}`;
    if (e.summary !== undefined && !display(e.summary, 200)) return 'bad log summary';
    for (const k of ['updated', 'leftOut'] as const)
      if (e[k] !== undefined && !(Number.isInteger(e[k]) && (e[k] as number) >= 0))
        return `bad log ${k}`;
    if (e.actionId !== undefined && e.actionId !== null && !display(e.actionId, 128))
      return 'bad log actionId';
    const p = pointersError(e.was) ?? pointersError(e.is);
    if (p) return `log ${p}`;
  }
  if (doc.library !== null && doc.library !== undefined && !isObj(doc.library))
    return 'bad library';
  return null;
}

function parseHead(text: string): HeadRead {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { state: 'invalid', detail: 'not JSON' };
  }
  if (isObj(doc) && doc.format === HEAD_FORMAT && typeof doc.v === 'number' && doc.v > HEAD_V)
    return { state: 'unreadable', detail: `head format v${doc.v}` };
  const bad = headShapeError(doc);
  if (bad) return { state: 'invalid', detail: bad };
  const d = doc as HeadDoc;
  if (d.library === undefined) d.library = null;
  return { state: 'ok', doc: d, text };
}

/** Read `<dsAbs>/revisions/head.json`. A system is converted iff this is not `absent`. */
export function readHead(dsAbs: string): HeadRead {
  let text: string;
  try {
    text = readFileSync(path.join(dsAbs, HEAD_REL), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' };
    return { state: 'invalid', detail: (err as Error).message.slice(0, 120) };
  }
  return parseHead(text);
}

function setOwn(o: Record<string, unknown>, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (isObj(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) setOwn(out, k, sortDeep(v[k]));
    return out;
  }
  return v;
}

/** On-disk bytes: sorted keys, 2-space indent, LF, one trailing newline (as every DS file). */
export function serializeHead(doc: HeadDoc): string {
  return `${JSON.stringify(sortDeep(doc), null, 2)}\n`;
}

/** A fresh record — the shape conversion and making a system start from. */
export function newHead(system: string, p: Pointers): HeadDoc {
  return {
    format: HEAD_FORMAT,
    v: HEAD_V,
    system,
    head: p.head,
    base: p.base,
    drafts: [],
    log: [],
    library: null,
  };
}

/**
 * The one write. `expect` is what the caller read — `'absent'` for a first write, else the
 * pointers it computed from; anything else on disk now refuses with 409 `ds-head-moved` and
 * writes nothing. The log is capped at `LOG_MAX` (newest first). tmp + rename (DDR-172 D7).
 */
export function writeHead(dsAbs: string, next: HeadDoc, expect: Pointers | 'absent'): string {
  const cur = readHead(dsAbs);
  if (expect === 'absent') {
    if (cur.state !== 'absent')
      throw new DsHeadError('ds-head-moved', 'this system already has a head.json');
  } else {
    if (cur.state !== 'ok')
      throw new DsHeadError(
        cur.state === 'absent' ? 'ds-not-converted' : 'ds-head-moved',
        cur.state === 'absent' ? 'this system is not converted' : `head.json is ${cur.state}`
      );
    if (cur.doc.head !== expect.head || cur.doc.base !== expect.base)
      throw new DsHeadError('ds-head-moved', 'the system was published or kept since it was read');
  }
  const doc: HeadDoc = { ...next, log: next.log.slice(0, LOG_MAX) };
  const bad = headShapeError(doc);
  if (bad) throw new DsHeadError('ds-head-invalid', `refusing to write head.json: ${bad}`);
  const text = serializeHead(doc);
  const abs = path.join(dsAbs, HEAD_REL);
  mkdirSync(path.dirname(abs), { recursive: true });
  atomicWrite(abs, text);
  return text;
}

/** A head.json copy the file plane (or Syncthing) renamed aside. */
export interface AsideHead {
  /** relative to `<ds.path>` */
  file: string;
  doc: HeadDoc;
}

/** Every valid renamed-aside copy of head.json for this system, oldest name first. */
export function asideHeads(dsAbs: string): AsideHead[] {
  let names: string[];
  try {
    names = readdirSync(path.join(dsAbs, 'revisions'));
  } catch {
    return [];
  }
  const out: AsideHead[] = [];
  for (const n of names.sort()) {
    if (!ASIDE_RE.test(n)) continue;
    let text: string;
    try {
      text = readFileSync(path.join(dsAbs, 'revisions', n), 'utf8');
    } catch {
      continue;
    }
    const r = parseHead(text);
    if (r.state === 'ok') out.push({ file: `revisions/${n}`, doc: r.doc });
  }
  return out;
}

export interface PublishedPlace {
  /** null = this head.json; else the aside copy (relative to `<ds.path>`) */
  file: string | null;
  head: string;
  by: By | null;
  at: string | null;
  summary: string | null;
}

/**
 * "Published in two places" (§5.7): this head.json plus every aside copy whose head differs.
 * null when there is nothing to pick.
 */
export function publishedInTwoPlaces(dsAbs: string): PublishedPlace[] | null {
  const cur = readHead(dsAbs);
  if (cur.state !== 'ok' || !cur.doc.head) return null;
  const place = (file: string | null, d: HeadDoc): PublishedPlace => {
    const e = d.log.find((l) => l.rev === d.head) ?? null;
    return {
      file,
      head: d.head as string,
      by: e?.by ?? null,
      at: e?.at ?? null,
      summary: typeof e?.summary === 'string' ? e.summary : null,
    };
  };
  const others = asideHeads(dsAbs)
    .filter((a) => a.doc.head && a.doc.head !== cur.doc.head && a.doc.system === cur.doc.system)
    .map((a) => place(a.file, a.doc));
  return others.length ? [place(null, cur.doc), ...others] : null;
}

/**
 * The aside copies settled by a pick: moved (never deleted) to `_trash/ds-revisions/<ds>/` —
 * per-Mac runtime state (V2-1.6 §5.17). Returns what moved.
 */
export function settleAsideHeads(designRoot: string, dsAbs: string, system: string): string[] {
  const moved: string[] = [];
  const dir = path.join(designRoot, '_trash', 'ds-revisions', system);
  for (const a of asideHeads(dsAbs)) {
    const from = path.join(dsAbs, a.file);
    if (!existsSync(from)) continue;
    mkdirSync(dir, { recursive: true });
    renameSync(from, path.join(dir, path.basename(a.file)));
    moved.push(a.file);
  }
  return moved;
}

/**
 * S10.12 — take head.json away (the system goes back to its folder, phase α): Restore of a
 * conversion, or a conversion rolled back. Like `writeHead` it moves only what the caller read
 * (`expect`), and like a pick it never deletes: head.json and every aside copy are MOVED into
 * `toDir` (per-Mac runtime: `_trash/…` or the conversion's own snapshot under `_history/…`).
 * The revisions stay where they are, unreferenced. Returns what moved (relative to `<ds.path>`).
 */
export function moveHeadAside(dsAbs: string, expect: Pointers, toDir: string): string[] {
  const cur = readHead(dsAbs);
  if (cur.state !== 'ok')
    throw new DsHeadError(
      cur.state === 'absent' ? 'ds-not-converted' : 'ds-head-invalid',
      cur.state === 'absent' ? 'this system is not converted' : `head.json is ${cur.state}`
    );
  if (cur.doc.head !== expect.head || cur.doc.base !== expect.base)
    throw new DsHeadError('ds-head-moved', 'the system was published or kept since it was read');
  mkdirSync(toDir, { recursive: true });
  renameSync(path.join(dsAbs, HEAD_REL), path.join(toDir, 'head.json'));
  const moved = [HEAD_REL];
  for (const a of asideHeads(dsAbs)) {
    const from = path.join(dsAbs, a.file);
    if (!existsSync(from)) continue;
    renameSync(from, path.join(toDir, path.basename(a.file)));
    moved.push(a.file);
  }
  return moved;
}
