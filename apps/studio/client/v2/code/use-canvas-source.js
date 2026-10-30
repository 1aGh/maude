// client/v2/code/use-canvas-source.js — S11.7: what the code view and the broken-canvas card know about
// one canvas's code. The data half; code-view.jsx and canvas-error-card.jsx only draw it.
//
//   GET /_api/canvas-source?canvas=<path>  → { ok, file, source, lines, parsed, artboards, error }  (S11.6)
//   GET /_api/canvas-errors?canvas=<path>  → { canvas, errors: [{ kind, message, file, line, column, lineText }] }
//   POST /_api/project/restore { path, at: '@last-good' }   → Go back to the last good version (S1.13)
//
// Both reads need Export on the canvas, so Can view gets a 403 `read-only`: the code view is then not
// offered at all, and a broken-canvas card still says its one sentence — just without the details.
//
// EVERYTHING in an answer is untrusted text (the file is whatever someone saved; an error message is
// whatever the compiler quoted from it). It is only ever drawn as a React text node and copied as a
// string — never HTML, never evaluated, never a URL.
//
// The pure half (parsing, ranges, excerpts, copy text) is exported for the tests; the two hooks at the
// foot are thin.

import { useEffect, useRef, useState } from 'react';
import { LAST_GOOD, restoreRequest } from '../../../history/surface-requests.ts';
import { splitLines } from './highlight.js';

export const SOURCE_ROUTE = '/_api/canvas-source';
export const ERRORS_ROUTE = '/_api/canvas-errors';

/** The most characters of an error message / source line the card and the AI prompt carry. */
const MAX_TEXT = 600;
/** Lines of source the code view draws; the rest is one "Open in editor" away. */
export const MAX_RENDER_LINES = 5000;

const clip = (s, n = MAX_TEXT) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** `ui/Pricing.tsx` → `Pricing` (a name for words; the file name stays in the mono rows). */
export function canvasTitle(canvas) {
  const base = String(canvas ?? '')
    .split('/')
    .pop();
  return (base || 'This canvas').replace(/\.(tsx|jsx|html?)$/i, '');
}

/** The file name only: `ui/Pricing.tsx` → `Pricing.tsx`. */
export function fileBase(file) {
  return String(file ?? '')
    .split('/')
    .pop();
}

// ── reading the answers ────────────────────────────────────────────────────────────────────────

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** A refused / failed read → a status the UI branches on. 403 `read-only` is the Can view refusal. */
function failure(res, body) {
  if (res.status === 403) {
    const viewOnly = body?.reason === 'read-only' || body?.error === 'read-only';
    return { status: viewOnly ? 'view-only' : 'refused', message: clip(body?.message ?? '') };
  }
  if (res.status === 404) return { status: 'missing' };
  if (res.status === 413) return { status: 'too-large' };
  return { status: 'error' };
}

/**
 * @param {string} canvas  design-root-relative (`ui/Pricing.tsx`)
 * @returns {Promise<{status:'ok', source:string, lines:string[], parsed:boolean, artboards:Record<string,{startLine:number,endLine:number,dynamic?:true}>, error:object|null, file:string}
 *   | {status:'view-only'|'refused'|'missing'|'too-large'|'error', message?:string}>}
 */
export async function fetchCanvasSource(canvas, { fetchImpl = (...a) => fetch(...a) } = {}) {
  try {
    const res = await fetchImpl(`${SOURCE_ROUTE}?canvas=${encodeURIComponent(canvas)}`, {
      cache: 'no-store',
    });
    const body = await readJson(res);
    if (!res.ok || !body || typeof body.source !== 'string') return failure(res, body);
    return {
      status: 'ok',
      file: typeof body.file === 'string' ? body.file : canvas,
      source: body.source,
      lines: splitLines(body.source),
      parsed: body.parsed !== false,
      artboards: body.artboards && typeof body.artboards === 'object' ? body.artboards : {},
      error: normalizeError(body.error),
    };
  } catch {
    return { status: 'error' };
  }
}

/** @returns {Promise<{status:'ok', error:object|null} | {status:'view-only'|'refused'|'missing'|'error'}>} */
export async function fetchCanvasError(canvas, { fetchImpl = (...a) => fetch(...a) } = {}) {
  try {
    const res = await fetchImpl(`${ERRORS_ROUTE}?canvas=${encodeURIComponent(canvas)}`, {
      cache: 'no-store',
    });
    const body = await readJson(res);
    if (!res.ok || !body || !Array.isArray(body.errors)) return failure(res, body);
    return { status: 'ok', error: normalizeError(body.errors[0]) };
  } catch {
    return { status: 'error' };
  }
}

