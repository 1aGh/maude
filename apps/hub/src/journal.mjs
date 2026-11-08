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
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
// Imported, never re-typed — same reason server.mjs pulls this in for the
// canvas-path receiver (see that file's own import of it).
import { canvasSlugFromRel } from '../../studio/canvas-slug.ts';
// The content test for "this file is a canvas" (C4 k) — pure, no imports, and
// already in the image (Dockerfile COPY, reached through access/closure.ts).
import { isCanvasSource } from '../../studio/skip-dirs.ts';
import { fileAccessFor, visibleJournalPage } from './access-files.mjs';
import { isProjectOwnerMatch } from './access-gate.mjs';
import { MAX_PROJECT_FILE_BYTES, sha256File } from './file-limits.mjs';
import {
  heldCodeEntries,
  heldOverflowed,
  hubCheckoutClass,
  listProjectFiles,
  readCanvasGroups,
  resolveProjectFileTarget,
} from './file-manifest.mjs';
import {
  classifyProjectFile,
  isFilePlaneClass,
  isProjectFileShape,
  normalizeGroup,
} from './file-membership.mjs';
import { headObject } from './s3.mjs';

const require = createRequire(import.meta.url);
// better-sqlite3 is a runtime-external native binding (see build.ts). Loading
// it lazily keeps the import graph clean for the bundler.
const Database = require('better-sqlite3');

/** Where a write came from. Recorded for forensics; never an authority. */
export const JOURNAL_SOURCES = Object.freeze([
  'peer-put', // a desktop PUT through a hub write door
  'owner-delete', // a DELETE through the write door by the project owner — the owner's own budget
  'owner-purge', // one file of an owner-confirmed bulk purge (owner-purge.mjs) — no window budget
  'studio-report', // the studio child nudged us about its own write
  'walk-import', // the reconciler found drift the hooks missed
  'boot-scan', // first walk of a checkout with no journal
  'hydrate', // bucket→checkout asset refill at boot
  'tail-replay', // reconstructed from the R2 tail after a rehydrate
  'disk-lost', // a live row whose bytes neither the checkout nor the bucket has
  'flat-twin-quarantine', // the hub parked its own flat canvas twin (2.0.4, quarantineFlatCanvasTwins)
  'owner-adopt', // #167 T5.3 — the project owner adopted a held file as code (POST /api/journal/adopt)
]);

/**
 * How many class holds one checkout keeps (p8-holds-fix, recheck N1). A hold is
 * noted only for a real canvas body on disk and pruned when the file goes, so
 * the store tracks the tree; the walk itself stops at 20 000 files
 * (file-manifest.mjs `MAX_MANIFEST_FILES`), and this matches it. Past the cap a
 * note is refused LOUDLY, once — the same residual as the walk cap (info C).
 */
export const MAX_CLASS_HOLDS = 20_000;

/** Sources whose `recordWrite` may note a hold: a lane that wrote (or found) a
 *  body that is not provably the owner's. `peer-put` is the write door, which
 *  admits a would-be-code `.tsx` only from an owner token (and never a canvas),
 *  so its rows are the owner's own and never noted; a replayed tail row says
 *  nothing about the disk. */
const HOLD_NOTE_SOURCES = new Set(['studio-report', 'walk-import', 'boot-scan', 'hydrate']);

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

/**
 * AN OWNER HAS ITS OWN DOOR BUDGET — HIGHER, NEVER NONE.
 *
 * The member budget exists for the accident shapes — a branch switch, a `git
 * clean`, a botched restore on ONE machine — and for a leaked low-value token.
 * An owner reorganising their own project is neither, and 25 per hour turned an
 * 80-file cleanup into an afternoon of babysitting. So an owner's door deletes
 * are recorded as `owner-delete` and counted against their own, higher window
 * (`OWNER_DELETE_BUDGET_PER_WINDOW`), not the member one — an owner's cleanup
 * does not spend the budget everyone else's accidents need. A deletion past the
 * owner window is a bulk purge: dry-run, confirm the exact set, and it runs in
 * bounded batches (`owner-purge.mjs`, source `owner-purge`, outside both
 * windows because the owner confirmed that exact set).
 *
 * Who is the owner is ONE reading of the token match (`access-gate.mjs`
 * `roleForMatch`) — the access gate and the door cannot disagree about it.
 *
 * What stays: every deleted file is still quarantined before its tombstone is
 * written, so an owner delete is as recoverable as any other. And the R2 TAIL
 * REPLAY still counts every tombstone, owner rows included — `source` in the
 * tail is data, not authority, and exempting a label is exactly how an injected
 * purge would dress itself.
 */
