/**
 * @file       annotations/figjam-into.ts — S4.16: the request and the ops of `POST /_api/annotations/figjam`
 * @scope      apps/studio/annotations/figjam-into.ts
 * @purpose    Canvas 15 an-figjam: a FigJam link arrives as ONE section of annotations in the canvas that is
 *             open, then a toast "46 items from FigJam arrived as annotations" with Undo. The route
 *             (routes/annotations.ts) plans the import with the S4.5 engine (`bin/_import-figma.mjs`
 *             `planBoardInto`) and applies the ops as one board change; THIS module is the part that decides
 *             what it is willing to apply, with no I/O:
 *               - `parseFigjamBody`  — the request, validated (a link to a board, a canvas, an optional place)
 *               - `guardFigjamOps`   — the planned ops, checked again before they touch the board
 *               - `arrivalLine`      — the one sentence the toast says (code-owned, never upstream text)
 * @invariant  FIGJAM CONTENT IS UNTRUSTED INPUT (DDR-216, DDR-054). The engine already maps it through the
 *             registry; this guard is the second wall, so an engine bug cannot put anything on the board that
 *             a hostile board could not have put there anyway: only `put` of new, `fj`-minted ids stamped
 *             `source: figjam`; no more than `FIGJAM_MAX_ITEMS`; no record over `FIGJAM_MAX_ITEM_BYTES`; a
 *             picture only by a stored `assets/…` path; and no value outside the WORD fields (text, label, names;
 *             rendered as text nodes, so they may say anything) that is markup, a script URL or an event handler. The words it answers with name counts, never what the board said.
 */

import { MAX_ELEMENTS } from './constants.ts';
import type { Op } from './ops.ts';

/** A FigJam board is capped well under the board's own limit: it is one section, not a project. */
export const FIGJAM_MAX_ITEMS = Math.min(2_000, MAX_ELEMENTS);
/** Serialized bytes of one imported record (the registry allows more; a pasted board has no business needing it). */
export const FIGJAM_MAX_ITEM_BYTES = 64 * 1024;
export const FIGJAM_MAX_URL = 2_048;
/** World coordinates the section may be asked to land at. */
const MAX_COORD = 10_000_000;

export interface FigjamRequest {
  /** The canvas, as the studio names it (repo-relative or design-relative). */
  file: string;
  /** The pasted link, not yet parsed (figma/url.ts is the parser and the host gate). */
  url: string;
  at?: { x: number; y: number };
  confirmLarge: boolean;
}

export type FigjamBody =
  | { ok: true; req: FigjamRequest }
  | { ok: false; status: 400; reason: 'bad-file' | 'bad-url' | 'bad-place' };

const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_COORD;

/** The request body, strictly: unknown keys are ignored, wrong types are refused. */
export function parseFigjamBody(body: Record<string, unknown>): FigjamBody {
  const { file, url, at, confirmLarge } = body;
  if (typeof file !== 'string' || !file || file.length > 1024 || file.includes('\0'))
    return { ok: false, status: 400, reason: 'bad-file' };
  if (typeof url !== 'string' || !url || url.length > FIGJAM_MAX_URL || /[\0\r\n]/.test(url))
    return { ok: false, status: 400, reason: 'bad-url' };
  let place: { x: number; y: number } | undefined;
  if (at !== undefined) {
    const p = at as { x?: unknown; y?: unknown } | null;
    if (!p || typeof p !== 'object' || !finite(p.x) || !finite(p.y))
      return { ok: false, status: 400, reason: 'bad-place' };
    place = { x: p.x, y: p.y };
  }
  return {
    ok: true,
    req: { file, url, ...(place ? { at: place } : {}), confirmLarge: confirmLarge === true },
  };
}

export type FigjamGuard =
  | { ok: true; items: number }
  | {
      ok: false;
      reason: 'empty' | 'too-many' | 'not-put' | 'bad-id' | 'bad-source' | 'too-big' | 'unsafe';
    };

/** A picture's only legal address: a content-addressed file under the design root's `assets/`. */
const ASSET_HREF = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** Ids the engine mints (`fj<tag>_<old>`), bounded the way fields.ts bounds every id. */
const MINTED_ID = /^fj[a-z0-9]{3,8}_[A-Za-z0-9_.:-]{1,52}$/;
/** What is not allowed to appear in ANY string of an imported record. */
const HOSTILE =
  /<\s*\/?\s*(?:script|iframe|object|embed|svg|style|link|meta|img)\b|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|\bon[a-z]{3,}\s*=|<!\[CDATA\[/i;

/** Fields that are WORDS: rendered as text nodes (inert), so a board that talks about `<script>` may say so. */
const WORD_KEYS = new Set(['text', 'label', 'alt', 'name', 'author', 'by']);

function unsafeValue(v: unknown, key = '', depth = 0): boolean {
  if (depth > 8) return true;
  if (typeof v === 'string') return !WORD_KEYS.has(key) && HOSTILE.test(v);
  if (Array.isArray(v)) return v.some((x) => unsafeValue(x, key, depth + 1));
  if (v && typeof v === 'object')
    return Object.entries(v).some(([k, x]) => HOSTILE.test(k) || unsafeValue(x, k, depth + 1));
  return false;
}

/**
 * The planned ops, checked before they reach the board. `existing` is every id already there, so a plan can
 * never overwrite an element that is not its own.
 */
export function guardFigjamOps(ops: readonly Op[], existing: ReadonlySet<string>): FigjamGuard {
  if (!ops.length) return { ok: false, reason: 'empty' };
  if (ops.length > FIGJAM_MAX_ITEMS + 1) return { ok: false, reason: 'too-many' };
  for (const op of ops) {
    if (op.op !== 'put') return { ok: false, reason: 'not-put' };
    const el = op.el as Record<string, unknown>;
    const id = typeof el.id === 'string' ? el.id : '';
    if (!MINTED_ID.test(id) || existing.has(id)) return { ok: false, reason: 'bad-id' };
    const src = el.source as { kind?: unknown } | undefined;
    if (!src || typeof src !== 'object' || src.kind !== 'figjam')
      return { ok: false, reason: 'bad-source' };
    if (JSON.stringify(el).length > FIGJAM_MAX_ITEM_BYTES) return { ok: false, reason: 'too-big' };
    if (typeof el.href === 'string' && el.href !== '' && !ASSET_HREF.test(el.href))
      return { ok: false, reason: 'unsafe' };
    if (unsafeValue(el)) return { ok: false, reason: 'unsafe' };
  }
  return { ok: true, items: ops.length - 1 };
}

/** The toast's sentence (canvas 15 an-figjam): counts only. The section itself is not counted. */
export const arrivalLine = (n: number): string =>
  `${n} ${n === 1 ? 'item' : 'items'} from FigJam arrived as annotations`;
