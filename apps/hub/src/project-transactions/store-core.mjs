// The accepted-revision store — DDR-241 §2.
//
// ONE schema and ONE commit procedure for both durable homes: better-sqlite3 in
// a self-hosted hub's data volume, and the cell Durable Object's SQLite in the
// cloud. That is only possible because this module is runtime-neutral ESM over
// a two-method synchronous SQL interface:
//
//   sql.exec(query, ...params) → Array<row>   (rows are plain objects)
//   sql.transaction(fn)        → fn's result, all-or-nothing
//
// Everything a commit writes — head, ordered action, effects, payloads, the
// idempotency result and the new revision — is written inside ONE transaction,
// so a crash leaves either the previous revision or the next one, never a head
// without its log or a result without its revision. The caller acknowledges
// only after `commit` returns (RPO 0 for acknowledged actions).
//
// No Node, Bun or Worker globals. No I/O but `sql`.

export const STORE_SCHEMA_VERSION = 1;

/** Lanes a canvas document carries (DDR-241 §4). */
export const LANES = Object.freeze(['html', 'css', 'meta', 'annotations', 'comments']);

/**
 * The project file format (V2-1.12 §5.2) — one integer, absent = 1. The hub's
 * store is the authority for a linked project; desktops mirror it raise-only.
 */
export const DEFAULT_FORMAT = 1;

/** A stored or requested format → a positive integer, else the default. */
export function asFormat(v) {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 1 ? n : DEFAULT_FORMAT;
}

export class StoreConflict extends Error {
  /** @param {'epoch-stale'|'revision-moved'|'head-moved'} code */
  constructor(code, detail = '') {
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'StoreConflict';
    this.code = code;
  }
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS store_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  // Content-addressed lane payloads. `body` is the exact lane text.
  `CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, body TEXT NOT NULL, size INTEGER NOT NULL)`,
  // A body larger than one row may hold is kept here in parts, its `blobs` row
  // carrying an empty body: a Durable Object's SQLite refuses any value or row
  // over 2 MB, and a lane may be 4 MB (security review A1 — the refused commit
  // was an import that could never finish).
  `CREATE TABLE IF NOT EXISTS blob_parts (hash TEXT NOT NULL, n INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (hash, n))`,
  // Manifest entries. `entry` is the stable identity a rename/move keeps; `doc`
  // is the transport document name (path-derived) and may change with a move.
  `CREATE TABLE IF NOT EXISTS docs (
     doc TEXT PRIMARY KEY, entry TEXT NOT NULL, generation INTEGER NOT NULL,
     path TEXT, retired INTEGER NOT NULL DEFAULT 0, moved_to TEXT,
     created_rev INTEGER NOT NULL, updated_rev INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS docs_entry ON docs(entry)`,
  `CREATE TABLE IF NOT EXISTS heads (
     doc TEXT NOT NULL, lane TEXT NOT NULL, hash TEXT NOT NULL, effect TEXT NOT NULL,
     rev INTEGER NOT NULL, PRIMARY KEY (doc, lane))`,
  // First-class directories, including empty ones.
  `CREATE TABLE IF NOT EXISTS dirs (path TEXT PRIMARY KEY, rev INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS actions (
     rev INTEGER PRIMARY KEY, tx TEXT NOT NULL, actor TEXT NOT NULL, action_id TEXT NOT NULL,
     kind TEXT NOT NULL, label TEXT, origin TEXT, committed_at INTEGER NOT NULL,
     undoes TEXT)`,
  `CREATE INDEX IF NOT EXISTS actions_action ON actions(action_id)`,
  `CREATE TABLE IF NOT EXISTS effects (
     effect TEXT PRIMARY KEY, rev INTEGER NOT NULL, action_id TEXT NOT NULL, doc TEXT,
     entry TEXT, lane TEXT NOT NULL, op TEXT NOT NULL, before_hash TEXT, after_hash TEXT,
     before_path TEXT, after_path TEXT)`,
  `CREATE INDEX IF NOT EXISTS effects_rev ON effects(rev)`,
  `CREATE INDEX IF NOT EXISTS effects_action ON effects(action_id)`,
  // Idempotency: scoped by actor + transaction id. `result` is the exact JSON
  // returned the first time; `terminal` rejections are retained too.
  `CREATE TABLE IF NOT EXISTS results (
     actor TEXT NOT NULL, tx TEXT NOT NULL, proposal_hash TEXT NOT NULL, result TEXT NOT NULL,
     rev INTEGER, at INTEGER NOT NULL, PRIMARY KEY (actor, tx))`,
];

