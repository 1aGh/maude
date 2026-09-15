// The single file write door — Sync v2 Increment 3/4 (DDR-226 §5).
//
// `PUT /api/file/<rel>` is where every peer write to the file plane lands. It
// exists now, beside the two older asset doors, because the journal engine
// needs two things they cannot give:
//
//   1. **COMPARE-AND-SWAP.** A push says which hub state it decided FROM
//      (`x-maude-expect-hash`). If the hub has moved since, the write is
//      refused with 409 and the current hash, and the peer re-decides. Without
//      it, two peers editing one file inside a poll round-trip resolve as
//      silent last-writer-wins AT THE DOOR — no conflict copy materializes
//      anywhere, and the design's "both ends SEE it" guarantee is false in
//      exactly the live-concurrent case it exists for.
//
//      The precondition is re-asked under a per-path publish lock that also
//      holds the rename and the journal append. Checking it only up front
//      would leave the whole body upload as the window, which is seconds to
//      minutes for a real asset — a narrower version of the same loss, not a
//      fix for it.
//   2. **A RECEIPT.** The response carries `{ seq, sha256 }`, which is what
//      moves a file from `local-only` to `on-hub` in the doručenka. A push you
//      cannot name is a push you cannot report.
//
// ── What is new here beyond the old doors ───────────────────────────────────
//
// An OWNER-ROLE GATE on `code-module` writes. Until now the class was checked
// but the role was not: `handleCheckoutAssetRoute` admits any peer token that
// passes the classifier, and the only owner gate on code modules lived on the
// RECEIVER (`allowCodeModules` in the desktop pull). A gate that exists on one
// side of a two-sided lane is half a gate — so the door now asks too.
//
// ── What is deliberately unchanged ──────────────────────────────────────────
//
// Every cap, shape gate and containment rule from DDR-217's addendum applies
// verbatim, because they are the mitigations that make a binary write door
// safe at all: anchored path shape, classifier admission judged on the REAL
// (symlink-resolved) landing path, writes to the RESOLVED parent, per-file and
// per-token windowed byte quotas, streaming with a mid-stream cap, tmp+rename.
// This door adds preconditions; it relaxes nothing.

import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import {
  checkoutFileClass,
  resolveCheckoutFileWrite,
  resolveProjectFileTarget,
} from './file-manifest.mjs';
import { MAX_PROJECT_FILE_BYTES, PART_BYTES, SINGLE_PUT_BYTES, sha256File } from './file-limits.mjs';
import { matchesScope, verifyToken } from './tokens.mjs';

/** `PUT /api/file/<rel>` — the single door. */
export const FILE_DOOR_PREFIX = '/api/file/';

/** One PUT body. Kept BELOW the platform's own body limit on purpose; a larger
 *  file goes up as an upload session (upload-sessions.mjs, plan T18). */
const MAX_FILE_BYTES = SINGLE_PUT_BYTES;

/**
 * Per-token, per-window write quota — DDR-226 §9's "cumulative per-hub
 * accumulation quota", made observable instead of implicit.
 *
 * It used to be one module-level `{cap, used}` shared by every token and never
 * decayed: after 2 GiB of entirely legitimate cumulative writes the door
 * answered 507 for EVERYONE until the process restarted. On a cell a restart is
 * the normal path, so the failure was intermittent and read as "sync randomly
 * stops working" — and one token uploading 2 GiB locked the door for the whole
 * tenant. A quota that punishes the innocent for the guilty's traffic is not a
 * quota, it is an outage with a threshold.
 */
const QUOTA_BYTES_PER_WINDOW = 2 * 1024 * 1024 * 1024;
const QUOTA_WINDOW_MS = 60 * 60 * 1000;

/** label → { used, since }. Rolls forward whole windows rather than sliding. */
const quotas = new Map();

/**
 * The live quota row for `label`, rolled to the current window.
 *
 * Shaped like the old `{cap, used}` so `streamAndHash` is unchanged, and
 * returned by reference so the post-write charge lands on the right row.
 */
