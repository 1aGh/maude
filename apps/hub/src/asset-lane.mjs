// Server-side object-storage lane — Sync v2 Increment 5.
//
// TWO jobs, one file:
//
//   1. `createWriteBehind` — checkout → bucket, JOURNAL-DRIVEN. Every accepted
//      file-plane write lands a journal row (`file_journal`), and this lane
//      subscribes to the append: whatever the row names is read back off disk
//      and mirrored to object storage, then the row is stamped
//      `mirrored_at_ms`. The unstamped rows ARE the work queue, so a crash
//      loses nothing — the next boot's flush picks up exactly where the last
//      one died. This replaces the old directory-walking sweeper
//      (`sweepAssets`/`createAssetSweeper`), which watched ONLY
//      `<designRoot>/assets/` — `companion-text`, `code-module` and every
//      nested `system/**/assets/*` file was durable solely through the hub's
//      git history (the F-6/B2 durability hole the burn-down closes).
//
//   2. `hydrateAssets` / `hydrateFiles` — bucket → checkout, at boot. A cell's
//      checkout is EPHEMERAL: the platform migrates instances whenever it
//      likes and `rehydrate.mjs` restores the newest backup GENERATION, so
//      bytes that reached the bucket after that generation exist in exactly
//      one place the cell can serve nothing from. Measured on Brno Alligators
//      2026-08-13: 53–58 of ~95 assets 404 in the checkout, 200 in the bucket,
//      three times in one afternoon.
//
// KEY LAYOUT. Top-level content-addressed assets keep the legacy
// `<scope>/assets/<name>` keys — the `/assets/` read proxy and every existing
// bucket object speak that layout. Everything else in the plane lands under
// `<scope>/files/<designRoot-rel>`, keyed by PATH: the journal's CAS is the
// concurrency authority, the bucket is a durable shadow of the checkout, and a
// deleted file's blob is left unreferenced rather than removed (quarantine
// semantics, same as `_trash/`).
//
// NOTHING HERE MAY EXPIRE. A canvas in git history can reference media no
// current canvas does, so "unreferenced" never means "unreachable" and a
// lifecycle rule on these prefixes is a permanently broken canvas. The
// `s3-no-expiry` verification check asserts it.
//
// LOUD AND RETRIED, never best-effort-and-silent (the 2026-08-15
// annotations-assets RCA): a mirror failure means those bytes live only in the
// checkout until a retry lands them — one container teardown from gone — so it
// is an error in the log and a delayed retry, not a dropped promise.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import { assetObjectKey, assetPrefixFromEnv } from './asset-key.mjs';
import { parseAssetPath } from './assets.mjs';
import { MAX_PROJECT_FILE_BYTES } from './file-limits.mjs';
import { resolveCheckoutFileWrite } from './file-manifest.mjs';
import { getObject, getObjectToFile, listObjects, putObject, putObjectFromFile } from './s3.mjs';

/**
 * Eligibility for the LEGACY `assets/` key layout is decided by the read
 * PROXY, not by a second regex here: a key this lane writes that the proxy
 * will not serve is spend with no reader.
 */
function servable(relPath) {
  return parseAssetPath(`/assets/${relPath}`) !== null;
}

/** The one project-file ceiling (file-limits.mjs, plan T18): large media is
 *  mirrored as a multipart upload; anything past the ceiling is refused. */
const MAX_ASSET_BYTES = MAX_PROJECT_FILE_BYTES;

/** Delay before the one post-failure retry pass. Long enough for a transient
 *  bucket blip to pass, short enough that the bytes stop being checkout-only
 *  within a session, not at the next boot. */
const RETRY_DELAY_MS = 60_000;

/** Rows one flush reads per iteration. The loop drains until empty; this only
 *  bounds a single query, not the pass. */
const WRITE_BEHIND_BATCH = 500;

/** Iteration backstop per flush — a runaway guard, not a product limit. */
const MAX_FLUSH_ITERATIONS = 100;

/** The bucket key for a journal path. */
export function writeBehindKey(rel, prefix = '') {
  if (rel.startsWith('assets/')) {
    const name = rel.slice('assets/'.length);
    // The legacy layout, exactly where the read proxy and hydrate look.
    if (servable(name)) return assetObjectKey(name, prefix);
  }
  return prefix ? `${prefix}/files/${rel}` : `files/${rel}`;
}