/** A server error → the card's shape (strings clipped, numbers coerced), or null. */
export function normalizeError(e) {
  if (!e || typeof e !== 'object' || typeof e.message !== 'string') return null;
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  return {
    kind: typeof e.kind === 'string' ? e.kind : 'syntax',
    message: clip(e.message),
    file: String(e.file ?? ''),
    line: n(e.line),
    column: n(e.column),
    lineText: clip(e.lineText ?? '', 400),
  };
}

// ── what the code view marks ───────────────────────────────────────────────────────────────────

/**
 * The lines to mark for the selected artboard, or null. `artboards` is the server's source map; a
 * family key (`disc-*`, one entry for every rendered artboard of a template id) marks its range for any
 * id with that prefix.
 */
export function rangeFor(artboards, artboardId) {
  if (!artboards || typeof artboardId !== 'string' || !artboardId) return null;
  const own = Object.hasOwn(artboards, artboardId) ? artboards[artboardId] : null;
  const hit =
    own ??
    Object.entries(artboards).find(
      ([k, v]) => v?.dynamic && k.endsWith('*') && artboardId.startsWith(k.slice(0, -1))
    )?.[1];
  if (!hit || !Number.isInteger(hit.startLine) || !Number.isInteger(hit.endLine)) return null;
  return { start: hit.startLine, end: hit.endLine };
}

// ── what the error card shows ──────────────────────────────────────────────────────────────────

/** "Pricing.tsx · line 212, column 19" (or the bare file name when the engine gave no position). */
export function whereLabel(error) {
  if (!error) return '';
  const file = fileBase(error.file);
  if (!error.line) return file;
  return `${file} · line ${error.line}${error.column ? `, column ${error.column}` : ''}`;
}

/**
 * Lines around the error — two before, one after (210–213 for an error on 212) — the bad one marked and
 * carrying the caret padding that puts a `^` under its column. `lines` is the source (when the viewer may
 * read it); without it the one quoted line stands alone.
 * @returns {{ rows: {n:number, text:string, bad:boolean, caret:string|null}[] } | null}
 */
export function excerptOf(error, lines, before = 2, after = 1) {
  if (!error?.line) return null;
  const at = error.line;
  const caretFor = (text) =>
    error.column > 0
      ? // keep tabs as tabs so the caret lands under the character in a monospace row
        `${Array.from(text.slice(0, error.column - 1), (c) => (c === '\t' ? '\t' : ' ')).join('')}^`
      : null;
  const row = (n, text) => ({ n, text, bad: n === at, caret: n === at ? caretFor(text) : null });
  if (Array.isArray(lines) && lines.length >= at) {
    const from = Math.max(1, at - before);
    const to = Math.min(lines.length, at + after);
    const rows = [];
    for (let n = from; n <= to; n++) rows.push(row(n, clip(lines[n - 1], 400)));
    return { rows };
  }
  if (error.lineText) return { rows: [row(at, error.lineText)] };
  return null;
}

/** What "Copy error" puts on the clipboard: the message, then where. */
export function errorText(error) {
  if (!error) return '';
  return [error.message, whereLabel(error)].filter(Boolean).join('\n');
}

/**
 * What "✦ Ask AI to fix it" drops into the AI chat composer (the person still presses send). Names the
 * canvas and quotes the error as DATA between marks, so the model reads it as a quotation.
 */
export function askAiText({ canvas, error, kind = 'syntax' }) {
  const name = canvasTitle(canvas);
  const head = `${name} can't be drawn right now. Fix it.`;
  if (!error) return head;
  const where = whereLabel(error);
  const what = kind === 'render' ? 'It stopped while drawing' : 'The code has a mistake';
  return `${head} ${what}${where ? ` (${where})` : ''}: “${clip(error.message, 300)}”`;
}

// ── the fold: commands for THIS canvas ─────────────────────────────────────────────────────────

/** A value inside a double-quoted shell word. */
const dq = (s) => `"${String(s).replace(/[\\"$`]/g, '\\$&')}"`;
/** An artboard id as a bare shell word when it is plain, else quoted. */
const word = (s) => (/^[A-Za-z0-9._:-]+$/.test(s) ? s : dq(s));

/**
 * The two groups of the fold. Terminal commands are `maude design …` (the CLI the AI itself uses);
 * Claude Code ones are the slash commands of the design plugin.
 * @returns {{ terminal: string[], claude: string[] }}
 */