export function quotaFor(label, now = Date.now(), windowMs = QUOTA_WINDOW_MS) {
  const key = label || '<anonymous>';
  let row = quotas.get(key);
  if (!row || now - row.since >= windowMs) {
    row = { cap: QUOTA_BYTES_PER_WINDOW, used: 0, since: now };
    quotas.set(key, row);
  }
  return row;
}

/** What `/health` reports: one entry per token that has written this window. */
export function quotaSnapshot(now = Date.now(), windowMs = QUOTA_WINDOW_MS) {
  const out = [];
  for (const [label, row] of quotas) {
    if (now - row.since >= windowMs) continue;
    out.push({ label, used: row.used, cap: row.cap, windowStarted: row.since });
  }
  return out;
}

/** Test seam — the quota map is process-global by design. */
export function resetQuotas() {
  quotas.clear();
}

/**
 * Parse `/api/file/<rel>` into a designRoot-relative path.
 *
 * Percent-decoded per segment (a path may contain characters a URL escapes),
 * then handed to the classifier — which is what actually decides admission.
 * Anything malformed is null rather than a guess.
 */
/** `GET /api/file-limits` — what this door will and will not accept. */
export const FILE_LIMITS_PATH = '/api/file-limits';

/**
 * The ceilings, as data, so a client can stop guessing them.
 *
 * WHY THIS ROUTE EXISTS. The push side used its OWN constant — 512 MB, the
 * PULL cap — while this door has always refused anything over 95 MB. So a
 * client would scan, queue, hash, and upload a 465 MB video that was never
 * going to be accepted, burn a request slot on it every single pass, and store
 * an anonymous `stuck` against it forever. Two files in one real project
 * (164.9 MB and 465.8 MB) did exactly that. A ceiling only one side knows is
 * not a contract, it is a trap.
 *
 * Unauthenticated on purpose: it reveals only what the door would answer to
 * any caller anyway, and a client needs it BEFORE it has decided to trust the
 * hub with bytes. The per-token quota figures are only included when a token
 * identifies itself.
 */
export function fileLimits(label = null, now = Date.now()) {
  const base = {
    maxFileBytes: MAX_FILE_BYTES,
    // T18 — beyond one PUT: resumable upload sessions up to the project-file
    // ceiling, in parts of `partBytes`.
    uploadSessions: true,
    maxSessionBytes: MAX_PROJECT_FILE_BYTES,
    partBytes: PART_BYTES,
    quotaBytesPerWindow: QUOTA_BYTES_PER_WINDOW,
    quotaWindowMs: QUOTA_WINDOW_MS,
  };
  if (!label) return base;
  const row = quotaFor(label, now);
  return {
    ...base,
    quotaUsed: row.used,
    quotaResetsAt: row.since + QUOTA_WINDOW_MS,
  };
}

/**
 * Handle `GET /api/file-limits`. Returns true when it answered.
 *
 * @param {object} ctx
 * @param {(req: object) => boolean} [ctx.checkRateLimit] per-IP throttle, same
 *   shape the file door and the asset routes use.
 */
export function handleFileLimits(ctx) {
  const { request, response, pathname, method, dataDir, secret } = ctx;
  if (pathname !== FILE_LIMITS_PATH) return false;
  if (method !== 'GET') {
    respond(response, 405, 'method not allowed');
    return true;
  }
  // A token is OPTIONAL here — with one, the caller also learns its own quota
  // position; without one, it still learns the ceilings.
  const auth = request.headers?.authorization;
  const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  // Only the token verification is metered — HMAC plus a SQLite lookup, the
  // expensive half an unauthenticated caller must not drive at will. The
  // ceilings themselves are static and public, and a 429 here used to be
  // fatal: a whole team behind one address spent the per-IP allowance, the
  // client fell back to the single-request ceiling, and every large video was
  // refused as "too big" until the next boot (T32 scale run). Metered, the
  // caller still gets the ceilings — just not its quota position.
  if (token && ctx.checkRateLimit && !ctx.checkRateLimit(request)) {
    respondJson(response, 200, fileLimits(null));
    return true;
  }
  const match = token ? verifyToken(dataDir, token, secret) : null;
  respondJson(response, 200, fileLimits(match?.label ?? null));
  return true;
}

