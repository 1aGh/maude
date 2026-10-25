// The studio's local gate — V2-1.7 §5.4 + §5.7 (S9.9, A19 studio half).
//
// ONE question per request: "what may THIS session do here?". The answer is an
// `Access` (access/scope.ts), established once per request:
//
//   - a cell child: the proxy's `x-maude-access` claim (base64url JSON), read on
//     EVERY request — a role change lands on the next one. Without it (an older
//     proxy, a test harness) the legacy `x-maude-role` + `x-maude-readonly` pair,
//     read-only unless the readonly projection is positively `0` (DDR-209).
//   - a desktop: the linked hub's stored claim (`accessFor`, sync/hubs-config.ts),
//     re-read per request; a local, unlinked project is the owner's.
//
// Every write then needs ONE capability, decided by its path:
//   SESSION_WRITES → `session` · COMMENT_WRITES → `comment` · EXPORT_WRITES →
//   `export` · annotations → `annotate` · trash clear → `delete` · the rest →
//   `edit` (default deny — a new route is an edit until somebody says otherwise).
// A project role that holds it passes. A session with canvas grants passes when
// the request's TARGET canvas holds it (G1). A canvas-only session is refused any
// target outside its grants + their closure with `not-in-scope` — the same
// status and body a missing file gets (no existence oracle).
//
// Pure apart from the AsyncLocalStorage and the disk reader at the bottom.

import { AsyncLocalStorage } from 'node:async_hooks';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Closure, ProjectReader } from './closure.ts';
// S9.12 — the revert-guard seam (a call-time read, so the import cycle with filters.ts is inert).
import { aclCheckOn } from './filters.ts';
import type { Capability, ProjectRole } from './roles.ts';
import { FLOOR_ROLE, can as roleCan } from './roles.ts';
import {
  type Access,
  type AccessClaim,
  legacyClaim,
  PER_USE_PHOTO_RE,
  resolveAccess,
  writes,
} from './scope.ts';

// ---------------------------------------------------------------------------
// The write classes (§5.7). `READ_ONLY_ALLOWED_WRITES` (http.ts) is their union.

/** Your own place: per-user runtime state, reports, sign-in / link / sign-out, fetch. */
export const SESSION_WRITES: ReadonlySet<string> = new Set([
  '/_hmr', // build-watch rebuild hint — dev plumbing, not project state
  '/_canvas-state', // per-user camera / view state (DDR-115: never versioned)
  '/_api/canvas-meta', // per-user lanes only — the layout lane needs `edit` (in-handler)
  '/_api/ui-prefs', // per-user UI preferences
  '/_api/tree-state', // per-user Files-panel disclosure (issue #124)
  '/_api/timeline-media', // per-user runtime media cache (scrub read path)
  '/_api/report', // bug reports are about Maude, not the project
  '/_api/report-fallback',
  '/_api/hub/link', // link/unlink ≈ session management (cell allows /auth/logout)
  '/_api/cloud/detach', // unlink — the same session-management class as hub/link
  '/_api/workspace/sign-in', // signing in is how the role is (re)learned
  '/_api/workspace/disclosure',
  '/_api/cloud/signin/start', // account session, not project state
  '/_api/cloud/signin/poll',
  '/_api/cloud/signout',
  // Fetch moves remote-tracking refs and nothing else. `pull` / `checkout` rewrite
  // the SHARED working tree (Cloud Phase 27 D2) and are edits.
  '/_api/git/fetch',
]);

/** Comment, reply — `comment` on the comment's canvas (Can comment holds it, Can view does not). */
export const COMMENT_WRITES: ReadonlySet<string> = new Set(['/_comments']);
/**
 * Table routes (routes/*.ts) of the comment class — S9.7b's `POST /_api/comments/op`. The spec
 * declares `readOnly: 'allowed'` itself (so it is not in READ_ONLY_ALLOWED_WRITES twice); this
 * set says WHICH capability that is: `comment`, never the table's default `session`.
 */
