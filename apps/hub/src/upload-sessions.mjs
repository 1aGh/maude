// Resumable upload sessions — plan T18 (DDR-226 file plane, DDR-241).
//
// One `PUT /api/file/<rel>` carries at most SINGLE_PUT_BYTES, under the
// platform's request cap. A real design project holds videos far past that
// (a 300 MB shoot, a 1.2 GB master), and a single request for one would die
// on the first flaky minute and start over from zero. So a large file goes up
// as a SESSION:
//
//   POST   /api/file-uploads                 {path, size, sha256}  → session
//   GET    /api/file-uploads/<id>                                  → parts received
//   PUT    /api/file-uploads/<id>/<n>        one part (x-maude-part-sha256)
//   POST   /api/file-uploads/<id>/complete   → the file lands, journal receipt
//   DELETE /api/file-uploads/<id>            → abort, reservation released
//
// What makes it safe, in the order a peer meets it:
//
//   • ADMISSION is the file door's: same token, scope, classifier on the real
//     landing path, owner gate on code modules, write rate limit.
//   • QUOTA IS RESERVED at creation for the whole size, so two concurrent
//     sessions cannot both pass a check neither could pass together; an abort
//     or an expiry gives it back.
//   • A PART is streamed to disk, hashed, and kept only when its hash matches;
//     re-sending a part is idempotent. Memory is one socket buffer.
//   • COMPLETION assembles the parts into a temp file beside the target,
//     hashing as it goes, and publishes only when the whole-object hash is the
//     one declared at creation — under the same per-path lock and
//     compare-and-swap as a single PUT, with the same journal receipt. A lost
//     completion answer is harmless: completing again returns the receipt.
//   • A session belongs to the token label that made it, and dies after
//     SESSION_TTL_MS; its parts never enter the checkout or the journal, so a
//     half-uploaded file is invisible to every peer.

import { createHash, randomBytes } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { currentHashFor, quotaFor, seqFor, withPathLock } from './file-door.mjs';
import { MAX_PROJECT_FILE_BYTES, PART_BYTES } from './file-limits.mjs';
import { checkoutFileClass, resolveCheckoutFileWrite } from './file-manifest.mjs';
import { matchesScope, verifyToken } from './tokens.mjs';

export const UPLOADS_PREFIX = '/api/file-uploads';
export const SESSION_TTL_MS = 24 * 3600_000;
const ID = /^up_[0-9a-f]{32}$/;
const SHA = /^[0-9a-f]{64}$/;

function respondJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response
    .writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
      'X-Content-Type-Options': 'nosniff',
    })
    .end(body);
}

