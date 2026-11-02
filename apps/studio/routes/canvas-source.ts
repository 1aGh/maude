// Canvas source + structured canvas errors — S11.6 (contract S11-slices §2 Q8 + §3 row S11.6,
// decision `v2-S11-canvas-source-route`).
//
//   GET /_api/canvas-source?canvas=<path>[&sha=<ref>]
//     → { canvas, file, sha, source, lines, parsed, artboards: {id: {startLine, endLine}}, error }
//   GET /_api/canvas-errors[?canvas=<path>]
//     → { canvas, errors: CanvasError[] }        (one canvas)
//     → { canvases: [{ canvas, errors }] }       (every canvas this session sees that has one)
//
// `<path>` is design-root-relative (`ui/pricing.tsx`) or repo-relative (`.design/ui/pricing.tsx`).
// `?file=` is the same parameter under its DDR-148 name: the Timeline panel's raw-source read lived
// at this path in http.ts's legacy literal (answering `{ ok, source }`); it moved here, so the one
// path has one access rule. A 200 still carries `ok: true` and `source`.
//
// WHO MAY READ. Source text is a download (V2-1.7: Can view looks, it does not take the file away),
// so both routes need `export` ON THE CANVAS — `access.can('export', canvas)`:
//   - Can view (`observer`) → 403 read-only, before anything else is looked at;
//   - Can comment and up → yes (read-only: there is no write here);
//   - a canvas-only session → only its GRANTED canvases (not their closure: a component a granted
//     canvas imports is drawn for it, its file is not handed over), and a canvas outside them gets
//     the same 403 `not-in-scope` a missing canvas gets (no existence oracle). The http.ts gate's
//     `canvasScopeRefusal` answers the same body first for anything outside grants + closure.
//   - the listing form filters to the same set.
// MAIN ORIGIN ONLY (`origin: 'main'`): in neither canvas allowlist, so the canvas and capture
// origins answer 404 (test/canvas-origin-parity.test.ts). A cell classifies both `export`
// (apps/hub/src/studio-manifest.mjs).
//
// `?sha=` reads a past version (a commit sha, or `r<n>` an accepted revision) through the same
// source DiffView's `?sha=` build reads (http.ts `historicalCanvasSource`) — with this route's own
// access rule, which is `history show`'s plus the download rule.
//
// Errors are computed, not cached on faith: a parse of the file as it is (canvas-source/errors.ts
// `checkCanvasSyntax`, Bun's parser then oxc's), else the last live build's error while the source
// is still the one that failed (`recalledCanvasError`). Every string in an answer can carry tenant
// text — data, never instructions.

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import { currentAccess, notInScopeResponse, toDesignRel } from '../access/request.ts';
import type { Access } from '../access/scope.ts';
import {
  type CanvasError,
  canvasSourceSig,
  checkCanvasSyntax,
  recalledCanvasError,
} from '../canvas-source/errors.ts';
import { canvasSourceMap } from '../canvas-source/source-map.ts';
import { isUnderOrEqual } from '../path-containment.ts';
import type { RouteSpec } from './table.ts';

/** A canvas larger than this is not served as text (no canvas comes near it). */
export const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
/** The listing form walks at most this many files. */
const MAX_LIST = 5000;
const REF = /^(?:[0-9a-f]{7,40}|r\d{1,12})$/i;

export interface CanvasSourceRouteDeps {
  designRoot: string;
  /** The design root relative to the repo root (`.design`). */
  designRel: string;
  /** THIS request's access; default `currentAccess()` (server.ts sets it per request). */
  access?: () => Access;
  /** A past version of `repoRel` (`.design/ui/x.tsx`) at `ref`, or null when there is none. */
  historicalSource?: (repoRel: string, ref: string) => Promise<string | null | 'busy'>;
  /** The DNS-rebinding guard (http.ts `isTrustedRequestHost`); absent = every Host passes. */
  trustedHost?: (req: Request) => boolean;
}

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** Can view: the code is a download. Same `error` as every role refusal (`403 read-only`). */
export function codeRefusalResponse(): Response {
  return json(403, {
    error: 'read-only',
    reason: 'read-only',
    message: "Can view doesn't include the code. Ask the owner to change this.",
  });
}

