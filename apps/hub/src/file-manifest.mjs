// The file plane's hub half — feature-sync-file-plane, on the binding
// decision maude/sync-two-plane-manifest-architecture.
//
// TWO routes, one policy module:
//
//   GET /api/files            — the MANIFEST. What plane-B files this project
//                               offers: `{ path, sha256, size, mtimeMs, class }`
//                               per file, for the three flowing classes only.
//   GET /_project-file/<rel>  — the READ. The bytes of ONE manifest entry.
//
// Membership is decided by `file-membership.mjs` — the positive classifier
// shared (mirrored + parity-pinned) with the studio. `canvas-owned` files are
// DELIBERATELY absent from both routes: plane disjointness is enforced at the
// source, so the CRDT lanes can never be shadowed by a second transport.
//
// WHY THE READ ROUTE IS NEW rather than a widening of `/_asset-file/`: that
// route's GET-is-presence-only posture is a recorded review decision ("It
// returns EXISTENCE, never bytes. Serving the file here would turn a write
// route into a read surface for the checkout — a different trust question
// than the one this route was reviewed for"). This route IS that different
// trust question, asked and answered on its own: read-only by construction
// (GET/HEAD, anything else 405), peer-token gated, scope-filtered, classifier
// -gated, realpath-contained, capped.
//
// NO ORACLE. Past authentication, every refusal on the read route is 404 —
// a `never` path, an out-of-scope path, a traversal shape and a genuinely
// absent file are indistinguishable, so the route cannot be used to probe
// what exists outside the plane.
//
// SCOPE, LIKE THE DOCUMENTS LISTING. The bearer is the same peer token the
// sync uses, and entries are filtered through the same `matchesScope` gate
// (injected). A workspace member's token carries scope `*`; a token scoped
// narrower than the project sees (conservatively) no plane-B files at all —
// refusing more than documents would is the safe direction.

import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { MAX_PROJECT_FILE_BYTES, parseRange } from './file-limits.mjs';
import { classifyProjectFile, isFilePlaneClass, isProjectFileShape } from './file-membership.mjs';
import { isContainedReal, realpathOfDeepestExisting } from './path-contain.mjs';
import { verifyToken } from './tokens.mjs';

/** `GET /api/files` — the plane-B manifest for this project. */
export const FILES_PATH = '/api/files';

/** `GET /_project-file/<designRoot-rel>` — one manifest entry's bytes. */
export const PROJECT_FILE_PREFIX = '/_project-file/';

/** Walk ceiling — files, not bytes. A real project is hundreds; 20k is a
 *  runaway tree, and the cap is LOUD (payload `truncated: true` + a warn)
 *  because a silent cap reads as "sync is broken" with no cause. */
const MAX_MANIFEST_FILES = 20_000;

/** Walk depth ceiling — matches the classifier's 8-segment shape cap, so the
 *  walk can never even visit a path the classifier would refuse. */
const MAX_WALK_DEPTH = 8;

/** Refuse to serve an implausible file rather than stream it. Same figure as
 *  the asset lanes' MAX_PULL_BYTES / MAX_PUSH_BYTES. */
// T18 — the one project-file ceiling (file-limits.mjs).
const MAX_FILE_BYTES = MAX_PROJECT_FILE_BYTES;

/**
 * Conservative content types by extension — never sniffed, never
 * client-supplied, never `text/html`. Code modules are deliberately
 * `application/octet-stream`: on this route they are DATA a sync peer
 * fetches, not something any browser context should ever execute.
 */
const FILE_CONTENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  css: 'text/css; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  ts: 'application/octet-stream',
  tsx: 'application/octet-stream',
  js: 'application/octet-stream',
  mjs: 'application/octet-stream',
};

/**
 * sha256 cache keyed by absolute path, valid while (size, mtimeMs) match.
 * The manifest is POLLED — rehashing an unchanged design system every 20 s
 * is the difference between a listing and a load. Bounded crudely: a tree
 * larger than the walk cap cannot fill it.
 */
const shaCache = new Map();

