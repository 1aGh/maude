// home/routes.ts — the Home server's OWN route table (V2-1.1 §5.3). Never merged into the project
// table (routes/index.ts, V2-2.5): the Home server has no project, no canvas origin, no ACP, no sync,
// and none of the project routes exist here.
//
// Guards (V2-1.1 §5.3 "Guards", §5.8 items 1, 2, 5):
//   - every request: a loopback Host (DNS rebinding); OPTIONS → 405 with no CORS headers, ever
//   - every non-static route: an `x-maude-home` header (a custom header forces a CORS preflight
//     from any other origin — and the preflight is the 405 above), Fetch Metadata `Sec-Fetch-Site`
//     absent / `same-origin` / `none`, and on a POST an `Origin` (when sent) naming this very host;
//     JSON bodies ≤ 64 KB; `Cache-Control: no-store` on everything but pictures
//   - every page route (kind `home`): the header's VALUE is the per-spawn Home PAGE secret
//     (`$MAUDE_HOME_PAGE_SECRET`, compared in constant time — V2-3.6 H1). Rust hands it to the Home
//     window alone (`home_session()`, label `home` + the Home origin, re-checked in Rust). Without
//     it, any local process could call Home with a plain header — the agent included, through its
//     auto-allowed `maude design curl-local` — and read every profile's cloud listing and every
//     project's index, or write another project's `_pins.json`. The secret is never the internal
//     bearer: an equal pair is refused at construction (fail closed). `/_health` is guarded too —
//     nothing polls it without the page (Rust watches the info file). In a plain browser (no Tauri)
//     the page has no `home_session`, so Home only answers there when the developer started the
//     server with `MAUDE_HOME_PAGE_SECRET=<hex>` and put the same value in the page's
//     `sessionStorage['maude-home-page-secret']` (client/home/home-api.js).
//   - `/_home/internal/*` (Rust only): a constant-time `Authorization: Bearer $MAUDE_HOME_TOKEN`,
//     refused outright when the request carries `Origin` or `Sec-Fetch-Site` — a browser never
//     gets in, even holding the token
//   - a picture is served only when that pid's snapshot references its key; missing and forbidden
//     are the same 404 (no existence oracle)
// So a project page (same site, other port), a canvas iframe or a web page can neither read nor
// write a Home route. Static client files carry no guard beyond the Host check (the bundle is
// public, and the page has to load before it can send a header).

import { createHash, timingSafeEqual } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { fold } from '../index/match.ts';
import { DIST_DIR } from '../paths.ts';
import { serveClientAsset, serveFile, serveIndexHtml } from '../static-lane.ts';
import { thumbNotFound, thumbResponse } from '../thumbs/routes.ts';
import { checkJpeg } from '../thumbs/validate.ts';
import { isLoopbackHost } from '../ws.ts';
import type { HomeCloud } from './cloud.ts';
import { createLocalProject } from './create-local.ts';
import { readHomeIndex, resolveProject, searchHome, thumbSource } from './index-reader.ts';
import { createHomeInvite, type HomeInvite } from './invite.ts';
import { isPid } from './pid.ts';
import { createHomeSignIn, type HomeAnswer, type HomeSignIn } from './signin.ts';
import { isCanvasKey, setPin } from './user-state.ts';

export const HOME_HEADER = 'x-maude-home';
export const MAX_BODY_BYTES = 64 * 1024;
const MAX_PIDS = 200;
const MAX_Q = 200;
const MAX_THUMBS_PER_CALL = 50;
const RECENT_SEARCHES_CAP = 20;

export interface HomeDeps {
  /** MAUDE_HOME_STATE_DIR — home.json lives here */
  stateDir: string;
  /** MAUDE_HOME_TOKEN — null = no internal route answers */
  token: string | null;
  /** MAUDE_HOME_PAGE_SECRET — null = no page route answers (V2-3.6 H1) */
  pageSecret: string | null;
  version: string;
  cloudOrigin: string;
  formatSupported: number;
  /** base dir for create-local (default ~/Maude) */
  projectsDir: string;
  cloud: HomeCloud;
  /** S6.5 — the device-flow sign-in (one per Home process; default: a fresh one per table) */
  signin?: HomeSignIn;
  /** S6.5 — the invite peek/accept proxy */
  invite?: HomeInvite;
}

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (status: number, body: unknown) => Response.json(body, { status, headers: NO_STORE });
const refuse = (status: number, error: string) =>
  new Response(error, {
    status,
    headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' },
  });

// ── guards ───────────────────────────────────────────────────────────────────────────────────
export function sameOriginSite(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  return !site || site === 'same-origin' || site === 'none';
}