function one(rows) {
  return rows.length ? rows[0] : null;
}

/**
 * UTF-16 units per part. SQLite stores text as UTF-8, at most 3 bytes a unit
 * (a surrogate pair is 4 bytes for 2 units), so a part stays under 1.5 MB.
 */
export const BLOB_PART_UNITS = 512 * 1024;

/** Split a body at part boundaries that never cut a surrogate pair. */
export function blobParts(body, units = BLOB_PART_UNITS) {
  const parts = [];
  for (let i = 0; i < body.length; ) {
    let end = Math.min(i + units, body.length);
    const last = body.charCodeAt(end - 1);
    if (end < body.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    parts.push(body.slice(i, end));
    i = end;
  }
  return parts;
}

export function createStoreCore(sql, { now = () => Date.now() } = {}) {
  function meta(k, fallback = null) {
    const row = one(sql.exec(`SELECT v FROM store_meta WHERE k = ?`, k));
    return row ? row.v : fallback;
  }
  function setMeta(k, v) {
    sql.exec(
      `INSERT INTO store_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      k,
      String(v)
    );
  }

  function migrate() {
    sql.transaction(() => {
      for (const ddl of DDL) sql.exec(ddl);
      if (meta('schema') === null) {
        setMeta('schema', STORE_SCHEMA_VERSION);
        setMeta('mode', 'legacy');
        setMeta('epoch', 0);
        setMeta('revision', 0);
      }
    });
  }

  function state() {
    return {
      schema: Number(meta('schema', STORE_SCHEMA_VERSION)),
      mode: meta('mode', 'legacy'),
      epoch: Number(meta('epoch', 0)),
      revision: Number(meta('revision', 0)),
      // T30 — entering accepted revisions persists the mode BEFORE the
      // documents are imported; this says the import has not finished yet, so
      // a process that died in between resumes it instead of serving a project
      // whose store lacks documents peers still hold.
      importPending: meta('importPending', '0') === '1',
      // V2-1.12 §5.5 — the project's file format (absent = 1).
      formatVersion: asFormat(meta('formatVersion', DEFAULT_FORMAT)),
    };
  }

  function formatRecord(cur) {
    return {
      ...cur,
      changedAt: meta('formatChangedAt', null),
      changedBy: meta('formatChangedBy', null),
    };
  }

  /**
   * Switch the project's file format (V2-1.12 §5.5, the owner's flip). A real
   * change advances the write epoch exactly like `setMode` (every writer holding
   * the previous epoch is fenced); the same value is a no-op with no epoch bump.
   * Returns the state plus `changed`, `changedAt` and `changedBy`.
   */
  function setFormat({ formatVersion, expectEpoch, by = null } = {}) {
    if (!Number.isSafeInteger(formatVersion) || formatVersion < 1) {
      throw new Error(`invalid formatVersion: ${formatVersion}`);
    }
    return sql.transaction(() => {
      const cur = state();
      if (expectEpoch !== undefined && expectEpoch !== null && cur.epoch !== expectEpoch) {
        throw new StoreConflict('epoch-stale', `expected ${expectEpoch}, at ${cur.epoch}`);
      }
      if (cur.formatVersion === formatVersion) return { ...formatRecord(cur), changed: false };
      return writeFormat(cur, formatVersion, by);
    });
  }

  /** Inside a transaction: write a CHANGED format, advancing the epoch. */
  function writeFormat(cur, formatVersion, by) {
    const epoch = cur.epoch + 1;
    setMeta('formatVersion', formatVersion);
    setMeta('epoch', epoch);
    setMeta('formatChangedAt', new Date(now()).toISOString());
    setMeta('formatChangedBy', String(by ?? 'unknown').slice(0, 200));
    return { ...formatRecord({ ...cur, formatVersion, epoch }), changed: true };
  }

  /**
   * RAISE-ONLY seed (V2-1.12 §5.2): a cell learns the format its checkout's
   * `config.json` declares. A value at or below the stored one changes
   * nothing — a checkout can raise the project, never lower it.
   */
  function raiseFormat(n, { by = 'checkout' } = {}) {
    const next = asFormat(n);
    return sql.transaction(() => {
      const cur = state();
      if (next <= cur.formatVersion) return { ...formatRecord(cur), changed: false };
      return writeFormat(cur, next, by);
    });
  }

  /**
   * Advance the persistent write epoch (and optionally the mode). Every writer
   * holding the previous epoch is fenced from this commit on (DDR-241 §7).
   */
  function setMode({ mode, expectEpoch }) {
    return sql.transaction(() => {
      const cur = state();
      if (expectEpoch !== undefined && cur.epoch !== expectEpoch) {
        throw new StoreConflict('epoch-stale', `expected ${expectEpoch}, at ${cur.epoch}`);
      }
      const epoch = cur.epoch + 1;
      setMeta('mode', mode);
      setMeta('epoch', epoch);
      setMeta('importPending', mode === 'transactions' ? '1' : '0');
      return { ...cur, mode, epoch, importPending: mode === 'transactions' };
    });
  }

  /** T30 — the baseline import that followed a switch has completed. */
  function markImported() {
    setMeta('importPending', '0');
    return state();
  }

  function docRow(doc) {
    return one(sql.exec(`SELECT * FROM docs WHERE doc = ?`, doc));
  }

  /** Current manifest entry + lane heads for each named document. */
  function heads(docs) {
    const out = {};
    for (const doc of docs) {
      const row = docRow(doc);
      if (!row) {
        out[doc] = null;
        continue;
      }
      const lanes = {};
      for (const h of sql.exec(`SELECT lane, hash, effect, rev FROM heads WHERE doc = ?`, doc)) {
        lanes[h.lane] = { hash: h.hash, effect: h.effect, rev: Number(h.rev) };
      }
      out[doc] = {
        doc,
        entry: row.entry,
        generation: Number(row.generation),
        path: row.path,
        retired: !!row.retired,
        movedTo: row.moved_to,
        lanes,
      };
    }
    return out;
  }

  function blob(hash) {
    const row = one(sql.exec(`SELECT body, size FROM blobs WHERE hash = ?`, hash));
    if (!row) return null;
    if (row.body !== '' || !row.size) return row.body;
    return sql
      .exec(`SELECT body FROM blob_parts WHERE hash = ? ORDER BY n`, hash)
      .map((r) => r.body)
      .join('');
  }

  function result(actor, tx) {
    const row = one(
      sql.exec(
        `SELECT proposal_hash, result, rev FROM results WHERE actor = ? AND tx = ?`,
        actor,
        tx
      )
    );
    return row
      ? { proposalHash: row.proposal_hash, result: JSON.parse(row.result), rev: row.rev }
      : null;
  }

  /** Retain a terminal rejection so an identical retry returns the same answer. */
  function recordResult({ actor, tx, proposalHash, result: res }) {
    sql.transaction(() => {
      const prior = one(
        sql.exec(`SELECT 1 AS x FROM results WHERE actor = ? AND tx = ?`, actor, tx)
      );
      if (prior) return;
      sql.exec(
        `INSERT INTO results (actor, tx, proposal_hash, result, rev, at) VALUES (?, ?, ?, ?, NULL, ?)`,
        actor,
        tx,
        proposalHash,
        JSON.stringify(res),
        now()
      );
    });
  }

  /**
   * Commit one accepted action. All-or-nothing. Throws StoreConflict when the
   * caller's view is stale (epoch, parent revision or an expected head hash).
   */
  function commit(input) {
    return sql.transaction(() => {
      const cur = state();
      if (cur.epoch !== input.epoch) {
        throw new StoreConflict(
          'epoch-stale',
          `commit carried ${input.epoch}, store at ${cur.epoch}`
        );
      }
      if (cur.revision !== input.parentRevision) {
        throw new StoreConflict(
          'revision-moved',
          `parent ${input.parentRevision}, head ${cur.revision}`
        );
      }
      const prior = one(
        sql.exec(`SELECT 1 AS x FROM results WHERE actor = ? AND tx = ?`, input.actor, input.tx)
      );
      if (prior) throw new StoreConflict('head-moved', 'transaction already has a result');
      for (const h of input.heads ?? []) {
        if (h.expectHash === undefined) continue;
        const row = one(
          sql.exec(`SELECT hash FROM heads WHERE doc = ? AND lane = ?`, h.doc, h.lane)
        );
        if ((row?.hash ?? null) !== h.expectHash) {
          throw new StoreConflict('head-moved', `${h.doc}/${h.lane}`);
        }
      }
      const rev = cur.revision + 1;
      const at = input.committedAt ?? now();
      for (const b of input.blobs ?? []) {
        if (one(sql.exec(`SELECT 1 AS x FROM blobs WHERE hash = ?`, b.hash))) continue;
        const size = b.size ?? b.body.length;
        if (b.body.length <= BLOB_PART_UNITS) {
          sql.exec(`INSERT INTO blobs (hash, body, size) VALUES (?, ?, ?)`, b.hash, b.body, size);
          continue;
        }
        // Parted: an empty body with a non-zero size (a real empty body has size 0).
        sql.exec(`INSERT INTO blobs (hash, body, size) VALUES (?, '', ?)`, b.hash, size || 1);
        blobParts(b.body).forEach((part, n) =>
          sql.exec(`INSERT INTO blob_parts (hash, n, body) VALUES (?, ?, ?)`, b.hash, n, part)
        );
      }
      for (const d of input.docs ?? []) {
        const existing = docRow(d.doc);
        if (existing) {
          sql.exec(
            `UPDATE docs SET entry = ?, generation = ?, path = ?, retired = ?, moved_to = ?, updated_rev = ? WHERE doc = ?`,
            d.entry,
            d.generation,
            d.path ?? null,
            d.retired ? 1 : 0,
            d.movedTo ?? null,
            rev,
            d.doc
          );
        } else {
          sql.exec(
            `INSERT INTO docs (doc, entry, generation, path, retired, moved_to, created_rev, updated_rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            d.doc,
            d.entry,
            d.generation,
            d.path ?? null,
            d.retired ? 1 : 0,
            d.movedTo ?? null,
            rev,
            rev
          );
        }
      }
      for (const h of input.heads ?? []) {
        if (h.hash === null) {
          sql.exec(`DELETE FROM heads WHERE doc = ? AND lane = ?`, h.doc, h.lane);
          continue;
        }
        sql.exec(
          `INSERT INTO heads (doc, lane, hash, effect, rev) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(doc, lane) DO UPDATE SET hash = excluded.hash, effect = excluded.effect, rev = excluded.rev`,
          h.doc,
          h.lane,
          h.hash,
          h.effect,
          rev
        );
      }
      for (const p of input.dirs?.remove ?? []) sql.exec(`DELETE FROM dirs WHERE path = ?`, p);
      for (const p of input.dirs?.add ?? []) {
        sql.exec(`INSERT INTO dirs (path, rev) VALUES (?, ?) ON CONFLICT(path) DO NOTHING`, p, rev);
      }
      sql.exec(
        `INSERT INTO actions (rev, tx, actor, action_id, kind, label, origin, committed_at, undoes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rev,
        input.tx,
        input.actor,
        input.actionId,
        input.kind,
        input.label ?? null,
        input.origin ? JSON.stringify(input.origin) : null,
        at,
        input.undoes ?? null
      );
      for (const e of input.effects ?? []) {
        sql.exec(
          `INSERT INTO effects (effect, rev, action_id, doc, entry, lane, op, before_hash, after_hash, before_path, after_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          e.effect,
          rev,
          input.actionId,
          e.doc ?? null,
          e.entry ?? null,
          e.lane,
          e.op,
          e.beforeHash ?? null,
          e.afterHash ?? null,
          e.beforePath ?? null,
          e.afterPath ?? null
        );
      }
      const res = { ...input.result, revision: rev, parentRevision: cur.revision, committedAt: at };
      sql.exec(
        `INSERT INTO results (actor, tx, proposal_hash, result, rev, at) VALUES (?, ?, ?, ?, ?, ?)`,
        input.actor,
        input.tx,
        input.proposalHash,
        JSON.stringify(res),
        rev,
        at
      );
      setMeta('revision', rev);
      return { revision: rev, result: res };
    });
  }

  function effectRows(where, ...params) {
    return sql
      .exec(
        `SELECT effect, rev, action_id, doc, entry, lane, op, before_hash, after_hash, before_path, after_path FROM effects ${where} ORDER BY rev, effect`,
        ...params
      )
      .map((e) => ({
        effect: e.effect,
        rev: Number(e.rev),
        actionId: e.action_id,
        doc: e.doc,
        entry: e.entry,
        lane: e.lane,
        op: e.op,
        beforeHash: e.before_hash,
        afterHash: e.after_hash,
        beforePath: e.before_path,
        afterPath: e.after_path,
      }));
  }

  function actionRow(a) {
    return {
      revision: Number(a.rev),
      tx: a.tx,
      actor: a.actor,
      actionId: a.action_id,
      kind: a.kind,
      label: a.label,
      origin: a.origin ? JSON.parse(a.origin) : null,
      committedAt: Number(a.committed_at),
      undoes: a.undoes,
    };
  }

  /** Ordered revisions after `after`, each with its effects — the replay feed. */
  function revisions({ after = 0, limit = 200 } = {}) {
    const rows = sql.exec(
      `SELECT * FROM actions WHERE rev > ? ORDER BY rev LIMIT ?`,
      after,
      Math.max(1, Math.min(limit, 1000))
    );
    return rows.map((a) => ({ ...actionRow(a), effects: effectRows('WHERE rev = ?', a.rev) }));
  }

  /** Logical history, newest first. */
  function history({ before = null, limit = 50, entry = null } = {}) {
    const lim = Math.max(1, Math.min(limit, 200));
    const rows = entry
      ? sql.exec(
          `SELECT DISTINCT a.* FROM actions a JOIN effects e ON e.rev = a.rev
           WHERE e.entry = ? ${before ? 'AND a.rev < ?' : ''} ORDER BY a.rev DESC LIMIT ?`,
          ...(before ? [entry, before, lim] : [entry, lim])
        )
      : sql.exec(
          `SELECT * FROM actions ${before ? 'WHERE rev < ?' : ''} ORDER BY rev DESC LIMIT ?`,
          ...(before ? [before, lim] : [lim])
        );
    return rows.map((a) => ({ ...actionRow(a), effects: effectRows('WHERE rev = ?', a.rev) }));
  }

  function action(actionId) {
    const a = one(
      sql.exec(`SELECT * FROM actions WHERE action_id = ? ORDER BY rev LIMIT 1`, actionId)
    );
    return a ? { ...actionRow(a), effects: effectRows('WHERE action_id = ?', actionId) } : null;
  }

  /** The live (non-retired) document at a manifest path, if any. */
  function docByPath(path) {
    const row = one(sql.exec(`SELECT doc FROM docs WHERE path = ? AND retired = 0`, path));
    return row ? row.doc : null;
  }

  /** A lane's content hash as of `rev` (restore), or null when it had none. */
  function laneAt(doc, lane, rev) {
    const row = one(
      sql.exec(
        `SELECT after_hash FROM effects WHERE doc = ? AND lane = ? AND rev <= ? ORDER BY rev DESC LIMIT 1`,
        doc,
        lane,
        rev
      )
    );
    return row ? row.after_hash : null;
  }

  /** Lane effects on an entry after `rev`, in order — undo rebases through them. */
  function effectsAfter(entry, lane, rev) {
    return effectRows('WHERE entry = ? AND lane = ? AND rev > ?', entry, lane, rev);
  }

  /** The live document currently carrying an entry (it may have moved). */
  function liveDocByEntry(entry) {
    const row = one(sql.exec(`SELECT doc FROM docs WHERE entry = ? AND retired = 0`, entry));
    return row ? row.doc : null;
  }

  function manifest() {
    const docs = sql.exec(`SELECT * FROM docs ORDER BY doc`).map((row) => {
      const lanes = {};
      for (const h of sql.exec(`SELECT lane, hash, effect FROM heads WHERE doc = ?`, row.doc)) {
        lanes[h.lane] = { hash: h.hash, effect: h.effect };
      }
      return {
        doc: row.doc,
        entry: row.entry,
        generation: Number(row.generation),
        path: row.path,
        retired: !!row.retired,
        movedTo: row.moved_to,
        lanes,
      };
    });
    const dirs = sql.exec(`SELECT path FROM dirs ORDER BY path`).map((r) => r.path);
    return { ...state(), docs, dirs };
  }

  return {
    migrate,
    state,
    setMode,
    setFormat,
    raiseFormat,
    markImported,
    heads,
    blob,
    result,
    recordResult,
    commit,
    revisions,
    history,
    action,
    manifest,
    docByPath,
    laneAt,
    effectsAfter,
    liveDocByEntry,
  };
}