async function readJson(request, max = 16 * 1024) {
  const chunks = [];
  let n = 0;
  for await (const c of request) {
    n += c.length;
    if (n > max) return null;
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

const sessionsDir = (dataDir) => join(dataDir, 'uploads');
const dirOf = (dataDir, id) => join(sessionsDir(dataDir), id);
const partPath = (dataDir, id, n) => join(dirOf(dataDir, id), `${String(n).padStart(6, '0')}.part`);

function loadSession(dataDir, id) {
  if (!ID.test(id)) return null;
  try {
    return JSON.parse(readFileSync(join(dirOf(dataDir, id), 'session.json'), 'utf8'));
  } catch {
    return null;
  }
}

function saveSession(dataDir, s) {
  const dir = dirOf(dataDir, s.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session.json.tmp'), JSON.stringify(s));
  renameSync(join(dir, 'session.json.tmp'), join(dir, 'session.json'));
}

function receivedParts(dataDir, s) {
  const out = [];
  for (let n = 0; n < s.parts; n += 1) {
    const p = partPath(dataDir, s.id, n);
    try {
      if (statSync(p).size === partSize(s, n)) out.push(n);
    } catch {
      /* not yet */
    }
  }
  return out;
}

function partSize(s, n) {
  return n < s.parts - 1 ? s.partBytes : s.size - s.partBytes * (s.parts - 1);
}

/** Expire sessions past their TTL — the reservation goes back to its token. */
export function sweepUploadSessions(dataDir, now = Date.now()) {
  let removed = 0;
  let names = [];
  try {
    names = readdirSync(sessionsDir(dataDir));
  } catch {
    return 0;
  }
  for (const id of names) {
    const s = loadSession(dataDir, id);
    const age = s ? now - (s.completedAt ?? s.createdAt) : Number.POSITIVE_INFINITY;
    const ttl = s?.completedAt ? 3600_000 : SESSION_TTL_MS;
    if (age < ttl) continue;
    if (s && !s.completedAt) release(s);
    rmSync(dirOf(dataDir, id), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

function release(s) {
  const row = quotaFor(s.label);
  row.used = Math.max(0, row.used - (s.reserved ?? 0));
}

function authorize(ctx) {
  const { request, dataDir, secret } = ctx;
  const auth = request.headers?.authorization;
  const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  const match = token ? verifyToken(dataDir, token, secret) : null;
  if (!match) return { status: 401, error: 'unauthorized' };
  if (match.readOnly) return { status: 403, error: 'this token is read-only' };
  if (!ctx.designRoot) return { status: 405, error: 'this hub does not accept file writes' };
  if (ctx.checkWriteRateLimit && !ctx.checkWriteRateLimit(match.label)) {
    return { status: 429, error: 'too many writes' };
  }
  return { match };
}

/** Admission for a path — the file door's rules, judged on the landing path. */
function admit(ctx, match, rel) {
  const target = resolveCheckoutFileWrite(ctx.designRoot, rel);
  if (!target.ok) return { status: 400, error: 'invalid path' };
  const landing = target.realRel;
  if (!matchesScope(match.scope, landing)) {
    return { status: 403, error: 'this token is not scoped to that path' };
  }
  if (checkoutFileClass(landing, ctx.designRoot) === 'code-module' && match.role !== 'owner') {
    return { status: 403, error: 'code modules may only be written by an owner-scoped token' };
  }
  return { target, landing };
}

async function streamPart(request, tmp, expected) {
  const hash = createHash('sha256');
  const out = createWriteStream(tmp);
  let total = 0;
  try {
    for await (const chunk of request) {
      total += chunk.length;
      if (total > expected) throw Object.assign(new Error('part too large'), { status: 413 });
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    }
    await new Promise((r, j) => out.end((err) => (err ? j(err) : r())));
  } catch (err) {
    out.destroy();
    rmSync(tmp, { force: true });
    throw err;
  }
  return { total, sha256: hash.digest('hex') };
}

/** Handle `/api/file-uploads[...]`. Returns true when it answered. */
export async function handleUploadSessions(ctx) {
  const { request, response, pathname, method, dataDir } = ctx;
  if (pathname !== UPLOADS_PREFIX && !pathname.startsWith(`${UPLOADS_PREFIX}/`)) return false;
  const rest = pathname.slice(UPLOADS_PREFIX.length).split('/').filter(Boolean);
  const maxBytes = ctx.maxSessionBytes ?? MAX_PROJECT_FILE_BYTES;
  const partBytes = ctx.partBytes ?? PART_BYTES;

  const a = authorize(ctx);
  if (!a.match) {
    respondJson(response, a.status, { error: a.error });
    return true;
  }
  const { match } = a;
  sweepUploadSessions(dataDir);

  // ---- create
  if (rest.length === 0) {
    if (method !== 'POST') {
      respondJson(response, 405, { error: 'method not allowed' });
      return true;
    }
    const body = await readJson(request);
    const rel = typeof body?.path === 'string' ? body.path : '';
    const size = Number(body?.size);
    const sha256 = typeof body?.sha256 === 'string' ? body.sha256.toLowerCase() : '';
    if (!rel || !Number.isInteger(size) || size <= 0 || !SHA.test(sha256)) {
      respondJson(response, 400, { error: 'path, size and sha256 are required' });
      return true;
    }
    if (size > maxBytes) {
      respondJson(response, 413, {
        error: `over the ${maxBytes}-byte project file ceiling`,
        maxBytes,
      });
      return true;
    }
    const ad = admit(ctx, match, rel);
    if (!ad.landing) {
      respondJson(response, ad.status, { error: ad.error });
      return true;
    }
    const expect = typeof body?.expectHash === 'string' ? body.expectHash.trim() : '';
    // Idempotent: the same person resuming the same bytes to the same place
    // gets the session they already have.
    try {
      for (const id of readdirSync(sessionsDir(dataDir))) {
        const s = loadSession(dataDir, id);
        if (
          s &&
          !s.completedAt &&
          s.label === match.label &&
          s.path === ad.landing &&
          s.sha256 === sha256 &&
          s.size === size
        ) {
          respondJson(response, 200, view(dataDir, s));
          return true;
        }
      }
    } catch {
      /* no sessions yet */
    }
    const row = quotaFor(match.label);
    if (row.used + size > row.cap) {
      respondJson(response, 507, {
        error: 'the upload quota for this hour is spent',
        quotaResetsAt: row.since + 3600_000,
      });
      return true;
    }
    row.used += size; // reserved for the whole object, now
    const s = {
      id: `up_${randomBytes(16).toString('hex')}`,
      label: match.label,
      path: ad.landing,
      size,
      sha256,
      expect,
      partBytes,
      parts: Math.ceil(size / partBytes),
      reserved: size,
      createdAt: Date.now(),
    };
    saveSession(dataDir, s);
    respondJson(response, 201, view(dataDir, s));
    return true;
  }

  const id = rest[0];
  const s = loadSession(dataDir, id);
  if (!s || s.label !== match.label) {
    respondJson(response, 404, { error: 'no such upload' });
    return true;
  }

  // ---- status / abort
  if (rest.length === 1) {
    if (method === 'GET') {
      respondJson(response, 200, view(dataDir, s));
      return true;
    }
    if (method === 'DELETE') {
      if (!s.completedAt) release(s);
      rmSync(dirOf(dataDir, s.id), { recursive: true, force: true });
      respondJson(response, 200, { ok: true, aborted: !s.completedAt });
      return true;
    }
    respondJson(response, 405, { error: 'method not allowed' });
    return true;
  }

  // ---- complete
  if (rest.length === 2 && rest[1] === 'complete') {
    if (method !== 'POST') {
      respondJson(response, 405, { error: 'method not allowed' });
      return true;
    }
    if (s.completedAt) {
      respondJson(response, 200, s.receipt);
      return true;
    }
    const missing = s.parts - receivedParts(dataDir, s).length;
    if (missing > 0) {
      respondJson(response, 409, {
        error: `${missing} part(s) still missing`,
        ...view(dataDir, s),
      });
      return true;
    }
    const ad = admit(ctx, match, s.path);
    if (!ad.landing) {
      respondJson(response, ad.status, { error: ad.error });
      return true;
    }
    const target = ad.target;
    return await withPathLock(s.path, async () => {
      const current = ctx.journal ? currentHashFor(ctx.journal, s.path) : null;
      if (s.expect && !(s.expect === 'none' ? current === null : current === s.expect)) {
        respondJson(response, 409, {
          error: 'the hub moved since you decided',
          path: s.path,
          current,
        });
        return true;
      }
      mkdirSync(dirname(target.abs), { recursive: true });
      const tmp = `${target.abs}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
      const hash = createHash('sha256');
      const out = createWriteStream(tmp);
      try {
        for (let n = 0; n < s.parts; n += 1) {
          for await (const chunk of createReadStream(partPath(dataDir, s.id, n))) {
            hash.update(chunk);
            if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          }
        }
        await new Promise((r, j) => out.end((err) => (err ? j(err) : r())));
      } catch (err) {
        out.destroy();
        rmSync(tmp, { force: true });
        console.error(`[hub] upload ${s.id} assembly failed: ${err.message}`);
        respondJson(response, 500, { error: 'assembly failed' });
        return true;
      }
      const whole = hash.digest('hex');
      if (whole !== s.sha256) {
        // The declared object is not what arrived: nothing lands, the session
        // is spent (its parts cannot be trusted either).
        rmSync(tmp, { force: true });
        release(s);
        rmSync(dirOf(dataDir, s.id), { recursive: true, force: true });
        respondJson(response, 422, {
          error: 'the assembled file does not match its declared hash',
          got: whole,
        });
        return true;
      }
      renameSync(tmp, target.abs);
      ctx.onWritten?.({ path: s.path, bytes: s.size, sha256: whole });
      const receipt = {
        ok: true,
        path: s.path,
        bytes: s.size,
        sha256: whole,
        seq: ctx.journal ? seqFor(ctx.journal, s.path) : null,
      };
      // The parts go; the receipt stays an hour, so a lost answer is replayed.
      for (let n = 0; n < s.parts; n += 1) rmSync(partPath(dataDir, s.id, n), { force: true });
      saveSession(dataDir, { ...s, completedAt: Date.now(), receipt });
      respondJson(response, 200, receipt);
      return true;
    });
  }

  // ---- one part
  if (rest.length === 2 && /^\d{1,6}$/.test(rest[1])) {
    if (method !== 'PUT') {
      respondJson(response, 405, { error: 'method not allowed' });
      return true;
    }
    if (s.completedAt) {
      respondJson(response, 409, { error: 'this upload is already complete' });
      return true;
    }
    const n = Number(rest[1]);
    if (n >= s.parts) {
      respondJson(response, 400, { error: 'no such part' });
      return true;
    }
    const expected = partSize(s, n);
    const declared = String(request.headers?.['x-maude-part-sha256'] ?? '')
      .trim()
      .toLowerCase();
    const tmp = `${partPath(dataDir, s.id, n)}.tmp-${randomBytes(4).toString('hex')}`;
    let got;
    try {
      got = await streamPart(request, tmp, expected);
    } catch (err) {
      respondJson(response, err.status ?? 500, { error: err.status ? err.message : 'part failed' });
      return true;
    }
    if (got.total !== expected || (declared && declared !== got.sha256)) {
      rmSync(tmp, { force: true });
      respondJson(response, 400, {
        error:
          got.total !== expected
            ? `part ${n} must be ${expected} bytes`
            : 'part hash does not match its bytes',
      });
      return true;
    }
    renameSync(tmp, partPath(dataDir, s.id, n));
    respondJson(response, 200, { ok: true, part: n, sha256: got.sha256 });
    return true;
  }

  respondJson(response, 404, { error: 'not found' });
  return true;
}

function view(dataDir, s) {
  return {
    id: s.id,
    path: s.path,
    size: s.size,
    partBytes: s.partBytes,
    parts: s.parts,
    received: s.completedAt ? [] : receivedParts(dataDir, s),
    state: s.completedAt ? 'complete' : 'open',
    expiresAt: s.createdAt + SESSION_TTL_MS,
  };
}

/** Test seam. */
export function uploadSessionExists(dataDir, id) {
  return existsSync(join(dirOf(dataDir, id), 'session.json'));
}