export function parseFileDoorPath(pathname) {
  if (!pathname.startsWith(FILE_DOOR_PREFIX)) return null;
  const raw = pathname.slice(FILE_DOOR_PREFIX.length);
  if (!raw) return null;
  let rel;
  try {
    rel = raw
      .split('/')
      .map((s) => decodeURIComponent(s))
      .join('/');
  } catch {
    return null;
  }
  if (rel.length === 0 || rel.length > 512) return null;
  if (rel.startsWith('/') || rel.includes('\\') || rel.includes('\0')) return null;
  if (rel.split('/').includes('..') || rel.split('/').includes('.')) return null;
  return rel;
}

function respond(response, status, message) {
  const body = JSON.stringify({ error: message });
  response
    .writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
      'X-Content-Type-Options': 'nosniff',
      Connection: 'close',
      // A 429 that TELLS the caller when to come back — the contract the
      // legacy asset routes carried (RCA 2026-08-11), preserved here now that
      // their PUTs delegate to this door. 60 s == the rate-limit window.
      ...(status === 429 ? { 'Retry-After': '60' } : {}),
    })
    .end(body);
}

function respondJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response
    .writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
      'X-Content-Type-Options': 'nosniff',
      Connection: 'close',
    })
    .end(body);
}

/**
 * Stream the body to `abs` via temp + rename, hashing as it goes.
 *
 * The hash is computed FROM THE BYTES THAT LANDED, never from a header — a
 * declared hash is a claim, and this route's whole job is to turn claims into
 * facts. Over-cap aborts mid-stream and removes the partial rather than
 * buffering a 95 MB body to find out.
 */
