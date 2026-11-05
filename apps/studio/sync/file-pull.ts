// The file plane's downward half — manifest-driven replication of every
// project file the canvas lanes do not own (feature-sync-file-plane, binding
// decision maude/sync-two-plane-manifest-architecture).
//
// WHAT THIS REPLACES, AND WHY THE DELETED `asset-pull.ts`'s INVARIANT STILL
// MATTERS. The reference-derived asset pull (deleted in Sync v2 Increment 5)
// derived its wants LOCALLY (it fetched only names its own files reference),
// so a hostile hub could never place a file nobody asked for.
// That invariant is exactly what made the 103-file gap unfixable: a fresh
// link REFERENCES nothing, so it can want nothing, so the design system that
// makes the canvases render never arrives (RCA
// issue-fresh-link-gets-canvases-but-not-the-design-system). The manifest
// DELIBERATELY replaces reference-derivation for the gated classes — and what
// stands in for it is the receiver-side discipline below, which is stronger
// than a reference scan, not weaker:
//
//   1. EVERY entry is RE-CLASSIFIED against this peer's OWN tree and config
//      (`classifyProjectFile` — the positive, default-closed classifier). The
//      hub's `class` field is a HINT for reporting; a disagreement drops the
//      entry with one warn (ATTACKER's invariant from the binding debate: the
//      receiver re-validates every path; naming authority is never handed to
//      the hub).
//   2. Per-class admission: `inert-media` and `companion-text` flow;
//      `code-module` lands ONLY when this peer's STORED record for the hub
//      says `role === 'owner'`, or the hub is this machine's own loopback
//      cell pairing — decided from local state, never from the wire.
//   3. Deletion does NOT propagate. A vanished manifest entry means "no
//      longer offered", never "delete yours" (scope cut: the branch-switch-
//      as-mass-delete hazard is dodged structurally).
//   4. Conflicts never lose work silently: on a hash mismatch the newer
//      `mtimeMs` wins, and a losing LOCAL copy parks in
//      `_trash/<rel>-conflict-<ts>` (`quarantineFile` — the tombstone lane's
//      quarantine-never-delete posture). If parking fails, the overwrite is
//      refused.
//
// CODE MODULES AND THE BUILD. A pulled `code-module` lands in the live tree,
// so this lane's admission is paired with the canvas build's import
// allowlist being unconditional (`restrictImportsTo: designRoot` at every
// build site — Task 9 of the same feature, landed with it): what a module
// can reach is bounded by the design root on every runtime, so a pulled file
// cannot turn the build into a read of the wider filesystem.
//
// MISSING-ONLY IS THE STEADY STATE: equal hash → skip (echo-guard by
// construction), so a converged project costs one manifest fetch per poll.

import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';

import {
  type CanvasGroupLike,
  classifyProjectFile,
  type FileClass,
  isFilePlaneClass,
} from './file-membership.ts';
import { createPullBudget } from './pull-budget.ts';
import { quarantineFile } from './tombstone-apply.ts';

/** How long to wait for the manifest. Same figure as the doc listing. */
const MANIFEST_TIMEOUT_MS = 6000;

/** How long to wait for one file. Generous — these run to videos. */
const GET_TIMEOUT_MS = 120_000;

/** Refuse an implausible body outright rather than streaming it to disk. */
const MAX_PULL_BYTES = 512 * 1024 * 1024;

/** How many files one pass will fetch — the loud cap, same reasoning as
 *  every other lane: one answer must not land thousands, and the remainder
 *  is picked up by the next pass. */
const MAX_FILES_PER_PASS = 200;

/** One entry as the hub offers it. Everything here is UNTRUSTED input. */
export interface RemoteFileEntry {
  path: string;
  sha256: string;
  size: number;
  mtimeMs: number;
  /** The hub's claimed class — a reporting hint, never authority. */
  class: string;
}

export interface FilePullConflict {
  rel: string;
  winner: 'local' | 'hub';
  /** Set when the hub won and the local copy was parked. */
  trashedTo?: string;
}

export interface FilePullResult {
  pulled: string[];
  /** Present with an equal hash — the converged steady state. */
  skipped: number;
  conflicts: FilePullConflict[];
  /** Refused by re-classification or per-class admission. */
  dropped: { rel: string; reason: string }[];
  failed: { rel: string; reason: string }[];
  /** F6 — the pass stopped on the aggregate byte budget rather than the count
   *  cap. The remainder is the next pass's work. */
  budgetExhausted?: true;
  /** How many offered files this pass wanted to move (before the count cap,
   *  without the held ones). `wanted > 0 && pulled.length === 0` is a pass that
   *  made no progress — what the gate backs off on (2.0.5). */
  wanted?: number;
  /** Files whose landing failed before and that wait out a backoff instead of
   *  being asked for again every pass — each with the reason, in words. */
  held?: { rel: string; reason: string; attempts: number }[];
  /** The manifest could not be read at all (hub unreachable or refusing). */
  unreachable?: true;
}

