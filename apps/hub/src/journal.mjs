// The hub file journal — Sync v2 Increment 1 (DDR-226 §2/§3).
//
// An append-only, hub-ordered log of every accepted write to the checkout's
// file plane. It is the backbone the whole redesign rests on:
//
//   - **The row IS the edit stamp** (DDR-223 generalized). Remote state without
//     a row cannot flow; a 0-byte file WITH a row is a stamped deliberate
//     truncation; the absence of a row is never a delete.
//   - **The latest row per path IS the manifest** — `GET /api/files` becomes the
//     `since=0` case of `GET /api/journal`.
//   - **`seq` is what peers checkpoint against**, so a peer asks "what changed
//     since 412" instead of diffing a whole tree every 20 s.
//
// ── Why its own database, not a table in hub.db ──────────────────────────────
// `hub.db` belongs to the Hocuspocus SQLite extension; its schema is upstream's
// to migrate and ours only to read. `tombstones.mjs` already made this call and
// spelled out why. Same reasoning here.
//
// BUT with one difference that matters: unlike tombstones (30-day TTL, failure
// mode = a resurrected canvas), a lost journal silently rewinds every peer's
// cursor. So `journal.db` is added to `BACKUP_DATABASES` and rides the SAME
// generation as the documents and the checkout — the DDR-199 rule that mixing
// generations is corruption applies to this file more than to any other.
//
// ── Why the R2 tail exists ───────────────────────────────────────────────────
// A cell's disk is ephemeral and it rehydrates from a ≤6 h-old generation on
// EVERY wake, not only in a disaster. Without a tail, every wake would rewind
// the journal past rows peers have already consumed (cursors stale forever); WITH
// a per-restore epoch rotation instead, a full re-anchor and a storm of conflict
// copies would become a daily event. Neither is acceptable, so every append is
// also written behind to object storage as one NDJSON line, and rehydrate
// replays that tail BEFORE any epoch decision. The epoch then rotates only when
// the tail genuinely cannot reconstruct the head.
//
// ── What is untrusted here ───────────────────────────────────────────────────
// EVERYTHING a caller passes about content. `recordWrite` takes a PATH and then
// re-stats and re-hashes the hub's own disk itself. `POST /api/journal/report`
// is a nudge, never data: a peer (or the studio child) can say "look at this
// path", and the hub looks. It cannot say what it found.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { listProjectFiles, readCanvasGroups } from './file-manifest.mjs';
import { classifyProjectFile, isFilePlaneClass, isProjectFileShape } from './file-membership.mjs';
import { MAX_PROJECT_FILE_BYTES, sha256File } from './file-limits.mjs';

const require = createRequire(import.meta.url);
// better-sqlite3 is a runtime-external native binding (see build.ts). Loading
// it lazily keeps the import graph clean for the bundler.
const Database = require('better-sqlite3');

/** Where a write came from. Recorded for forensics; never an authority. */
export const JOURNAL_SOURCES = Object.freeze([
  'peer-put', // a desktop PUT through a hub write door
  'studio-report', // the studio child nudged us about its own write
  'walk-import', // the reconciler found drift the hooks missed
  'boot-scan', // first walk of a checkout with no journal
  'hydrate', // bucket→checkout asset refill at boot
  'tail-replay', // reconstructed from the R2 tail after a rehydrate
]);

/** Refuse an implausible file rather than hash it — the file-manifest figure. */
// T18 — the one project-file ceiling (file-limits.mjs).
const MAX_FILE_BYTES = MAX_PROJECT_FILE_BYTES;

/** How many entries one `GET /api/journal` page carries. */
export const MAX_JOURNAL_PAGE = 2000;

/**
 * THE HUB-SIDE HALF OF THE DELETION BREAKER (F-1).
 *
 * `apps/studio/sync/file-plane.ts` has carried `DELETE_BUDGET_WINDOW_MS` /
 * `DELETE_BUDGET_PER_WINDOW` since `propagateDeletes` shipped ON — cumulative,
 * windowed, ledger-persisted, because a per-pass rate limit is the wrong
 * control for a cumulative harm (ten per pass, six passes a minute, and a
 * two-hundred-file project is gone in three minutes without the limit tripping
 * once). The DOOR had no such budget at all. A gate on one side of a two-sided
 * lane is half a gate, and this is the lossy direction: a tombstone accepted
 * here is a delete every peer applies.
 *
 * Same numbers as the desktop, deliberately — two different ceilings on the
 * same harm would just mean the lower one is the real one and the other is
 * decoration.
 *
 * PERSISTENCE IS FREE HERE: the count is a query over `file_journal` itself, so
 * "restart the hub" is not the bypass it would be for in-memory state, and it
 * survives rehydrate with the generation.
 */
export const DELETE_BUDGET_WINDOW_MS = 60 * 60 * 1000;
export const DELETE_BUDGET_PER_WINDOW = 25;