/** Strip the `files/` layout back to a designRoot-relative path, or null. */
export function fileRelFromKey(key, prefix = '') {
  const scope = prefix ? `${prefix}/files/` : 'files/';
  const k = String(key ?? '');
  return k.startsWith(scope) ? k.slice(scope.length) : null;
}

/**
 * The journal-driven write-behind: checkout → bucket, for EVERY file-plane
 * class. Subscribe `note()` to `journal.onAppend` and call `flush()` once at
 * boot; the unstamped `mirrored_at_ms` rows are the entire work queue.
 *
 * Never throws into a caller. A failed upload stays unstamped, gets ONE
 * delayed retry per pass, and is loud in the log either way.
 */
export function createWriteBehind({ designRoot, s3, journal, prefix, log = console, deps = {} }) {
  const scope = prefix ?? assetPrefixFromEnv();
  const put = deps.putObject ?? putObject;
  // Large files stream from disk in parts (never read whole into memory).
  const putFile = deps.putObjectFromFile ?? (deps.putObject ? null : putObjectFromFile);
  let running = null;
  let again = false;
  let retryTimer = null;
  let mirroredTotal = 0;

  async function flushOnce() {
    const failedPaths = new Set();
    let mirrored = 0;
    for (let i = 0; i < MAX_FLUSH_ITERATIONS; i += 1) {
      const rows = journal.unmirrored(WRITE_BEHIND_BATCH);
      const work = rows.filter((r) => !failedPaths.has(r.path));
      if (work.length === 0) break;
      // Latest row per path wins — the key is the path, so one upload of the
      // disk's newest bytes satisfies every older row for it too.
      const byPath = new Map();
      for (const row of work) byPath.set(row.path, row); // seq ASC ⇒ last wins
      for (const [rel, row] of byPath) {
        const seqs = work.filter((r) => r.path === rel).map((r) => r.seq);
        if (row.deleted) {
          // A tombstone mirrors NOTHING: the blob stays, unreferenced —
          // quarantine semantics, and the reason a delete is recoverable.
          for (const seq of seqs) journal.markMirrored(seq);
          continue;
        }
        try {
          const abs = join(designRoot, rel);
          // Realpath containment at the READ site, not only at the write door.
          // Every journal producer excludes symlinks today, so this is
          // defense-in-depth — but the write-behind reads bytes and ships them
          // to durable, potentially peer-readable storage, so a committed
          // symlink that ever slipped a producer must not become an exfil of a
          // file outside the design root (defender finding L-2, 2026-08-18).
          if (!containedReal(abs, designRoot)) {
            log.warn?.(`[assets] ${rel} resolves outside the design root — NOT mirrored.`);
            for (const seq of seqs) journal.markMirrored(seq); // deliberate refusal, not a retry
            continue;
          }
          const size = statSync(abs).size;
          if (size > MAX_ASSET_BYTES) {
            log.warn?.(`[assets] ${rel} is over ${MAX_ASSET_BYTES} bytes — NOT mirrored.`);
            for (const seq of seqs) journal.markMirrored(seq); // deliberate refusal, not a retry
            continue;
          }
          if (putFile) await putFile(s3, writeBehindKey(rel, scope), abs);
          else await put(s3, writeBehindKey(rel, scope), readFileSync(abs));
          mirrored += 1;
          for (const seq of seqs) journal.markMirrored(seq);
        } catch (err) {
          if (!existsSync(join(designRoot, rel))) {
            // The file is gone from disk. If a tombstone follows, its row will
            // settle these; until then the row stays unstamped so a reappearing
            // file (a raced rename) is retried rather than forgotten.
            failedPaths.add(rel);
            continue;
          }
          failedPaths.add(rel);
          log.error?.(
            `[assets] bucket mirror FAILED for ${rel}: ${err.message} — these bytes live ` +
              'only in the checkout until a retry lands them.'
          );
        }
      }
    }
    mirroredTotal += mirrored;
    if (mirrored > 0) log.log?.(`[assets] write-behind mirrored ${mirrored} file(s) to the bucket`);
    if (failedPaths.size > 0 && retryTimer === null) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void flush();
      }, RETRY_DELAY_MS);
      retryTimer.unref?.();
    }
    return { mirrored, failed: failedPaths.size };
  }

  /** Single-flight with a trailing re-run — a row appended DURING a pass is
   *  the next pass's work, never a lost upload. */
  function flush() {
    if (!s3) return Promise.resolve({ mirrored: 0, failed: 0, skipped: 'no-target' });
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        return await flushOnce();
      } finally {
        running = null;
        if (again) {
          again = false;
          void flush();
        }
      }
    })();
    return running;
  }

  return {
    /** Wire to `journal.onAppend` — fire-and-forget per row. */
    note() {
      void flush().catch(() => {});
    },
    flush,
    mirroredCount: () => mirroredTotal,
    stop() {
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
    },
  };
}