/** First retry after a failed landing; doubles per failure up to the cap. */
const FAIL_BACKOFF_BASE_MS = 60_000;
const FAIL_BACKOFF_MAX_MS = 60 * 60_000;

/**
 * What this runtime remembers about files whose landing failed (2.0.5, rule b).
 *
 * The legacy lane has no ledger, so without this a file that cannot land — a
 * write the disk refuses, a hub that answers 500 for it — was asked for on
 * EVERY pass, at the head of the batch, forever. Keyed by (path, hash): a new
 * version of the file is a new offer and is tried at once.
 */
export interface PullFailureMemory {
  noteFailed(rel: string, sha256: string, reason: string, now: number): void;
  noteLanded(rel: string): void;
  /** The hold on this exact offer, while it is still waiting out its backoff. */
  heldNow(rel: string, sha256: string, now: number): { reason: string; attempts: number } | null;
}

export function createPullFailureMemory(
  opts: { baseMs?: number; maxMs?: number } = {}
): PullFailureMemory {
  const base = opts.baseMs ?? FAIL_BACKOFF_BASE_MS;
  const max = opts.maxMs ?? FAIL_BACKOFF_MAX_MS;
  const rows = new Map<
    string,
    { sha256: string; attempts: number; nextAt: number; reason: string }
  >();
  return {
    noteFailed(rel, sha256, reason, now) {
      const prev = rows.get(rel);
      const attempts = prev && prev.sha256 === sha256 ? prev.attempts + 1 : 1;
      const delay = Math.min(max, base * 2 ** (attempts - 1));
      rows.delete(rel);
      rows.set(rel, { sha256, attempts, nextAt: now + delay, reason });
      // Bounded: a hostile manifest cannot grow this without limit.
      if (rows.size > 20_000) {
        const oldest = rows.keys().next().value;
        if (oldest !== undefined) rows.delete(oldest);
      }
    },
    noteLanded(rel) {
      rows.delete(rel);
    },
    heldNow(rel, sha256, now) {
      const r = rows.get(rel);
      if (!r) return null;
      if (r.sha256 !== sha256) {
        rows.delete(rel); // a new version of the file is a new offer
        return null;
      }
      return now < r.nextAt ? { reason: r.reason, attempts: r.attempts } : null;
    },
  };
}

/**
 * One legacy pass at a time, and a pass that made no progress backs off
 * (2.0.5, rule c).
 *
 * The 20 s poll used to start a new `pullFiles` on every tick, whatever the
 * last one was still doing. Against a slow hub one pass of 200 files outlives
 * many ticks, and every new pass chose the SAME 200 (the in-flight ones were
 * not on disk yet): N passes downloading the same bodies at once, each holding
 * them in memory. `run` answers null when it did not start a pass.
 */
export function createLegacyPullGate(
  opts: { now?: () => number; baseMs?: number; maxMs?: number } = {}
) {
  const now = opts.now ?? Date.now;
  const base = opts.baseMs ?? 20_000;
  const max = opts.maxMs ?? 10 * 60_000;
  let running = false;
  let streak = 0;
  let notBefore = 0;
  return {
    async run(pass: () => Promise<FilePullResult>): Promise<FilePullResult | null> {
      if (running || now() < notBefore) return null;
      running = true;
      try {
        const r = await pass();
        const stalled = r.unreachable === true || ((r.wanted ?? 0) > 0 && r.pulled.length === 0);
        if (stalled) {
          streak += 1;
          notBefore = now() + Math.min(max, base * 2 ** (streak - 1));
        } else {
          streak = 0;
          notBefore = 0;
        }
        return r;
      } finally {
        running = false;
      }
    },
    /** ms until the next pass may start (0 = now). */
    waitMs(): number {
      return Math.max(0, notBefore - now());
    },
  };
}

