// Authenticated asset proxy — Cloud Phase 3 Task 2 (hub side).
//
// A peer that has an asset REFERENCE but not the bytes asks the hub for them.
// The hub streams from the bucket after checking the peer's token.
//
// WHY A PROXY AND NOT A PRESIGNED URL. Two independent reasons, either
// sufficient:
//
//   1. The canvas origin's CSP is `img-src 'self'` (DDR-063/DDR-054) and stays
//      that way. Media has to arrive same-origin or it does not render.
//   2. A presigned URL is a bearer credential. Handing one to tenant-authored
//      canvas content puts a credential inside the least-trusted thing in the
//      system, where any script sharing that realm can read it — and it stays
//      valid after the page is closed.
//
// The proxy costs egress on the hub. R2's $0 egress is what makes that
// affordable, and it is a reason the provider decision (DDR-193 §1) is
// load-bearing here rather than incidental.
//
// WHAT THIS ROUTE IS NOT: a general object store. Only content-addressed
// `assets/<sha8>[.ext]` keys are reachable, validated by regex before any
// network call, so a hostile key can neither traverse the bucket nor probe for
// unrelated objects.

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { assetObjectKey, assetPrefixFromEnv } from './asset-key.mjs';
import { resolveCheckoutFileWrite } from './file-manifest.mjs';
import { isProjectFileShape } from './file-membership.mjs';
import { isContainedReal, realpathOfDeepestExisting } from './path-contain.mjs';
import { getObject, headObject } from './s3.mjs';
import { verifyToken } from './tokens.mjs';

/**
 * A content-addressed key: the name IS the hash of the bytes. Immutable, so it
 * can be cached forever.
 */
const CONTENT_ADDRESSED = /^[0-9a-f]{8}(?:\.[A-Za-z0-9]{1,8})?$/;

/**
 * Every key shape the proxy will serve.
 *
 * Content-addressing was the ONLY shape until Cloud Phase 15 put a real
 * project in a cell and found that real projects do not look like that. The
 * alligators design system references `/assets/graphics/camo-bg.png`,
 * `/assets/fonts/Gators-Bold.woff2`, `/assets/gator_badge_roundel.svg` — human
 * names, in subdirectories. `maude design fetch-asset` mints content-addressed
 * names for things it DOWNLOADS; a design system's own fonts and graphics are
 * authored, committed, and referenced by path. Serving only hashes meant a
 * hosted project rendered with its images missing and no error anywhere.
 *
 * The security properties that mattered are kept, and they were never about
 * the hash:
 *   - no `..` segment, no leading `/`, no backslash ⇒ cannot escape `assets/`;
 *   - a bounded, conservative charset ⇒ nothing that could be read as a
 *     control character, a query, or a second path;
 *   - depth and length caps ⇒ not a vehicle for absurd keys.
 * What the hash DID buy is cache-safety, and that is handled where it belongs:
 * only content-addressed keys get an immutable cache header (see below).
 */
const ASSET_KEY =
  /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}){0,4}$/;

/** Conservative content types, chosen by extension. Never sniffed, never
 *  taken from the client, and never `text/html` — an asset must not be able to
 *  become a document on the hub's origin. */
const CONTENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  json: 'application/json',
};