export const COMMENT_TABLE_WRITES: ReadonlySet<string> = new Set(['/_api/comments/op']);
/** The generated half of the comment lane (an exact set cannot name it). */
export const COMMENT_WRITE_PATTERNS: readonly RegExp[] = Object.freeze([
  /^\/_api\/comments\/[A-Za-z0-9_-]+\/reply$/,
]);

/**
 * S4.14 — table routes (routes/votes.ts) of the vote class: casting your own ballot. The spec declares
 * `readOnly: 'allowed'` itself; this set says WHICH capability that is: `vote` (Can comment and up —
 * Can view is refused), never the table's default `session`. Start / end are `edit` (the default).
 */
export const VOTE_TABLE_WRITES: ReadonlySet<string> = new Set(['/_api/votes/ballot']);

/** Every download and export — `export` on the export's target. */
export const EXPORT_WRITES: ReadonlySet<string> = new Set([
  '/_api/export',
  '/_api/export-jobs',
  '/_api/export-jobs/download',
  // DDR-231 T6 — recording that you exported is the same class as exporting.
  '/_api/export-history',
  // The deck's composition half: packs bytes the session already captured.
  '/_api/export-assemble',
]);

/**
 * S8.4 — table routes (routes/export.ts) of the export class: Retry re-runs a finished export's failed
 * items. The spec declares `readOnly: 'allowed'` itself (so the path is not in READ_ONLY_ALLOWED_WRITES
 * twice); this set says WHICH capability that is: `export`, never the table's default `session`.
 */
export const EXPORT_TABLE_WRITES: ReadonlySet<string> = new Set([
  '/_api/export-jobs/retry',
  // S8.7 — the Print preflight (paper, the back, safe margin, fonts) is numbers and names about an export
  '/_api/export-preflight',
  // P8 C2 — the pictures of what an export would reach (artboard stills from the picture service)
  '/_api/export-preview',
]);

/** Stickies, marker, arrows, stickers, sections (V2-1.7 §5.2 `annotate`). */
export const ANNOTATE_WRITES: ReadonlySet<string> = new Set([
  '/_api/annotations',
  '/_api/annotations/ops',
  // S4.7 — sticky ↔ comment (routes/annotations.ts): a board write either way, and its undo token
  '/_api/annotations/to-comment',
  '/_api/comments/to-sticky',
  '/_api/annotations/convert-undo',
  // S4.16 - a FigJam board arrives as one section of annotations (routes/annotations.ts)
  '/_api/annotations/figjam',
]);

/** Clearing out the trash is the owner's (§5.5 `delete`); the per-Mac `_trash/` prune is not this. */
export const DELETE_WRITES: ReadonlySet<string> = new Set([
  '/_api/trash/clear',
  // S10.3b — a design-system token's clear-out (routes/ds.ts `clear`, owner — Q15); the hub's
  // studio manifest already classes it `delete`.
  '/_api/ds/clear',
]);

/**
 * gate-b-c4i — the media uploads (http.ts `/_api/asset` + the chunked trio). They name no canvas:
 * the bytes become a NEW content-addressed file (`assets/<sha8>.<ext>`, sniffed and capped in
 * api.ts), so the write gate has no target to judge. A canvas FRAME (every canvas-listener request
 * since gate-b-c4) is a canvas-only session, so without this an upload was refused from every
 * frame — the owner's drop, the board's image, the bg-remove harness. `localGate` admits one from a
 * frame that holds `edit` on at least one canvas of its grant; nothing else changes.
 */
export const FRAME_UPLOAD_WRITES: ReadonlySet<string> = new Set([
  '/_api/asset',
  '/_api/asset/chunk-start',
  '/_api/asset/chunk',
  '/_api/asset/chunk-finish',
]);

/**
 * p8-c4 (403 sweep) — `project`-class routes (test/_acl-route-classes.ts, U3: a canvas-only session
 * never gets a 2xx) whose handlers carry no scope check of their own, because they exist only on a
 * desktop (a cell contains them, DDR-193 §2): the AI chat's state and transcripts, the diagnostics
 * and debug bundle, the cloud / GitHub project lists. On a hub-linked desktop whose stored claim is
 * canvas-only they answered 200. The gate refuses them for such a session, every method, with the
 * plain 403. `/_api/acp/chats` (+ `/search`) are `filtered` (narrowed by their handler) and stay out.
 */