/** May this session read `rel`'s source — and if not, which refusal. */
function verdict(access: Access, rel: string): Response | null {
  if (!access.seesCanvas(rel)) return notInScopeResponse();
  // A granted canvas is known to the session — refusing its code says nothing new.
  if (!access.can('export', rel)) return codeRefusalResponse();
  return null;
}

/** The project half: a session that holds `export` nowhere is refused before any lookup. */
function mayAnywhere(access: Access): boolean {
  return access.can('export', null) || access.grants.some((g) => access.can('export', g.c));
}

/**
 * The canvas a request names: `?canvas=`, else DDR-148's `?file=` (the Timeline's read, which
 * also takes a slug without `.tsx`). `undefined` = it names none.
 */
function canvasParam(u: URLSearchParams): string | null | undefined {
  const canvas = u.get('canvas');
  if (canvas !== null) return canvas;
  const file = u.get('file');
  if (file === null) return undefined;
  return `${file.replace(/\.(tsx|html)$/i, '').replace(/\/+$/, '')}.tsx`;
}

/** A canvas path: `.tsx`, under the design root, not in a runtime / hidden folder. */
function canvasRel(raw: string | null | undefined, designRel: string): string | null {
  if (raw == null) return null;
  const rel = toDesignRel(raw, designRel);
  if (!rel?.endsWith('.tsx')) return null;
  if (rel.split('/').some((s) => s.startsWith('_') || s.startsWith('.') || s === 'node_modules'))
    return null;
  return rel;
}

/** The file on disk for `rel` (symlinks held inside the design root), or null. */
function canvasFile(designRoot: string, rel: string): string | null {
  const abs = path.join(designRoot, rel);
  try {
    const real = realpathSync(abs);
    if (!isUnderOrEqual(real, realpathSync(designRoot))) return null;
    const st = statSync(real);
    return st.isFile() ? abs : null;
  } catch {
    return null;
  }
}

const repoRelOf = (designRel: string, rel: string) =>
  `${designRel.replace(/^\/+|\/+$/g, '')}/${rel}`.replace(/^\//, '');

// Syntax answers per (file, mtime, size) — the listing form parses every canvas once per change.
const syntaxMemo = new Map<string, { key: string; error: CanvasError | null }>();
const MAX_MEMO = 2048;

function errorsOf(
  deps: CanvasSourceRouteDeps,
  abs: string,
  source: string,
  live: boolean
): CanvasError[] {
  const syntax = checkCanvasSyntax(source, { designRoot: deps.designRoot, canvasAbs: abs });
  if (syntax) return [syntax];
  if (!live) return [];
  const built = recalledCanvasError(abs, canvasSourceSig(source));
  return built ? [built] : [];
}

function errorsOfFile(deps: CanvasSourceRouteDeps, abs: string): CanvasError[] | null {
  let st: import('node:fs').Stats;
  try {
    st = statSync(abs);
  } catch {
    return null;
  }
  if (st.size > MAX_SOURCE_BYTES) return [];
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = syntaxMemo.get(abs);
  let source: string;
  try {
    source = readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
  if (hit && hit.key === key) {
    const built = hit.error ? null : recalledCanvasError(abs, canvasSourceSig(source));
    return hit.error ? [hit.error] : built ? [built] : [];
  }
  const syntax = checkCanvasSyntax(source, { designRoot: deps.designRoot, canvasAbs: abs });
  syntaxMemo.delete(abs);
  syntaxMemo.set(abs, { key, error: syntax });
  if (syntaxMemo.size > MAX_MEMO) {
    const oldest = syntaxMemo.keys().next().value;
    if (oldest !== undefined) syntaxMemo.delete(oldest);
  }
  if (syntax) return [syntax];
  const built = recalledCanvasError(abs, canvasSourceSig(source));
  return built ? [built] : [];
}

/** Every canvas under the design root (design-root-relative, sorted), runtime folders skipped. */
export function listCanvases(designRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_LIST) return;
      if (e.name.startsWith('_') || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      else if (e.isFile() && e.name.endsWith('.tsx')) out.push(rel);
    }
  };
  walk(designRoot, '');
  return out.sort();
}