export function foldCommands(canvas, artboardId) {
  const rel = String(canvas ?? '');
  return {
    terminal: [
      `maude design screenshot --canvas ${dq(rel)} ${artboardId ? `--screen ${word(artboardId)}` : '--full'}`,
      'maude design export png --scope canvas-as-separate',
      `maude design read-annotations ${dq(rel)}`,
    ],
    claude: ['/design:edit "make the headline bigger"', '/design:critic'],
  };
}

// ── Go back ────────────────────────────────────────────────────────────────────────────────────

const GO_BACK_WORDS = {
  409: 'There is no earlier version that drew cleanly. Every version stays in Version history.',
  403: "This canvas can't be changed from here.",
};

/**
 * Restore the last version this Mac drew without an error (S1.13, `history.go-back`) — a new version, so
 * it can be undone. @returns {{ok:true, line:string}|{ok:false, line:string}}
 */
export async function goBackToLastGood(canvas, { fetchImpl = (...a) => fetch(...a) } = {}) {
  try {
    const rq = restoreRequest({ path: canvas, at: LAST_GOOD });
    const res = await fetchImpl(rq.route, {
      method: rq.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rq.body),
    });
    const body = await readJson(res);
    if (res.ok && body?.ok !== false) {
      return {
        ok: true,
        line: typeof body?.line === 'string' ? clip(body.line, 120) : 'Went back.',
      };
    }
    return {
      ok: false,
      line:
        GO_BACK_WORDS[res.status] ??
        "Couldn't go back just now. The canvas is as it was. Try again.",
    };
  } catch {
    return { ok: false, line: "Couldn't go back just now. The canvas is as it was. Try again." };
  }
}

// ── hooks ──────────────────────────────────────────────────────────────────────────────────────

/** The canvas's source while `enabled`; refetched when `stamp` changes (the file changed). */
export function useCanvasSource({ canvas, enabled = true, stamp, fetchImpl } = {}) {
  const [state, setState] = useState({ status: 'loading' });
  const fetchRef = useRef(fetchImpl);
  fetchRef.current = fetchImpl;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `stamp` is the "the file changed" signal
  useEffect(() => {
    if (!enabled || !canvas) return undefined;
    let cancelled = false;
    setState((s) => (s.status === 'ok' ? s : { status: 'loading' }));
    fetchCanvasSource(canvas, { fetchImpl: fetchRef.current }).then((r) => {
      if (!cancelled) setState(r);
    });
    return () => {
      cancelled = true;
    };
  }, [canvas, enabled, stamp]);
  return state;
}

/** The canvas's current error (or null) while `enabled`. */
export function useCanvasError({ canvas, enabled = true, stamp, fetchImpl } = {}) {
  const [state, setState] = useState({ status: 'loading' });
  const fetchRef = useRef(fetchImpl);
  fetchRef.current = fetchImpl;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `stamp` is the "try again" signal
  useEffect(() => {
    if (!enabled || !canvas) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });
    fetchCanvasError(canvas, { fetchImpl: fetchRef.current }).then((r) => {
      if (!cancelled) setState(r);
    });
    return () => {
      cancelled = true;
    };
  }, [canvas, enabled, stamp]);
  return state;
}

const fin = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * The boards a canvas had when it last drew, as plain boxes — from its `.meta.json` layout (`layout.artboards[]
 * {x, y, width, height}`), which is written when the canvas renders. A box without all four numbers is skipped.
 * 06 `ad-edge-syntax` draws them dimmed behind the card; this is their layout, never a render of them.
 */
export function ghostBoxes(meta) {
  const list = Array.isArray(meta?.layout?.artboards) ? meta.layout.artboards : [];
  return list
    .filter((a) => a && fin(a.x) && fin(a.y) && fin(a.width) && fin(a.height))
    .filter((a) => a.width > 0 && a.height > 0)
    .map((a) => ({ id: String(a.id ?? ''), x: a.x, y: a.y, w: a.width, h: a.height }));
}

/** The last-drawn boards of `canvas` ([] while reading, and when nothing is stored). */
export function useGhostBoxes({ canvas, fetchImpl } = {}) {
  const [boxes, setBoxes] = useState([]);
  const fetchRef = useRef(fetchImpl);
  fetchRef.current = fetchImpl;
  useEffect(() => {
    if (!canvas) return undefined;
    let cancelled = false;
    const f = fetchRef.current ?? globalThis.fetch;
    Promise.resolve()
      .then(() => f(`/_api/canvas-meta?file=${encodeURIComponent(canvas)}`, { cache: 'no-store' }))
      .then((r) => (r?.ok ? r.json() : null))
      .then((meta) => {
        if (!cancelled) setBoxes(ghostBoxes(meta));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canvas]);
  return boxes;
}