const CANVAS_ONLY_REFUSED = new Set([
  '/_api/acp/status',
  '/_api/acp/focus',
  '/_api/acp/running',
  '/_api/acp/activity',
  '/_api/acp/chat',
  '/_api/acp/chat/session',
  '/_api/acp/attachment',
  '/_api/diagnostics',
  '/_api/diagnostics/report',
  '/_api/debug-bundle',
  '/_api/cloud/move',
  '/_api/cloud/projects',
  '/_api/github/repos',
]);

/** Is `pathname` a project-level route a canvas-only session is refused outright (p8-c4)? */
export function canvasOnlyRefused(pathname: string): boolean {
  return CANVAS_ONLY_REFUSED.has(pathname);
}

export interface SessionAllowlist {
  exact: ReadonlySet<string>;
  patterns: readonly RegExp[];
}

/**
 * The capability a WRITE to `pathname` needs. `tableSession` = the route table's own
 * `readOnly: 'allowed'` writes (routes/*.ts), which keep today's meaning: your own place.
 */
export function writeCapability(pathname: string, tableSession?: SessionAllowlist): Capability {
  // D2 — the AI chat drives file edits: no write under it is ever anything but `edit` (C30).
  if (pathname.startsWith('/_api/acp/')) return 'edit';
  if (EXPORT_WRITES.has(pathname) || EXPORT_TABLE_WRITES.has(pathname)) return 'export';
  if (
    COMMENT_WRITES.has(pathname) ||
    COMMENT_TABLE_WRITES.has(pathname) ||
    COMMENT_WRITE_PATTERNS.some((re) => re.test(pathname))
  )
    return 'comment';
  if (VOTE_TABLE_WRITES.has(pathname)) return 'vote';
  if (SESSION_WRITES.has(pathname)) return 'session';
  if (tableSession?.exact.has(pathname) || tableSession?.patterns.some((re) => re.test(pathname)))
    return 'session';
  if (ANNOTATE_WRITES.has(pathname)) return 'annotate';
  if (DELETE_WRITES.has(pathname)) return 'delete';
  return 'edit';
}

// ---------------------------------------------------------------------------
// Establishing the session's Access.

/** The proxy's injected claim header (apps/hub/src/studio-proxy.mjs `upstreamHeaders`). */
export const ACCESS_HEADER = 'x-maude-access';

/** A claim header is never larger than this (256 grants of long paths fit well inside). */
const MAX_CLAIM_HEADER = 96 * 1024;

/** `x-maude-access` → the claim, or null when absent / malformed (null then holds nothing). */
export function decodeAccessClaim(value: string | null | undefined): AccessClaim | null {
  if (typeof value !== 'string' || value === '' || value.length > MAX_CLAIM_HEADER) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as AccessClaim)
      : null;
  } catch {
    return null;
  }
}

/** A role that edits, capped at `viewer` — the readonly projection said "not an editor". */
const capAtViewer = (role: ProjectRole | null): ProjectRole | null =>
  role !== null && roleCan(role, 'edit') ? 'viewer' : role;

/**
 * A cell child's session, from the proxy's vouched headers (fail closed, DDR-209).
 *
 * The claim is authoritative; the `x-maude-readonly` projection can only LOWER the
 * project role in it (the proxy derives both from the same role, so they agree — a
 * disagreement is believed in the safe direction). Without a claim: the legacy pair,
 * where an absent vouch is today's answer — read-only (`viewer`), never an editor.
 */
export function accessFromProxy(headers: Headers): Access {
  const readOnly = headers.get('x-maude-readonly') !== '0';
  const claim = decodeAccessClaim(headers.get(ACCESS_HEADER));
  if (claim) {
    const parsed = resolveAccess(claim);
    if (!readOnly || !roleCan(parsed.role, 'edit')) return parsed;
    return resolveAccess({ ...claim, role: capAtViewer(parsed.role) });
  }
  // No role named: the projection alone decides, as it always has — an editor is a
  // `member` (never the owner: nothing proved that), anything else `viewer`.
  const role = headers.get('x-maude-role') || (readOnly ? 'viewer' : 'member');
  const legacy = legacyClaim(role);
  return resolveAccess(readOnly ? { ...legacy, role: capAtViewer(legacy.role) } : legacy);
}