function originMatchesHost(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // non-browser (Rust, tests)
  try {
    return new URL(origin).host === req.headers.get('host');
  } catch {
    return false;
  }
}

/** Constant-time string equality: hash both sides (equal length for timingSafeEqual, no length oracle). */
function secretEquals(got: string, want: string): boolean {
  const a = createHash('sha256').update(got).digest();
  const b = createHash('sha256').update(want).digest();
  return timingSafeEqual(a, b);
}

function bearerOk(req: Request, token: string | null): boolean {
  if (!token) return false;
  const got = req.headers.get('authorization') ?? '';
  const m = /^Bearer ([^\s]+)$/.exec(got);
  if (!m) return false;
  return secretEquals(m[1] as string, token);
}

/** The page route's capability: `x-maude-home: <page secret>` (V2-3.6 H1). */
function pageSecretOk(req: Request, secret: string | null): boolean {
  if (!secret) return false;
  const got = req.headers.get(HOME_HEADER);
  return got != null && got !== '' && secretEquals(got, secret);
}

async function readBody(
  req: Request
): Promise<{ ok: true; value: unknown } | { ok: false; res: Response }> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    return { ok: false, res: refuse(413, 'body too large') };
  let text = '';
  if (req.body) {
    const reader = req.body.getReader();
    const dec = new TextDecoder();
    let seen = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += value?.byteLength ?? 0;
      if (seen > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return { ok: false, res: refuse(413, 'body too large') };
      }
      text += dec.decode(value, { stream: true });
    }
    text += dec.decode();
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, res: refuse(400, 'bad json') };
  }
}

function pidList(raw: string | null): string[] | null {
  if (raw == null || raw === '') return [];
  const pids = [...new Set(raw.split(','))];
  if (pids.length > MAX_PIDS || !pids.every(isPid)) return null;
  return pids;
}

// ── home.json (recent searches, this Mac) ────────────────────────────────────────────────────
interface RecentSearch {
  q: string;
  at: number;
  results: number;
}

function homeJsonPath(stateDir: string) {
  return path.join(stateDir, 'home.json');
}

export function readRecentSearches(stateDir: string): RecentSearch[] {
  try {
    const raw = JSON.parse(readFileSync(homeJsonPath(stateDir), 'utf8')) as {
      recentSearches?: unknown;
    };
    if (!Array.isArray(raw.recentSearches)) return [];
    return (raw.recentSearches as RecentSearch[])
      .filter((r) => r && typeof r.q === 'string' && r.q.length <= MAX_Q)
      .map((r) => ({ q: r.q, at: Number(r.at) || 0, results: Number(r.results) || 0 }))
      .slice(0, RECENT_SEARCHES_CAP);
  } catch {
    return [];
  }
}