/** One loud warn per designRoot per process when the walk cap bites. */
const warnedTruncated = new Set();

/**
 * The checkout's declared canvas groups, read from `<designRoot>/config.json`.
 * Unreadable/absent config → undefined, and the classifier falls back to the
 * same `['system', 'ui']` default the canvas-path receiver uses.
 */
export function readCanvasGroups(designRoot) {
  try {
    const parsed = JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
    return Array.isArray(parsed?.canvasGroups) ? parsed.canvasGroups : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Walk the checkout designRoot and return every plane-B entry.
 *
 * Directories that no plane path can live under (leading `_` or `.`,
 * `node_modules` — all structurally refused by the classifier's DIR segment
 * rule) are pruned without descending; correctness still rests on
 * `classifyProjectFile` over the full relative path, the pruning is only why
 * a poll does not descend into `_history/` ten thousand snapshots deep.
 *
 * @returns {{ files: Array<{path:string, sha256:string, size:number, mtimeMs:number, class:string}>, truncated: boolean }}
 */
export function listProjectFiles(designRoot) {
  /** @type {Array<{ rel: string, abs: string, size: number, mtimeMs: number }>} */
  const found = [];
  let truncated = false;

  const walk = (dir, rel, depth) => {
    if (depth > MAX_WALK_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith('_') && entry.isDirectory()) continue;
      if (name.startsWith('.') || name === 'node_modules') continue;
      const childRel = rel ? `${rel}/${name}` : name;
      const childAbs = join(dir, name);
      if (entry.isDirectory()) {
        walk(childAbs, childRel, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue; // symlinks never enter the manifest
      if (found.length >= MAX_MANIFEST_FILES) {
        truncated = true;
        return;
      }
      let st;
      try {
        st = statSync(childAbs);
      } catch {
        continue;
      }
      if (st.size > MAX_FILE_BYTES) continue;
      found.push({ rel: childRel, abs: childAbs, size: st.size, mtimeMs: st.mtimeMs });
    }
  };
  walk(designRoot, '', 1);

  // Classify against the walked SNAPSHOT — `hasFile` answers from the same
  // set, so the sibling-css split cannot race a concurrent write.
  const fileSet = new Set(found.map((f) => f.rel));
  const canvasGroups = readCanvasGroups(designRoot);
  const opts = { canvasGroups, hasFile: (r) => fileSet.has(r) };

  const files = [];
  for (const f of found) {
    const cls = classifyProjectFile(f.rel, opts);
    if (!isFilePlaneClass(cls)) continue;
    const sha256 = shaOf(f.abs, f.size, f.mtimeMs);
    if (sha256 === null) continue;
    files.push({ path: f.rel, sha256, size: f.size, mtimeMs: f.mtimeMs, class: cls });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  if (truncated && !warnedTruncated.has(designRoot)) {
    warnedTruncated.add(designRoot);
    console.warn(
      `[hub] file manifest for ${designRoot} hit the ${MAX_MANIFEST_FILES}-file cap — the listing is TRUNCATED and peers will not see the remainder.`
    );
  }
  return { files, truncated };
}

/** Cached sha256 of one file, or null when it cannot be read. */
function shaOf(abs, size, mtimeMs) {
  const hit = shaCache.get(abs);
  if (hit && hit.size === size && hit.mtimeMs === mtimeMs) return hit.sha256;
  let bytes;
  try {
    bytes = readFileSync(abs);
  } catch {
    return null;
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  shaCache.set(abs, { size, mtimeMs, sha256 });
  return sha256;
}

/**
 * Handle `GET /api/files`.
 *
 * Returns `true` when it answered, `false` when the path is not ours — the
 * `handleDocumentsRoute` contract, dependency-injected the same way so the
 * route is testable without a server.
 *
 * @param {object} args
 * @param {string} args.path            request path, query already stripped
 * @param {string} args.method
 * @param {string|null} args.bearer     presented token, or null
 * @param {(token: string) => ({ scope?: string, label?: string }|null)} args.verify
 * @param {(scope: string|undefined, name: string) => boolean} args.matchesScope
 * @param {string|null} args.designRoot workspace checkout design root, or null
 * @param {(status: number, payload: unknown) => void} args.respondJson
 */
export function handleFilesRoute({
  path,
  method,
  bearer,
  verify,
  matchesScope,
  designRoot,
  respondJson,
}) {
  if (path !== FILES_PATH) return false;
  if (method !== 'GET') {
    respondJson(405, { error: 'method not allowed' });
    return true;
  }

  // Same refusal shape as the documents listing: a missing credential and a
  // bad one are the same answer.
  const match = bearer ? verify(bearer) : null;
  if (!match) {
    respondJson(401, { error: 'a project token is required to list project files' });
    return true;
  }

  // Workspace-mode only. A hub with no checkout has no file plane — an empty
  // manifest, not an error, so an old-style hub answers peers harmlessly.
  if (!designRoot || !existsSync(designRoot)) {
    respondJson(200, { files: [], count: 0 });
    return true;
  }

  const { files, truncated } = listProjectFiles(designRoot);
  const visible = files.filter((f) => matchesScope(match.scope, f.path));
  respondJson(200, {
    files: visible,
    count: visible.length,
    ...(truncated ? { truncated: true } : {}),
  });
  return true;
}

/**
 * The checkout's class for one rel, judged against the checkout's OWN config
 * and tree — the tree-aware half the URL parser cannot do.
 */
export function checkoutFileClass(rel, designRoot) {
  if (!designRoot) return 'never';
  return classifyProjectFile(rel, {
    canvasGroups: readCanvasGroups(designRoot),
    // `r` only ever derives from a shape-valid rel (the sibling `.tsx` swap),
    // so it is contained by construction before it touches the filesystem.
    hasFile: (r) => existsSync(join(designRoot, r)),
  });
}

/**
 * The WRITE/PROBE decision for `/_asset-file/`, whole, in one call — shape,
 * realpath containment, then CLASS admission judged on the REAL landing path.
 * One function, used by BOTH the writer and the batch probe, so they agree
 * byte-for-byte and the probe can never become an oracle for paths the writer
 * would refuse (the warning `checkoutAssetRel` carries).
 *
 * WHY THE CLASS IS JUDGED ON `realRel`, NOT THE LEXICAL `rel`: a peer can
 * COMMIT a symlink into the shared repo (DDR-054), and a link that stays
 * INSIDE the design root can still map a benign-looking lexical path onto
 * runtime state (`media -> _history`) or onto a CRDT-owned sidecar
 * (`p -> system/ds/preview`, then `p/specimen.css`). Containment alone passes
 * both; the class of the path where the bytes actually land is what refuses
 * them. This replaces the old assets-parent rule, which enforced the same
 * idea for the narrower assets-only surface.
 *
 * `realRel` comes back with the caller, not just `abs`. Admission is decided on
 * the symlink-resolved path, so every LATER decision about those bytes — the
 * owner-role gate, the CAS lookup, the journal row — has to be asked on the
 * same path, or the two disagree exactly where the symlink threat lives.
 *
 * @returns {{ ok: true, abs: string, realRel: string } | { ok: false }}
 */
export function resolveCheckoutFileWrite(designRoot, rel) {
  if (!designRoot || !isProjectFileShape(rel)) return { ok: false };
  const target = resolveProjectFileTarget(designRoot, rel);
  if (!target.ok) return { ok: false };
  // `classifyProjectFile` shape-gates internally, so a realRel landing in a
  // `_*` directory (or any malformed shape) classifies `never` right here.
  if (!isFilePlaneClass(checkoutFileClass(target.realRel, designRoot))) return { ok: false };
  return { ok: true, abs: target.abs, realRel: target.realRel };
}

/**
 * Where a plane-B read is allowed to read from disk, or `{ok:false}`.
 *
 * The same two-guard discipline as `resolveCheckoutAssetTarget` (assets.mjs),
 * reusing the same `path-contain.mjs` primitives — containment lexically AND
 * through symlinks, with every filesystem op then using the RESOLVED parent +
 * basename, never the lexical path — minus that function's `assets`-segment
 * requirement, which is the asset lane's own scope rule, not a containment
 * rule. A committed symlink under the design root (DDR-054 — a peer can
 * commit one) therefore cannot walk this route out of the checkout.
 */
export function resolveProjectFileTarget(designRootRaw, rel) {
  if (!designRootRaw) return { ok: false };
  const designRoot = resolve(designRootRaw);
  const abs = resolve(designRoot, rel);
  if (
    (abs !== designRoot && !abs.startsWith(designRoot + sep)) ||
    !isContainedReal(designRoot, abs)
  ) {
    return { ok: false };
  }
  try {
    const realRoot = realpathOfDeepestExisting(designRoot);
    const realParent = realpathOfDeepestExisting(dirname(abs));
    if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) return { ok: false };
    const real = join(realParent, basename(abs));
    // The REAL designRoot-relative path — where the bytes actually land or
    // come from, `/`-normalized so the classifier can judge it. Differs from
    // the lexical `rel` exactly when a committed symlink sits on the path.
    const realRel = relative(realRoot, real).split(sep).join('/');
    return { ok: true, abs: real, realRel };
  } catch {
    return { ok: false };
  }
}

/** Parse `/_project-file/<rel>` → the decoded rel, or null. */
export function parseProjectFilePath(pathname) {
  const m = String(pathname ?? '').match(/^\/_project-file\/([^?#]+)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/**
 * Handle `GET|HEAD /_project-file/<rel>`. Returns true when handled.
 *
 * @param {object} ctx
 * @param {import('node:http').IncomingMessage} ctx.request
 * @param {import('node:http').ServerResponse} ctx.response
 * @param {string} ctx.pathname
 * @param {string} ctx.method
 * @param {string} ctx.dataDir
 * @param {string} ctx.secret
 * @param {string|null} ctx.designRoot
 * @param {(request: any) => boolean} [ctx.checkRateLimit]  UNAUTHENTICATED refusals (tight per-IP)
 * @param {(label: string) => boolean} [ctx.checkReadRateLimit]  authenticated reads — the GENEROUS
 *        per-label bucket (`checkConnRateLimit` shape), NEVER the 5/min per-IP one: a fresh link
 *        legitimately pulls a whole design system in one pass (the RCA-2026-08-11 lesson).
 * @param {(scope: string|undefined, name: string) => boolean} ctx.matchesScope
 * @param {(token: string) => ({ scope?: string, label?: string }|null)} [ctx.verify]
 *        Injectable for tests (the bun-side parity suite cannot open the
 *        native sqlite store); absent ⇒ the real `verifyToken`.
 */
export async function handleProjectFileRoute(ctx) {
  const { request, response, pathname, method, dataDir, secret, matchesScope } = ctx;
  if (!pathname.startsWith(PROJECT_FILE_PREFIX)) return false;

  // Read-only BY CONSTRUCTION — the method gate precedes everything else, so
  // this route can never grow a write half by accident.
  if (method !== 'GET' && method !== 'HEAD') {
    respond(response, 405, 'method not allowed');
    return true;
  }

  const verify = ctx.verify ?? ((t) => verifyToken(dataDir, t, secret));
  const auth = request.headers?.authorization;
  const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  const match = token ? verify(token) : null;
  if (!match) {
    if (ctx.checkRateLimit && !ctx.checkRateLimit(request)) {
      respondRateLimited(response);
      return true;
    }
    respond(response, 401, 'unauthorized');
    return true;
  }
  if (ctx.checkReadRateLimit && !ctx.checkReadRateLimit(match.label)) {
    respondRateLimited(response);
    return true;
  }

  // Everything past this point answers 404 on refusal — a malformed path, a
  // `never` class, an out-of-scope path and an absent file are one answer.
  const designRoot = ctx.designRoot;
  const rel = parseProjectFilePath(pathname);
  if (!designRoot || rel === null) {
    respond(response, 404, 'not found');
    return true;
  }
  // Containment first, then the class judged on the REAL path — the same
  // symlink reasoning as `resolveCheckoutFileWrite`: reading through a
  // committed link must not hand out bytes the classifier would refuse to
  // name (runtime state, a CRDT-owned sidecar).
  const target = isProjectFileShape(rel)
    ? resolveProjectFileTarget(designRoot, rel)
    : { ok: false };
  // F-4 (post-1.0 burn-down) — scope is judged on the REAL path, exactly like
  // the class one line up and exactly like the WRITE half (`file-door.mjs`
  // judges `matchesScope` on `landing = target.realRel`). Judging scope on the
  // lexical `rel` while judging class on the real one was the same split the
  // write half was fixed for: a committed symlink inside a token's scope could
  // point at a file outside it, and the read would pass the gate on the name
  // while serving the target's bytes.
  if (
    !target.ok ||
    !isFilePlaneClass(checkoutFileClass(target.realRel, designRoot)) ||
    !matchesScope(match.scope, target.realRel)
  ) {
    respond(response, 404, 'not found');
    return true;
  }

  // lstat, NOT stat — the FINAL component must never be followed. Containment
  // above resolves the PARENT's symlinks and re-classifies on `realRel`, but a
  // committed symlink whose LEAF is the link (`assets/logo.png -> ../config.json`,
  // target in-root so containment passes) would otherwise be class-judged on
  // the link name (a flowing class) and then read THROUGH the link, serving a
  // `never` file's bytes — config.json, `_history/`, a CRDT body. The manifest
  // walk already refuses symlinks (`entry.isFile()`), so a real plane-B file is
  // never a link and refusing one here costs nothing legitimate. (Security
  // review 2026-08-14, both seats — the one confirmed read-route blocker.)
  let st;
  try {
    st = lstatSync(target.abs);
  } catch {
    respond(response, 404, 'not found');
    return true;
  }
  if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_FILE_BYTES) {
    if (st.isFile() && st.size > MAX_FILE_BYTES) {
      console.warn(`[hub] refusing to serve ${rel}: ${st.size} B over the cap`);
    }
    respond(response, 404, 'not found');
    return true;
  }

  const dot = rel.lastIndexOf('.');
  const ext = dot < 0 ? '' : rel.slice(dot + 1).toLowerCase();
  // T18 — a byte range, so an interrupted download of a large file resumes
  // where it stopped instead of starting over.
  const range = parseRange(request?.headers?.range, st.size);
  if (range?.invalid) {
    response
      .writeHead(416, { 'Content-Range': `bytes */${st.size}`, 'Cache-Control': 'no-store' })
      .end();
    return true;
  }
  const headers = {
    'Content-Type': FILE_CONTENT_TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': range ? range.end - range.start + 1 : st.size,
    'Accept-Ranges': 'bytes',
    ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${st.size}` } : {}),
    // The peer is a program; a browser that somehow lands here downloads
    // rather than renders — an svg must not become a document on this origin.
    'Content-Disposition': 'attachment',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (method === 'HEAD') {
    response.writeHead(200, headers).end();
    return true;
  }
  response.writeHead(range ? 206 : 200, headers);
  await new Promise((resolveDone) => {
    const stream = createReadStream(
      target.abs,
      range ? { start: range.start, end: range.end } : undefined
    );
    stream.on('error', () => {
      // Headers are gone; all we can do is cut the connection short so the
      // peer sees a length mismatch instead of a silently short file.
      try {
        response.destroy?.();
      } catch {
        /* best-effort */
      }
      resolveDone();
    });
    stream.on('end', resolveDone);
    stream.pipe(response);
  });
  return true;
}

function respond(response, status, message) {
  const body = JSON.stringify({ error: message });
  response
    .writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
      'X-Content-Type-Options': 'nosniff',
    })
    .end(body);
}

function respondRateLimited(response) {
  const body = JSON.stringify({ error: 'rate limit exceeded' });
  response
    .writeHead(429, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Retry-After': '60',
      'Content-Length': Buffer.byteLength(body),
      'X-Content-Type-Options': 'nosniff',
    })
    .end(body);
}