/**
 * S9.15c — does the proxy's readonly projection close EVERY lane of this session's
 * sockets? `0` (may edit) and `1` (read-only by role: the comment lane stays open,
 * Can comment) do not. `plan` (the project is paused — the proxy's socket lanes,
 * lead decision `v2-lead-paused-comments-refused`) does, and so does any value this
 * studio does not know, or none: the stricter reading. Socket lanes only — the HTTP
 * writes of a paused project never reach the studio (the proxy answers 402 plan).
 */
export function lanesClosedFromProxy(headers: Headers): boolean {
  const projection = headers.get('x-maude-readonly');
  return projection !== '0' && projection !== '1';
}

/** A local, unlinked project: the person at this Mac owns it (§5.4). */
export const LOCAL_OWNER: Access = resolveAccess({ v: 1, role: 'owner' });

/** A desktop's session: the linked hub's stored claim, or the owner's when unlinked. */
export function accessForDesktop(
  linkedHubUrl: string | null | undefined,
  claimFor: (url: string) => AccessClaim
): Access {
  if (!linkedHubUrl) return LOCAL_OWNER;
  try {
    return resolveAccess(claimFor(linkedHubUrl));
  } catch {
    return resolveAccess(legacyClaim(FLOOR_ROLE));
  }
}

const als = new AsyncLocalStorage<Access>();
let fallback: () => Access = () => LOCAL_OWNER;

/** Run `fn` as `access` — server.ts `withSession` wraps every request in this. */
export function runWithAccess<T>(access: Access, fn: () => T): T {
  return als.run(access, fn);
}

/** Outside a request (boot, timers, tests calling a handler directly): this resolver. */
export function setAccessFallback(resolve: () => Access): void {
  fallback = resolve;
}

/** THIS request's Access (§5.4 `currentAccess()`). */
export function currentAccess(): Access {
  return als.getStore() ?? fallback();
}

// ---------------------------------------------------------------------------
// Targets and refusals.