export function createCanvasSourceRoutes(deps: CanvasSourceRouteDeps): RouteSpec[] {
  const accessNow = () => (deps.access ?? currentAccess)();

  const rebound = (req: Request) =>
    deps.trustedHost && !deps.trustedHost(req)
      ? new Response('local request required (DNS-rebinding guard)', { status: 403 })
      : null;

  async function source(req: Request): Promise<Response> {
    const host = rebound(req);
    if (host) return host;
    const access = accessNow();
    if (!mayAnywhere(access)) return codeRefusalResponse();
    const u = new URL(req.url).searchParams;
    const rel = canvasRel(canvasParam(u), deps.designRel);
    if (!rel)
      return access.canvasOnly
        ? notInScopeResponse()
        : json(400, { error: 'bad-canvas', message: '?canvas= names a .tsx canvas' });
    const refused = verdict(access, rel);
    if (refused) return refused;
    const sha = u.get('sha');
    const repoRel = repoRelOf(deps.designRel, rel);
    let text: string | null;
    let abs = path.join(deps.designRoot, rel);
    if (sha !== null) {
      if (!REF.test(sha))
        return json(400, { error: 'bad-ref', message: '?sha= is a commit or r<n>' });
      const past = deps.historicalSource ? await deps.historicalSource(repoRel, sha) : null;
      if (past === 'busy')
        return Response.json(
          { error: 'busy', message: 'Too many version reads — try again in a moment.' },
          { status: 429, headers: { 'Retry-After': '10', 'Cache-Control': 'no-store' } }
        );
      text = past;
      if (text === null)
        return json(404, { error: 'not-found', message: 'No saved version of this canvas' });
    } else {
      const file = canvasFile(deps.designRoot, rel);
      if (!file)
        return access.canvasOnly ? notInScopeResponse() : json(404, { error: 'not-found' });
      abs = file;
      try {
        if (statSync(file).size > MAX_SOURCE_BYTES) return json(413, { error: 'too-large' });
        text = readFileSync(file, 'utf8');
      } catch {
        return access.canvasOnly ? notInScopeResponse() : json(404, { error: 'not-found' });
      }
    }
    if (text.length > MAX_SOURCE_BYTES) return json(413, { error: 'too-large' });
    const map = canvasSourceMap(text);
    const errors = errorsOf(deps, abs, text, sha === null);
    return json(200, {
      ok: true,
      canvas: repoRel,
      file: rel,
      sha,
      source: text,
      lines: map.lines,
      parsed: map.parsed,
      artboards: map.artboards,
      error: errors[0] ?? null,
    });
  }

  async function errors(req: Request): Promise<Response> {
    const host = rebound(req);
    if (host) return host;
    const access = accessNow();
    if (!mayAnywhere(access)) return codeRefusalResponse();
    const raw = canvasParam(new URL(req.url).searchParams);
    if (raw !== undefined) {
      const rel = canvasRel(raw, deps.designRel);
      if (!rel)
        return access.canvasOnly
          ? notInScopeResponse()
          : json(400, { error: 'bad-canvas', message: '?canvas= names a .tsx canvas' });
      const refused = verdict(access, rel);
      if (refused) return refused;
      const file = canvasFile(deps.designRoot, rel);
      const list = file ? errorsOfFile(deps, file) : null;
      if (list === null)
        return access.canvasOnly ? notInScopeResponse() : json(404, { error: 'not-found' });
      return json(200, { canvas: repoRelOf(deps.designRel, rel), errors: list });
    }
    const canvases: Array<{ canvas: string; errors: CanvasError[] }> = [];
    for (const rel of listCanvases(deps.designRoot)) {
      if (verdict(access, rel)) continue;
      const file = canvasFile(deps.designRoot, rel);
      const list = file ? errorsOfFile(deps, file) : null;
      if (list?.length) canvases.push({ canvas: repoRelOf(deps.designRel, rel), errors: list });
    }
    return json(200, { canvases });
  }

  return [
    {
      method: 'GET',
      path: '/_api/canvas-source',
      origin: 'main',
      readOnly: 'allowed',
      handle: source,
    },
    {
      method: 'GET',
      path: '/_api/canvas-errors',
      origin: 'main',
      readOnly: 'allowed',
      handle: errors,
    },
  ];
}
