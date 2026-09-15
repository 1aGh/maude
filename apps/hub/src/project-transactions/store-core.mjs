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
    };
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
      return { ...cur, mode, epoch };
    });
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
    const row = one(sql.exec(`SELECT body FROM blobs WHERE hash = ?`, hash));
    return row ? row.body : null;
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
        sql.exec(
          `INSERT INTO blobs (hash, body, size) VALUES (?, ?, ?) ON CONFLICT(hash) DO NOTHING`,
          b.hash,
          b.body,
          b.size ?? b.body.length
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