export function assetContentType(key) {
  const ext = key.includes('.') ? key.split('.').pop().toLowerCase() : '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/** True when the key is the hash of its own bytes ⇒ safe to cache forever. */
export function isContentAddressed(key) {
  return CONTENT_ADDRESSED.test(String(key ?? ''));
}

/** Parse `/assets/<path>` → the key, or null when it is not one we will serve. */
export function parseAssetPath(pathname) {
  const m = String(pathname ?? '').match(/^\/assets\/([^?#]+)$/);
  const key = m?.[1];
  if (!key || !ASSET_KEY.test(key)) return null;
  return key;
}

/** Keys the drift alert has already named — one line per key per boot. */
const bucketFallbackSeen = new Set();
const MAX_DRIFT_KEYS = 500;

/**
 * STORE-DRIFT ALERT (Sync v2 Increment 5). On a hub WITH a checkout, the
 * checkout is the serving truth and the bucket is its durable shadow: the boot
 * hydrate refills any gap, so steady-state bucket serving should be zero.
 * A bucket-served key after boot therefore means the checkout has drifted —
 * an alarm someone can act on, not a fallback quietly working.
 */
function noteBucketFallback(key) {
  if (bucketFallbackSeen.has(key) || bucketFallbackSeen.size >= MAX_DRIFT_KEYS) return;
  bucketFallbackSeen.add(key);
  console.warn(
    `[assets] STORE DRIFT: serving ${key} from the bucket — the checkout does not hold it. ` +
      'The boot hydrate should have restored this; a cell doing this in steady state needs looking at.'
  );
}

/**
 * Handle `GET /assets/<sha8>[.ext]`. Returns true when handled.
 *
 * @param {object} ctx
 * @param {import('node:http').IncomingMessage} ctx.request
 * @param {import('node:http').ServerResponse} ctx.response
 * @param {string} ctx.pathname
 * @param {string} ctx.method
 * @param {string} ctx.dataDir
 * @param {string} ctx.secret
 * @param {import('./s3.mjs').S3Config|null} ctx.s3
 * @param {(request: any) => boolean} [ctx.checkRateLimit]  UNAUTHENTICATED paths only (tight per-IP)
 * @param {(label: string) => boolean} [ctx.checkWriteRateLimit]  authenticated write lane (generous per-label)
 */
export async function handleAssetRoute(ctx) {
  const { request, response, pathname, method, dataDir, secret, s3 } = ctx;
  const key = parseAssetPath(pathname);
  if (key === null) return false;

  if (method !== 'GET' && method !== 'HEAD') {
    // GET/HEAD proxy only. The DDR-217 desktop PUT still answers on this URL,
    // but it is intercepted in server.mjs and delegated to the file door
    // (`PUT /api/file/<rel>`) — Sync v2 Increment 5's "one door" rule — so a
    // PUT reaching THIS handler means the dispatch order broke. Refuse loudly
    // rather than keep a second write path alive by accident.
    respond(response, 405, 'method not allowed (writes go through the file door)');
    return true;
  }

  const auth = request.headers?.authorization;
  const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  const match = token ? verifyToken(dataDir, token, secret) : null;
  if (!match) {
    if (ctx.checkRateLimit && !ctx.checkRateLimit(request)) {
      respondRateLimited(response);
      return true;
    }
    respond(response, 401, 'unauthorized');
    return true;
  }

  // ---- CHECKOUT FIRST, bucket second (the 2026-08-15 annotations-assets RCA).
  //
  // This route used to be bucket-ONLY, which made it lie about what the cell
  // can serve: a browser upload lands in the checkout instantly (and the studio
  // serves it to browsers from there), a git-mirror pull lands there too — but
  // until the bucket mirror caught up, a peer's asset pull got a 404 for a file
  // the very same process was serving on another route. For every peer without
  // the file plane that 404 was the ONLY downward path, so a freshly dropped
  // annotation image stayed a broken glyph on every other machine. The checkout
  // is exactly "what this cell can serve"; the bucket stays as the durable
  // fallback (and remains authoritative for hubs with no checkout at all).
  //
  // Containment mirrors the PUT branch: `key` already passed ASSET_KEY (no
  // `..`, bounded charset/depth), and `isContainedReal` resolves symlinks
  // before a byte is read.
  if (ctx.designRoot) {
    try {
      const assetsRoot = resolve(ctx.designRoot, 'assets');
      const abs = resolve(assetsRoot, key);
      if (
        (abs === assetsRoot || abs.startsWith(assetsRoot + sep)) &&
        isContainedReal(assetsRoot, abs) &&
        existsSync(abs) &&
        statSync(abs).isFile()
      ) {
        if (method === 'HEAD') {
          response
            .writeHead(200, {
              'Content-Type': assetContentType(key),
              'Content-Length': statSync(abs).size,
              ...cacheHeadersFor(key),
            })
            .end();
          return true;
        }
        // Buffered like the bucket branch below — same ceiling, same shape.
        const bytes = readFileSync(abs);
        response
          .writeHead(200, {
            'Content-Type': assetContentType(key),
            'Content-Length': bytes.length,
            ...cacheHeadersFor(key),
          })
          .end(bytes);
        return true;
      }
    } catch {
      /* checkout miss/unreadable — fall through to the bucket */
    }
  }

  // CELL MODE (cell materializer Task 11): the disk is a cache, so a checkout
  // miss is ordinary, not drift. The materializer fills from the bucket,
  // VERIFIES the bytes against the journal row, and the file is streamed —
  // never the old buffered whole-object GET, and never unverified bucket bytes
  // (a path-keyed object can be newer than the row; DDR-054). The drift alarm
  // lives in the materializer now, where it means something: a sha mismatch.
  if (ctx.materializer) {
    const got = await ctx.materializer.materialize(`assets/${key}`);
    if (got.path) {
      const headers = {
        'Content-Type': assetContentType(key),
        'Content-Length': got.size,
        ...cacheHeadersFor(key),
      };
      if (method === 'HEAD') {
        response.writeHead(200, headers).end();
        return true;
      }
      response.writeHead(200, headers);
      createReadStream(got.path)
        .on('error', () => response.destroy())
        .pipe(response);
      return true;
    }
    if (['timeout', 'full', 'unavailable'].includes(got.miss)) {
      response
        .writeHead(503, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Retry-After': '5',
        })
        .end(JSON.stringify({ error: 'fetching from storage', miss: got.miss }));
      return true;
    }
    respond(response, 404, 'not found');
    return true;
  }

  if (!s3) {
    // With a checkout present, a miss is a real answer (404); 503 stays for a
    // hub that has NO store of either kind.
    respond(
      response,
      ctx.designRoot ? 404 : 503,
      ctx.designRoot ? 'not found' : 'this hub has no asset store configured'
    );
    return true;
  }

  // STORE-DRIFT ALERT (Sync v2 Increment 5). With a checkout present, the
  // bucket is the durable SHADOW — serving from it means the checkout is
  // missing a file the hydrate pass should have restored at boot. That is an
  // alarm about checkout drift, not a fallback working as intended, and it
  // must be visible long before it is visible as a grey box.
  if (ctx.designRoot) noteBucketFallback(key);

  try {
    if (method === 'HEAD') {
      const meta = await headObject(
        s3,
        assetObjectKey(key, ctx.assetPrefix ?? assetPrefixFromEnv())
      );
      if (!meta) {
        respond(response, 404, 'not found');
        return true;
      }
      response
        .writeHead(200, {
          'Content-Type': assetContentType(key),
          'Content-Length': meta.size,
          ...cacheHeadersFor(key),
        })
        .end();
      return true;
    }

    const body = await getObject(s3, assetObjectKey(key, ctx.assetPrefix ?? assetPrefixFromEnv()));
    if (!body) {
      respond(response, 404, 'not found');
      return true;
    }
    response
      .writeHead(200, {
        'Content-Type': assetContentType(key),
        'Content-Length': body.length,
        ...cacheHeadersFor(key),
      })
      .end(body);
    return true;
  } catch (err) {
    console.error(`[hub] asset ${key} failed: ${err.message}`);
    respond(response, 502, 'asset store unavailable');
    return true;
  }
}

/**
 * The binary asset EXTENSIONS the checkout-file PUT accepts. Deliberately a
 * closed set of image/font/media types — NEVER `.tsx`/`.css`/`.json`/`.meta.json`,
 * so this route can never overwrite a canvas body, a stylesheet, or config.json
 * (which the studio child compiles/serves). Mirrors CONTENT_TYPES plus the font
 * types a DS ships (`Gators-Bold.woff2`).
 */
const CHECKOUT_ASSET_EXTS = new Set([
  ...Object.keys(CONTENT_TYPES).filter((e) => e !== 'json'),
  'woff2',
  'woff',
  'ttf',
  'otf',
]);

/**
 * Parse `/_asset-file/<rel>` → the decoded rel, SHAPE-checked, or null.
 *
 * feature-sync-file-plane: membership on this write surface is decided by the
 * positive classifier (`file-membership.mjs`), not by the assets-segment +
 * binary-extension rule any more — the sweep now carries `brand.css`,
 * `_brand-css.ts`, `README.md` up, and the DDR-217 asset classes ride the
 * same admission. This parser applies only the SHAPE half (relative, bounded,
 * charset-safe, leading `_` on the final segment only): a parse-stage refusal
 * is final (the request falls through), so it may refuse only what no
 * checkout configuration could ever admit. The CLASS half — which needs the
 * checkout's own canvas groups and tree — is `admitCheckoutFileRel`, applied
 * in the route where the checkout is known.
 *
 * The path stays UNTRUSTED (DDR-054); containment through symlinks is still
 * checked at the write site.
 */
export function parseCheckoutAssetPath(pathname) {
  const m = String(pathname ?? '').match(/^\/_asset-file\/([^?#]+)$/);
  if (!m) return null;
  let rel;
  try {
    rel = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  return isProjectFileShape(rel) ? rel : null;
}

/**
 * The ASSET-lane shape rules — `assets`-segment + binary extension on top of
 * `checkoutRelShape`. Returns the path, or null.
 *
 * feature-sync-file-plane: this is NO LONGER the `/_asset-file/` write
 * surface's gate — that surface admits by classifier membership
 * (`admitCheckoutFileRel`), and the probe/writer byte-for-byte agreement now
 * lives there. What still judges by THIS function is the cell main-origin
 * READ lane (`studio-manifest.mjs` `designAssetLane`), which was reviewed as
 * "the readable set is exactly the binary-asset set" and must not silently
 * widen because the write surface did.
 */
export function checkoutAssetRel(rel) {
  const parts = checkoutRelShape(rel);
  if (!parts) return null;
  if (!parts.includes('assets')) return null;
  const last = parts[parts.length - 1];
  const dot = last.lastIndexOf('.');
  if (dot < 0) return null;
  if (!CHECKOUT_ASSET_EXTS.has(last.slice(dot + 1).toLowerCase())) return null;
  return rel;
}

/**
 * The SEGMENT shape rules alone — relative, bounded, every component
 * charset-safe and starting alphanumeric (which is what keeps all DDR-115
 * runtime state — `_history/`, `_chat/`, `_comments/`, `_untrusted/` — out
 * without a rule naming it). Returns the split parts, or null.
 *
 * Extracted from `checkoutAssetRel` so a hub read lane that admits NON-asset
 * paths (the tokens-CSS lane in studio-manifest.mjs) judges shape by the exact
 * same rules as the asset write surface — the asset-specific `assets`-segment
 * and binary-extension requirements stay layered on top in `checkoutAssetRel`,
 * where the write route needs them.
 */
export function checkoutRelShape(rel) {
  if (typeof rel !== 'string') return null;
  if (!rel || rel.length > 512) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point.
  if (/[\u0000-\u001f\u007f]/.test(rel)) return null;
  if (rel.startsWith('/') || rel.includes('\\') || /^[A-Za-z]:/.test(rel)) return null;
  const parts = rel.split('/');
  if (parts.length < 2 || parts.length > 8) return null;
  for (const p of parts) {
    if (!p || p === '.' || p === '..') return null;
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(p)) return null;
    if (/ $/.test(p)) return null;
  }
  return parts;
}

/**
 * Where a checkout-relative asset path is allowed to land on disk, or `{ok:false}`.
 *
 * Two guards, both load-bearing, and this is their ONE home — the write route
 * and the presence probes must agree byte-for-byte about what is reachable, or
 * the probe becomes an oracle for paths the writer would refuse:
 *
 *   1. Containment, lexically AND through symlinks. `rel` already passed the
 *      shape rules (no `..`), but that is purely textual — a peer can COMMIT a
 *      symlink under `assets/` into the shared repo (DDR-054), so the on-disk
 *      resolution is what actually decides.
 *   2. The RESOLVED parent must still sit under an `assets/` directory. A
 *      committed `system/ds/assets/escape -> ../../ui` stays inside designRoot
 *      yet leaves the assets semantic this route is scoped to.
 *
 * Every filesystem op then uses `realParent/<basename>` — never the lexical
 * path (F1, attacker review 2026-08-11). A writer's mkdir/create/rename
 * would otherwise re-traverse the lexical path and follow whatever symlink sits
 * there at WRITE time, reopening the TOCTOU the realpath check just closed.
 */
export function resolveCheckoutAssetTarget(designRootRaw, rel) {
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
    if (!realParent.slice(realRoot.length).split(sep).includes('assets')) return { ok: false };
    return { ok: true, writeAbs: join(realParent, basename(abs)) };
  } catch {
    return { ok: false };
  }
}

/**
 * `PUT /_asset-file/<designRoot-rel>` — the checkout half of the desktop asset
 * push (DDR-217 addendum). Writes a DS/brand asset to the cell's checkout at
 * its real designRoot-relative path so the studio child's static serve finds
 * it. Peer-token gated (in the caller), shape-validated, symlink-contained,
 * size/budget capped. NO bucket mirror — these are checkout-served, not
 * proxied. Returns true when handled.
 */
export async function handleCheckoutAssetRoute(ctx) {
  const { request, response, pathname, method, dataDir, secret } = ctx;
  const rel = parseCheckoutAssetPath(pathname);
  if (rel === null) return false;

  // GET is admitted as a PRESENCE PROBE, and answers nothing else (RCA
  // 2026-08-11 part 2). On a Cloud cell a `HEAD` never arrives as one — proven
  // three ways: `HEAD /health` answers 200 although the hub matches that path
  // for GET only; `HEAD` here answered 405, the status only the non-PUT branch
  // can produce; and both hold under curl, so it is not a client artifact. The
  // sweep is HEAD-first, so on the cloud its skip-probe could never say "already
  // there" and every boot re-uploaded the entire DS asset set.
  //
  // It returns EXISTENCE, never bytes. Serving the file here would turn a write
  // route into a read surface for the checkout — a different trust question
  // than the one this route was reviewed for, and not one the sweep needs asked.
  if (method !== 'PUT' && method !== 'HEAD' && method !== 'GET') {
    respond(response, 405, 'method not allowed');
    return true;
  }
  const auth = request.headers?.authorization;
  const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  const match = token ? verifyToken(dataDir, token, secret) : null;
  if (!match) {
    if (ctx.checkRateLimit && !ctx.checkRateLimit(request)) {
      respondRateLimited(response);
      return true;
    }
    respond(response, 401, 'unauthorized');
    return true;
  }
  if (!ctx.designRoot) {
    respond(response, 405, 'this hub does not accept asset writes');
    return true;
  }

  // Classifier membership (feature-sync-file-plane): the three flowing
  // classes are admitted; `never` (config.json, runtime state, unclassified
  // extensions) and `canvas-owned` (a body or sidecar the CRDT lanes own)
  // refuse with 400. This is the PAIRED refusal the leading-underscore
  // relaxation ships with — `_brand-css.ts` is now writable exactly because
  // `_active.json` is now refused by NAME, not by its underscore. The class
  // is judged on the REAL landing path (symlink-resolved), and containment
  // rides in the same call — see `resolveCheckoutFileWrite`.
  const target = resolveCheckoutFileWrite(ctx.designRoot, rel);
  if (!target.ok) {
    respond(response, 400, 'invalid path');
    return true;
  }
  const writeAbs = target.abs;
  // Rate-limit BEFORE the HEAD branch too (F4) — otherwise the weakest role
  // gets an unmetered filesystem existence oracle with realpath amplification.
  // Same per-label write bucket as the bucket route's PUT (RCA 2026-08-11): the
  // desktop sweep is HEAD-first, so metering HEAD in the 5/min per-IP bucket
  // burned the whole budget on presence PROBES before a single byte moved.
  if (ctx.checkWriteRateLimit && !ctx.checkWriteRateLimit(match.label)) {
    respondRateLimited(response);
    return true;
  }

  // The desktop's skip-first presence probe (idempotent sweep — don't re-push a
  // large photo every boot). GET answers identically and with an empty body:
  // see the method gate above for why GET has to be one of these.
  if (method === 'HEAD' || method === 'GET') {
    if (existsSync(writeAbs)) {
      response
        .writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Length': 0,
          'X-Content-Type-Options': 'nosniff',
        })
        .end();
    } else {
      respond(response, 404, 'not found');
    }
    return true;
  }

  // PUT is intercepted in server.mjs and delegated to the file door
  // (`PUT /api/file/<rel>`) — Sync v2 Increment 5's "one door" rule. A PUT
  // reaching this handler means the dispatch order broke; refuse rather than
  // keep a second write path alive by accident.
  respond(response, 405, 'method not allowed (writes go through the file door)');
  return true;
}

/** The most paths one probe may ask about. A real project's whole asset set in
 *  one request (alligators: 182) with room to spare, and a bound on the work a
 *  single call can order. */
const MAX_PROBE_PATHS = 1000;

/** Cap on the probe's request body — MAX_PROBE_PATHS × a 512-char path, plus
 *  JSON overhead, rounded up. Read incrementally and abandoned the moment it is
 *  exceeded, so an oversized body is never buffered whole. */
const MAX_PROBE_BODY_BYTES = 768 * 1024;

async function readBoundedJson(request, cap) {
  let total = 0;
  const chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > cap) return { ok: false, tooLarge: true };
    chunks.push(chunk);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { ok: false };
  }
}

/**
 * `POST /_asset-probe` — "which of these do you already have?"
 *
 * WHY A BATCH, AND WHY POST (RCA 2026-08-11 part 2). The desktop sweep asked
 * per file, with HEAD. On a Cloud cell a HEAD does not survive the trip — it
 * arrives as GET — so the DS half of the sweep could never skip anything and
 * re-uploaded its whole asset set every boot, while the bucket half's converted
 * probe took the GET branch and pulled entire objects out of R2 to answer an
 * existence question (~428 MB per boot on a real project). A POST carrying the
 * list fixes both at once: the method it needs is the one that demonstrably
 * survives, and 182 round trips collapse into one.
 *
 * Both asset classes answer here, because the sweep does not want to care:
 * a top-level `assets/<key>` is looked up in the BUCKET (where that class
 * lives), anything else in the CHECKOUT (where the DS class lives) — the same
 * split, and the same validators, the write routes use.
 *
 * Paths are UNTRUSTED (DDR-054): each is re-validated with the very functions
 * the writers use, and one that fails validation is simply reported absent —
 * never an error the caller can use to map the filesystem, and never a path the
 * writer would refuse.
 *
 * Returns true when handled.
 */
export async function handleAssetProbeRoute(ctx) {
  const { request, response, pathname, method, dataDir, secret } = ctx;
  if (pathname !== '/_asset-probe') return false;
  if (method !== 'POST') {
    respond(response, 405, 'method not allowed');
    return true;
  }
  const auth = request.headers?.authorization;
  const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  const match = token ? verifyToken(dataDir, token, secret) : null;
  if (!match) {
    if (ctx.checkRateLimit && !ctx.checkRateLimit(request)) {
      respondRateLimited(response);
      return true;
    }
    respond(response, 401, 'unauthorized');
    return true;
  }
  // The same generous per-label bucket the writes use: this replaces the HEADs
  // that lane already metered, so it must not be tighter than what it replaces.
  if (ctx.checkWriteRateLimit && !ctx.checkWriteRateLimit(match.label)) {
    respondRateLimited(response);
    return true;
  }

  const body = await readBoundedJson(request, MAX_PROBE_BODY_BYTES);
  if (!body.ok) {
    respond(response, body.tooLarge ? 413 : 400, body.tooLarge ? 'body too large' : 'invalid body');
    return true;
  }
  const paths = body.value?.paths;
  if (!Array.isArray(paths)) {
    respond(response, 400, 'expected { paths: string[] }');
    return true;
  }
  if (paths.length > MAX_PROBE_PATHS) {
    respond(response, 413, `at most ${MAX_PROBE_PATHS} paths per probe`);
    return true;
  }

  // CHECKOUT-ONLY COMPAT SHIM (Sync v2 Increment 5). The probe used to answer
  // from both stores — checkout AND bucket — because the checkout could lag
  // the bucket after a wake. The boot hydrate now refills the checkout for
  // every plane class, so the checkout IS "what this cell can serve" and the
  // bucket half's object-store reads bought nothing but latency. Callers are
  // the legacy client window only (a plane-speaking desktop never probes);
  // answering "absent" for a file the bucket alone holds costs one idempotent
  // re-upload, which is the safe direction.
  const present = [];
  // CELL MODE (cell materializer Task 11 — amends "asset presence means BOTH
  // stores"): inert media lives in the bucket and a disk that is only a cache
  // says nothing. Present = a live journal row whose bytes are durable
  // (mirrored) or still held here pinned until they are.
  const cellHolds = (rel) => {
    const row = ctx.journal?.latestFor?.(rel);
    if (!row || row.deleted || !row.sha256 || row.class !== 'inert-media') return null;
    return row.mirroredAtMs != null || ctx.materializer.isPinned(row.sha256);
  };
  const holds = (rel) => {
    if (typeof rel !== 'string' || !ctx.designRoot) return false;
    if (ctx.materializer) {
      const cell = cellHolds(rel);
      if (cell !== null) return cell;
    }
    if (rel.startsWith('assets/')) {
      const key = rel.slice('assets/'.length);
      if (!ASSET_KEY.test(key)) return false;
      const mirror = resolveCheckoutAssetTarget(ctx.designRoot, rel);
      return mirror.ok && existsSync(mirror.writeAbs);
    }
    // Checkout-resident project files — judged by the SAME decision the write
    // door uses, so the probe can never answer about a path a writer would
    // refuse.
    const target = resolveCheckoutFileWrite(ctx.designRoot, rel);
    return target.ok && existsSync(target.abs);
  };
  for (const rel of paths) if (holds(rel)) present.push(rel);

  const payload = JSON.stringify({ present });
  response
    .writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(payload),
      'X-Content-Type-Options': 'nosniff',
    })
    .end(payload);
  return true;
}

