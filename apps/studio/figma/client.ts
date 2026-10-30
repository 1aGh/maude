/**
 * @file       figma/client.ts — the Figma REST client (DDR-216 D2/D4/D5).
 * @scope      apps/studio/figma/client.ts
 * @purpose    Fetch a document, its nodes, its rendered images and its styles —
 *             and nothing else. Produces the normalized tree in `types.ts`.
 *
 * @invariant  SSRF CHOKEPOINT 1 — every request URL is composed from the
 *             hardcoded `API_BASE` below plus values already charset-validated
 *             by `url.ts`, each `encodeURIComponent`-ed. **No caller-supplied
 *             host, scheme, port or path prefix ever reaches a request.** This
 *             is the closure Round 1 of the DDR-216 security review attacked
 *             directly and could not break; if you are adding a method, compose
 *             it the same way rather than accepting a URL.
 *
 * @invariant  THE TOKEN IS RESOLVED AT REQUEST TIME AND NEVER CACHED, LOGGED,
 *             OR RETURNED. `getProviderKey('figma')` is called inside the
 *             request that needs it. Errors are built from code-owned strings
 *             and the request PATH — never headers, never a raw response body
 *             (DDR-216 D2 + D10; `figma-routes.test.ts` asserts it).
 *
 * @invariant  Figma's `/v1/images` answers with URLs Maude did not choose. This
 *             module returns them; it NEVER downloads one. That goes through
 *             `_fetch-asset.mjs`'s gate (DDR-216 D4 chokepoint 2 / D11).
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { getProviderKey } from '../generation/keys.ts';
import {
  FigmaCapError,
  MAX_RESPONSE_BYTES,
  type NormalizedDocument,
  normalizeDocument,
} from './types.ts';

/** The ONLY base. Never derived from input, never overridable at runtime. */
const API_BASE = 'https://api.figma.com/v1';

/** Whole-request budget. A slow file is a failure, not an indefinite hang. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Bounded 429 backoff (DDR-216 D5) — never an unbounded sleep loop. */
const MAX_RETRIES = 3;
const MAX_BACKOFF_TOTAL_MS = 30_000;
/** Per-retry ceiling — 3 × this stays inside the total budget above. */
const MAX_SINGLE_BACKOFF_MS = 10_000;

/**
 * `IMAGE_COST = 200` ⇒ ~30 req/min. Batch ids into as few calls as the endpoint
 * allows; never one call per node (DDR-216 D5).
 */
export const MAX_IMAGE_BATCH = 100;

export type FigmaErrorKind =
  | 'not_configured'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'too_large'
  | 'network'
  | 'bad_response';

export class FigmaApiError extends Error {
  readonly kind: FigmaErrorKind;
  readonly status?: number;
  /** The request PATH only — never the query, never a header, never a body. */
  readonly path: string;

  constructor(kind: FigmaErrorKind, path: string, message: string, status?: number) {
    super(message);
    this.name = 'FigmaApiError';
    this.kind = kind;
    this.path = path;
    if (status !== undefined) this.status = status;
  }
}

/** Fixed, code-owned messages. No upstream string is ever interpolated. */
const MESSAGE_BY_KIND: Readonly<Record<FigmaErrorKind, string>> = {
  not_configured: 'No Figma token configured — add one in Settings.',
  unauthorized: 'Figma rejected the token — check it is current and has file_content:read.',
  forbidden: 'Figma denied access to this resource for the configured token.',
  not_found: 'Figma has no such file or node.',
  rate_limited: 'Figma rate-limited this import — try again in a minute.',
  too_large: 'Figma response is too large — import a specific frame instead.',
  network: 'Could not reach the Figma API.',
  bad_response: 'Figma returned a response this client could not read.',
};

function apiError(kind: FigmaErrorKind, path: string, status?: number): FigmaApiError {
  return new FigmaApiError(kind, path, MESSAGE_BY_KIND[kind], status);
}

/**
 * Compose a request URL. `path` is a code-owned literal with already-validated
 * segments; `query` values are encoded here. There is deliberately no overload
 * that accepts a full URL.
 */