/** One open handle per dataDir. Native init is expensive; cache it. */
const handleCache = new Map();

export function journalDbPath(dataDir) {
  return join(dataDir, 'journal.db');
}

/**
 * Open (creating if needed) the journal for a data directory.
 *
 * Idempotent and cached. The epoch is minted on first open and then only ever
 * rotated deliberately, by `rotateEpoch`.
 */
export function openJournal(dataDir, { now = Date.now } = {}) {
  const cached = handleCache.get(dataDir);
  if (cached) return cached;
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const db = new Database(journalDbPath(dataDir));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_journal (
      seq            INTEGER PRIMARY KEY AUTOINCREMENT,
      path           TEXT    NOT NULL,
      sha256         TEXT,
      size           INTEGER,
      mtime_ms       INTEGER,
      class          TEXT,
      deleted        INTEGER NOT NULL DEFAULT 0,
      source         TEXT    NOT NULL,
      mirrored_at_ms INTEGER,
      at_ms          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS file_journal_path ON file_journal(path);
    CREATE TABLE IF NOT EXISTS journal_meta (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS peer_cursors (
      label      TEXT PRIMARY KEY,
      epoch      TEXT,
      seq        INTEGER NOT NULL DEFAULT 0,
      healed_seq INTEGER NOT NULL DEFAULT 0,
      refused    TEXT,
      last_seen  INTEGER
    );
    CREATE TABLE IF NOT EXISTS sha_cache (
      path     TEXT PRIMARY KEY,
      size     INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      sha256   TEXT    NOT NULL
    );
  `);

  const getMeta = db.prepare('SELECT v FROM journal_meta WHERE k = ?');
  const setMeta = db.prepare(
    'INSERT INTO journal_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'
  );
  if (!getMeta.get('epoch')) setMeta.run('epoch', randomUUID());

  const handle = makeHandle({ db, getMeta, setMeta, now });
  handleCache.set(dataDir, handle);
  return handle;
}

/** Drop the cached handle (tests; a closed db must not be handed out again). */
export function closeJournal(dataDir) {
  const h = handleCache.get(dataDir);
  if (!h) return;
  handleCache.delete(dataDir);
  try {
    h.db.close();
  } catch {
    /* already closed */
  }
}

function makeHandle({ db, getMeta, setMeta, now }) {
  const stmts = {
    head: db.prepare('SELECT COALESCE(MAX(seq), 0) AS head FROM file_journal'),
    latestForPath: db.prepare(
      'SELECT * FROM file_journal WHERE path = ? ORDER BY seq DESC LIMIT 1'
    ),
    insert: db.prepare(
      `INSERT INTO file_journal (path, sha256, size, mtime_ms, class, deleted, source, at_ms)
       VALUES (@path, @sha256, @size, @mtime_ms, @class, @deleted, @source, @at_ms)`
    ),
    insertAtSeq: db.prepare(
      `INSERT INTO file_journal (seq, path, sha256, size, mtime_ms, class, deleted, source, mirrored_at_ms, at_ms)
       VALUES (@seq, @path, @sha256, @size, @mtime_ms, @class, @deleted, @source, @mirrored_at_ms, @at_ms)`
    ),
    since: db.prepare('SELECT * FROM file_journal WHERE seq > ? ORDER BY seq ASC LIMIT ?'),
    byId: db.prepare('SELECT * FROM file_journal WHERE seq = ?'),
    deletionsSince: db.prepare(
      'SELECT COUNT(*) AS n FROM file_journal WHERE deleted = 1 AND at_ms >= ?'
    ),
    compaction: db.prepare(
      `SELECT j.* FROM file_journal j
        JOIN (SELECT path, MAX(seq) AS seq FROM file_journal GROUP BY path) m
          ON j.path = m.path AND j.seq = m.seq
        ORDER BY j.path ASC`
    ),
    markMirrored: db.prepare('UPDATE file_journal SET mirrored_at_ms = ? WHERE seq = ?'),
    getCursor: db.prepare('SELECT * FROM peer_cursors WHERE label = ?'),
    upsertCursor: db.prepare(
      `INSERT INTO peer_cursors (label, epoch, seq, healed_seq, refused, last_seen)
       VALUES (@label, @epoch, @seq, @healed_seq, @refused, @last_seen)
       ON CONFLICT(label) DO UPDATE SET
         epoch = excluded.epoch, seq = excluded.seq,
         healed_seq = excluded.healed_seq, refused = excluded.refused,
         last_seen = excluded.last_seen`
    ),
    allCursors: db.prepare('SELECT * FROM peer_cursors ORDER BY label ASC'),
    getSha: db.prepare('SELECT * FROM sha_cache WHERE path = ?'),
    setSha: db.prepare(
      `INSERT INTO sha_cache (path, size, mtime_ms, sha256) VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET size = excluded.size,
         mtime_ms = excluded.mtime_ms, sha256 = excluded.sha256`
    ),
  };

  /** Listeners fired after every accepted append (the poke + the tail). */
  const listeners = new Set();
  const emit = (row) => {
    for (const fn of listeners) {
      try {
        fn(row);
      } catch (err) {
        // A subscriber must never be able to fail a write that already landed.
        console.error(`[journal] subscriber threw: ${err.message}`);
      }
    }
  };

  const handle = {
    db,

    epoch: () => getMeta.get('epoch').v,
    head: () => stmts.head.get().head,

    /**
     * Rotate the epoch — every peer cursor becomes meaningless and peers
     * re-anchor. Reserved for an UNRECONSTRUCTIBLE rewind (§3): a restore whose
     * tail is missing or corrupt. Loud on purpose; if this fires routinely,
     * the tail write-behind is broken and that is the bug to fix.
     */
    rotateEpoch(reason) {
      const next = randomUUID();
      setMeta.run('epoch', next);
      db.prepare('UPDATE peer_cursors SET epoch = NULL, seq = 0, healed_seq = 0').run();
      console.error(
        `[journal] EPOCH ROTATED (${next}) — ${reason}. Every peer will re-anchor against a full manifest.`
      );
      return next;
    },

    onAppend(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /**
     * sha256 of a checkout file, through the persisted cache.
     *
     * The cache is keyed by path and validated by (size, mtimeMs). It survives
     * a warm restart, which is the common case. It deliberately does NOT
     * survive a REHYDRATE in any useful way — a restored tree has fresh mtimes,
     * so every entry misses and the tree is re-hashed once. That pass is why
     * the walk-import reconciler runs POST-BIND: the cell serves
     * stale-until-repaired rather than adding a full hash to the boot path.
     */
    shaOf(designRoot, rel) {
      const abs = join(designRoot, rel);
      let st;
      try {
        st = statSync(abs);
      } catch {
        return null;
      }
      if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
      const hit = stmts.getSha.get(rel);
      if (hit && hit.size === st.size && hit.mtime_ms === st.mtimeMs) {
        return { sha256: hit.sha256, size: st.size, mtimeMs: st.mtimeMs };
      }
      // Chunked: a large video is hashed without being held in memory.
      let sha256;
      try {
        sha256 = sha256File(abs);
      } catch {
        return null;
      }
      stmts.setSha.run(rel, st.size, st.mtimeMs, sha256);
      return { sha256, size: st.size, mtimeMs: st.mtimeMs };
    },

    /**
     * Append a row for `path`, having looked at the hub's OWN disk.
     *
     * The caller supplies only WHERE to look. What is there — existence, size,
     * mtime, bytes, class — is read here, so a nudge from a peer or from the
     * studio child can never inject content into the log.
     *
     * Same-hash is a NO-OP (`{ noop: true }` with the existing seq): redundant
     * re-uploads, an idempotent sweep, and a rewrite of identical bytes all
     * cost zero journal churn and zero peer wakeups.
     *
     * @returns {null | { seq: number, sha256: string|null, noop: boolean, deleted: boolean }}
     */
    recordWrite({ designRoot, path: rel, source, deleted = false }) {
      if (!designRoot || typeof rel !== 'string' || rel.length === 0) return null;
      if (!JOURNAL_SOURCES.includes(source)) {
        console.error(`[journal] refusing an append with unknown source '${source}'`);
        return null;
      }
      // Membership is the classifier's call and nobody else's (DDR-226 §1).
      // A path outside the file plane simply has no journal, which is what
      // makes "no row" a meaningful statement about the plane.
      const cls = classifyProjectFile(rel, {
        canvasGroups: readCanvasGroups(designRoot),
        hasFile: (r) => existsSync(join(designRoot, r)),
      });
      if (!isFilePlaneClass(cls)) return null;

      const prev = stmts.latestForPath.get(rel);
      const at = now();

      if (deleted) {
        // A tombstone row. Emission is Increment 6's job; the SHAPE lands now
        // so a replayed tail from a future release is never unparseable.
        if (prev && prev.deleted === 1)
          return { seq: prev.seq, sha256: null, noop: true, deleted: true };
        const info = stmts.insert.run({
          path: rel,
          sha256: null,
          size: null,
          mtime_ms: null,
          class: cls,
          deleted: 1,
          source,
          at_ms: at,
        });
        const row = stmts.byId.get(info.lastInsertRowid);
        emit(row);
        return { seq: row.seq, sha256: null, noop: false, deleted: true };
      }

      const stat = handle.shaOf(designRoot, rel);
      if (stat === null) return null; // gone, unreadable, or implausible

      if (prev && prev.deleted === 0 && prev.sha256 === stat.sha256) {
        return { seq: prev.seq, sha256: stat.sha256, noop: true, deleted: false };
      }
      const info = stmts.insert.run({
        path: rel,
        sha256: stat.sha256,
        size: stat.size,
        mtime_ms: Math.round(stat.mtimeMs),
        class: cls,
        deleted: 0,
        source,
        at_ms: at,
      });
      const row = stmts.byId.get(info.lastInsertRowid);
      emit(row);
      return { seq: row.seq, sha256: stat.sha256, noop: false, deleted: false };
    },

    /**
     * Tombstone rows appended at or after `sinceMs` — the delete breaker's
     * numerator. See `DELETE_BUDGET_PER_WINDOW`.
     *
     * @param {number} sinceMs
     * @returns {number}
     */
    deletionsSince(sinceMs) {
      const row = stmts.deletionsSince.get(Number.isFinite(sinceMs) ? sinceMs : 0);
      return row?.n ?? 0;
    },

    /**
     * Is there budget for one more deletion right now?
     *
     * @returns {{ ok: true } | { ok: false, used: number, limit: number, windowMs: number }}
     */
    deleteBudget() {
      const used = handle.deletionsSince(now() - DELETE_BUDGET_WINDOW_MS);
      if (used < DELETE_BUDGET_PER_WINDOW) return { ok: true };
      return {
        ok: false,
        used,
        limit: DELETE_BUDGET_PER_WINDOW,
        windowMs: DELETE_BUDGET_WINDOW_MS,
      };
    },

    /** Entries after `since`, capped. `truncated` says the page is partial. */
    entriesSince(since, limit = MAX_JOURNAL_PAGE) {
      const capped = Math.max(1, Math.min(limit, MAX_JOURNAL_PAGE));
      const rows = stmts.since.all(since, capped + 1);
      const truncated = rows.length > capped;
      return { entries: rows.slice(0, capped).map(toWire), truncated };
    },

    /** Latest row per path — the manifest, as a compaction of the log. */
    compaction() {
      return stmts.compaction.all().map(toWire);
    },

    /**
     * The latest row for ONE path, or null.
     *
     * The compare-and-swap at the write door asks this per request, so it is
     * an indexed lookup rather than a scan of the whole compaction — the
     * difference between a constant and a full-project walk on every push of a
     * fresh link.
     */
    latestFor(rel) {
      const row = stmts.latestForPath.get(rel);
      return row ? toWire(row) : null;
    },

    markMirrored(seq, atMs = now()) {
      stmts.markMirrored.run(atMs, seq);
    },

    /**
     * Rows the write-behind has not confirmed durable — ITS work queue
     * (Sync v2 Increment 5). `mirrored_at_ms` is stamped only after the
     * object-storage put succeeds, so a crash between append and mirror
     * loses nothing: the row is still here on the next flush.
     */
    unmirrored(limit = 500) {
      return db
        .prepare('SELECT * FROM file_journal WHERE mirrored_at_ms IS NULL ORDER BY seq ASC LIMIT ?')
        .all(Math.max(1, limit))
        .map(toWire);
    },

    cursorFor(label) {
      return stmts.getCursor.get(label) ?? null;
    },

    allCursors() {
      return stmts.allCursors.all();
    },

    /**
     * Record a peer's checkpoint.
     *
     * `refused` is the persistent refused-path set and it OUTRANKS the cursor
     * in the doručenka (DDR-214's ordering rule applied to files): a peer whose
     * cursor passed seq S but which REFUSED that path has not received it, and
     * must never render as delivered.
     */
    setCursor({ label, epoch, seq = 0, healedSeq = 0, refused = null }) {
      stmts.upsertCursor.run({
        label,
        epoch: epoch ?? null,
        seq,
        healed_seq: healedSeq,
        refused: refused === null ? null : JSON.stringify(refused),
        last_seen: now(),
      });
    },

    /**
     * Serialize rows after `sinceSeq` as NDJSON — the R2 tail's payload.
     */
    tailLines(sinceSeq = 0) {
      const rows = db
        .prepare('SELECT * FROM file_journal WHERE seq > ? ORDER BY seq ASC')
        .all(sinceSeq);
      return rows.map((r) => JSON.stringify(toTail(r))).join('\n');
    },

    /**
     * Replay an NDJSON tail into the journal, seq-preserving.
     *
     * Called at rehydrate, AFTER the generation restored `journal.db` and
     * BEFORE any epoch decision. Rows at or below the restored head are
     * skipped, so replaying a tail that overlaps the generation is idempotent —
     * which is what makes "reset the tail after a backup" safe even if the
     * process dies between the snapshot and the reset.
     *
     * Every replayed row is re-classified, not trusted. `recordWrite` treats
     * "the classifier decides membership and nobody else" as its central
     * invariant, and a tail that bypassed it stated the invariant in one place
     * and broke it in another: whoever can write `tenants/<id>/journal/tail.ndjson`
     * could inject rows for `never`-class paths, or tombstones for real files,
     * and they would flow straight out of `GET /api/journal`.
     *
     * ── The tombstone half, re-argued (F-1) ────────────────────────────────
     * This comment used to state its own expiry: "contained today by the
     * re-classification at both readers — and it stops being contained the
     * moment Increment 6 wires tombstone application." Increment 6 landed
     * (`sync/index.ts` imports `tombstone-apply`), so the class part is no
     * longer the whole answer: re-classification decides WHETHER a path is in
     * the plane, and says nothing about whether `deleted` is true.
     *
     * `deleted` cannot simply be re-derived from disk the way `recordWrite`
     * derives content, because a tail legitimately carries deletes that happened
     * AFTER the generation this checkout was restored from — the file is still
     * present on disk and the tombstone is still real. So the control is a RATE,
     * not a permission, exactly as it is on the desktop: a replay may apply at
     * most `DELETE_BUDGET_PER_WINDOW` tombstones, counted cumulatively against
     * the ones already in the window. A real rehydrate is far under it; an
     * injected purge is not. Overflow rows count as `malformed`, which is
     * already the counter the drill asserts on.
     *
     * `designRoot` is optional so a caller without a checkout still gets the
     * shape gate; with one, the full classifier runs.
     *
     * @returns {{ applied: number, skipped: number, malformed: number, head: number }}
     */
    replayTail(text, { designRoot } = {}) {
      const before = handle.head();
      let applied = 0;
      let skipped = 0;
      let malformed = 0;
      // Cumulative with whatever the window already holds — a replay cannot
      // top the budget back up by being a separate operation.
      let tombstoneBudget = Math.max(
        0,
        DELETE_BUDGET_PER_WINDOW - handle.deletionsSince(now() - DELETE_BUDGET_WINDOW_MS)
      );
      const lines = String(text ?? '')
        .split('\n')
        .filter((l) => l.trim().length > 0);
      const run = db.transaction(() => {
        for (const line of lines) {
          let row;
          try {
            row = JSON.parse(line);
          } catch {
            malformed += 1;
            continue;
          }
          if (
            !row ||
            typeof row.seq !== 'number' ||
            !Number.isInteger(row.seq) ||
            row.seq <= 0 ||
            typeof row.path !== 'string' ||
            row.path.length === 0
          ) {
            malformed += 1;
            continue;
          }
          if (row.seq <= before || stmts.byId.get(row.seq)) {
            skipped += 1;
            continue;
          }
          if (!isProjectFileShape(row.path)) {
            malformed += 1;
            continue;
          }
          if (designRoot) {
            const cls = classifyProjectFile(row.path, {
              canvasGroups: readCanvasGroups(designRoot),
              hasFile: (r) => existsSync(join(designRoot, r)),
            });
            if (!isFilePlaneClass(cls)) {
              malformed += 1;
              continue;
            }
          }
          // The delete breaker, applied to the tail. See the docblock above:
          // classification says nothing about `deleted`, and a tombstone that
          // lands here is a delete every peer applies.
          if (row.deleted) {
            if (tombstoneBudget <= 0) {
              malformed += 1;
              continue;
            }
            tombstoneBudget -= 1;
          }
          stmts.insertAtSeq.run({
            seq: row.seq,
            path: row.path,
            sha256: typeof row.sha256 === 'string' ? row.sha256 : null,
            size: Number.isFinite(row.size) ? row.size : null,
            mtime_ms: Number.isFinite(row.mtimeMs) ? row.mtimeMs : null,
            class: typeof row.class === 'string' ? row.class : null,
            deleted: row.deleted ? 1 : 0,
            source: JOURNAL_SOURCES.includes(row.source) ? row.source : 'tail-replay',
            mirrored_at_ms: Number.isFinite(row.mirroredAtMs) ? row.mirroredAtMs : null,
            at_ms: Number.isFinite(row.atMs) ? row.atMs : now(),
          });
          applied += 1;
        }
      });
      run();
      // No manual `sqlite_sequence` bump is needed and none is safe: the table
      // is AUTOINCREMENT, so SQLite raises its own counter to any explicit
      // rowid we insert above the current max. The next organic append
      // therefore continues past the replayed rows rather than colliding with a
      // seq peers already consumed — pinned by the idempotence test.
      return { applied, skipped, malformed, head: handle.head() };
    },
  };

  return handle;
}

/** DB row → the shape peers see. camelCase, and `mtimeMs` clearly display-only. */
function toWire(row) {
  return {
    seq: row.seq,
    path: row.path,
    sha256: row.sha256,
    size: row.size,
    // DISPLAY ONLY — never an overwrite authority on any receiver (F4).
    mtimeMs: row.mtime_ms,
    class: row.class,
    deleted: row.deleted === 1,
    mirroredAtMs: row.mirrored_at_ms,
    atMs: row.at_ms,
  };
}

/** DB row → the tail's line shape. Same as the wire plus the source. */
function toTail(row) {
  return { ...toWire(row), source: row.source };
}

/* ---------------------------------------------------------- the routes --- */

/** `GET /api/journal?since=&epoch=` — the cursor read. */
export const JOURNAL_PATH = '/api/journal';

/** `POST /api/journal/report` — the loopback NUDGE (never data). */
export const JOURNAL_REPORT_PATH = '/api/journal/report';

/** A path a nudge is allowed to name. Shape only — the classifier still judges
 *  membership, and the disk still decides what is actually there. */
const NUDGE_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;

/** How many paths one nudge may name. A nudge is a hint, not a work queue. */
const MAX_NUDGE_PATHS = 64;

/**
 * Handle the journal's two routes. Same dependency-injected contract as
 * `handleFilesRoute` — returns true when it answered.
 *
 * `GET /api/journal` is the cursor read. It is bearer-gated and scope-filtered
 * like the manifest, and it fails CLOSED: an epoch mismatch, a `since` beyond
 * the head, or a `since` below what the log still carries all answer
 * `{ reanchor: true }`. "No cursor" must never render as "no changes" — that is
 * the shape that lets a stale peer believe it is up to date.
 *
 * `POST /api/journal/report` is the studio child's nudge. It carries PATHS and
 * nothing else; the hub re-stats and re-hashes its own disk for each one. A
 * caller cannot state a hash, a size, a class, or a deletion — which is what
 * makes it safe to accept from a process the hub supervises but does not trust
 * to speak about content.
 */
export function handleJournalRoutes({
  path,
  method,
  query,
  bearer,
  verify,
  matchesScope,
  designRoot,
  journal,
  body,
  respondJson,
  isLoopback = false,
  checkRateLimit,
}) {
  if (path === JOURNAL_PATH) {
    if (method !== 'GET') {
      respondJson(405, { error: 'method not allowed' });
      return true;
    }
    const match = bearer ? verify(bearer) : null;
    if (!match) {
      respondJson(401, { error: 'a project token is required to read the journal' });
      return true;
    }
    // The manifest route has no rate limit and that is a named below-floor
    // finding; this one is not going to repeat it.
    if (checkRateLimit && !checkRateLimit(match.label)) {
      respondJson(429, { error: 'too many journal reads' });
      return true;
    }
    if (!journal) {
      // A hub with no checkout has no file plane. An EMPTY journal, not an
      // error — an old-style hub answers peers harmlessly.
      respondJson(200, { epoch: null, head: 0, entries: [], truncated: false });
      return true;
    }

    const epoch = journal.epoch();
    const head = journal.head();
    const askedEpoch = query?.epoch ?? null;
    const sinceRaw = query?.since;
    const since = Number.isFinite(Number(sinceRaw)) ? Math.trunc(Number(sinceRaw)) : 0;

    // FAIL CLOSED, three ways (DDR-214's ordering rule applied to the cursor):
    // a different epoch, a cursor from the future, and a negative cursor are
    // all "you do not know where you are" — never "nothing changed".
    if (askedEpoch !== null && askedEpoch !== epoch) {
      respondJson(200, { epoch, head, reanchor: true, reason: 'epoch changed' });
      return true;
    }
    if (since < 0 || since > head) {
      respondJson(200, { epoch, head, reanchor: true, reason: 'cursor is not in this log' });
      return true;
    }

    const page = journal.entriesSince(since);
    const entries = page.entries.filter((e) => matchesScope(match.scope, e.path));
    respondJson(200, { epoch, head, entries, truncated: page.truncated });
    return true;
  }

  if (path === JOURNAL_REPORT_PATH) {
    if (method !== 'POST') {
      respondJson(405, { error: 'method not allowed' });
      return true;
    }
    // Loopback only. This route exists for the studio child sharing the disk;
    // exposing "make the hub stat these 64 paths" to the internet would be a
    // free filesystem oracle with realpath amplification.
    if (!isLoopback) {
      respondJson(404, { error: 'not found' });
      return true;
    }
    const match = bearer ? verify(bearer) : null;
    if (!match) {
      respondJson(401, { error: 'a token is required' });
      return true;
    }
    // Same posture as the file door, which refuses read-only at its own gate.
    // Harmless today — the caller is loopback and the hub only reads its own
    // disk — but "a viewer may cause journal rows to be appended" is not a
    // sentence worth leaving true just because the current caller is trusted.
    if (match.readOnly) {
      respondJson(403, { error: 'this token is read-only' });
      return true;
    }
    if (!journal || !designRoot) {
      respondJson(200, { noted: 0 });
      return true;
    }
    const paths = Array.isArray(body?.paths) ? body.paths : [];
    let noted = 0;
    for (const raw of paths.slice(0, MAX_NUDGE_PATHS)) {
      if (typeof raw !== 'string' || !NUDGE_PATH_RE.test(raw) || raw.split('/').includes('..')) {
        continue;
      }
      noted += 1;
      // The hub looks at ITS OWN disk. The report said where; it did not say
      // what, and there is no parameter through which it could.
      journal.recordWrite({ designRoot, path: raw, source: 'studio-report' });
    }
    // THE ANSWER LEAKS NOTHING. `noted` counts syntactically-valid paths — a
    // pure function of the request, which the caller could compute itself. It
    // deliberately does NOT report how many rows were appended: that number
    // differs for a path that exists and a path that does not, which would make
    // this an existence oracle over the checkout for anyone who reached the
    // route. The loopback gate above is a belt; this is the braces, and it holds
    // even if a deployment ever put a proxy hop where loopback used to be.
    respondJson(200, { noted });
    return true;
  }

  return false;
}

/* ------------------------------------------------------- the R2 tail ----- */

/** Where the live tail lives, under whatever prefix the target already applies. */
export const JOURNAL_TAIL_KEY = 'journal/tail.ndjson';

/** `journal_meta` key holding the seq the current tail starts after. */
const TAIL_BASE_KEY = 'tail_base_seq';

/**
 * Write-behind the journal to object storage as one NDJSON blob.
 *
 * S3 has no append, so "one line per append" is implemented as a debounced
 * rewrite of the whole tail. That is cheap because the tail is BOUNDED: it
 * carries only the rows written since the last backup generation (≤6 h of a
 * design project's writes), and `rotate()` resets it whenever a generation
 * snapshots `journal.db`.
 *
 * LOUD AND RETRIED, never best-effort-and-silent (the `sweepNew` lesson): a
 * failing tail means the next wake rewinds the journal, so it must be visible
 * in the logs long before it is visible as a conflict storm.
 */
export function createJournalTail({
  journal,
  target,
  debounceMs = 2000,
  maxRetries = 3,
  log = console,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  if (!target) {
    // A hub with no object storage (a laptop) has nothing to write behind TO,
    // and nothing to rehydrate FROM either — so this is a clean no-op, not a
    // degraded mode.
    return {
      schedule() {},
      async flush() {
        return { ok: true, skipped: 'no-target' };
      },
      async rotate() {},
      async stop() {},
      pending: () => false,
      failures: () => 0,
    };
  }

  let timer = null;
  let inFlight = null;
  let again = false;
  let failures = 0;
  let stopped = false;

  const baseSeq = () => {
    const row = journal.db.prepare('SELECT v FROM journal_meta WHERE k = ?').get(TAIL_BASE_KEY);
    return row ? Number(row.v) || 0 : 0;
  };

  async function writeOnce() {
    const body = journal.tailLines(baseSeq());
    let lastErr = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        await target.put(JOURNAL_TAIL_KEY, Buffer.from(body, 'utf8'));
        if (failures > 0) {
          log.log?.(`[journal] tail write-behind recovered after ${failures} failure(s).`);
        }
        failures = 0;
        return { ok: true, bytes: Buffer.byteLength(body) };
      } catch (err) {
        lastErr = err;
        // Linear backoff; this is durability, not a hot path.
        if (attempt < maxRetries) await new Promise((r) => setTimeoutImpl(r, 200 * (attempt + 1)));
      }
    }
    failures += 1;
    log.error?.(
      `[journal] tail write-behind FAILED (${failures} consecutive): ${lastErr?.message}. ` +
        'Until this succeeds a container restore will rewind the journal and every peer will re-anchor.'
    );
    return { ok: false, error: lastErr };
  }

  async function flush() {
    if (inFlight) {
      again = true;
      return inFlight;
    }
    inFlight = (async () => {
      try {
        return await writeOnce();
      } finally {
        inFlight = null;
        if (again) {
          again = false;
          void flush();
        }
      }
    })();
    return inFlight;
  }

  return {
    /** Called from the journal's append listener — coalesces a burst. */
    schedule() {
      if (stopped || timer !== null) return;
      timer = setTimeoutImpl(() => {
        timer = null;
        void flush();
      }, debounceMs);
    },
    flush,
    /**
     * A backup generation has snapshotted `journal.db` up to `seq` — the tail
     * no longer has to carry those rows. Replay is seq-guarded, so a crash
     * between the snapshot and this call costs a slightly long tail, never a
     * wrong journal.
     */
    async rotate(seq) {
      journal.db
        .prepare(
          'INSERT INTO journal_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'
        )
        .run(TAIL_BASE_KEY, String(seq));
      await flush();
    },
    /** SIGTERM: land whatever is inside the debounce window. */
    async stop() {
      stopped = true;
      if (timer !== null) {
        clearTimeoutImpl(timer);
        timer = null;
      }
      await flush();
    },
    pending: () => timer !== null || inFlight !== null,
    failures: () => failures,
  };
}

/**
 * Replay the object-storage tail into a just-restored journal — the step that
 * must run BEFORE any epoch decision (DDR-226 §3).
 *
 * Returns what happened so the caller can decide the epoch honestly:
 *   - `state: 'replayed'`  the tail was readable; head moved (or was already ahead)
 *   - `state: 'empty'`     there is no tail yet (a tenant that never wrote one)
 *   - `state: 'lost'`      the tail could not be read → a TRUE rewind; the
 *                          caller rotates the epoch
 */
export async function replayTailFromTarget({ journal, target, designRoot, log = console }) {
  if (!target) return { state: 'empty', reason: 'no object storage configured' };
  let raw;
  try {
    raw = await target.get(JOURNAL_TAIL_KEY);
  } catch (err) {
    log.error?.(`[journal] tail unreadable: ${err.message}`);
    return { state: 'lost', reason: err.message };
  }
  if (!raw) {
    // "No tail" and "no tail, on a tenant that had already issued seqs" are
    // not the same fact. The first is a genuine first boot. The second is
    // UNRECONSTRUCTIBLE: the journal rewinds to the generation's head, and
    // under an unchanged epoch the next appends re-issue seqs peers already
    // consumed. Peers above the restored head are rescued by the fail-closed
    // `since > head → reanchor` rule; peers BELOW it read re-issued seqs as
    // fresh news with nothing degraded, which is the "cursors go stale
    // forever" outcome the epoch exists to prevent.
    return journal.head() > 0
      ? { state: 'lost', reason: 'no tail object, but this tenant had already issued seqs' }
      : { state: 'empty', reason: 'no tail object' };
  }
  const result = journal.replayTail(raw.toString('utf8'), { designRoot });
  if (result.malformed > 0) {
    log.error?.(
      `[journal] tail replay skipped ${result.malformed} malformed line(s) — the log may be short of rows peers already hold.`
    );
  }
  log.log?.(
    `[journal] tail replay: +${result.applied} row(s), ${result.skipped} already present, head now ${result.head}.`
  );
  return { state: 'replayed', ...result };
}

/** Floor and ceiling for the walk-import belt. A belt faster than a second is
 *  a busy-loop; one slower than an hour is not a backstop, it is a shrug. */
const WALK_MIN_MS = 1_000;
const WALK_MAX_MS = 60 * 60_000;
/**
 * How often the reconciler re-walks the checkout, in ms.
 *
 * This is the backstop for writes NO hook covers: an agent editing a
 * design-system file from inside the cell, a `git pull`, a CLI import verb, a
 * class flip. The hooked paths (a peer's PUT, the studio child's nudge) reach
 * the journal in about a second and never wait for this.
 *
 * It used to be fifteen minutes, chosen when the walk was assumed expensive. It
 * isn't, after the first pass: `shaOf` caches by (path, size, mtime), so a
 * repeat walk is one `stat` per file and re-hashes only what actually moved. A
 * minute costs a few milliseconds on a design project and turns "up to a
 * quarter of an hour" into "up to a minute" for everything unhooked — which
 * matters because the difference between the two sync directions is what reads
 * to a person as "cloud → desktop is broken".
 *
 * The first walk after a REHYDRATE is still the expensive one (a restore resets
 * every mtime, so the cache misses across the board), and it still runs
 * post-bind exactly once. This interval does not touch that.
 */
export function walkIntervalFromEnv(env = process.env) {
  const raw = Number(env.MAUDE_JOURNAL_WALK_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 60_000;
  return Math.min(WALK_MAX_MS, Math.max(WALK_MIN_MS, Math.trunc(raw)));
}

/**
 * The permanent walk-import reconciler (DDR-226 §2).
 *
 * Diffs the checkout against the journal's compaction and appends a row for
 * anything the hooks missed: a git-level restore, a write site nobody hooked, a
 * class flip. It is PERMANENT, not a migration — the hooks are an optimization
 * and this is the truth.
 *
 * Runs post-bind (the cell serves stale-until-repaired) and on a slow timer.
 * Never throws: a reconciler that can fail a boot is worse than a stale row.
 *
 * @returns {{ appended: number, scanned: number, unchanged: number }}
 */
export function walkImport({ journal, designRoot, source = 'walk-import', log = console }) {
  if (!designRoot || !existsSync(designRoot)) return { appended: 0, scanned: 0, unchanged: 0 };
  let files;
  try {
    // Reuse the manifest walk verbatim — one walk implementation, one set of
    // depth/size/symlink rules, one classifier call site.
    files = listProjectFiles(designRoot).files;
  } catch (err) {
    log.error?.(`[journal] walk-import could not read ${designRoot}: ${err.message}`);
    return { appended: 0, scanned: 0, unchanged: 0 };
  }

  const known = new Map(journal.compaction().map((r) => [r.path, r]));
  let appended = 0;
  let unchanged = 0;
  for (const f of files) {
    const prev = known.get(f.path);
    if (prev && !prev.deleted && prev.sha256 === f.sha256) {
      unchanged += 1;
      continue;
    }
    const res = journal.recordWrite({ designRoot, path: f.path, source });
    if (res && !res.noop) appended += 1;
    else unchanged += 1;
  }
  if (appended > 0) {
    log.log?.(
      `[journal] walk-import appended ${appended} row(s) the write hooks did not see (${files.length} file(s) scanned).`
    );
  }
  return { appended, scanned: files.length, unchanged };
}
