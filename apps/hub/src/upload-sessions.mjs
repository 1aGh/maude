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
//   • A session belongs to the PERSON who made it (the token's owner; the
//     label for an ownerless token), and dies after SESSION_TTL_MS; its parts
//     never enter the checkout or the journal, so a half-uploaded file is
//     invisible to every peer.
//   • DURABLE beside the disk when the hub has object storage: the session
//     record and every verified part are copied to
//     `<tenant>/upload-sessions/<id>/` before the part is acknowledged, so a
//     hub on a fresh disk — a cloud cell after any restart — resumes instead
//     of answering "no such upload" (F3 S12, cloud, 2026-09-24). Parts a
//     restarted process does not hold locally are fetched at completion.

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

import { assetPrefixFromEnv } from './asset-key.mjs';
import { diskPressureRefusal, respondDiskPressure } from './disk.mjs';
import {
  currentHashFor,
  moveFile,
  quotaFor,
  seqFor,
  textFileMaxBytes,
  withPathLock,
} from './file-door.mjs';
import { MAX_PROJECT_FILE_BYTES, PART_BYTES } from './file-limits.mjs';
import { checkoutFileClass, resolveCheckoutFileWrite } from './file-manifest.mjs';
import {
  deleteObject,
  getObject,
  getObjectToFile,
  listObjects,
  putObject,
  putObjectFromFile,
} from './s3.mjs';
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

/**
 * The durable store for sessions on an object-storage-backed hub. Keys live
 * under the tenant's prefix, apart from `assets/`, so nothing that lists media
 * ever sees a part.
 */
export function s3UploadStore(cfg, prefix = assetPrefixFromEnv()) {
  const p = String(prefix ?? '').replace(/^\/+|\/+$/g, '');
  const base = `${p ? `${p}/` : ''}upload-sessions/`;
  const key = (id, name) => `${base}${id}/${name}`;
  const partName = (n) => `${String(n).padStart(6, '0')}.part`;
  return {
    async putSession(s) {
      await putObject(cfg, key(s.id, 'session.json'), JSON.stringify(s));
    },
    async getSession(id) {
      const b = await getObject(cfg, key(id, 'session.json'));
      return b ? JSON.parse(b.toString('utf8')) : null;
    },
    async listSessions() {
      const out = [];
      for (const o of await listObjects(cfg, base)) {
        if (!o.key.endsWith('/session.json')) continue;
        const b = await getObject(cfg, o.key).catch(() => null);
        if (b) out.push(JSON.parse(b.toString('utf8')));
      }
      return out;
    },
    async putPart(id, n, abs) {
      await putObjectFromFile(cfg, key(id, partName(n)), abs);
    },
    async listParts(id) {
      return (await listObjects(cfg, `${base}${id}/`))
        .map((o) => /\/(\d{6})\.part$/.exec(o.key)?.[1])
        .filter(Boolean)
        .map(Number);
    },
    async partToFile(id, n, abs) {
      return (await getObjectToFile(cfg, key(id, partName(n)), abs)) !== null;
    },
    async removeParts(id) {
      for (const o of await listObjects(cfg, `${base}${id}/`))
        if (o.key.endsWith('.part')) await deleteObject(cfg, o.key);
    },
    async remove(id) {
      for (const o of await listObjects(cfg, `${base}${id}/`)) await deleteObject(cfg, o.key);
    },
  };
}

function storeFor(ctx) {
  if (ctx.uploadStore !== undefined) return ctx.uploadStore;
  return ctx.s3 ? s3UploadStore(ctx.s3) : null;
}

/** The same PERSON: a fresh sign-in is a new token label, not a new owner. */
function owns(s, match) {
  if (s.owner) return s.owner === (match.owner ?? null);
  return s.label === match.label;
}

/** Best-effort durable copy: a store fault never fails the local session. */
async function durably(what, fn) {
  try {
    await fn();
    return true;
  } catch (err) {
    console.warn(`[hub] upload ${what} not made durable: ${err.message}`);
    return false;
  }
}

async function receivedAll(dataDir, s, store) {
  const local = receivedParts(dataDir, s);
  if (!store || s.completedAt) return local;
  let remote = [];
  try {
    remote = await store.listParts(s.id);
  } catch {
    /* the local view stands */
  }
  return [...new Set([...local, ...remote])].filter((n) => n < s.parts).sort((a, b) => a - b);
}

async function viewOf(dataDir, s, store) {
  return {
    ...view(dataDir, s),
    received: s.completedAt ? [] : await receivedAll(dataDir, s, store),
  };
}

function expired(s, now = Date.now()) {
  const age = now - (s.completedAt ?? s.createdAt);
  return age >= (s.completedAt ? 3600_000 : SESSION_TTL_MS);
}