async function streamAndHash(request, abs, { maxBytes, budget }) {
  if (budget.used >= budget.cap) {
    return { ok: false, status: 507, message: 'write quota for this token is exhausted' };
  }
  const tmp = `${abs}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  const hash = createHash('sha256');
  let total = 0;
  try {
    mkdirSync(dirname(abs), { recursive: true });
    const ws = createWriteStream(tmp);
    ws.on('error', () => {});
    const effectiveCap = Math.min(maxBytes, budget.cap - budget.used);
    try {
      for await (const chunk of request) {
        total += chunk.length;
        if (total > effectiveCap) {
          const err = new Error('too large');
          err.tooLarge = true;
          throw err;
        }
        hash.update(chunk);
        if (!ws.write(chunk)) await once(ws, 'drain');
      }
      await new Promise((res, rej) => {
        ws.end((err) => (err ? rej(err) : res()));
      });
    } catch (err) {
      ws.destroy();
      await once(ws, 'close');
      rmSync(tmp, { force: true });
      return err.tooLarge
        ? {
            ok: false,
            status: 413,
            message: `file exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB cap`,
          }
        : { ok: false, status: 500, message: 'write failed' };
    }
    return { ok: true, total, sha256: hash.digest('hex'), tmp };
  } catch (err) {
    rmSync(tmp, { force: true });
    return { ok: false, status: 500, message: 'write failed', detail: err.message };
  }
}

/**
 * Handle `PUT /api/file/<rel>`. Returns true when it answered.
 *
 * @param {object} ctx
 * @param {string|null} ctx.designRoot   the checkout's design root, or null
 * @param {object|null} ctx.journal      the file journal, or null
 * @param {(info: {path: string}) => void} [ctx.onWritten]
 */
export async function handleFileDoor(ctx) {
  const { request, response, pathname, method, dataDir, secret } = ctx;
  const rel = parseFileDoorPath(pathname);
  if (rel === null) return false;

  if (method !== 'PUT' && method !== 'DELETE') {
    respond(response, 405, 'method not allowed');
    return true;
  }

  const auth = request.headers?.authorization;
  const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  const match = token ? verifyToken(dataDir, token, secret) : null;
  if (!match) {
    if (ctx.checkRateLimit && !ctx.checkRateLimit(request)) {
      respond(response, 429, 'too many requests');
      return true;
    }
    respond(response, 401, 'unauthorized');
    return true;
  }
  if (match.readOnly) {
    respond(response, 403, 'this token is read-only');
    return true;
  }
  if (!ctx.designRoot) {
    respond(response, 405, 'this hub does not accept file writes');
    return true;
  }
  if (ctx.checkWriteRateLimit && !ctx.checkWriteRateLimit(match.label)) {
    respond(response, 429, 'too many writes');
    return true;
  }

  // Admission: shape, containment through symlinks, and the class judged on the
  // REAL landing path. Same call the older checkout door makes.
  const target = resolveCheckoutFileWrite(ctx.designRoot, rel);
  if (!target.ok) {
    respond(response, 400, 'invalid path');
    return true;
  }

  // Every decision from here on is asked about `landing`, never the lexical
  // `rel`. Admission already judged the class on the symlink-resolved path;
  // asking the role, the CAS and the journal about a DIFFERENT path is how a
  // committed directory symlink (DDR-054 — a peer can commit one) walks a
  // write past a gate that admission had already classified correctly.
  const landing = target.realRel;

  // Scope confinement, the same gate the READ half of this lane applies
  // (`handleProjectFileRoute`, `handleJournalRoutes`). Without it a token
  // scoped to one canvas can WRITE the whole project's file plane while being
  // unable to read most of it back — and a leaked low-value token becomes a
  // project-wide write primitive (DDR-053 §3).
  if (!matchesScope(match.scope, landing)) {
    respond(response, 403, 'this token is not scoped to that path');
    return true;
  }

  // NEW — the owner gate on code modules, at the DOOR.
  //
  // The receiver has gated this since the file plane shipped; the door never
  // did. A gate on one side of a two-sided lane is half a gate: any peer token
  // could land executable modules in a project's `system/**`, and the only
  // thing stopping them was that the OTHER peers would refuse to pull them.
  const cls = checkoutFileClass(landing, ctx.designRoot);
  if (cls === 'code-module' && match.role !== 'owner') {
    // 403 rather than 400: the path is fine, the credential is not, and
    // saying so is what lets a peer report something a person can act on.
    respond(response, 403, 'code modules may only be written by an owner-scoped token');
    return true;
  }

  // COMPARE-AND-SWAP against what the peer decided from.
  //
  // `x-maude-expect-hash: <sha256>` — the hub must currently hold this.
  // `x-maude-expect-hash: none`     — the hub must currently hold NOTHING.
  // absent                          — no precondition (a first push, or an
  //                                    older client; the compat matrix keeps
  //                                    those working).
  //
  // Asked TWICE: here, so a doomed push is refused before its body crosses the
  // wire, and again under the publish lock below, which is the one that binds.
  const expect = String(request.headers?.['x-maude-expect-hash'] ?? '').trim();

  if (method === 'DELETE') {
    return await handleDelete({ ctx, response, landing, target, expect });
  }
  const casHolds = () => {
    if (!expect) return { ok: true };
    const current = ctx.journal ? currentHashFor(ctx.journal, landing) : null;
    const matches = expect === 'none' ? current === null : current === expect;
    return matches ? { ok: true } : { ok: false, current };
  };

  const pre = casHolds();
  if (!pre.ok) {
    // 409 with the CURRENT state, so the peer can re-decide immediately
    // instead of polling to discover what it collided with.
    respondJson(response, 409, {
      error: 'the hub moved since you decided',
      path: landing,
      current: pre.current,
    });
    return true;
  }

  // The quota is per TOKEN and per window, so one peer's legitimate bulk
  // upload cannot lock the door for the tenant (see `quotaFor`).
  const budget = ctx.budget ?? quotaFor(match.label);
  const r = await streamAndHash(request, target.abs, {
    maxBytes: ctx.maxFileBytes ?? MAX_FILE_BYTES,
    budget,
  });
  if (!r.ok) {
    if (r.detail) console.error(`[hub] file door ${landing} failed: ${r.detail}`);
    respond(response, r.status, r.message);
    return true;
  }

  // The declared content hash is checked AGAINST WHAT LANDED. A mismatch is a
  // truncated or tampered upload; the bytes are discarded rather than kept.
  const declared = String(request.headers?.['x-maude-content-sha256'] ?? '').trim();
  if (declared && declared !== r.sha256) {
    rmSync(r.tmp, { force: true });
    respond(response, 400, 'content hash does not match the bytes sent');
    return true;
  }

  // Re-check, rename and journal as ONE step per path. A crossing write that
  // passed the pre-check while this body was uploading is refused here, with a
  // conflict the peer can act on — instead of overwriting these bytes with no
  // copy of them anywhere.
  return await withPathLock(landing, async () => {
    const post = casHolds();
    if (!post.ok) {
      rmSync(r.tmp, { force: true });
      respondJson(response, 409, {
        error: 'the hub moved while your body was in flight',
        path: landing,
        current: post.current,
      });
      return true;
    }

    try {
      renameSync(r.tmp, target.abs);
    } catch (err) {
      rmSync(r.tmp, { force: true });
      console.error(`[hub] file door ${landing} rename failed: ${err.message}`);
      respond(response, 500, 'write failed');
      return true;
    }
    budget.used += r.total;

    // The journal append + the bucket mirror, through the one notifier. The row
    // it produces is the receipt below — and it names where the bytes ACTUALLY
    // landed, so a symlinked path cannot alias one file under two CAS states.
    ctx.onWritten?.({ path: landing, bytes: r.total });

    const seq = ctx.journal ? seqFor(ctx.journal, landing) : null;
    respondJson(response, 200, {
      ok: true,
      path: landing,
      bytes: r.total,
      sha256: r.sha256,
      seq,
    });
    return true;
  });
}

/**
 * `DELETE /api/file/<rel>` — Increment 6.
 *
 * A tombstone is a JOURNAL ROW, not an absence: the log is what peers read, so
 * "this was deleted at seq N" has to be a statement they can receive in order,
 * exactly like a write. An absence would be indistinguishable from a file the
 * hub never had, and absence-as-authority is what DDR-076 forbids.
 *
 * The bytes are QUARANTINED, never unlinked. `_trash/` on the hub is the same
 * recoverability spine the peers use.
 *
 * WHAT ELSE STILL HOLDS A COPY, precisely — an earlier version of this comment
 * claimed object storage keeps every deleted file, and that is true of exactly
 * one class:
 *
 *   assets/**            CAS blob in object storage. Content-addressed, so a
 *                        delete unreferences it and never removes it.
 *   everything else      the hub's own git history, and only because the
 *                        workspace agent force-stages the design root
 *                        (`stageIgnored`) — a hub-owned project gitignores it,
 *                        and generation backups bundle committed objects only.
 *
 * So `companion-text` and `code-module` are durable through history, not
 * through the bucket. Widening the object-storage mirror to the whole plane is
 * Increment 5's write-behind; until then, do not describe this route as
 * bucket-durable for anything but assets.
 *
 * Same CAS as a write, same publish lock, same journal append. A delete that
 * raced somebody's edit loses the race and says so, which is the whole point:
 * an edit beats a delete, and the peer re-decides against the hash it is told.
 */
async function handleDelete({ ctx, response, landing, target, expect }) {
  return await withPathLock(landing, async () => {
    // B14 (post-1.0 burn-down) — the precondition is REQUIRED on DELETE.
    // Every real client has sent `x-maude-expect-hash` since Increment 6
    // (`file-plane.ts` pushDelete sends `expect ?? 'none'`), so nothing
    // legitimate is refused — and "remove whatever is there, no questions"
    // stops being an expressible request. 428 Precondition Required, so a
    // scripted caller learns exactly what to add.
    if (!expect) {
      respondJson(response, 428, {
        error: 'DELETE requires x-maude-expect-hash (the ancestor sha256, or "none")',
        path: landing,
      });
      return true;
    }

    // F-14 — "no journal row" is NOT "already deleted" when the bytes are on
    // disk. A fresh checkout before boot-scan, or a file the git plane placed,
    // has no row yet; answering `deleted: true, noop: true` made the peer run
    // `ledger.forget` while the hub kept the file — the next walk-import
    // journals it and every peer pulls it back ("you delete a file and it
    // comes back", the sentence Increment 6 exists to make false). The CAS
    // for this branch compares against the DISK bytes, the only truth there is.
    const journalHash = ctx.journal ? currentHashFor(ctx.journal, landing) : null;
    const onDisk = existsSync(target.abs);
    if (journalHash === null && !onDisk) {
      // Genuinely absent everywhere, or already tombstoned. Idempotent by
      // construction — a retry after a dropped response must not be an error.
      respondJson(response, 200, { ok: true, path: landing, deleted: true, noop: true });
      return true;
    }
    const current = journalHash ?? hashFileOnDisk(target.abs);
    if (current === null) {
      // The file vanished between the existsSync and the read — absent wins.
      respondJson(response, 200, { ok: true, path: landing, deleted: true, noop: true });
      return true;
    }

    // F-8 — `'none'` means THE SAME THING on both verbs: "the hub must
    // currently hold nothing". We are past the absent branch, so the hub holds
    // something and a `none` DELETE is a conflict, never an unconditional
    // purge. (PUT has said this since the door shipped; DELETE inherited a
    // leniency with no reason of its own — and "write whatever is there" and
    // "remove whatever is there" are not the same risk.)
    if (current !== expect) {
      respondJson(response, 409, {
        error: 'the hub moved since you decided',
        path: landing,
        current,
      });
      return true;
    }

    // THE DELETE BREAKER, AT THE DOOR (F-1).
    //
    // The desktop has refused a runaway delete since `propagateDeletes` shipped
    // ON; the hub accepted an unbounded stream of them. That is the lossy
    // direction — a tombstone admitted here is a delete every peer applies —
    // and the shapes it guards against are ordinary, not exotic: a branch
    // switch, a `git clean`, a botched restore on one machine. In each the
    // mechanism works perfectly and the outcome is a disaster, so the control
    // is a rate rather than a permission.
    //
    // Checked INSIDE the path lock and BEFORE the quarantine, so a burst of
    // concurrent DELETEs cannot each read the budget as available and then all
    // spend it, and so nothing is moved for a request that is about to be
    // refused.
    const budget = ctx.journal?.deleteBudget?.() ?? { ok: true };
    if (!budget.ok) {
      // 429, not 403: the credential is fine and the path is fine — this is a
      // rate, and a rate is something the caller can act on by waiting or by
      // asking a person whether the purge was meant.
      respondJson(response, 429, {
        error: 'deletion breaker: too many deletions in this window — refusing to delete more',
        path: landing,
        used: budget.used,
        limit: budget.limit,
        windowMs: budget.windowMs,
      });
      return true;
    }

    // QUARANTINE BEFORE THE ROW. If the copy cannot be parked the tombstone is
    // refused, because a deletion nobody can undo is not one this lane makes.
    let parked = null;
    try {
      parked = quarantineForDelete(ctx.designRoot, target.abs, landing);
    } catch (err) {
      console.error(`[hub] file door DELETE ${landing} could not quarantine: ${err.message}`);
      respond(response, 500, 'could not quarantine the file — refusing to delete it');
      return true;
    }

    // F-7 — the receipt must name the TOMBSTONE, or admit there is none.
    // `onDeleted` used to be fire-and-forget while the response reported
    // `latestFor(rel)?.seq` — after a failed append that is the PREVIOUS
    // WRITE's seq: a receipt naming a row that says the file exists, handed to
    // a peer that will run `ledger.forget` on the strength of it. Now the
    // append result comes back; when no tombstone row was produced the
    // quarantined bytes are put back and the answer is a 500, because a delete
    // the journal never heard of is a delete that did not happen.
    let tombstone = null;
    if (ctx.onDeleted) {
      tombstone = ctx.onDeleted({ path: landing, parked }) ?? null;
      if (!tombstone) {
        if (parked) {
          try {
            mkdirSync(dirname(target.abs), { recursive: true });
            renameSync(join(ctx.designRoot, parked), target.abs);
          } catch (err) {
            console.error(
              `[hub] file door DELETE ${landing}: tombstone failed AND the quarantined copy could not be restored: ${err.message}`
            );
          }
        }
        respond(response, 500, 'the deletion could not be journaled — nothing was deleted');
        return true;
      }
    }
    const seq = tombstone?.seq ?? null;
    respondJson(response, 200, { ok: true, path: landing, deleted: true, parked, seq });
    return true;
  });
}

/**
 * Move `abs` into `<designRoot>/_trash/<stamp>/<rel>` and return the trash rel.
 *
 * `_trash/` is DDR-115 runtime state: gitignored, per-machine, never synced.
 * That is deliberate — a quarantine that replicated would turn one person's
 * delete into everyone's copy of the deleted file.
 */
function quarantineForDelete(designRoot, abs, rel) {
  if (!existsSync(abs)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destRel = `_trash/${stamp}/${rel}`;
  // The DESTINATION gets the same two-guard treatment every write destination
  // on this hub gets. It is the one that decides whether "quarantined, never
  // unlinked" is true: a symlinked `_trash/` that lands the file outside the
  // design root is a deletion wearing a recovery story.
  const target = resolveProjectFileTarget(designRoot, destRel);
  if (!target.ok) {
    throw new Error('_trash/ does not resolve inside the design root');
  }
  mkdirSync(dirname(target.abs), { recursive: true });
  renameSync(abs, target.abs);
  return destRel;
}

/**
 * One in-flight publish per path, process-wide.
 *
 * The up-front CAS is a fail-fast, not the guarantee: between reading the
 * current hash and renaming the temp file sits the whole body upload, which is
 * seconds to minutes for a real asset. Two peers that both decided from hash
 * `H` therefore both passed the check, both renamed, and the second silently
 * won — the exact last-writer-wins the CAS exists to eliminate, narrowed to an
 * upload duration but not closed.
 *
 * So the precondition is re-asked under this lock, with the rename and the
 * journal append inside it. The journal is already the serialization point;
 * this just makes the door respect it.
 */
const publishing = new Map();

export async function withPathLock(rel, fn) {
  const prior = publishing.get(rel) ?? Promise.resolve();
  let release;
  const mine = prior.then(() => new Promise((r) => (release = r)));
  publishing.set(rel, mine);
  await prior;
  try {
    return await fn();
  } finally {
    release();
    // Only the last waiter clears the entry, so a queue behind us survives.
    if (publishing.get(rel) === mine) publishing.delete(rel);
  }
}

/** The hash the hub currently holds for `rel`, or null (absent or tombstoned). */
export function currentHashFor(journal, rel) {
  const row = journal.latestFor(rel);
  if (!row || row.deleted) return null;
  return row.sha256 ?? null;
}

/** The seq of the hub's latest row for `rel`, or null. */
export function seqFor(journal, rel) {
  return journal.latestFor(rel)?.seq ?? null;
}

/** sha256 of the file's bytes on disk, or null when unreadable (F-14 — the
 *  CAS truth for a file the journal has not met yet). */
function hashFileOnDisk(abs) {
  try {
    return sha256File(abs);
  } catch {
    return null;
  }
}