/** SHA-256 of a file read in fixed chunks — never the whole file in memory. */
export function hashFileSync(abs: string): string {
  const h = createHash('sha256');
  const fd = openSync(abs, 'r');
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      h.update(n === buf.length ? buf : buf.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return h.digest('hex');
}

/**
 * Fetch the manifest, never fatally: null means unreachable, refused, or a
 * hub without the route — sync continues either way, we ask again later
 * (the `fetchRemoteListing` posture). Entries are filtered to the expected
 * SHAPE here; the classifier judges the paths themselves at pull time.
 */
export async function fetchFileManifest(
  hubUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<RemoteFileEntry[] | null> {
  try {
    const base = hubUrl.replace(/\/+$/, '');
    const res = await fetchImpl(`${base}/api/files`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { files?: unknown };
    if (!Array.isArray(body?.files)) return null;
    return body.files
      .filter(
        (f): f is RemoteFileEntry =>
          !!f &&
          typeof (f as RemoteFileEntry).path === 'string' &&
          (f as RemoteFileEntry).path.length > 0 &&
          typeof (f as RemoteFileEntry).sha256 === 'string' &&
          /^[0-9a-f]{64}$/.test((f as RemoteFileEntry).sha256)
      )
      .map((f) => ({
        path: f.path,
        sha256: f.sha256,
        size: Number(f.size) || 0,
        mtimeMs: Number(f.mtimeMs) || 0,
        class: String(f.class ?? ''),
      }));
  } catch {
    return null;
  }
}

export interface PullFilesOptions {
  designRoot: string;
  hubUrl: string;
  /** Read at call time — silent renewal swaps the credential in place. */
  token: () => string;
  /** Declared canvas groups — the same config the canvas receiver honours. */
  canvasGroups?: readonly CanvasGroupLike[];
  /**
   * Whether `code-module` entries may land: the STORED record for this hub
   * vouches `role === 'owner'`, or the hub is this machine's own loopback
   * cell pairing. Computed by the caller from LOCAL state (hubs.json /
   * cell-pairing) — never from anything the hub sent.
   */
  allowCodeModules: boolean;
  fetchImpl?: typeof fetch;
  log?: Pick<Console, 'log' | 'warn'>;
  now?: () => number;
  /** F6 — override the aggregate per-pass byte ceiling (tests). */
  maxPassBytes?: number;
  /** Kept by the caller across passes: a failed landing waits out a backoff
   *  rather than being asked for again on the next pass (rule b). */
  failures?: PullFailureMemory;
}

/**
 * One downward pass: manifest → re-classify → admit → reconcile → fetch.
 * Sequential on purpose (the asset lanes' reasoning — don't starve the
 * handshakes); never throws — a failure is a line in `failed` and a free
 * retry on the next poll.
 */
export async function pullFiles(opts: PullFilesOptions): Promise<FilePullResult> {
  const { designRoot, hubUrl } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const log = opts.log ?? console;
  const now = opts.now ?? Date.now;
  const base = hubUrl.replace(/\/+$/, '');
  const out: FilePullResult = { pulled: [], skipped: 0, conflicts: [], dropped: [], failed: [] };

  const manifest = await fetchFileManifest(hubUrl, opts.token(), fetchImpl);
  if (manifest === null) {
    out.unreachable = true;
    return out;
  }
  const failures = opts.failures;
  const held: NonNullable<FilePullResult['held']> = [];

  // Decide the whole pass from the manifest first, then move bytes: a local
  // win costs no fetch at all, and the loud cap counts only real transfers.
  const classifyOpts = {
    canvasGroups: opts.canvasGroups,
    hasFile: (r: string) => existsSync(path.join(designRoot, r)),
  };
  const wanted: { entry: RemoteFileEntry; abs: string; conflict: FilePullConflict | null }[] = [];
  /** A failed landing waiting out its backoff is reported, not re-fetched. */
  const isHeld = (rel: string, entry: RemoteFileEntry): boolean => {
    const h = failures?.heldNow(rel, entry.sha256, now());
    if (!h) return false;
    held.push({ rel, reason: h.reason, attempts: h.attempts });
    return true;
  };

  for (const entry of manifest) {
    const rel = entry.path;
    // 1. THIS peer's own verdict on the path — shape and class in one call.
    const localClass: FileClass = classifyProjectFile(rel, classifyOpts);
    if (!isFilePlaneClass(localClass)) {
      drop(out, log, rel, `classifies '${localClass}' here`);
      continue;
    }
    // The hub's class is a hint; a disagreement is a drop, not a negotiation.
    if (entry.class !== localClass) {
      drop(out, log, rel, `hub says '${entry.class}', this peer says '${localClass}'`);
      continue;
    }
    // 2. Per-class admission — the owner-hub gate, from LOCAL state only.
    if (localClass === 'code-module' && !opts.allowCodeModules) {
      drop(out, log, rel, 'code modules replicate only from an owner-vouched or loopback hub');
      continue;
    }
    if (entry.size > MAX_PULL_BYTES) {
      drop(out, log, rel, `implausible size (${entry.size} B)`);
      continue;
    }

    // 3. Reconcile against the local copy.
    const abs = path.join(designRoot, rel);
    const resolved = path.resolve(abs);
    const root = path.resolve(designRoot);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      // Unreachable while the classifier holds (no `..`, no absolutes) —
      // belt and braces for the one lane where a hub NAME becomes a path.
      drop(out, log, rel, 'escapes the design root');
      continue;
    }
    let st: ReturnType<typeof statSync> | null = null;
    try {
      st = statSync(abs);
    } catch {
      st = null;
    }
    if (st !== null) {
      if (!st.isFile()) {
        drop(out, log, rel, 'a non-file sits at this path locally');
        continue;
      }
      // LWW by mtime. The local file wins ties: overwriting a person's disk
      // needs the remote to be STRICTLY newer. Decided before any byte is read:
      // a local win costs no hash at all (every pass used to read every local
      // file whole — gigabytes for an asset-heavy project, on each poll).
      const hubNewer = entry.mtimeMs > st.mtimeMs;
      let same: boolean;
      if (st.size !== entry.size) {
        same = false; // different lengths cannot be equal bytes
      } else {
        try {
          same = hashFileSync(abs) === entry.sha256;
        } catch (err) {
          out.failed.push({ rel, reason: `unreadable local copy: ${(err as Error).message}` });
          continue;
        }
      }
      if (same) {
        out.skipped += 1;
        failures?.noteLanded(rel);
        continue;
      }
      if (!hubNewer) {
        out.conflicts.push({ rel, winner: 'local' });
        continue;
      }
      if (isHeld(rel, entry)) continue;
      wanted.push({ entry, abs, conflict: { rel, winner: 'hub' } });
      continue;
    }
    if (isHeld(rel, entry)) continue;
    wanted.push({ entry, abs, conflict: null });
  }
  out.wanted = wanted.length;
  if (held.length > 0) out.held = held;

  const batch = wanted.slice(0, MAX_FILES_PER_PASS);
  if (batch.length < wanted.length) {
    // Named loudly — a silent cap reads as "sync is broken" with no cause.
    log.warn(
      `[sync/files] the project offers ${wanted.length} files this peer is missing; taking ${batch.length} this pass.`
    );
  }

  // F6 (DDR-226 §9) — the per-file cap and the count cap multiply, and the hub
  // picks both factors. One aggregate ceiling per pass closes that. This lane
  // has the manifest, so the charge lands BEFORE the request: an oversize batch
  // costs no transfer at all.
  const budget = createPullBudget({
    label: 'sync/files',
    log,
    ...(opts.maxPassBytes !== undefined ? { maxBytes: opts.maxPassBytes } : {}),
  });

  /** A failure that is the file's, not the pass's: remembered, so it waits. */
  const fail = (entry: RemoteFileEntry, reason: string): void => {
    out.failed.push({ rel: entry.path, reason });
    failures?.noteFailed(entry.path, entry.sha256, reason, now());
  };

  for (const { entry, abs, conflict } of batch) {
    const rel = entry.path;
    if (budget.exhausted()) break;
    // The manifest size is hub-supplied and therefore a hint — it reserves the
    // budget; the ACTUAL bytes are re-charged below, so an understated size
    // cannot buy a bigger transfer.
    if (!budget.take(entry.size)) {
      out.budgetExhausted = true;
      break;
    }
    // Staged beside the target and renamed, so a reader never sees a
    // half-written file. Created (with its folders) before the request: a
    // folder that cannot be made costs no transfer.
    const tmpAbs = `${abs}.part`;
    try {
      mkdirSync(path.dirname(abs), { recursive: true });
    } catch (err) {
      fail(entry, `could not create the folder for it here: ${(err as Error).message}`);
      continue;
    }
    try {
      const res = await fetchImpl(
        `${base}/_project-file/${rel.split('/').map(encodeURIComponent).join('/')}`,
        {
          headers: { authorization: `Bearer ${opts.token()}` },
          signal: AbortSignal.timeout(GET_TIMEOUT_MS),
        }
      );
      if (!res.ok) {
        fail(entry, `the project's server answered HTTP ${res.status}`);
        continue;
      }
      // STREAMED to the staging file (2.0.5, rule d): one chunk in memory at a
      // time, hashed and counted as it goes. Holding the body whole, times 200,
      // times the passes that overlapped, was the field's 2–4 GB.
      const limit = Math.min(MAX_PULL_BYTES, entry.size + budget.remaining());
      const got = await streamToFile(res, tmpAbs, limit);
      if (!got.ok) {
        discard(tmpAbs);
        if (got.over) {
          if (got.size > MAX_PULL_BYTES) {
            fail(entry, `implausible size (more than ${MAX_PULL_BYTES} B)`);
            continue;
          }
          // Charge the overrun: the manifest's size was a hint, the wire is the
          // fact. A body larger than declared must not slip past the ceiling.
          out.failed.push({
            rel,
            reason: `pass byte budget reached (declared ${entry.size} B, sent more than ${limit} B)`,
          });
          out.budgetExhausted = true;
          break;
        }
        fail(entry, got.reason);
        continue;
      }
      if (got.size > entry.size && !budget.take(got.size - entry.size)) {
        discard(tmpAbs);
        out.failed.push({
          rel,
          reason: `pass byte budget reached (declared ${entry.size} B, sent ${got.size} B)`,
        });
        out.budgetExhausted = true;
        break;
      }
      // The manifest named a hash; the bytes must BE that hash. A mismatch is
      // usually a write racing the poll — a retry after a short wait, never a
      // landing.
      if (got.sha256 !== entry.sha256) {
        discard(tmpAbs);
        fail(
          entry,
          'content hash mismatch — the bytes did not match what the project listed (it may be changing)'
        );
        continue;
      }
      if (conflict) {
        const trashedTo = quarantineFile({
          designRoot,
          rel,
          now: now(),
          log: (line) => log.log(line),
        });
        if (trashedTo === null) {
          // Could not park the loser ⇒ the overwrite is refused. Never
          // silent loss — the local copy stays, the conflict is reported.
          discard(tmpAbs);
          out.conflicts.push({ rel, winner: 'local' });
          continue;
        }
        conflict.trashedTo = trashedTo;
        out.conflicts.push(conflict);
      }
      renameSync(tmpAbs, abs);
      // RULE (a): pulled means ON DISK WITH THAT HASH — checked, not assumed.
      // A rename that "succeeded" into a place nothing can read back is a
      // failure the person must hear about, not a delivery.
      let landedSha: string | null = null;
      try {
        landedSha = statSync(abs).size === got.size ? hashFileSync(abs) : null;
      } catch {
        landedSha = null;
      }
      if (landedSha !== entry.sha256) {
        fail(entry, 'it was written but could not be read back from this disk');
        continue;
      }
      failures?.noteLanded(rel);
      out.pulled.push(rel);
    } catch (err) {
      discard(tmpAbs);
      fail(entry, (err as Error).message);
    }
  }

  if (out.pulled.length > 0 || out.conflicts.length > 0 || out.failed.length > 0) {
    log.log(
      `[sync/files] pulled ${out.pulled.length} project file(s) down (${out.skipped} already here, ${out.conflicts.length} conflict(s), ${out.failed.length} failed${
        held.length > 0 ? `, ${held.length} waiting to retry after a failure` : ''
      }${out.budgetExhausted ? ', pass byte budget reached — resuming next pass' : ''}).`
    );
  }
  return out;
}

/** Remove a staging file, never throwing (its folder may be the problem). */
function discard(abs: string): void {
  try {
    rmSync(abs, { force: true });
  } catch {
    /* nothing to clean */
  }
}

/**
 * Stream a response body into `abs`, hashing as it goes. Stops (and reports
 * `over`) the moment the body passes `limit` bytes, so neither memory nor the
 * disk ever holds more than the pass allowed.
 */
async function streamToFile(
  res: Response,
  abs: string,
  limit: number
): Promise<
  | { ok: true; size: number; sha256: string }
  | { ok: false; over: true; size: number }
  | { ok: false; over?: false; reason: string }
> {
  const h = createHash('sha256');
  let size = 0;
  let fd: number | null = null;
  try {
    fd = openSync(abs, 'w');
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel().catch(() => {});
          return { ok: false, over: true, size };
        }
        h.update(value);
        let off = 0;
        while (off < value.byteLength) off += writeSync(fd, value, off, value.byteLength - off);
      }
    }
    return { ok: true, size, sha256: h.digest('hex') };
  } catch (err) {
    return { ok: false, reason: `the download did not finish: ${(err as Error).message}` };
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

/** One warn per (reason-class) flood is the caller's job; here every drop is
 *  one line — drops are refusals of UNTRUSTED input and deserve a trace. */
function drop(
  out: FilePullResult,
  log: Pick<Console, 'log' | 'warn'>,
  rel: string,
  reason: string
): void {
  out.dropped.push({ rel, reason });
  log.warn(`[sync/files] dropped '${rel}': ${reason}`);
}