/** Expired sessions leave the durable store too (checked on each creation). */
async function sweepDurable(store) {
  try {
    for (const s of await store.listSessions()) if (expired(s)) await store.remove(s.id);
  } catch {
    /* the next creation sweeps again */
  }
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
  const cls = checkoutFileClass(landing, ctx.designRoot);
  if (cls === 'code-module' && match.role !== 'owner') {
    return { status: 403, error: 'code modules may only be written by an owner-scoped token' };
  }
  return { target, landing, cls };
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
  const store = storeFor(ctx);

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
    // On a cell, code and companion text stay checkout files and are capped
    // (file-door.mjs `textFileMaxBytes`) — refused at creation, before a part.
    if (ctx.materializer && (ad.cls === 'code-module' || ad.cls === 'companion-text')) {
      const cap = textFileMaxBytes();
      if (size > cap) {
        respondJson(response, 413, {
          error: `over the ${cap}-byte ceiling for this file type`,
          maxBytes: cap,
        });
        return true;
      }
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
          owns(s, match) &&
          s.path === ad.landing &&
          s.sha256 === sha256 &&
          s.size === size
        ) {
          respondJson(response, 200, await viewOf(dataDir, s, store));
          return true;
        }
      }
    } catch {
      /* no sessions yet */
    }
    // …including one this process never saw, from the durable store.
    if (store) {
      await sweepDurable(store);
      let remote = [];
      try {
        remote = await store.listSessions();
      } catch {
        /* the store is down: a new session starts, locally */
      }
      const s = remote.find(
        (r) =>
          !r.completedAt &&
          !expired(r) &&
          owns(r, match) &&
          r.path === ad.landing &&
          r.sha256 === sha256 &&
          r.size === size
      );
      if (s) {
        saveSession(dataDir, s);
        respondJson(response, 200, await viewOf(dataDir, s, store));
        return true;
      }
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
      owner: match.owner ?? null,
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
    if (store) await durably(`${s.id} session`, () => store.putSession(s));
    respondJson(response, 201, view(dataDir, s));
    return true;
  }

  const id = rest[0];
  let s = loadSession(dataDir, id);
  if (!s && store && ID.test(id)) {
    // A process on a fresh disk: the durable record is the session.
    const remote = await store.getSession(id).catch(() => null);
    if (remote && !expired(remote)) {
      saveSession(dataDir, remote);
      s = remote;
    }
  }
  if (!s || !owns(s, match)) {
    respondJson(response, 404, { error: 'no such upload' });
    return true;
  }

  // ---- status / abort
  if (rest.length === 1) {
    if (method === 'GET') {
      respondJson(response, 200, await viewOf(dataDir, s, store));
      return true;
    }
    if (method === 'DELETE') {
      if (!s.completedAt) release(s);
      rmSync(dirOf(dataDir, s.id), { recursive: true, force: true });
      if (store) await durably(`${s.id} removal`, () => store.remove(s.id));
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
    // Assembly writes the whole file again beside its parts — the biggest
    // single write the hub makes. Below the disk floor it is a hold, not an
    // ENOSPC halfway through (disk.mjs). A replayed receipt above is free.
    const pressure = await diskPressureRefusal(ctx.designRoot);
    if (pressure) {
      respondDiskPressure(response, pressure);
      return true;
    }
    const missing = s.parts - (await receivedAll(dataDir, s, store)).length;
    if (missing > 0) {
      respondJson(response, 409, {
        error: `${missing} part(s) still missing`,
        ...(await viewOf(dataDir, s, store)),
      });
      return true;
    }
    // Parts this process does not hold on its own disk come back from the
    // durable store before assembly (a restarted cell resumed this session).
    if (store) {
      for (let n = 0; n < s.parts; n += 1) {
        const p = partPath(dataDir, s.id, n);
        let have = false;
        try {
          have = statSync(p).size === partSize(s, n);
        } catch {
          /* fetch it */
        }
        if (have) continue;
        mkdirSync(dirOf(dataDir, s.id), { recursive: true });
        const ok = await store.partToFile(s.id, n, p).catch(() => false);
        if (!ok) {
          respondJson(response, 409, {
            error: `part ${n} is missing`,
            ...(await viewOf(dataDir, s, store)),
          });
          return true;
        }
      }
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
      // CELL MODE (Task 12): inert media with no checkout copy is assembled in
      // the blob cache and pinned there, exactly as the single-PUT door does.
      const intoCache =
        Boolean(ctx.materializer) && ad.cls === 'inert-media' && !existsSync(target.abs);
      if (intoCache && !ctx.materializer.canPin()) {
        respondDiskPressure(response, {
          error: 'cache-pinned',
          detail: 'waiting for the bucket mirror',
        });
        return true;
      }
      mkdirSync(dirname(target.abs), { recursive: true });
      const tmp = intoCache
        ? ctx.materializer.tempPath()
        : `${target.abs}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
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
        if (store) await durably(`${s.id} removal`, () => store.remove(s.id));
        respondJson(response, 422, {
          error: 'the assembled file does not match its declared hash',
          got: whole,
        });
        return true;
      }
      if (intoCache) {
        ctx.materializer.pin(whole, tmp);
        ctx.onPinned?.({ path: s.path, sha256: whole, bytes: s.size });
        ctx.materializer.release(whole); // a no-op append needs no pin
      } else {
        moveFile(tmp, target.abs);
        ctx.onWritten?.({ path: s.path, bytes: s.size, sha256: whole });
      }
      const receipt = {
        ok: true,
        path: s.path,
        bytes: s.size,
        sha256: whole,
        seq: ctx.journal ? seqFor(ctx.journal, s.path) : null,
      };
      // The parts go; the receipt stays an hour, so a lost answer is replayed.
      for (let n = 0; n < s.parts; n += 1) rmSync(partPath(dataDir, s.id, n), { force: true });
      const completed = { ...s, completedAt: Date.now(), receipt };
      saveSession(dataDir, completed);
      if (store) {
        await durably(`${s.id} receipt`, () => store.putSession(completed));
        await durably(`${s.id} parts cleanup`, () => store.removeParts(s.id));
      }
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
    // Gated before the part's body is read (disk.mjs).
    const pressure = await diskPressureRefusal(ctx.designRoot);
    if (pressure) {
      respondDiskPressure(response, pressure);
      return true;
    }
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
    // Acknowledged only once it is durable (when the hub has a store).
    if (store)
      await durably(`${s.id} part ${n}`, () => store.putPart(s.id, n, partPath(dataDir, s.id, n)));
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