export const OWNER_DELETE_BUDGET_PER_WINDOW = 200;
export const OWNER_DELETE_SOURCE = 'owner-delete';
export const OWNER_PURGE_SOURCE = 'owner-purge';

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
export function openJournal(
  dataDir,
  { now = Date.now, maxHolds = MAX_CLASS_HOLDS, log = console } = {}
) {
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
    -- p8-boundary-harden: paths the hub held as canvases only because the owner
    -- had declared no folders (file-manifest.mjs hubCheckoutClass). code_sha is
    -- the owner's last code row for the path when it was noted, or NULL.
    CREATE TABLE IF NOT EXISTS class_holds (
      path     TEXT PRIMARY KEY,
      code_sha TEXT,
      at_ms    INTEGER NOT NULL
    );
    -- #167 T5.3: holds released since the tail's generation (the tail's delta), and
    -- GHOSTS — a hold pruned because its file was gone remembers its path, so bytes an
    -- unhooked writer restores there later are held again rather than read as code.
    CREATE TABLE IF NOT EXISTS class_hold_released (
      path  TEXT PRIMARY KEY,
      seq   INTEGER NOT NULL,
      ghost INTEGER NOT NULL DEFAULT 0,
      at_ms INTEGER NOT NULL
    );
  `);
  // #167 T5.3 — the journal head a hold was noted at (the tail carries only holds noted at or
  // after its generation's seq). Additive: an older hub inserts without it (NULL = always
  // carried); a pre-existing hold is stamped with today's head, so it rides the tail until a
  // generation taken after this upgrade holds it.
  if (
    !db
      .prepare('PRAGMA table_info(class_holds)')
      .all()
      .some((c) => c.name === 'noted_seq')
  ) {
    db.exec('ALTER TABLE class_holds ADD COLUMN noted_seq INTEGER');
    db.prepare(
      'UPDATE class_holds SET noted_seq = (SELECT COALESCE(MAX(seq), 0) FROM file_journal)'
    ).run();
  }

  const getMeta = db.prepare('SELECT v FROM journal_meta WHERE k = ?');
  const setMeta = db.prepare(
    'INSERT INTO journal_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'
  );
  if (!getMeta.get('epoch')) setMeta.run('epoch', randomUUID());

  const handle = makeHandle({ db, getMeta, setMeta, now, maxHolds, log });
  handleCache.set(dataDir, handle);
  return handle;
}

/**
 * The handle already open for a data directory, or null — never opens one.
 * For a door that was not handed the journal but must see what it names
 * (`access-files.mjs`: a cell's inert media lives in the journal, not on disk).
 */
export function cachedJournal(dataDir) {
  return handleCache.get(dataDir) ?? null;
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

function makeHandle({ db, getMeta, setMeta, now, maxHolds = MAX_CLASS_HOLDS, log = console }) {
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
    // Owner rows are outside the member budget (see OWNER_DELETE_BUDGET_PER_WINDOW).
    deletionsSince: db.prepare(
      "SELECT COUNT(*) AS n FROM file_journal WHERE deleted = 1 AND at_ms >= ? AND source NOT IN ('owner-delete', 'owner-purge')"
    ),
    ownerDeletionsSince: db.prepare(
      "SELECT COUNT(*) AS n FROM file_journal WHERE deleted = 1 AND at_ms >= ? AND source = 'owner-delete'"
    ),
    allDeletionsSince: db.prepare(
      'SELECT COUNT(*) AS n FROM file_journal WHERE deleted = 1 AND at_ms >= ?'
    ),
    compaction: db.prepare(
      `SELECT j.* FROM file_journal j
        JOIN (SELECT path, MAX(seq) AS seq FROM file_journal GROUP BY path) m
          ON j.path = m.path AND j.seq = m.seq
        ORDER BY j.path ASC`
    ),
    markMirrored: db.prepare('UPDATE file_journal SET mirrored_at_ms = ? WHERE seq = ?'),
    unmirroredSha: db.prepare(
      'SELECT 1 AS hit FROM file_journal WHERE sha256 = ? AND mirrored_at_ms IS NULL LIMIT 1'
    ),
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
    holdGet: db.prepare('SELECT code_sha FROM class_holds WHERE path = ?'),
    holdInsert: db.prepare(
      'INSERT OR IGNORE INTO class_holds (path, code_sha, at_ms, noted_seq) VALUES (?, ?, ?, ?)'
    ),
    holdsSince: db.prepare(
      'SELECT path FROM class_holds WHERE noted_seq IS NULL OR noted_seq >= ? ORDER BY path ASC'
    ),
    releasedUpsert: db.prepare(
      `INSERT INTO class_hold_released (path, seq, ghost, at_ms) VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET seq = excluded.seq, ghost = excluded.ghost, at_ms = excluded.at_ms`
    ),
    releasedDelete: db.prepare('DELETE FROM class_hold_released WHERE path = ?'),
    releasedSince: db.prepare(
      'SELECT path FROM class_hold_released WHERE seq >= ? ORDER BY path ASC'
    ),
    releasedPrune: db.prepare('DELETE FROM class_hold_released WHERE ghost = 0 AND seq < ?'),
    ghostGet: db.prepare('SELECT 1 AS hit FROM class_hold_released WHERE path = ? AND ghost = 1'),
    ghostClear: db.prepare('UPDATE class_hold_released SET ghost = 0 WHERE path = ?'),
    ghostCount: db.prepare('SELECT COUNT(*) AS n FROM class_hold_released WHERE ghost = 1'),
    holdDelete: db.prepare('DELETE FROM class_holds WHERE path = ?'),
    holdAll: db.prepare('SELECT path FROM class_holds ORDER BY path ASC'),
    holdCount: db.prepare('SELECT COUNT(*) AS n FROM class_holds'),
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

  /** Cell materializer: inert media lives in the bucket + blob cache, and the
   *  checkout's copy (or its absence) says nothing about it. */
  let inertCached = false;

  /** Paths already in `class_holds` — the walk notes on every pass, the db once.
   *  Mirrors the table, so it is bounded by the same cap. */
  const noted = new Set();
  let holdCount = stmts.holdCount.get().n;
  let warnedHoldCap = false;
  /** Listeners fired when the hold set changes — the R2 tail carries it (N2). */
  const holdListeners = new Set();
  const holdsChanged = () => {
    for (const fn of holdListeners) {
      try {
        fn();
      } catch (err) {
        console.error(`[journal] hold subscriber threw: ${err.message}`);
      }
    }
  };
  /**
   * #167 T5.3 — the overflow flag (`journal_meta` `holds_overflow`): set when a note was refused
   * at the cap or a walk was cut while the hub was the folder boundary, so some boundary canvas
   * may be un-noted. While set, `hubCheckoutClass` reads a would-be-code body from a non-owner
   * lane with no owner code row as `never` (fails closed). Persisted: a restart or a wake (the db
   * rides the generation) keeps it. Cleared only by a complete undeclared walk that refused
   * nothing — the one pass that noted every boundary canvas.
   */
  let overflowed = getMeta.get('holds_overflow')?.v === '1';
  let refusedThisPass = false;
  const setOverflow = (on, { quiet = false } = {}) => {
    if (overflowed === on) return;
    overflowed = on;
    setMeta.run('holds_overflow', on ? '1' : '0');
    if (on && !quiet) {
      log.error?.(
        '[journal] class holds overflowed — boundary canvases without an owner code row are held back from the code lane until a complete walk while no folders are declared.'
      );
    }
  };
  /** Insert one hold with the owner's last live code sha for it (or NULL). */
  const insertHold = (rel) => {
    if (stmts.holdGet.get(rel) !== undefined) return true;
    if (holdCount >= maxHolds) {
      refusedThisPass = true;
      setOverflow(true, { quiet: true }); // the cap line below says it
      if (!warnedHoldCap) {
        warnedHoldCap = true;
        log.error?.(
          `[journal] class-hold cap (${maxHolds}) reached — further boundary canvases are not noted; until a complete walk while no folders are declared, every un-noted one is held back from the code lane (the overflow flag).`
        );
      }
      return false;
    }
    const row = stmts.latestForPath.get(rel);
    const codeSha = row && row.deleted === 0 && row.class === 'code-module' ? row.sha256 : null;
    const info = stmts.holdInsert.run(rel, codeSha, now(), stmts.head.get().head);
    if (info.changes > 0) {
      holdCount += 1;
      // Held again: no release (and no ghost) to carry for it.
      stmts.releasedDelete.run(rel);
      holdsChanged();
    }
    return true;
  };
  /** Drop one hold. `gone` (its file is gone) leaves a ghost of the path (#167 T5.3). */
  const deleteHold = (rel, { gone = false } = {}) => {
    const info = stmts.holdDelete.run(rel);
    noted.delete(rel);
    if (info.changes > 0) {
      holdCount = Math.max(0, holdCount - 1);
      let ghost = gone;
      if (ghost && stmts.ghostCount.get().n >= maxHolds) {
        // No room to remember it: the overflow flag fails the path closed instead.
        ghost = false;
        setOverflow(true);
      }
      stmts.releasedUpsert.run(rel, stmts.head.get().head, ghost ? 1 : 0, now());
      holdsChanged();
    }
  };

  const handle = {
    db,

    /**
     * Class holds (p8-boundary-harden, final-3 attacker L1) — the store behind
     * file-manifest.mjs `hubCheckoutClass`: "a config change never promotes a
     * path into code-module". `noteBoundaryCanvas` records a path that is a
     * canvas only because the owner has declared no folders, with the sha of
     * the owner's last live code row for it (so unchanged owner code is never
     * held); the first note wins.
     */
    noteBoundaryCanvas(rel) {
      if (noted.has(rel)) return;
      if (insertHold(rel)) noted.add(rel);
    },
    /** `undefined` = not held; otherwise the owner's code sha (or null). */
    heldCodeSha(rel) {
      const r = stmts.holdGet.get(rel);
      return r ? (r.code_sha ?? null) : undefined;
    },
    releaseHold(rel) {
      deleteHold(rel);
    },
    /** #167 T5.3 — the owner's last live code sha for `rel`, or null. */
    ownerCodeSha(rel) {
      const row = stmts.latestForPath.get(rel);
      return row && row.deleted === 0 && row.class === 'code-module' ? row.sha256 : null;
    },
    /** #167 T5.3 — a hold on `rel` was pruned because its file was gone. */
    isGhost(rel) {
      return stmts.ghostGet.get(rel) !== undefined;
    },
    clearGhost(rel) {
      stmts.ghostClear.run(rel);
    },
    /** #167 T5.3 — bytes returned at a ghost path from a non-owner lane: hold them again. */
    reholdGhost(rel) {
      if (insertHold(rel)) noted.add(rel);
    },
    holdsOverflowed: () => overflowed,
    /** #167 T5.3 — a walk while the hub is the folder boundary starts / ends (`listProjectFiles`). */
    holdPassStart() {
      refusedThisPass = false;
    },
    holdPassEnd({ truncated = false } = {}) {
      if (truncated) setOverflow(true);
      else if (!refusedThisPass) setOverflow(false);
    },
    /** #167 T5.3 — a generation holds everything before `seq`: forget the releases it covers. */
    pruneReleases(seq) {
      stmts.releasedPrune.run(seq);
    },
    heldPaths() {
      return stmts.holdAll.all().map((r) => r.path);
    },
    /**
     * Drop the hold on `rel` when its file is GONE from the checkout (N1). Only
     * a real absence (ENOENT/ENOTDIR) counts: a file the walk skips (too big, a
     * link) still exists, and dropping its hold would let a later declaration
     * promote it.
     */
    dropHoldIfGone(designRoot, rel) {
      if (!designRoot || stmts.holdGet.get(rel) === undefined) return false;
      try {
        lstatSync(join(designRoot, rel));
        return false;
      } catch (err) {
        if (err?.code !== 'ENOENT' && err?.code !== 'ENOTDIR') return false;
      }
      deleteHold(rel, { gone: true });
      return true;
    },
    /** The walk's prune: every hold whose file is gone. */
    pruneGoneHolds(designRoot) {
      let dropped = 0;
      for (const rel of handle.heldPaths()) {
        if (handle.dropHoldIfGone(designRoot, rel)) dropped += 1;
      }
      return dropped;
    },
    /** Subscribe to changes of the hold set (the R2 tail, N2). */
    onHoldsChange(fn) {
      holdListeners.add(fn);
      return () => holdListeners.delete(fn);
    },
    /**
     * Restore holds a replayed tail carried (N2). Paths only: the owner's code
     * sha is re-derived from THIS journal, exactly as a live note derives it, so
     * a tail can only add a hold, never pick the bytes that lift one. Union, not
     * replace — a release since the last generation may come back after a wake
     * (fail closed; the walk prunes a gone file again).
     */
    restoreHolds(paths) {
      let restored = 0;
      let malformed = 0;
      for (const rel of Array.isArray(paths) ? paths.slice(0, maxHolds) : []) {
        if (typeof rel !== 'string' || !isProjectFileShape(rel)) {
          malformed += 1;
          continue;
        }
        if (stmts.holdGet.get(rel) !== undefined) continue;
        if (insertHold(rel)) {
          noted.add(rel);
          restored += 1;
        }
      }
      return { restored, malformed };
    },

    /**
     * Cell mode (cell materializer Task 13). Once on, absence of an inert-media
     * file from the checkout is never a deletion and its presence never a
     * write — the journal and the bucket are the truth for that class, and the
     * disk is a disposable cache. This is the guard against the plan's top
     * risk: an evicted or never-hydrated photo must not tombstone itself on
     * every desktop.
     */
    setInertCached(on) {
      inertCached = Boolean(on);
    },
    inertCached: () => inertCached,

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
     * The hub's own disk no longer has a path the journal tracks as live — a
     * delete, or the source of a rename, in this checkout (a studio child's
     * report). `recordWrite` looks for bytes and finds none, so without this a
     * file removed on the hub's side never left a teammate's disk (plan
     * T31/L03). Tombstoned only when the disk agrees; a path the journal never
     * tracked, or already tombstoned, is left alone.
     */
    recordGone({ designRoot, path: rel, source }) {
      if (!designRoot || typeof rel !== 'string' || rel.length === 0) return null;
      // A held canvas has no file-plane row, so its hold goes here or nowhere.
      handle.dropHoldIfGone(designRoot, rel);
      const prev = stmts.latestForPath.get(rel);
      if (!prev || prev.deleted === 1) return null;
      // On a cell an inert-media file is ABSENT from the checkout by design.
      // A real delete of one comes through the write door, never from here.
      if (inertCached && prev.class === 'inert-media') return null;
      if (existsSync(join(designRoot, rel))) return null;
      return handle.recordWrite({ designRoot, path: rel, source, deleted: true });
    },

    /**
     * The hub LOST a file it still lists as live — not a delete.
     *
     * A cell's checkout is ephemeral and the boot hydrate refills it from the
     * bucket, so a file that never reached the bucket (the v1.5.x expired
     * write-behind credentials) is simply gone after a restart, while its
     * journal row still says "the hub holds sha X". Every peer agreed with that
     * row, so nobody ever pushed the file again: the canvas that imports it
     * stays a 422 forever.
     *
     * The repair row is LIVE with no hash. A peer reads it as "the hub holds
     * nothing" without a tombstone — `remote-regressed` in `decide-file.ts`,
     * which pushes its copy back (absence is not authority, DDR-076). It is
     * never a tombstone: a tombstone would delete the file on every desktop.
     * No epoch rotation either — the row travels on the ordinary cursor.
     */
    recordLost({ designRoot, path: rel }) {
      if (!designRoot || typeof rel !== 'string' || rel.length === 0) return null;
      const prev = stmts.latestForPath.get(rel);
      if (!prev || prev.deleted === 1 || prev.sha256 == null) return null;
      if (existsSync(join(designRoot, rel))) return null;
      const info = stmts.insert.run({
        path: rel,
        sha256: null,
        size: null,
        mtime_ms: null,
        class: prev.class,
        deleted: 0,
        source: 'disk-lost',
        at_ms: now(),
      });
      const row = stmts.byId.get(info.lastInsertRowid);
      emit(row);
      return { seq: row.seq };
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
     * `expectSha256` (optional): append only when the bytes on disk hash to it — the caller
     * decided about that version and no other (else `null`, nothing appended).
     *
     * @returns {null | { seq: number, sha256: string|null, noop: boolean, deleted: boolean }}
     */
    recordWrite({ designRoot, path: rel, source, deleted = false, expectSha256 = null }) {
      if (!designRoot || typeof rel !== 'string' || rel.length === 0) return null;
      if (!JOURNAL_SOURCES.includes(source)) {
        console.error(`[journal] refusing an append with unknown source '${source}'`);
        return null;
      }
      // Membership is the classifier's call and nobody else's (DDR-226 §1).
      // A path outside the file plane simply has no journal, which is what
      // makes "no row" a meaningful statement about the plane.
      // Provenance-aware (`hubCheckoutClass`): a path held back from the code
      // lane gets no row — the reconciler cannot promote it either.
      // A note only for a regular file a non-owner lane wrote or found (N1).
      const cls = hubCheckoutClass(rel, designRoot, {
        hasFile: (r) => existsSync(join(designRoot, r)),
        sha256: () => handle.shaOf(designRoot, rel)?.sha256 ?? null,
        note: !deleted && HOLD_NOTE_SOURCES.has(source) && isRegularFile(join(designRoot, rel)),
      });
      if (!isFilePlaneClass(cls)) return null;
      // #167 T5.3 — the owner's own write door at a ghost path: the bytes are the owner's.
      if (source === 'peer-put' && !deleted) stmts.ghostClear.run(rel);

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
      // The caller recorded a decision about ONE version (the owner's adopt): other bytes get no row.
      if (expectSha256 !== null && stat.sha256 !== expectSha256) return null;

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
     * Append a row for bytes the hub holds in its CELL BLOB CACHE, not at the
     * checkout path (cell materializer Task 12).
     *
     * `recordWrite`'s invariant is "the hub reads its own disk": the caller
     * says WHERE, never WHAT. On a cell an inert-media upload lands pinned in
     * `_cache/blobs/<sha>` and the checkout path stays empty by design, so
     * that read has nothing to read. This sibling keeps the invariant's point
     * — content is never caller-supplied over HTTP — by accepting only the
     * digest the WRITE DOOR computed from the bytes it streamed, and only for
     * inert media (code and companion text always land in the checkout).
     *
     * @param {{ designRoot: string, path: string, sha256: string, size: number, source: string }} w
     */
    recordVerifiedWrite({ designRoot, path: rel, sha256, size, source }) {
      if (!designRoot || typeof rel !== 'string' || rel.length === 0) return null;
      if (!JOURNAL_SOURCES.includes(source)) {
        console.error(`[journal] refusing an append with unknown source '${source}'`);
        return null;
      }
      if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null;
      if (!Number.isInteger(size) || size < 0 || size > MAX_FILE_BYTES) return null;
      const cls = classifyProjectFile(rel, {
        canvasGroups: readCanvasGroups(designRoot),
        hasFile: (r) => existsSync(join(designRoot, r)),
      });
      if (cls !== 'inert-media') return null;
      const prev = stmts.latestForPath.get(rel);
      if (prev && prev.deleted === 0 && prev.sha256 === sha256) {
        return { seq: prev.seq, sha256, noop: true, deleted: false };
      }
      const info = stmts.insert.run({
        path: rel,
        sha256,
        size,
        mtime_ms: now(),
        class: cls,
        deleted: 0,
        source,
        at_ms: now(),
      });
      const row = stmts.byId.get(info.lastInsertRowid);
      emit(row);
      return { seq: row.seq, sha256, noop: false, deleted: false };
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
     * Every tombstone in the window, `owner-delete` included — what the R2 tail
     * replay counts against, because a label read back from the tail is data.
     *
     * @param {number} sinceMs
     * @returns {number}
     */
    allDeletionsSince(sinceMs) {
      const row = stmts.allDeletionsSince.get(Number.isFinite(sinceMs) ? sinceMs : 0);
      return row?.n ?? 0;
    },

    /**
     * Owner door deletes (`owner-delete`) in the window — the owner budget's
     * numerator. Purge rows are not in it: the owner confirmed that set.
     *
     * @param {number} sinceMs
     * @returns {number}
     */
    ownerDeletionsSince(sinceMs) {
      const row = stmts.ownerDeletionsSince.get(Number.isFinite(sinceMs) ? sinceMs : 0);
      return row?.n ?? 0;
    },

    /**
     * Is there budget for one more deletion right now? `owner: true` asks the
     * owner's window, otherwise the member one.
     *
     * @param {{ owner?: boolean }} [opts]
     * @returns {{ ok: true } | { ok: false, used: number, limit: number, windowMs: number }}
     */
    deleteBudget({ owner = false } = {}) {
      const since = now() - DELETE_BUDGET_WINDOW_MS;
      const used = owner ? handle.ownerDeletionsSince(since) : handle.deletionsSince(since);
      const limit = owner ? OWNER_DELETE_BUDGET_PER_WINDOW : DELETE_BUDGET_PER_WINDOW;
      if (used < limit) return { ok: true };
      return { ok: false, used, limit, windowMs: DELETE_BUDGET_WINDOW_MS };
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

    /** Which lane wrote `rel`'s latest row — forensics and provenance, never
     *  on the wire (`toWire` leaves it out on purpose). Null with no row. */
    latestSourceFor(rel) {
      return stmts.latestForPath.get(rel)?.source ?? null;
    },

    /** Does any row naming this sha still wait for its mirror? (cell pins) */
    hasUnmirroredSha(sha) {
      return Boolean(stmts.unmirroredSha.get(sha));
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
      const lines = rows.map((r) => JSON.stringify(toTail(r)));
      // N2 — the holds ride the tail: a hold is noted with no journal row, and a
      // cell that slept between a note and the next generation must wake with it.
      // #167 T5.3 — only the DELTA since the generation (`sinceSeq`): the holds
      // noted at or after it, and the paths released since (`released`, on the
      // one `holds` line, so a 2.0.x reader keeps reading `holds`). Nothing
      // changed ⇒ the old row-only shape exactly, which an older hub reads clean.
      const held = stmts.holdsSince.all(sinceSeq).map((r) => r.path);
      const released = stmts.releasedSince.all(sinceSeq).map((r) => r.path);
      if (held.length > 0 || released.length > 0) {
        lines.push(JSON.stringify({ holds: held, ...(released.length ? { released } : {}) }));
      }
      return lines.join('\n');
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
        DELETE_BUDGET_PER_WINDOW - handle.allDeletionsSince(now() - DELETE_BUDGET_WINDOW_MS)
      );
      const lines = String(text ?? '')
        .split('\n')
        .filter((l) => l.trim().length > 0);
      /** N2 — hold lines, applied AFTER the rows (their code sha is re-derived
       *  from the replayed journal, see `restoreHolds`). */
      const holdLines = [];
      const parsed = [];
      for (const line of lines) {
        try {
          parsed.push(JSON.parse(line));
        } catch {
          malformed += 1;
        }
      }
      const run = db.transaction(() => {
        // #167 T5.3 — releases FIRST, so the owner's code row written after a
        // prune is not refused by a hold the generation still carries. A tail is
        // not trusted to lift a hold: a released path is dropped only when its
        // file is gone from this disk NOW — the walk's own prune, done in time
        // (it leaves a ghost, like the walk). A file still there stays held.
        for (const row of parsed) {
          if (!row || typeof row !== 'object' || 'seq' in row || !('released' in row)) continue;
          if (!Array.isArray(row.released)) {
            malformed += 1;
            continue;
          }
          for (const rel of row.released.slice(0, maxHolds)) {
            if (typeof rel !== 'string' || !isProjectFileShape(rel)) {
              malformed += 1;
              continue;
            }
            if (designRoot) handle.dropHoldIfGone(designRoot, rel);
          }
        }
        for (const row of parsed) {
          if (row && typeof row === 'object' && 'holds' in row && !('seq' in row)) {
            holdLines.push(row.holds);
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
            const cls = hubCheckoutClass(row.path, designRoot, {
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
        for (const holds of holdLines) {
          if (!Array.isArray(holds)) {
            malformed += 1;
            continue;
          }
          malformed += handle.restoreHolds(holds).malformed;
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

/** `POST /api/journal/adopt` — the owner's "Adopt as code" for one held file (#167 T5.3). */
export const JOURNAL_ADOPT_PATH = '/api/journal/adopt';

/** How many paths one nudge may name. A nudge is a hint, not a work queue. */
const MAX_NUDGE_PATHS = 64;

/** How many held paths one journal answer names (the count is always whole). */
const MAX_HELD_LISTED = 200;

/**
 * The checkout's held code paths, for the OWNER only (p8-held-surface).
 *
 * A path held back from the code lane (`hubCheckoutClass`) is not synced and
 * not committed — and a hold nobody is told about is a silent failure. Only the
 * owner can resolve one (only the owner sets the canvas folders), and the list
 * names teammate work, so it goes to exactly the bar the project-config door
 * sets: a project-wide, writable, owner token. An editor, a viewer, a
 * canvas-scoped token and a canvas-only session get no field at all. The list
 * is this checkout's alone: the holds are keyed by its design root.
 *
 * An owner always gets the field (an empty list clears a panel row).
 */
function ownerHeld(match, designRoot) {
  if (!isProjectOwnerMatch(match)) return {};
  if (!designRoot) return {};
  const held = heldCodeEntries(designRoot);
  return {
    held: held.slice(0, MAX_HELD_LISTED),
    heldCount: held.length,
    // #167 T5.3 — additive: the list may be short (the hold cap or a cut walk), and the
    // boundary canvases it could not name are held back until a complete walk.
    ...(heldOverflowed(designRoot) ? { heldOverflow: true } : {}),
  };
}

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
    const askedEpoch = query?.epoch ?? null;
    const sinceRaw = query?.since;
    const since = Number.isFinite(Number(sinceRaw)) ? Math.trunc(Number(sinceRaw)) : 0;

    // V2-1.16 L1 — a canvas-only session reads its closure's rows only, under
    // the last VISIBLE seq as its head (U5). Project sessions: unchanged.
    const files = fileAccessFor(match, { designRoot, journal });
    if (files.claimDecides) {
      const visibleHead = files.visibleHead();
      if (askedEpoch !== null && askedEpoch !== epoch) {
        respondJson(200, { epoch, head: visibleHead, reanchor: true, reason: 'epoch changed' });
        return true;
      }
      const page = visibleJournalPage(files, journal, { since, pageMax: MAX_JOURNAL_PAGE });
      if (page.reanchor) {
        respondJson(200, { epoch, head: page.head, reanchor: true, reason: page.reanchor });
        return true;
      }
      respondJson(200, {
        epoch,
        head: page.head,
        entries: page.entries,
        truncated: page.truncated,
      });
      return true;
    }
    const head = journal.head();

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
    respondJson(200, {
      epoch,
      head,
      entries,
      truncated: page.truncated,
      ...ownerHeld(match, designRoot),
    });
    return true;
  }

  if (path === JOURNAL_ADOPT_PATH) {
    adoptAsCode({ method, bearer, verify, designRoot, journal, body, respondJson });
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
      // Shape only — the project-file shape the file door admits (a narrower
      // regex here left every path with a space unjournalled). The classifier
      // still judges membership, and the disk decides what is actually there.
      if (typeof raw !== 'string' || !isProjectFileShape(raw)) {
        continue;
      }
      noted += 1;
      // The hub looks at ITS OWN disk. The report said where; it did not say
      // what, and there is no parameter through which it could.
      const row = journal.recordWrite({ designRoot, path: raw, source: 'studio-report' });
      // Nothing there to read: the child removed or renamed it away.
      if (row === null) journal.recordGone?.({ designRoot, path: raw, source: 'studio-report' });
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

/**
 * #167 T5.3 — "Adopt as code": the owner's explicit way out of a class hold (final-4 recheck L2).
 *
 * A hold with no owner code sha never lifts while its file exists, and implicit adoption by an owner
 * write was rejected on purpose (decision v2-p8-holds-fix-no-implicit-owner-adoption): the owner's
 * door write at a held path still lands nowhere. This is the explicit door. Owner only — the same
 * bar as the held list and the project-config door (`isProjectOwnerMatch`: owner role, project-wide,
 * writable); every other token is 403 before the path is even looked at.
 *
 * Only a path that is held NOW is adopted: folders declared, the path code under them, a regular
 * file on this disk, and a hold, a ghost, or the overflow flag in force. It drops the hold (no ghost
 * — the file is there), clears a ghost, and journals the bytes on THIS disk as the owner's code
 * (`owner-adopt`): the caller names a path and the sha of the version it was shown (the held list's
 * `sha256`), never content. Bytes that differ are 409 and stay held; a caller with no sha (an older
 * client) is 428 "update Maude" — never adopted blind. Anything else is one 404, so the answer is
 * the same for "not held" and "not there".
 *
 * Not wake-durable by design: the release rides the tail as a plain `released` path, and a tail is
 * never trusted to lift a hold whose file exists — a wake from a generation taken before the adopt
 * holds the file again (fails closed; the owner adopts again).
 */
function adoptAsCode({ method, bearer, verify, designRoot, journal, body, respondJson }) {
  if (method !== 'POST') {
    respondJson(405, { error: 'method not allowed' });
    return;
  }
  const match = bearer ? verify(bearer) : null;
  if (!match) {
    respondJson(401, { error: 'a project token is required' });
    return;
  }
  if (!isProjectOwnerMatch(match)) {
    respondJson(403, { error: 'only the project owner can adopt a file as code' });
    return;
  }
  const rel = body?.path;
  const notHeld = () => respondJson(404, { error: 'that file is not held' });
  if (!journal || !designRoot || typeof rel !== 'string' || !isProjectFileShape(rel)) {
    notHeld();
    return;
  }
  const canvasGroups = readCanvasGroups(designRoot);
  if (canvasGroups === null) {
    notHeld();
    return;
  }
  const hasFile = (r) => existsSync(join(designRoot, r));
  if (classifyProjectFile(rel, { canvasGroups, hasFile }) !== 'code-module') {
    notHeld();
    return;
  }
  if (!isRegularFile(join(designRoot, rel))) {
    notHeld();
    return;
  }
  const held =
    journal.heldCodeSha(rel) !== undefined ||
    journal.isGhost(rel) ||
    journal.holdsOverflowed() === true;
  if (!held) {
    notHeld();
    return;
  }
  // The version the owner was shown (the held list's sha). Without it the door would adopt
  // whatever bytes sit here at click time — a teammate could swap them in between.
  const shown = body?.sha256;
  if (typeof shown !== 'string' || !SHA256_HEX.test(shown)) {
    respondJson(428, {
      error: 'update Maude to adopt a held file — this version cannot say which version it showed',
      reason: 'version-required',
    });
    return;
  }
  const changed = () =>
    respondJson(409, {
      error: 'the file changed since it was shown — look at it again before adopting',
      reason: 'changed',
    });
  const onDisk = journal.shaOf(designRoot, rel);
  if (onDisk === null) {
    respondJson(409, { error: 'the file could not be read' });
    return;
  }
  if (onDisk.sha256 !== shown) {
    changed();
    return;
  }
  journal.releaseHold(rel);
  journal.clearGhost(rel);
  const row = journal.recordWrite({
    designRoot,
    path: rel,
    source: 'owner-adopt',
    expectSha256: shown,
  });
  if (row === null) {
    // Bytes changed between the check and the read (or became unreadable): held again, no row.
    journal.reholdGhost(rel);
    changed();
    return;
  }
  respondJson(200, { adopted: true, seq: row.seq, sha256: row.sha256 });
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

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
  // N2 — a hold is noted with no journal row, so the append listener never
  // fires for it; the tail carries the hold set and must be woken by it.
  let unsubscribeHolds = null;

  const baseSeq = () => {
    const row = journal.db.prepare('SELECT v FROM journal_meta WHERE k = ?').get(TAIL_BASE_KEY);
    return row ? Number(row.v) || 0 : 0;
  };

  async function writeOnce() {
    const body = journal.tailLines(baseSeq());
    let lastErr = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        // Resolved per attempt: a cell's credentials expire mid-process.
        const t = typeof target === 'function' ? await target() : target;
        if (!t) throw new Error('no object storage target');
        await t.put(JOURNAL_TAIL_KEY, Buffer.from(body, 'utf8'));
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

  function schedule() {
    if (stopped || timer !== null) return;
    timer = setTimeoutImpl(() => {
      timer = null;
      void flush();
    }, debounceMs);
  }
  unsubscribeHolds = journal.onHoldsChange?.(schedule) ?? null;

  return {
    /** Called from the journal's append listener — coalesces a burst. */
    schedule,
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
      journal.pruneReleases?.(seq);
      await flush();
    },
    /** SIGTERM: land whatever is inside the debounce window. */
    async stop() {
      stopped = true;
      unsubscribeHolds?.();
      unsubscribeHolds = null;
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

/** Bucket HEADs in flight at once during the lost-file pass. A large project
 *  has thousands of candidate rows after a budgeted hydrate; unbounded, that
 *  is a self-inflicted rate limit on the account. */
const LOST_HEAD_CONCURRENCY = 8;

/** One HEAD may take this long. The write-behind starts only after this pass,
 *  and a bucket that hangs must not hold the mirror back for undici's 300 s
 *  default per request (Phase 0 defender W5) — a timeout is a bucket error,
 *  which skips the pass. */
const LOST_HEAD_TIMEOUT_MS = 15_000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Mark live rows whose bytes are GONE as `disk-lost`, so peers that still hold
 * them push them back (v1.5.2).
 *
 * THE BUCKET IS ASKED FIRST (cell materializer Phase 0). The v1.5.2 pass
 * marked every live row missing from the checkout — without asking the
 * bucket, and after a hydrate that may have died half-way. On the 2026-10-01
 * Alligators loop that told every desktop to re-push gigabytes the bucket
 * already held, into a disk that was already full. So a row is lost only when:
 *
 *   • the boot hydrate completed (no failures, nothing skipped for budget) —
 *     after a partial hydrate, "absent from disk" means nothing; and
 *   • it is absent from the checkout; and
 *   • its bytes were never mirrored (`mirroredAtMs` null), OR the bucket
 *     answers 404 for its key.
 *
 * Any bucket error skips the whole pass rather than guessing: a false "lost"
 * costs a full re-upload from every peer, a missed one costs a minute until
 * the next boot. `MAUDE_REPORT_LOST=0` turns the pass off entirely.
 *
 * @param {object} o
 * @param {{failed: number, skippedForBudget: number}|null} [o.hydrate] the boot
 *   hydrate's totals; null when no hydrate ran (a hub without storage).
 * @param {object|(() => Promise<object>)|null} [o.s3] config or resolver.
 * @param {(rel: string) => string} [o.keyFor] the write-behind's bucket key.
 * @returns {Promise<{ lost: number, skipped?: string }>}
 */
export async function reportLostFiles({
  journal,
  designRoot,
  hydrate = null,
  s3 = null,
  keyFor = null,
  deps = {},
  env = process.env,
  log = console,
  /** Cell mode: is this sha pinned in the blob cache (bytes held, unmirrored)? */
  isPinned = null,
}) {
  if (String(env.MAUDE_REPORT_LOST ?? '').trim() === '0') return { lost: 0, skipped: 'disabled' };
  if (!journal || !designRoot || !existsSync(designRoot)) return { lost: 0 };
  if (hydrate && (hydrate.failed > 0 || hydrate.skippedForBudget > 0)) {
    log.warn?.(
      `[journal] lost-file pass skipped: the boot hydrate was partial (${hydrate.failed} failed, ` +
        `${hydrate.skippedForBudget} left in the bucket) — absence from disk proves nothing.`
    );
    return { lost: 0, skipped: 'hydrate-incomplete' };
  }

  let lost = 0;
  try {
    const cell = journal.inertCached?.() === true;
    const absent = journal.compaction().filter((r) => {
      if (r.deleted || !r.sha256) return false;
      // On a cell, inert media is SUPPOSED to be absent from the checkout. It
      // is lost only when its bytes are nowhere: never mirrored, not pinned.
      if (cell && r.class === 'inert-media') {
        return r.mirroredAtMs == null && !(isPinned?.(r.sha256) ?? false);
      }
      return !existsSync(join(designRoot, r.path));
    });
    if (absent.length === 0) return { lost: 0 };

    const confirmed = absent.filter((r) => r.mirroredAtMs == null);
    const mirrored = absent.filter((r) => r.mirroredAtMs != null);
    if (mirrored.length > 0) {
      const head = deps.headObject ?? headObject;
      let cfg = null;
      try {
        cfg = typeof s3 === 'function' ? await s3() : s3;
      } catch (err) {
        log.warn?.(`[journal] lost-file pass skipped: no bucket credentials (${err.message}).`);
        return { lost: 0, skipped: 'bucket-unreachable' };
      }
      // Mirrored bytes the hub cannot ask about are NOT lost — they are
      // unverified, and an unverified "lost" is the expensive mistake.
      if (cfg && keyFor) {
        let failure = null;
        let next = 0;
        const worker = async () => {
          while (failure === null && next < mirrored.length) {
            const row = mirrored[next++];
            try {
              const res = await withTimeout(head(cfg, keyFor(row.path)), LOST_HEAD_TIMEOUT_MS);
              if (res === null) confirmed.push(row);
            } catch (err) {
              failure = err;
            }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(LOST_HEAD_CONCURRENCY, mirrored.length) }, worker)
        );
        if (failure) {
          log.warn?.(
            `[journal] lost-file pass skipped: the bucket did not answer (${failure.message}).`
          );
          return { lost: 0, skipped: 'bucket-unreachable' };
        }
      }
    }
    for (const row of confirmed) {
      if (journal.recordLost({ designRoot, path: row.path })) lost += 1;
    }
  } catch (err) {
    log.error?.(`[journal] lost-file pass failed: ${err.message}`);
  }
  if (lost > 0) {
    log.warn?.(
      `[journal] ${lost} file(s) are listed as live but missing from the checkout, and the ` +
        'bucket does not hold their bytes either (never mirrored, or 404) — marked lost so peers ' +
        'that still hold them push them back.'
    );
  }
  return { lost };
}

/**
 * Clear stale inert-media copies out of a cell's checkout (cell materializer
 * Task 13).
 *
 * On a cell the static route serves the checkout FIRST, and a restart restores
 * the checkout from the newest git-bundle generation — so a photo that was
 * replaced since (the new bytes live pinned or in the bucket) comes back at its
 * old path and would be served in place of the journal's row. A copy whose
 * hash is not the live row's, or whose row is a tombstone, is moved to
 * `_trash/stale-inert/<stamp>/` (quarantined, never unlinked). The studio's
 * resulting report cannot tombstone anything: `recordGone` ignores inert media
 * in cell mode. A copy with NO row is left alone — it is nobody's claim.
 *
 * @returns {{ moved: number, scanned: number }}
 */
export function quarantineStaleInert({ journal, designRoot, log = console }) {
  if (!journal || !designRoot || !existsSync(designRoot)) return { moved: 0, scanned: 0 };
  let files;
  try {
    files = listProjectFiles(designRoot).files.filter((f) => f.class === 'inert-media');
  } catch (err) {
    log.error?.(`[journal] stale-inert pass could not read ${designRoot}: ${err.message}`);
    return { moved: 0, scanned: 0 };
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let moved = 0;
  for (const f of files) {
    const row = journal.latestFor(f.path);
    if (!row) continue;
    if (!row.deleted && row.sha256 === f.sha256) continue;
    // The destination gets the write door's two-guard treatment: a committed
    // `_trash` symlink must not carry the checkout outside the design root
    // (Phase 1 security review L1, the same guard file-door's delete uses).
    const dest = resolveProjectFileTarget(designRoot, `_trash/stale-inert/${stamp}/${f.path}`);
    if (!dest.ok) {
      log.warn?.(
        `[journal] _trash does not resolve inside the design root — ${f.path} left in place.`
      );
      continue;
    }
    try {
      mkdirSync(dirname(dest.abs), { recursive: true });
      renameSync(join(designRoot, f.path), dest.abs);
      moved += 1;
    } catch (err) {
      log.warn?.(`[journal] could not move stale ${f.path} aside: ${err.message}`);
    }
  }
  if (moved > 0) {
    log.warn?.(
      `[journal] moved ${moved} stale media file(s) out of the checkout to _trash/stale-inert/${stamp} — ` +
        'the journal names newer bytes, which are served from the cache.'
    );
  }
  return { moved, scanned: files.length };
}

/** Depth ceiling for the grouped-side walk below `designRoot/<group>/` —
 *  matches the manifest walk's cap (file-manifest.mjs `MAX_WALK_DEPTH`). */
const FLAT_TWIN_WALK_DEPTH = 8;

/** File-count ceiling across BOTH sides of the walk — matches
 *  file-manifest.mjs `MAX_MANIFEST_FILES`'s order of magnitude. Without this
 *  a project with one ordinary flat canvas pays an unbounded second walk on
 *  every tick forever (security review, #140). */
const FLAT_TWIN_WALK_MAX_FILES = 20_000;

/** The declared canvas-group directories, same default as the classifier's
 *  own `normalizedGroups` (file-membership.mjs, not exported — this mirrors
 *  its five lines rather than reaching for a private helper). */
function canvasGroupDirs(designRoot) {
  const out = [];
  for (const g of readCanvasGroups(designRoot) ?? []) {
    const p = normalizeGroup(g?.path);
    if (p && !out.includes(p)) out.push(p);
  }
  return out.length > 0 ? out : ['system', 'ui'];
}

/**
 * Flat `.tsx` paths (no `/`) confirmed to be a pre-fix-5 flat-fallback twin of
 * a REAL grouped canvas — the shape the original report described exactly:
 * "the file concatenated with itself", 2× the grouped body's size. This is
 * deliberately a CONTENT check, not just a filename/slug match: a slug
 * collision alone is forgeable by anyone who can create a grouped canvas
 * (any project collaborator with ordinary CRDT-doc write access — security
 * review for #140), which would let that collaborator permanently blind
 * walk-import to an unrelated flat file by naming a stub after it. Requiring
 * the flat body to be the grouped body's bytes, twice, closes that: forging
 * it now takes matching exact content, not just a name — and if the flat
 * file's content later changes for real, it stops matching and walk-import
 * resumes journaling it (self-healing, not a permanent blind spot).
 *
 * Scoped to the TOP LEVEL (flat candidates) and the declared canvas-group
 * directories (grouped candidates) — the only places `classifyProjectFile`
 * ever calls `canvas-owned`, so this walk visits exactly the directories a
 * real grouped twin could live in, not the whole tree.
 *
 * `apps/studio/sync/migrate-flat-fallback.ts`'s quarantine is the studio-side
 * sibling (skipped under cell pairing — a cell's checkout is the hub's to
 * manage); this is its cell-safe, read-only counterpart. Never touches the
 * checkout — it only decides what `walkImport` journals.
 */
function flatCanvasTwinPaths(designRoot, journal = null) {
  const twins = new Set();
  for (const { flatRel, groupedRel } of flatCanvasTwinPairs(designRoot)) {
    if (
      isDoubledBody(designRoot, flatRel, groupedRel) ||
      (journal && isQuarantinableTwin(journal, designRoot, flatRel))
    ) {
      twins.add(flatRel);
    }
  }
  return twins;
}

/**
 * Every flat `.tsx` at the design root's top level paired with a grouped
 * `.tsx` (inside a canvas-group directory) that claims the SAME slug —
 * case-insensitively, since the slug lower-cases (`ui/2026/social/Krpole.tsx`
 * and `ui-2026-social-krpole.tsx` are one document). Names only; whether a
 * pair may be acted on is the caller's content/provenance question.
 *
 * @returns {{ slug: string, flatRel: string, groupedRel: string }[]}
 */
function flatCanvasTwinPairs(designRoot) {
  let topEntries;
  try {
    topEntries = readdirSync(designRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  let budget = FLAT_TWIN_WALK_MAX_FILES;
  const flatBySlug = new Map();
  for (const entry of topEntries) {
    if (budget <= 0) break;
    if (!entry.isFile() || !/\.tsx$/i.test(entry.name)) continue;
    budget -= 1;
    flatBySlug.set(canvasSlugFromRel(entry.name, ''), entry.name);
  }
  if (flatBySlug.size === 0) return [];

  const groupedBySlug = new Map();
  const walkGroup = (dir, rel, depth) => {
    if (budget <= 0 || depth > FLAT_TWIN_WALK_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (budget <= 0) return;
      const name = entry.name;
      if (entry.isDirectory()) {
        if (name.startsWith('_') || name.startsWith('.') || name === 'node_modules') continue;
        walkGroup(join(dir, name), `${rel}/${name}`, depth + 1);
        continue;
      }
      if (!entry.isFile() || !/\.tsx$/i.test(name)) continue;
      budget -= 1;
      const childRel = `${rel}/${name}`;
      groupedBySlug.set(canvasSlugFromRel(childRel, ''), childRel);
    }
  };
  for (const group of canvasGroupDirs(designRoot)) {
    walkGroup(join(designRoot, group), group, 1);
  }

  const pairs = [];
  for (const [slug, flatRel] of flatBySlug) {
    const groupedRel = groupedBySlug.get(slug);
    if (groupedRel) pairs.push({ slug, flatRel, groupedRel });
  }
  return pairs;
}

/** Sources whose rows are an OWNER's deliberate act at the write door: the
 *  door admits a would-be-code `.tsx` only from an owner token (see
 *  HOLD_NOTE_SOURCES). A flat file whose latest row came from here is the
 *  owner's own, whatever twin later appeared — the hub never parks it. */
const OWNER_DOOR_SOURCES = new Set(['peer-put', 'owner-delete']);

/**
 * May the hub park this flat twin on its own authority? (2.0.4)
 *
 * The slug match alone is forgeable — any collaborator who can write a canvas
 * can name one after an unrelated flat file (the #140 security finding) — so
 * two further facts are required, and both are unforgeable beyond what that
 * collaborator could already do through the doc lane:
 *
 *   1. CONTENT — the flat body is itself a canvas (`isCanvasSource`). A flat
 *      helper module is never one, so a forged twin cannot reach it. A flat
 *      canvas sharing the twin's slug is the SAME document (the slug is the
 *      doc name); its bytes were already the doc lane's to overwrite.
 *   2. PROVENANCE — its latest journal row did not come through the owner's
 *      write door. A tombstone, no row, or a row a non-owner lane wrote
 *      (`walk-import`, `studio-report`, …) qualifies; an owner's PUT never does.
 */
function isQuarantinableTwin(journal, designRoot, flatRel) {
  try {
    const abs = join(designRoot, flatRel);
    const st = lstatSync(abs);
    if (!st.isFile() || st.size > MAX_PROJECT_FILE_BYTES) return false;
    const row = journal.latestFor?.(flatRel) ?? null;
    if (row && !row.deleted && OWNER_DOOR_SOURCES.has(journal.latestSourceFor?.(flatRel))) {
      return false;
    }
    return isCanvasSource(readFileSync(abs, 'utf8'));
  } catch {
    return false;
  }
}

/** How long a parked flat twin stays parked before the quarantine may park
 *  that path again. A twin back inside this window is being REWRITTEN by
 *  something on the cell; parking it every tick would stack one copy per walk
 *  in `_trash/` forever, so it is reported instead. */
export const FLAT_TWIN_REPARK_MS = 6 * 60 * 60 * 1000;

/** `<designRoot>\0<rel>` → { at, sha, warned } — what this process parked, and
 *  whether it already said that the twin came back. In memory on purpose: a
 *  restart re-parks at most once, and a cold boot is the event worth a copy. */
const parkedFlatTwins = new Map();

/**
 * The cell's own flat-twin quarantine (2.0.4) — the hub-side twin of the
 * studio's `migrateFlatFallback`, which a cell skips (cell pairing).
 *
 * A cell that had lost its `config.json` wrote canvases FLAT at the design root
 * (`ui-welcome.tsx` beside the real `ui/welcome.tsx` — the workspace agent's
 * no-groups fallback), walk-import journaled them, and every desktop refused
 * them as code modules: "stuck" for good, and only an owner token could delete
 * them. The hub now parks each such twin itself:
 *
 *   - only a flat `.tsx` WITH a grouped twin of the same slug, whose content
 *     and provenance pass `isQuarantinableTwin` — a genuinely flat canvas with
 *     no twin, a flat module, or an owner's upload is never touched;
 *   - QUARANTINED, never unlinked: the body and its flat `.meta.json`/`.css`
 *     go to `_trash/flat-twins/<stamp>/` (the file door's place for deleted
 *     bytes). `<slug>.annotations.json` stays — it is keyed by the slug at the
 *     root and serves the surviving grouped twin;
 *   - each moved path that has a live row gets a TOMBSTONE, so peers receive
 *     the deletion and their stuck rows clear (`decide-file` tombstone-agreed,
 *     file-plane's "exists nowhere" forget);
 *   - idempotent, one log line per move, never throws;
 *   - BOUNDED: a path is parked at most once per `FLAT_TWIN_REPARK_MS`. A twin
 *     back inside that window (same bytes or new) is left in place and reported
 *     ONCE, loudly, with the lane that last wrote it — the writer is the bug,
 *     and a trash folder that grows by a copy a minute hides it.
 *
 * `onMoved(rels)` hears every design-root-relative path that left the
 * checkout, so the workspace agent can drop it from its path index and stage
 * the deletion in history.
 *
 * @returns {{ moved: { slug: string, from: string, keptTwin: string, trashedTo: string, tombstoned: string[] }[], held: string[] }}
 */
export function quarantineFlatCanvasTwins({
  journal,
  designRoot,
  log = console,
  onMoved,
  now = Date.now,
  reparkAfterMs = FLAT_TWIN_REPARK_MS,
} = {}) {
  const moved = [];
  const held = [];
  if (!journal || !designRoot || !existsSync(designRoot)) return { moved, held };
  try {
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
    for (const { slug, flatRel, groupedRel } of flatCanvasTwinPairs(designRoot)) {
      if (!isQuarantinableTwin(journal, designRoot, flatRel)) continue;
      const key = `${designRoot}\0${flatRel}`;
      let sha = null;
      try {
        sha = sha256File(join(designRoot, flatRel));
      } catch {
        /* unreadable — the move below decides */
      }
      const prior = parkedFlatTwins.get(key);
      if (prior && now() - prior.at < reparkAfterMs) {
        held.push(flatRel);
        if (!prior.warned) {
          prior.warned = true;
          const lane = journal.latestSourceFor?.(flatRel) ?? 'unknown';
          log.error?.(
            `[journal] flat canvas twin ${flatRel} keeps being rewritten (parked ` +
              `${Math.round((now() - prior.at) / 60_000)} min ago, back with ` +
              `${sha && sha === prior.sha ? 'the same bytes' : 'new bytes'}; last journaled by '${lane}') — ` +
              `left in place, not parked again until ${new Date(prior.at + reparkAfterMs).toISOString()}. ` +
              `Something on this cell still writes it beside ${groupedRel}.`
          );
        }
        continue;
      }
      const trashedTo = `_trash/flat-twins/${stamp}`;
      const base = flatRel.replace(/\.tsx$/i, '');
      const lanes = [flatRel, `${base}.meta.json`, `${base}.css`];
      const gone = [];
      for (const lane of lanes) {
        const src = join(designRoot, lane);
        if (lane !== flatRel && !isRegularFile(src)) continue;
        // The write door's two-guard treatment: a committed `_trash` symlink
        // must not carry the checkout outside the design root.
        const dest = resolveProjectFileTarget(designRoot, `${trashedTo}/${lane}`);
        if (!dest.ok) {
          log.warn?.(
            `[journal] _trash does not resolve inside the design root — ${lane} left in place.`
          );
          break;
        }
        try {
          mkdirSync(dirname(dest.abs), { recursive: true });
          renameSync(src, dest.abs);
          gone.push(lane);
        } catch (err) {
          log.warn?.(`[journal] could not park flat canvas twin ${lane}: ${err.message}`);
          if (lane === flatRel) break;
        }
      }
      if (!gone.includes(flatRel)) continue;
      parkedFlatTwins.set(key, { at: now(), sha, warned: false });
      const tombstoned = [];
      for (const lane of gone) {
        const row = journal.recordGone({ designRoot, path: lane, source: 'flat-twin-quarantine' });
        if (row && !row.noop) tombstoned.push(lane);
      }
      moved.push({ slug, from: flatRel, keptTwin: groupedRel, trashedTo, tombstoned });
      log.log?.(
        `[journal] flat canvas twin ${flatRel} duplicated ${groupedRel} (slug ${slug}) — ` +
          `moved ${gone.join(', ')} to ${trashedTo}/` +
          (tombstoned.length > 0 ? `, tombstoned ${tombstoned.length} row(s)` : ', never journaled')
      );
      try {
        onMoved?.(gone);
      } catch (err) {
        log.warn?.(`[journal] flat-twin hook failed: ${err.message}`);
      }
    }
  } catch (err) {
    log.error?.(`[journal] flat-twin quarantine pass failed: ${err.message}`);
  }
  return { moved, held };
}

/** Does `flatRel`'s content equal `groupedRel`'s content, exactly twice?
 *  Refuses rather than reads when either side is past the project-wide file
 *  ceiling — same guard `listProjectFiles` applies before this walk ever
 *  gets a candidate, re-asserted here since this walk is unfiltered by size. */
function isDoubledBody(designRoot, flatRel, groupedRel) {
  try {
    const flatAbs = join(designRoot, flatRel);
    const groupedAbs = join(designRoot, groupedRel);
    const groupedSize = statSync(groupedAbs).size;
    const flatSize = statSync(flatAbs).size;
    if (groupedSize === 0 || flatSize !== groupedSize * 2) return false;
    if (flatSize > MAX_PROJECT_FILE_BYTES) return false;
    const groupedBytes = readFileSync(groupedAbs);
    const flatBytes = readFileSync(flatAbs);
    return (
      flatBytes.length === groupedBytes.length * 2 &&
      flatBytes.subarray(0, groupedBytes.length).equals(groupedBytes) &&
      flatBytes.subarray(groupedBytes.length).equals(groupedBytes)
    );
  } catch {
    return false;
  }
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
 * @returns {{ appended: number, scanned: number, unchanged: number, skippedFlatTwin: number }}
 */
export function walkImport({ journal, designRoot, source = 'walk-import', log = console }) {
  if (!designRoot || !existsSync(designRoot)) {
    return { appended: 0, scanned: 0, unchanged: 0, skippedFlatTwin: 0 };
  }
  let files;
  try {
    // Reuse the manifest walk verbatim — one walk implementation, one set of
    // depth/size/symlink rules, one classifier call site.
    files = listProjectFiles(designRoot).files;
  } catch (err) {
    log.error?.(`[journal] walk-import could not read ${designRoot}: ${err.message}`);
    return { appended: 0, scanned: 0, unchanged: 0, skippedFlatTwin: 0 };
  }

  const known = new Map(journal.compaction().map((r) => [r.path, r]));
  // On a cell the checkout's media is a CACHE (or a stale git-bundle restore):
  // journaling what happens to be on disk could put an older photo back over
  // a newer row. The doors and the studio report journal real writes.
  const skipInert = journal.inertCached?.() === true;
  // #140 — see flatCanvasTwinPaths. Only worth the extra walk when there is
  // at least one flat-shaped `.tsx` candidate in the manifest result.
  const hasFlatTsxCandidate = files.some(
    (f) => f.class === 'code-module' && !f.path.includes('/') && /\.tsx$/i.test(f.path)
  );
  const flatTwinPaths = hasFlatTsxCandidate ? flatCanvasTwinPaths(designRoot, journal) : null;
  let appended = 0;
  let unchanged = 0;
  let skippedFlatTwin = 0;
  for (const f of files) {
    if (skipInert && f.class === 'inert-media') continue;
    if (flatTwinPaths?.has(f.path)) {
      skippedFlatTwin += 1;
      continue;
    }
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
  if (skippedFlatTwin > 0) {
    log.warn?.(
      `[journal] walk-import skipped ${skippedFlatTwin} flat .tsx twin(s) of a grouped canvas (fallback debris) — never journaled; quarantineFlatCanvasTwins parks the ones it may.`
    );
  }
  // N1 — a hold whose file is gone no longer blocks the path.
  journal.pruneGoneHolds?.(designRoot);
  return { appended, scanned: files.length, unchanged, skippedFlatTwin };
}

/** A regular file at `abs` (never a link, a FIFO or a directory). */
function isRegularFile(abs) {
  try {
    return lstatSync(abs).isFile();
  } catch {
    return false;
  }
}