function buildUrl(path: string, query?: Record<string, string | undefined>): string {
  const url = new URL(`${API_BASE}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse `Retry-After` (delta-seconds only — the HTTP-date form is not worth a
 * date parser here) and clamp it. An upstream header is untrusted input for
 * scheduling purposes just like anything else: a hostile or buggy value must
 * not be able to park this process for an hour.
 */
export function retryAfterMs(header: string | null): number {
  const seconds = header ? Number.parseInt(header, 10) : Number.NaN;
  if (!Number.isFinite(seconds) || seconds < 0) return 1_000;
  return Math.min(seconds * 1_000, MAX_SINGLE_BACKOFF_MS);
}

// ── Test fixture lane (S8.17b) ──────────────────────────────────────────────
//
// `MAUDE_FIGMA_FIXTURE=<dir>` answers every request below from local files and makes NO network call, so an end-to-end
// scenario can drive the frame leg without a Figma account. It is read from the PROCESS ENVIRONMENT of the studio
// (nothing a request, a file or a canvas can set), it is a directory read — not a host, scheme or path prefix — and the
// request URL is still composed by `buildUrl` from `API_BASE` only. With the variable unset `fixtureDir()` is null, no
// branch below is taken, and `getJson` behaves exactly as before (test/figma-fixture.test.ts pins both).
//
//   <dir>/<request path, '/' → '_'>.json   e.g. /files/KEY → files_KEY.json · /files/KEY/nodes → files_KEY_nodes.json
//                                          /images/KEY → images_KEY.json · /me → me.json
//   an images answer names pictures as `maude-fixture:<file>`; `fixtureAsset` reads that file from the same directory.

const FIXTURE_ENV = 'MAUDE_FIGMA_FIXTURE';
const FIXTURE_URL = /^maude-fixture:([A-Za-z0-9][A-Za-z0-9._-]{0,99})$/;

/** The fixture directory, or null (the production case). */
export function fixtureDir(): string | null {
  const d = process.env[FIXTURE_ENV];
  return typeof d === 'string' && d.trim() ? d.trim() : null;
}

/** `/files/KEY/nodes` → `files_KEY_nodes.json`. Exported for the fixture author and the test. */
export function fixtureFileFor(requestPath: string): string {
  return `${requestPath.replace(/^\/+/, '').replace(/[^A-Za-z0-9._-]+/g, '_')}.json`;
}

function fixtureJson<T>(dir: string, requestPath: string): T {
  const file = join(dir, fixtureFileFor(requestPath));
  let text: string;
  try {
    if (statSync(file).size > MAX_RESPONSE_BYTES) throw apiError('too_large', requestPath);
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (err instanceof FigmaApiError) throw err;
    throw apiError('not_found', requestPath, 404);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw apiError('bad_response', requestPath, 200);
  }
}

/**
 * The bytes behind a `maude-fixture:<file>` picture URL, or null — always null unless the fixture lane is on, and null for
 * any URL that is not exactly that shape (a real Figma URL goes on to the download gate as it always did).
 */
export function fixtureAsset(url: string): { bytes: Uint8Array; ext: string } | null {
  const dir = fixtureDir();
  if (!dir) return null;
  const m = FIXTURE_URL.exec(url);
  if (!m) return null;
  const name = m[1] as string;
  try {
    const bytes = readFileSync(join(dir, name));
    const dot = name.lastIndexOf('.');
    return { bytes, ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : 'png' };
  } catch {
    return null;
  }
}

/**
 * One authenticated GET. Resolves the token at call time, enforces the response
 * byte cap while reading, and retries only on 429 within a bounded budget.
 */
async function getJson<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
  const fixture = fixtureDir();
  if (fixture) return fixtureJson<T>(fixture, path); // S8.17b — the test lane: no token, no network
  const token = await getProviderKey('figma');
  if (!token) throw apiError('not_configured', path);

  const url = buildUrl(path, query);
  let spentBackoffMs = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'X-Figma-Token': token, Accept: 'application/json' },
        redirect: 'error', // the API never legitimately redirects
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Deliberately swallow the cause: a fetch error message can carry the URL
      // and, on some runtimes, request detail. D10 — output is code-owned.
      throw apiError('network', path);
    }

    if (res.status === 429) {
      const waitMs = retryAfterMs(res.headers.get('Retry-After'));
      if (attempt === MAX_RETRIES || spentBackoffMs + waitMs > MAX_BACKOFF_TOTAL_MS) {
        throw apiError('rate_limited', path, 429);
      }
      spentBackoffMs += waitMs;
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      if (res.status === 401) throw apiError('unauthorized', path, 401);
      if (res.status === 403) throw apiError('forbidden', path, 403);
      if (res.status === 404) throw apiError('not_found', path, 404);
      throw apiError('bad_response', path, res.status);
    }

    // Trust `Content-Length` as an early-out only; the real bound is the byte
    // count of what actually arrived (a missing or lying header must not be
    // the thing standing between an 8 MB cap and the heap).
    const declared = Number.parseInt(res.headers.get('Content-Length') ?? '', 10);
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      throw apiError('too_large', path, res.status);
    }

    const buffer = await readCapped(res, path);
    try {
      return JSON.parse(new TextDecoder().decode(buffer)) as T;
    } catch {
      throw apiError('bad_response', path, res.status);
    }
  }

  throw apiError('rate_limited', path, 429);
}

/**
 * Read a response body, aborting the moment it exceeds the cap. Streaming
 * rather than `res.arrayBuffer()` so an unbounded body is never fully
 * materialized before the check — the cap has to hold against a response that
 * does not declare its length.
 */
async function readCapped(res: Response, path: string): Promise<Uint8Array> {
  const body = res.body;
  if (!body) throw apiError('bad_response', path, res.status);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw apiError('too_large', path, res.status);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

// ── Public surface ──────────────────────────────────────────────────────────

export interface FetchDocumentOptions {
  fileKey: string;
  surface: 'design' | 'board';
  /** When present, fetches only this subtree — see the note below. */
  nodeId?: string;
  /** Figma's own tree-depth projection knob; independent of our own cap. */
  depth?: number;
}

/**
 * Fetch and normalize a document.
 *
 * **Prefers `/nodes` whenever a node id is present.** A whole enterprise file is
 * tens of MB and blows both the byte cap and any reasonable memory budget;
 * whole-file import is not a viable default, frame-scoped is (DDR-216 D5).
 */
export async function fetchDocument(opts: FetchDocumentOptions): Promise<NormalizedDocument> {
  const { fileKey, surface, nodeId, depth } = opts;
  const meta = { fileKey, surface, origin: 'rest' as const };

  if (nodeId) {
    const path = `/files/${encodeURIComponent(fileKey)}/nodes`;
    const body = await getJson<{ nodes?: Record<string, { document?: unknown }> }>(path, {
      ids: nodeId,
      depth: depth !== undefined ? String(depth) : undefined,
    });
    const entry = body?.nodes?.[nodeId];
    if (!entry?.document) throw apiError('not_found', path, 404);
    return normalizeDocument(entry.document, meta);
  }

  const path = `/files/${encodeURIComponent(fileKey)}`;
  const body = await getJson<{ document?: unknown }>(path, {
    depth: depth !== undefined ? String(depth) : undefined,
  });
  if (!body?.document) throw apiError('bad_response', path, 200);
  return normalizeDocument(body.document, meta);
}

export interface FigmaImageResult {
  /** nodeId → the URL Figma rendered it to, or null when it declined. */
  images: Record<string, string | null>;
}

/**
 * Ask Figma to render nodes. Returns URLs; **downloading is not this module's
 * job** — the returned URLs are response-controlled and must go through
 * `_fetch-asset.mjs`'s gate (DDR-216 D4/D11).
 *
 * Callers batch: `MAX_IMAGE_BATCH` ids per call, never one call per node.
 */
export async function fetchImageUrls(
  fileKey: string,
  nodeIds: readonly string[],
  format: 'png' | 'svg' | 'jpg' = 'png',
  scale = 2,
  opts: { outlineText?: boolean } = {}
): Promise<FigmaImageResult> {
  if (nodeIds.length === 0) return { images: {} };
  if (nodeIds.length > MAX_IMAGE_BATCH) {
    throw new FigmaCapError(
      'nodes',
      `image batch of ${nodeIds.length} exceeds the ${MAX_IMAGE_BATCH}-id ceiling`
    );
  }
  const path = `/images/${encodeURIComponent(fileKey)}`;
  const body = await getJson<{ images?: Record<string, string | null>; err?: unknown }>(path, {
    ids: nodeIds.join(','),
    format,
    // Scale is meaningless for svg and Figma rejects it there.
    scale: format === 'svg' ? undefined : String(scale),
    // Only meaningful for svg. `false` keeps real `<text>` runs in the output,
    // which is what makes a rendered frame searchable instead of a picture of
    // words. Omitted entirely for raster so the query stays byte-identical to
    // what the asset lane has always sent.
    svg_outline_text:
      format === 'svg' && opts.outlineText !== undefined ? String(opts.outlineText) : undefined,
  });
  return { images: body?.images ?? {} };
}

/** One Figma comment, charset-bounded at the edge like every other name. */
export interface FigmaComment {
  id: string;
  /** UNTRUSTED free text. Never interpreted, only ever rendered as data. */
  message: string;
  /** The node the pin hangs off, when it is pinned to one. */
  nodeId?: string;
  /** Offset within that node, or absolute page coords for a canvas-level pin. */
  x?: number;
  y?: number;
  /** Thread parent. Replies group under their root pin. */
  parentId?: string;
  resolved: boolean;
  /** Display handle only — provenance, never an identifier we act on (D7). */
  author?: string;
  createdAt?: string;
}

/**
 * A file's review comments — the annotations a designer actually left.
 *
 * These live nowhere in the document tree, which is why a tree-walking import
 * misses every one of them (the live StudyFi file carries 133). Unresolved and
 * resolved both come back; dropping resolved threads throws away the record of
 * what was already decided, so that call belongs to the caller.
 */
export async function fetchComments(fileKey: string): Promise<FigmaComment[]> {
  const path = `/files/${encodeURIComponent(fileKey)}/comments`;
  const body = await getJson<{ comments?: unknown[] }>(path);
  const raw = body?.comments;
  if (!Array.isArray(raw)) return [];

  const out: FigmaComment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const id = typeof c.id === 'string' ? c.id : undefined;
    if (!id) continue;
    const meta = (c.client_meta ?? {}) as Record<string, unknown>;
    const offset = (meta.node_offset ?? {}) as Record<string, unknown>;
    const user = (c.user ?? {}) as Record<string, unknown>;

    const num = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? v : undefined;

    out.push({
      id,
      message: typeof c.message === 'string' ? c.message : '',
      nodeId: typeof meta.node_id === 'string' ? meta.node_id : undefined,
      x: num(offset.x) ?? num(meta.x),
      y: num(offset.y) ?? num(meta.y),
      parentId: typeof c.parent_id === 'string' && c.parent_id ? c.parent_id : undefined,
      resolved: Boolean(c.resolved_at),
      author: typeof user.handle === 'string' ? user.handle : undefined,
      createdAt: typeof c.created_at === 'string' ? c.created_at : undefined,
    });
  }
  return out;
}

export interface FigmaStyleMeta {
  key: string;
  /** UNTRUSTED — charset-bounded before it becomes a token name (DDR-216 D6). */
  name: string;
  styleType: string;
  /** UNTRUSTED and DELIBERATELY UNUSED — never carried into any output. */
  description?: string;
  nodeId?: string;
}

/** Paint / text / effect styles — the Phase-4 input. */
export async function fetchStyles(fileKey: string): Promise<FigmaStyleMeta[]> {
  const path = `/files/${encodeURIComponent(fileKey)}/styles`;
  const body = await getJson<{ meta?: { styles?: unknown[] } }>(path);
  const raw = body?.meta?.styles;
  if (!Array.isArray(raw)) return [];
  const out: FigmaStyleMeta[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    const key = typeof s.key === 'string' ? s.key : undefined;
    const styleType = typeof s.style_type === 'string' ? s.style_type : undefined;
    if (!key || !styleType) continue;
    const entry: FigmaStyleMeta = {
      key,
      name: typeof s.name === 'string' ? s.name : '',
      styleType,
    };
    if (typeof s.node_id === 'string') entry.nodeId = s.node_id;
    out.push(entry);
  }
  return out;
}

export interface FigmaVariablesResult {
  /** False when the plan gates the endpoint — a NORMAL outcome, not an error. */
  available: boolean;
  raw?: unknown;
}

/**
 * Local variables — richer than styles (modes → themes), but **Enterprise-plan
 * gated**. A 403 here is the COMMON case (the dogfood account is Pro), so it
 * degrades to `{ available: false }` and the caller says "using your styles"
 * rather than surfacing a failure (DDR-216 D5).
 */
export async function fetchLocalVariables(fileKey: string): Promise<FigmaVariablesResult> {
  const path = `/files/${encodeURIComponent(fileKey)}/variables/local`;
  try {
    const body = await getJson<{ meta?: unknown }>(path);
    return { available: true, raw: body?.meta };
  } catch (err) {
    if (err instanceof FigmaApiError && (err.kind === 'forbidden' || err.kind === 'not_found')) {
      return { available: false };
    }
    throw err;
  }
}

/**
 * Fetch MANY nodes by id, in batches, adapting to the response-byte cap.
 *
 * `fetchDocument` fetches one subtree, and a whole PAGE of a real file routinely
 * blows the 8 MB cap — measured on a live StudyFi file, one page of 190
 * top-level nodes did exactly that while its siblings came in at 1–7 k nodes.
 * Refusing the page is the wrong answer when the caller wants the page: the
 * cap is a bound on ONE RESPONSE, not on how much a caller may assemble.
 *
 * So: chunk the ids, and on a `too_large` HALVE the chunk and retry. A single
 * id that still trips the cap is genuinely too big and is reported, not
 * silently dropped. This keeps every individual request inside the cap while
 * letting an import cover a page — the node-count and depth caps in
 * `normalizeDocument` still bound the assembled total.
 */
export async function fetchNodes(
  fileKey: string,
  ids: readonly string[],
  opts: { chunk?: number; onSkip?: (id: string) => void } = {}
): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  const path = `/files/${encodeURIComponent(fileKey)}/nodes`;

  const run = async (batch: readonly string[], chunk: number): Promise<void> => {
    if (batch.length === 0) return;
    try {
      const body = await getJson<{ nodes?: Record<string, { document?: unknown }> }>(path, {
        ids: batch.join(','),
      });
      for (const id of batch) {
        const doc = body?.nodes?.[id]?.document;
        if (doc) out.set(id, doc);
        else opts.onSkip?.(id);
      }
    } catch (err) {
      if (!(err instanceof FigmaApiError) || err.kind !== 'too_large') throw err;
      if (batch.length === 1) {
        // One node that alone exceeds the cap. Genuinely too big — report it
        // rather than pretending the page imported whole.
        opts.onSkip?.(batch[0]);
        return;
      }
      const half = Math.max(1, Math.floor(batch.length / 2));
      await run(batch.slice(0, half), half);
      await run(batch.slice(half), half);
    }
  };

  const size = Math.max(1, opts.chunk ?? 8);
  for (let i = 0; i < ids.length; i += size) {
    await run(ids.slice(i, i + size), size);
  }
  return out;
}

export interface FigmaPage {
  id: string;
  /** UNTRUSTED — charset-bounded before it becomes a filename. */
  name: string;
}

/** The file's pages, cheaply (`depth: 1` — names and ids, no content). */
export async function fetchPages(fileKey: string): Promise<FigmaPage[]> {
  const path = `/files/${encodeURIComponent(fileKey)}`;
  const body = await getJson<{ document?: { children?: unknown[] } }>(path, { depth: '1' });
  const kids = body?.document?.children;
  if (!Array.isArray(kids)) return [];
  const out: FigmaPage[] = [];
  for (const k of kids) {
    if (!k || typeof k !== 'object') continue;
    const c = k as Record<string, unknown>;
    if (c.type !== 'CANVAS') continue;
    if (typeof c.id !== 'string') continue;
    out.push({ id: c.id, name: typeof c.name === 'string' ? c.name : '' });
  }
  return out;
}

export interface FigmaIdentity {
  /** UNTRUSTED — length/charset-bounded before display, never persisted. */
  handle: string;
}

/** `GET /v1/me` — the Settings "probe this token" call. */
export async function fetchIdentity(): Promise<FigmaIdentity> {
  const body = await getJson<{ handle?: unknown; email?: unknown }>('/me');
  const handle = typeof body?.handle === 'string' ? body.handle : '';
  return { handle };
}