/** The 403 for a target outside the session's scope — identical for "does not exist" (U1). */
export function notInScopeResponse(): Response {
  return Response.json(
    { error: 'not-in-scope', reason: 'not-in-scope' },
    { status: 403, headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * A request path / param as a designRoot-relative POSIX path (`ui/x.tsx`), or null when it
 * names nothing under the design root (traversal, empty). `designRel` is the design root
 * relative to the repo root (`.design`), which every repo-relative param starts with.
 */
export function toDesignRel(raw: string, designRel: string): string | null {
  let p = String(raw).replace(/\\/g, '/');
  try {
    p = decodeURIComponent(p);
  } catch {
    return null;
  }
  p = p.replace(/^\/+/, '');
  const prefix = `${designRel.replace(/^\/+|\/+$/g, '')}/`;
  if (prefix !== '/' && p.startsWith(prefix)) p = p.slice(prefix.length);
  if (!p || p.split('/').some((s) => s === '..' || s === '.' || s === '')) return null;
  return p;
}

const TARGET_KEYS = ['file', 'canvas', 'path'] as const;
const MAX_TARGET_BODY = 1024 * 1024;

/**
 * The canvas / file a request targets, designRoot-relative: `?file=` / `?canvas=` / `?path=`,
 * the static lane's `/<designRel>/…` path, then a small JSON body's `file` / `canvas` / `path`.
 * `undefined` = the request names no target; `null` = it names one that is not a path.
 */
export async function targetOf(
  req: Request,
  designRel: string
): Promise<string | null | undefined> {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return null;
  }
  for (const k of TARGET_KEYS) {
    const v = url.searchParams.get(k);
    if (v !== null) return toDesignRel(v, designRel);
  }
  const base = `/${designRel.replace(/^\/+|\/+$/g, '')}/`;
  if (url.pathname.startsWith(base)) return toDesignRel(url.pathname, designRel);
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const type = req.headers.get('content-type') ?? '';
  const len = Number(req.headers.get('content-length') ?? '0');
  if (!type.includes('json') || !(len > 0 && len <= MAX_TARGET_BODY)) return undefined;
  try {
    const body = (await req.clone().json()) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return undefined;
    for (const k of TARGET_KEYS) {
      const v = body[k];
      if (typeof v === 'string') return toDesignRel(v, designRel);
    }
  } catch {
    /* not JSON — no target */
  }
  return undefined;
}

export interface GateInput {
  access: Access;
  /** designRoot relative to repoRoot (`.design`). */
  designRel: string;
  /** The route table's `readOnly: 'allowed'` writes (session class). */
  tableSession?: SessionAllowlist;
  /** The closure of the session's grants, when it has any (computed lazily). */
  closure?: () => Closure | null;
  /**
   * Does designRoot-relative `rel` exist (G2 create-only assets)? With `body` (a per-use photo
   * edit, S8.15): does it hold bytes OTHER than these — a content-addressed file that already
   * holds them is no overwrite.
   */
  exists?: (rel: string, body?: string) => boolean;
  /**
   * S8.15 — the exact bytes a write to a per-use photo edit would land, so `writes()` can check
   * them against the name (contract S8-asset-sidecars §5.6). Absent: such a create is refused.
   */
  bodyFor?: (req: Request, target: string) => Promise<string | undefined>;
  /**
   * A route that knows its own target better than the generic read (routes/table.ts
   * `RouteSpec.target`, S9.7b): a reply names a comment id, and only the server knows which
   * canvas that thread is on. When it answers, its target REPLACES `targetOf` — a body naming a
   * granted canvas cannot unlock a thread that lives on another.
   */
  targetFor?: (req: Request, pathname: string) => Promise<string | null | undefined> | undefined;
}

/** The target the gate judges: the route's own answer, else the generic `targetOf`. */
async function gateTarget(
  req: Request,
  g: GateInput,
  pathname?: string
): Promise<string | null | undefined> {
  let path = pathname;
  if (path === undefined) {
    try {
      path = new URL(req.url).pathname;
    } catch {
      return null;
    }
  }
  const own = g.targetFor?.(req, path);
  return own ? await own : targetOf(req, g.designRel);
}

/**
 * May a session with grants see `rel`: a granted canvas, or its closure. S8.15 — a WRITE may
 * also name a per-use photo edit of an asset in the closure: the writer's own bytes name it, so
 * naming it reveals nothing, and `writes()` decides (a read of one stays closure-only, U1).
 */
function seesTarget(g: GateInput, rel: string, method = 'GET'): boolean {
  if (g.access.seesCanvas(rel)) return true;
  const closure = g.closure?.() ?? null;
  if (closure?.read.has(rel)) return true;
  const perUse = method === 'GET' || method === 'HEAD' ? null : PER_USE_PHOTO_RE.exec(rel);
  if (!perUse || !closure) return false;
  for (const asset of closure.assetUsers.keys())
    if (asset.startsWith(`${perUse[1]}.`) && !asset.slice(perUse[1].length + 1).includes('/'))
      return true;
  return false;
}

/**
 * `canvasScopeRefusal` (§5.7) — a canvas-only session naming a target outside its grants
 * and their closure. Any method: reading B is refused exactly like writing it.
 */
export async function canvasScopeRefusal(req: Request, g: GateInput): Promise<Response | null> {
  if (!g.access.canvasOnly || !aclCheckOn('canvasScopeRefusal')) return null;
  const target = await gateTarget(req, g);
  if (target === undefined) return null;
  if (target === null || !seesTarget(g, target, req.method)) return notInScopeResponse();
  return null;
}

export type LocalGate =
  | { ok: true }
  | { ok: false; reason: 'capability'; cap: Capability }
  | { ok: false; reason: 'not-in-scope' };

/**
 * The capability check for one WRITE. A project role holding the capability passes; with
 * grants, the target canvas must hold it (or, for edits, `writes()` must admit the file).
 */
export async function localGate(req: Request, pathname: string, g: GateInput): Promise<LocalGate> {
  const cap = writeCapability(pathname, g.tableSession);
  if (g.access.can(cap, null)) return { ok: true };
  if (g.access.grants.length === 0) return { ok: false, reason: 'capability', cap };
  const target = await gateTarget(req, g, pathname);
  if (target === undefined) {
    // gate-b-c4i — an upload from a frame (`unnarrowed` is set on a frame's access only) that may
    // edit a canvas of its grant. A Can view / Can comment frame never held `edit`: still refused,
    // and so is frame-less. (gate-b-c4j: there is no read-only frame any more — a frame inlines no
    // canvas outside its own grant, so no frame is writing another canvas's content.)
    if (
      cap === 'edit' &&
      FRAME_UPLOAD_WRITES.has(pathname) &&
      g.access.unnarrowed !== undefined &&
      g.access.grants.some((gr) => g.access.can('edit', gr.c))
    )
      return { ok: true };
    return { ok: false, reason: 'capability', cap };
  }
  if (target === null) return { ok: false, reason: 'not-in-scope' };
  if (g.access.canvasOnly && !seesTarget(g, target, req.method))
    return { ok: false, reason: 'not-in-scope' };
  if (g.access.can(cap, target)) return { ok: true };
  if (cap === 'edit' || cap === 'annotate') {
    const closure = g.closure?.() ?? null;
    const body = PER_USE_PHOTO_RE.test(target) ? await g.bodyFor?.(req, target) : undefined;
    const exists = g.exists?.(target, body) ?? true;
    if (closure && writes(g.access, closure, target, { exists, body })) return { ok: true };
  }
  return { ok: false, reason: 'capability', cap };
}

/** The refusal of the AI chat (D2): socket upgrade, every state-changing frame, `/_api/acp/*`. */
export const ACP_REFUSAL = Object.freeze({
  error: 'read-only',
  reason: 'read-only',
  message: 'Ask the owner to change this.',
});

/**
 * `acpRefusal` — the AI chat needs `edit` (C30: no AI panel below it). Answers the 403 the
 * `/_ws/acp` upgrade and the `/_api/acp/*` writes give, or null when the session may chat.
 */
export function acpRefusal(access: Access): Response | null {
  if (access.can('edit', null)) return null;
  return Response.json(ACP_REFUSAL, { status: 403, headers: { 'Cache-Control': 'no-store' } });
}

// ---------------------------------------------------------------------------
// The studio child's ProjectReader (V2-1.7 §5.3 G4: closure computed on the server).

const LIST_CAP = 20000;

/**
 * The design root on disk as a `ProjectReader`. `head` is a generation the caller bumps on
 * every file change (the closure cache key), so a closure is recomputed after the tree moves.
 */
export function diskProjectReader(designRoot: string, head: () => string): ProjectReader {
  return {
    head,
    text(rel) {
      try {
        return readFileSync(join(designRoot, rel), 'utf8');
      } catch {
        return null;
      }
    },
    *list() {
      let n = 0;
      const walk = function* (dir: string, prefix: string): Generator<string> {
        let entries: import('node:fs').Dirent[];
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (n >= LIST_CAP) return;
          // Runtime state is FIRST-segment `_*` only (DDR-115; the static lane's DDR-210 rule):
          // a nested `_` file is versioned content — a design system's `preview/_components.css`
          // or `preview/_ds.tsx` override (closure.ts `isSystemFileInClosure` expects to see it).
          // gate-b-c4: every canvas frame now reads through this closure, so skipping them at
          // depth rendered every canvas without its component styles.
          if ((e.name.startsWith('_') && !prefix) || e.name.startsWith('.')) continue;
          if (e.name === 'node_modules') continue;
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          if (e.isDirectory()) yield* walk(join(dir, e.name), rel);
          else if (e.isFile()) {
            n++;
            yield rel;
          }
        }
      };
      yield* walk(designRoot, '');
    },
  };
}