// Content-addressed ⇒ the bytes under a key never change ⇒ cache forever. This
// is the payoff of content addressing: no invalidation, ever.
// `nosniff` is not optional here — the content type is chosen from an
// extension, and letting a browser sniff its way to text/html would turn an
// asset into a document on the hub's own origin.
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Disposition': 'inline',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

/**
 * Cache policy follows from the KEY, not from a guess.
 *
 * A content-addressed key can never point at different bytes, so it is
 * immutable and cacheable forever. A human-named one can be replaced by its
 * author tomorrow — caching that for a year means the design system's own font
 * or logo is stale in every browser that ever loaded it, with no way to
 * invalidate. `no-cache` still allows revalidation; it just forbids serving a
 * stale copy blind.
 */
function cacheHeadersFor(key) {
  return isContentAddressed(key)
    ? { ...BASE_HEADERS, 'Cache-Control': 'public, max-age=31536000, immutable' }
    : { ...BASE_HEADERS, 'Cache-Control': 'no-cache' };
}

function respond(response, status, message, extraHeaders = null) {
  const body = JSON.stringify({ error: message });
  response
    .writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
      'X-Content-Type-Options': 'nosniff',
      ...(extraHeaders ?? {}),
    })
    .end(body);
}

/**
 * A 429 that TELLS the caller when to come back. The admin API has always sent
 * `Retry-After` (`respondRateLimited`, server.mjs); the asset routes did not,
 * so the desktop push had nothing to pace itself with even if it wanted to —
 * it just burned the rest of the window into instant refusals (RCA 2026-08-11).
 * 60 s == RATE_LIMIT_WINDOW_MS, the widest either bucket makes you wait.
 */
function respondRateLimited(response) {
  respond(response, 429, 'rate limit exceeded', { 'Retry-After': '60' });
}