function writeHomeJson(stateDir: string, recentSearches: RecentSearch[]) {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const file = homeJsonPath(stateDir);
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  writeFileSync(tmp, `${JSON.stringify({ v: 1, recentSearches }, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

// ── the table ────────────────────────────────────────────────────────────────────────────────
type Kind = 'home' | 'internal';
interface HomeRoute {
  method: 'GET' | 'POST';
  /** exact path, or a prefix ending in `/` with `prefix: true` */
  path: string;
  prefix?: boolean;
  kind: Kind;
  handle(req: Request, url: URL): Response | Promise<Response>;
}

/** A JSON-bodied POST row whose handler answers `{status, body}` (S6.5). */
function post(
  path: string,
  kind: Kind,
  run: (body: unknown) => HomeAnswer | Promise<HomeAnswer>
): HomeRoute {
  return {
    method: 'POST',
    path,
    kind,
    handle: async (req) => {
      const b = await readBody(req);
      if (!b.ok) return b.res;
      const r = await run(b.value);
      return json(r.status, r.body);
    },
  };
}

/** Exported for the route-guard test: every row of V2-1.1 §5.3 but the static lane. */
export function homeRouteTable(deps: HomeDeps): HomeRoute[] {
  const signin = deps.signin ?? createHomeSignIn();
  const invite = deps.invite ?? createHomeInvite();
  return [
    {
      method: 'GET',
      path: '/_health',
      kind: 'home',
      handle: () => json(200, { ok: true, mode: 'home', version: deps.version }),
    },
    {
      method: 'GET',
      path: '/_config',
      kind: 'home',
      handle: () =>
        json(200, {
          mode: 'home',
          shell: 'home',
          version: deps.version,
          cloudOrigin: deps.cloudOrigin,
          formatSupported: deps.formatSupported,
        }),
    },
    {
      method: 'GET',
      path: '/_home/index',
      kind: 'home',
      handle: (_req, url) => {
        const pids = pidList(url.searchParams.get('pids'));
        const running = pidList(url.searchParams.get('running'));
        if (!pids || !running) return refuse(400, 'bad pids');
        return json(200, readHomeIndex(pids, new Set(running)));
      },
    },
    {
      method: 'GET',
      path: '/_home/thumb/',
      prefix: true,
      kind: 'home',
      // /_home/thumb/<pid>/<key>.jpg — one 404 for every "no"
      handle: (_req, url) => {
        const m = /^\/_home\/thumb\/([^/]+)\/([^/]+)\.jpg$/.exec(url.pathname);
        if (!m || !isPid(m[1])) return thumbNotFound();
        return thumbResponse(thumbSource(m[1] as string), m[2]);
      },
    },
    {
      method: 'GET',
      path: '/_home/search',
      kind: 'home',
      handle: (_req, url) => {
        const q = (url.searchParams.get('q') ?? '').slice(0, MAX_Q);
        const pids = pidList(url.searchParams.get('pids'));
        if (!pids) return refuse(400, 'bad pids');
        return json(200, searchHome(q, pids));
      },
    },
    {
      method: 'GET',
      path: '/_home/recent-searches',
      kind: 'home',
      handle: () => json(200, { recentSearches: readRecentSearches(deps.stateDir) }),
    },
    {
      method: 'POST',
      path: '/_home/recent-searches',
      kind: 'home',
      handle: async (req) => {
        const b = await readBody(req);
        if (!b.ok) return b.res;
        const body = (b.value ?? {}) as { q?: unknown; results?: unknown };
        const q = typeof body.q === 'string' ? body.q.trim() : '';
        if (!q || q.length > MAX_Q) return refuse(400, 'bad q');
        const results =
          Number.isInteger(body.results) && Number(body.results) >= 0 ? Number(body.results) : 0;
        const key = fold(q);
        const next = [
          { q, at: Date.now(), results },
          ...readRecentSearches(deps.stateDir).filter((r) => fold(r.q) !== key),
        ].slice(0, RECENT_SEARCHES_CAP);
        writeHomeJson(deps.stateDir, next);
        return json(200, { recentSearches: next });
      },
    },
    {
      method: 'POST',
      path: '/_home/pins',
      kind: 'home',
      handle: async (req) => {
        const b = await readBody(req);
        if (!b.ok) return b.res;
        const body = (b.value ?? {}) as { pid?: unknown; canvas?: unknown; pinned?: unknown };
        if (!isPid(body.pid) || !isCanvasKey(body.canvas) || typeof body.pinned !== 'boolean')
          return refuse(400, 'bad pin');
        const r = resolveProject(body.pid);
        // the snapshot's root must still BE this pid: a snapshot naming another folder writes nothing
        if (!r.ok)
          return r.state === 'mismatch'
            ? refuse(403, 'root mismatch')
            : refuse(404, 'no such project');
        const canvas = body.canvas;
        if (body.pinned && !r.snap.canvases.some((c) => c.rel === canvas)) {
          let isFile = false;
          try {
            isFile = lstatSync(path.join(r.designRoot, canvas)).isFile();
          } catch {
            /* not there */
          }
          if (!isFile) return refuse(404, 'no such canvas');
        }
        const file = setPin(r.designRoot, canvas, body.pinned);
        return json(200, { ok: true, pins: file.pins });
      },
    },
    {
      method: 'POST',
      path: '/_home/projects/create-local',
      kind: 'home',
      handle: async (req) => {
        const b = await readBody(req);
        if (!b.ok) return b.res;
        const r = createLocalProject(
          (b.value as { name?: unknown } | null)?.name,
          deps.projectsDir
        );
        return r.ok ? json(200, r) : json(r.status, r);
      },
    },
    {
      method: 'GET',
      path: '/_home/cloud',
      kind: 'home',
      handle: async (_req, url) => {
        const r = await deps.cloud.listing(url.searchParams.get('profile') ?? '');
        return json('status' in r ? r.status : 200, r);
      },
    },
    {
      method: 'POST',
      path: '/_home/cloud/prepare',
      kind: 'home',
      handle: async (req) => {
        const b = await readBody(req);
        if (!b.ok) return b.res;
        const r = await deps.cloud.prepare((b.value ?? {}) as Record<string, unknown>);
        return json(r.ok ? 200 : r.status, r);
      },
    },
    // S6.5 — sign-in (contract S6-S9 §5.1) and the invite proxy (§5.3): page routes behind the
    // page secret; the profile they may write is named by Rust alone (the internal row below)
    post('/_home/cloud/signin/start', 'home', (b) => signin.start(b)),
    post('/_home/cloud/signin/poll', 'home', (b) => signin.poll(b)),
    post('/_home/cloud/signin/cancel', 'home', (b) => signin.cancel(b)),
    post('/_home/invite/peek', 'home', (b) => invite.peek(b)),
    post('/_home/invite/accept', 'home', (b) => invite.accept(b)),
    post('/_home/internal/signin/profile', 'internal', (b) => signin.register(b)),
    {
      method: 'GET',
      path: '/_home/internal/search',
      kind: 'internal',
      handle: (_req, url) => {
        const q = (url.searchParams.get('q') ?? '').slice(0, MAX_Q);
        const pids = pidList(url.searchParams.get('pids'));
        if (!pids) return refuse(400, 'bad pids');
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
        return json(200, searchHome(q, pids, limit));
      },
    },
    {
      method: 'GET',
      path: '/_home/internal/thumbs',
      kind: 'internal',
      // `?pid=<pid>&keys=k1,k2` → `{ thumbs: { <key>: <base64 jpeg> } }` for the keys that pid's
      // snapshot references; any other key is simply absent (the same answer as a missing one)
      handle: (_req, url) => {
        const pid = url.searchParams.get('pid');
        const keys = [...new Set((url.searchParams.get('keys') ?? '').split(',').filter(Boolean))];
        if (!isPid(pid) || keys.length > MAX_THUMBS_PER_CALL) return refuse(400, 'bad request');
        const src = thumbSource(pid);
        const thumbs: Record<string, string> = {};
        for (const k of keys) {
          if (!src.serves(k)) continue;
          const bytes = src.read(k);
          if (bytes && checkJpeg(bytes, 2048).ok) thumbs[k] = Buffer.from(bytes).toString('base64');
        }
        return json(200, { thumbs });
      },
    },
  ];
}

function isStatic(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/index.html' ||
    pathname.startsWith('/_client/') ||
    pathname.startsWith('/dist/')
  );
}

async function serveStatic(pathname: string): Promise<Response> {
  let rel: string;
  if (pathname === '/' || pathname === '/index.html')
    return serveIndexHtml({ 'Content-Security-Policy': "frame-ancestors 'none'" });
  try {
    rel = decodeURIComponent(pathname.slice(pathname.startsWith('/dist/') ? 6 : 9));
  } catch {
    return refuse(400, 'bad path');
  }
  if (pathname.startsWith('/_client/')) return serveClientAsset(rel);
  if (rel.includes('..')) return refuse(403, 'Forbidden');
  return serveFile(path.join(DIST_DIR, rel));
}

/** The Home server's whole `fetch`: guards first, then the table. */
export function createHomeFetch(deps: HomeDeps): (req: Request) => Promise<Response> {
  const table = homeRouteTable(deps);
  // fail closed: a page secret that IS the internal bearer would let the bearer open page routes
  const pageSecret = deps.pageSecret && deps.pageSecret !== deps.token ? deps.pageSecret : null;
  return async (req) => {
    // a preflight is never answered — the custom header makes every cross-origin call need one
    if (req.method === 'OPTIONS') return new Response('Method Not Allowed', { status: 405 });
    if (!isLoopbackHost(req.headers.get('host'))) return refuse(403, 'local request required');
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return refuse(400, 'bad url');
    }
    const { pathname } = url;
    if (isStatic(pathname)) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return refuse(405, 'Method Not Allowed');
      return serveStatic(pathname);
    }
    const candidates = table.filter((r) =>
      r.prefix ? pathname.startsWith(r.path) : pathname === r.path
    );
    if (!candidates.length) return refuse(404, 'Not found');
    const kind = (candidates[0] as HomeRoute).kind;
    // the header first: without it nothing below runs, whatever the path
    if (!req.headers.get(HOME_HEADER)) return refuse(403, 'home header required');
    if (kind === 'internal') {
      if (req.headers.has('origin') || req.headers.has('sec-fetch-site'))
        return refuse(403, 'internal route');
      if (!bearerOk(req, deps.token)) return refuse(403, 'internal route');
    } else {
      if (!pageSecretOk(req, pageSecret)) return refuse(403, 'home header required');
      if (!sameOriginSite(req)) return refuse(403, 'cross-origin rejected');
      if (req.method !== 'GET' && !originMatchesHost(req))
        return refuse(403, 'cross-origin rejected');
    }
    const route = candidates.find((r) => r.method === req.method);
    if (!route) return refuse(405, 'Method Not Allowed');
    try {
      return await route.handle(req, url);
    } catch (err) {
      console.error('[home] route failed:', pathname, err instanceof Error ? err.message : err);
      return refuse(500, 'Server error');
    }
  };
}