/**
 * Does `abs` still live under `root` once every symlink on the way is followed?
 *
 * Resolves the deepest EXISTING ancestor, because the target itself is about to
 * be created and `realpathSync` on a missing path throws. Mirrors
 * `realpathOfDeepestExisting` in `apps/studio/sync/index.ts` — the receiver on
 * the other side of the same trust boundary.
 */
function containedReal(abs, root) {
  // BOTH sides go through the same resolution, or the comparison is nonsense:
  // on macOS a temp root under `/var` realpaths to `/private/var`, so resolving
  // only the probe made every restore into a not-yet-created `assets/` look
  // like an escape.
  const realDeepest = (p) => {
    let probe = p;
    for (let i = 0; i < 64 && !existsSync(probe); i++) {
      const parent = dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    // The unresolved tail cannot introduce a link — nothing exists there yet —
    // but `resolve` still collapses any `..` it contains.
    return resolve(realpathSync(probe) + p.slice(probe.length));
  };
  try {
    const realRoot = realDeepest(root);
    const realAbs = realDeepest(abs);
    return realAbs !== realRoot && realAbs.startsWith(realRoot + sep);
  } catch {
    return false; // unreadable is not admissible
  }
}

/** Every file under `dir`, as paths relative to it. Missing dir → []. */
function listRecursive(dir, prefix = '', out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) listRecursive(join(dir, entry.name), rel, out);
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/**
 * The names a bucket listing offers this checkout, given what is already on disk.
 *
 * Pure — the caller supplies the listing and the disk. Separated from the IO so
 * the two decisions that matter (what is servable, what is missing) can be
 * exhaustively tested without a bucket or a filesystem.
 *
 * @param {string[]} keys       object keys, scope prefix ALREADY stripped
 * @param {Set<string>} onDisk  asset-relative names present in the checkout
 */
export function missingFromCheckout(keys, onDisk = new Set()) {
  return [...new Set(keys.filter((k) => servable(k) && !onDisk.has(k)))].sort();
}

/**
 * Strip a tenant scope from an object key, or null when it is not ours.
 *
 * A listing is filtered server-side by prefix, but the answer is still remote
 * input and this is the step that turns it into a PATH. A key that does not
 * start with the exact scope we asked for is refused rather than trimmed —
 * "close enough" is how one tenant's media ends up in another's checkout.
 */
export function assetNameFromKey(key, prefix = '') {
  const scope = prefix ? `${prefix}/assets/` : 'assets/';
  const k = String(key ?? '');
  return k.startsWith(scope) ? k.slice(scope.length) : null;
}

/**
 * Refill the checkout's `assets/` from the bucket — the restore half.
 *
 * IT NEVER OVERWRITES. Only files ABSENT from the checkout are written. The
 * bucket is a backup of this checkout, not an authority over it: a
 * content-addressed name means identical bytes either way, and a
 * path-addressed one (`graphics/camo-bg.png`) could legitimately be NEWER on
 * disk — a local edit that has not been mirrored yet. Filling gaps is the whole
 * job; anything more is a way to lose work.
 *
 * NEVER THROWS. A cell that refuses to boot because one GET 502'd is worse than
 * a cell with one missing image, and the next boot retries for free.
 *
 * @returns {Promise<{ restored: string[], present: number, failed: {key:string,reason:string}[], listed: number }>}
 */
export async function hydrateAssets({
  designRoot,
  s3,
  log = console,
  deps = {},
  prefix,
  /**
   * Sync v2 (DDR-226 §2) — fired with the designRoot-relative path of every
   * file this restore lands.
   *
   * This lane WRITES CHECKOUT FILES, so it is a write door like any other and
   * needs a journal row: a rehydrated cell that refilled 58 assets from the
   * bucket has 58 files peers cannot see the arrival of, and — because "no
   * row" is a meaningful statement in this protocol — 58 files the doručenka
   * would report as never delivered. Found by the write-door tripwire, not by
   * a reader; that is what the tripwire is for.
   */
  onWritten = null,
}) {
  const scope = prefix ?? assetPrefixFromEnv();
  const list = deps.listObjects ?? listObjects;
  const get = deps.getObject ?? getObject;
  const result = { restored: [], present: 0, failed: [], listed: 0 };
  if (!s3) return result;

  const dir = join(designRoot, 'assets');
  let objects;
  try {
    objects = await list(s3, scope ? `${scope}/assets/` : 'assets/');
  } catch (err) {
    log.warn?.(`[assets] could not list the bucket to hydrate: ${err.message}`);
    return result;
  }
  result.listed = objects.length;

  const names = objects.map((o) => assetNameFromKey(o.key, scope)).filter((n) => n !== null);
  const onDisk = new Set(listRecursive(dir));
  result.present = names.filter((n) => onDisk.has(n)).length;
  const missing = missingFromCheckout(names, onDisk);
  if (missing.length === 0) return result;

  log.log?.(
    `[assets] ${missing.length} asset(s) are in the bucket and missing from the checkout — restoring.`
  );

  const root = resolve(dir);
  for (const name of missing) {
    // Belt and braces at a CREATE. `servable()` already refuses `..`, a leading
    // slash, a backslash and anything outside the bounded charset — but this is
    // the one place a remote-controlled string becomes a file, so the last word
    // belongs to the filesystem, not to a regex.
    const abs = resolve(dir, name);
    if (abs !== root && !abs.startsWith(root + sep)) {
      result.failed.push({ key: name, reason: 'resolves outside the assets directory' });
      continue;
    }
    // …AND THE SAME CHECK AGAIN, THROUGH THE SYMLINKS.
    //
    // `resolve()` is purely lexical: it never follows a link, and
    // `mkdirSync(recursive: true)` happily traverses one that already exists.
    // The checkout is a clone of a repository the TENANT controls, so a
    // committed symlink under `.design/assets/` is a write-outside primitive
    // inside this cell — the exact hazard `sync/remote-docs.ts` documents and
    // injects a realpath for, on a receiver that is otherwise this one's twin.
    if (!containedReal(abs, root)) {
      result.failed.push({
        key: name,
        reason: 'a symlink on the path leaves the assets directory',
      });
      continue;
    }
    try {
      const body = await get(s3, assetObjectKey(name, scope));
      if (!body) {
        result.failed.push({ key: name, reason: 'not found in the bucket' });
        continue;
      }
      if (body.length > MAX_ASSET_BYTES) {
        result.failed.push({ key: name, reason: `over ${MAX_ASSET_BYTES} bytes` });
        continue;
      }
      // Re-check under the write, not only under the plan: a concurrent restore,
      // a git checkout or a desktop push may have landed the real file while
      // this loop was awaiting an earlier GET.
      if (existsSync(abs)) {
        result.present += 1;
        continue;
      }
      mkdirSync(dirname(abs), { recursive: true });
      // Temp + rename, so a crash mid-restore cannot leave a truncated image
      // that later looks like a real asset to every reader in the process.
      const tmp = `${abs}.hydrating-${process.pid}`;
      writeFileSync(tmp, body);
      renameSync(tmp, abs);
      result.restored.push(name);
      // The path is all this says; the journal re-stats and re-hashes the disk.
      // Never allowed to fail the restore that already landed.
      try {
        onWritten?.({ path: `assets/${name}` });
      } catch (err) {
        log.error?.(`[assets] hydrate journal hook failed for ${name}: ${err.message}`);
      }
    } catch (err) {
      result.failed.push({ key: name, reason: err.message });
    }
  }

  if (result.restored.length || result.failed.length) {
    log.log?.(
      `[assets] restored ${result.restored.length} from the bucket, ${result.present} already present` +
        (result.failed.length ? `, ${result.failed.length} failed` : '')
    );
  }
  return result;
}

/**
 * Refill the checkout's OTHER file-plane classes from the `files/` prefix —
 * the restore half of the write-behind, and what makes the F-6/B2 fix whole:
 * durability without a way back is a receipt, not a backup.
 *
 * Same posture as `hydrateAssets`: only-if-absent, never throws, every landed
 * file gets a journal row via `onWritten`. Admission is
 * `resolveCheckoutFileWrite` — the SAME classifier + symlink containment the
 * write door uses, so a listing (remote input, DDR-054) can never land a path
 * the door would refuse.
 *
 * @returns {Promise<{ restored: string[], present: number, failed: {key:string,reason:string}[], listed: number }>}
 */
export async function hydrateFiles({
  designRoot,
  s3,
  log = console,
  deps = {},
  prefix,
  onWritten = null,
}) {
  const scope = prefix ?? assetPrefixFromEnv();
  const list = deps.listObjects ?? listObjects;
  const get = deps.getObject ?? getObject;
  const result = { restored: [], present: 0, failed: [], listed: 0 };
  if (!s3) return result;

  let objects;
  try {
    objects = await list(s3, scope ? `${scope}/files/` : 'files/');
  } catch (err) {
    log.warn?.(`[assets] could not list the bucket to hydrate files: ${err.message}`);
    return result;
  }
  result.listed = objects.length;

  for (const obj of objects) {
    const rel = fileRelFromKey(obj.key, scope);
    if (rel === null) continue; // not ours — refused, never trimmed
    // The one admission gate: classifier membership + containment through
    // symlinks, judged exactly as the write door judges a peer's PUT.
    const target = resolveCheckoutFileWrite(designRoot, rel);
    if (!target.ok) {
      result.failed.push({ key: rel, reason: 'refused by the write-door admission' });
      continue;
    }
    if (existsSync(target.abs)) {
      result.present += 1;
      continue;
    }
    try {
      mkdirSync(dirname(target.abs), { recursive: true });
      const tmp = `${target.abs}.hydrating-${process.pid}`;
      if (deps.getObject) {
        // Injected (tests): the buffered shape.
        const body = await get(s3, obj.key);
        if (!body) {
          result.failed.push({ key: rel, reason: 'not found in the bucket' });
          continue;
        }
        if (body.length > MAX_ASSET_BYTES) {
          result.failed.push({ key: rel, reason: `over ${MAX_ASSET_BYTES} bytes` });
          continue;
        }
        writeFileSync(tmp, body);
      } else {
        // T18 — streamed to disk; a large video never sits whole in memory.
        const n = await getObjectToFile(s3, obj.key, tmp, { maxBytes: MAX_ASSET_BYTES }).catch(
          (err) => {
            if (/ceiling/.test(err.message)) return -1;
            throw err;
          }
        );
        if (n === null) {
          result.failed.push({ key: rel, reason: 'not found in the bucket' });
          continue;
        }
        if (n === -1) {
          result.failed.push({ key: rel, reason: `over ${MAX_ASSET_BYTES} bytes` });
          continue;
        }
      }
      if (existsSync(target.abs)) {
        rmSync(tmp, { force: true });
        result.present += 1;
        continue;
      }
      renameSync(tmp, target.abs);
      result.restored.push(rel);
      try {
        onWritten?.({ path: rel });
      } catch (err) {
        log.error?.(`[assets] file hydrate journal hook failed for ${rel}: ${err.message}`);
      }
    } catch (err) {
      result.failed.push({ key: rel, reason: err.message });
    }
  }

  if (result.restored.length || result.failed.length) {
    log.log?.(
      `[assets] restored ${result.restored.length} plane file(s) from the bucket, ` +
        `${result.present} already present` +
        (result.failed.length ? `, ${result.failed.length} failed` : '')
    );
  }
  return result;
}
