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

import { createVotesCore, VOTES_DDL } from '../votes.mjs';
import { createRunsCore, RUNS_DDL } from './runs-core.mjs';

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
  /**
   * @param {'epoch-stale'|'revision-moved'|'head-moved'|'lease-fenced'} code
   * @param {string} [detail]
   * @param {{ keys?: Array<{entry: string, artboard: string, token: number, fence: number}> }} [extra]
   *   `lease-fenced` names the keys a newer grant took (V2-1.15 §5.3).
   */
  constructor(code, detail = '', extra = undefined) {
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'StoreConflict';
    this.code = code;
    if (Array.isArray(extra?.keys)) this.keys = extra.keys;
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
  // V2-1.15 §5.2 — AI runs, leases, the waiting line (additive: CREATE IF NOT
  // EXISTS, no schema bump; an old hub opening this store ignores them).
  ...RUNS_DDL,
  // S1.6 (V2-1.9 §5.4, S1-trash.md §4) — additive indexes of facts the log
  // already carries (`origin.named` / `origin.cleared`). An old hub opening
  // this store ignores both; nothing here deletes a row or a body.
  `CREATE TABLE IF NOT EXISTS names (
     entry TEXT NOT NULL, target_rev INTEGER NOT NULL, name TEXT NOT NULL, actor TEXT NOT NULL,
     at INTEGER NOT NULL, rev INTEGER NOT NULL, PRIMARY KEY (entry, target_rev))`,
  // `artboard` '' = the whole canvas; `rev` = the action that put it in the trash.
  `CREATE TABLE IF NOT EXISTS trash_cleared (
     entry TEXT NOT NULL, artboard TEXT NOT NULL, rev INTEGER NOT NULL, by TEXT NOT NULL,
     at INTEGER NOT NULL, cleared_rev INTEGER NOT NULL, PRIMARY KEY (entry, artboard, rev))`,
  `CREATE INDEX IF NOT EXISTS actions_kind ON actions(kind)`,
  // Gate 0 A18 (S4.6) — formal votes and hub-held ballots (additive, as runs).
  ...VOTES_DDL,
];

function one(rows) {
  return rows.length ? rows[0] : null;
}

/** A stored `undoes`: a plain id (v1, single target), a JSON id list (multi-target), or null. */
function parseUndoes(v) {
  if (typeof v !== 'string' || !v.startsWith('[')) return v ?? null;
  try {
    const ids = JSON.parse(v);
    return Array.isArray(ids) ? ids : v;
  } catch {
    return v;
  }
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

/**
 * The default blob codec: the stored body IS the lane text. A codec (V2-1.9
 * §5.3 C4 — the local home passes gzip) maps the raw text to what the row
 * holds and back; `hash` and `size` always describe the raw text, so
 * deduplication and the part split never see the codec. `decode` must accept a
 * value written before the codec existed (a plain TEXT row).
 */
export const IDENTITY_CODEC = Object.freeze({ encode: (text) => text, decode: (stored) => stored });

/** Meta flag: the additive `run_id` / `chat_id` action columns exist (S5.1a). */
const RUN_CHAT_COLUMNS = 'actionsRunChat';

export function createStoreCore(sql, { now = () => Date.now(), codec = IDENTITY_CODEC } = {}) {
  const encode = (text) => codec.encode(text);
  const decode = (stored) => codec.decode(stored);
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

  const runs = createRunsCore(sql, { now, meta, setMeta });
  const votes = createVotesCore(sql, { now });

  function migrate() {
    sql.transaction(() => {
      for (const ddl of DDL) sql.exec(ddl);
      if (meta('schema') === null) {
        setMeta('schema', STORE_SCHEMA_VERSION);
        setMeta('mode', 'legacy');
        setMeta('epoch', 0);
        setMeta('revision', 0);
      }
      // S5.1a (V2-1.5 §5.2) — additive, nullable: "this person's actions of
      // chat X" without scanning `origin`. Gated by a meta flag rather than a
      // schema probe, which a Durable Object's SQLite may not allow; an old hub
      // opening the migrated store ignores both (every INSERT names columns).
      if (meta(RUN_CHAT_COLUMNS) !== '1') {
        sql.exec(`ALTER TABLE actions ADD COLUMN run_id TEXT`);
        sql.exec(`ALTER TABLE actions ADD COLUMN chat_id TEXT`);
        setMeta(RUN_CHAT_COLUMNS, '1');
      }
      sql.exec(`CREATE INDEX IF NOT EXISTS actions_chat ON actions(chat_id, actor)`);
      sql.exec(`CREATE INDEX IF NOT EXISTS actions_run ON actions(run_id)`);
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
   * RAISE-ONLY, ONE-TIME seed (V2-1.12 §5.2): a cell learns the format its
   * checkout's `config.json` declares — but only while nobody has ever SET the
   * format. Once the owner flipped (or a seed landed), the store is the
   * authority and a checkout can never undo or redo that decision.
   */
  function raiseFormat(n, { by = 'checkout' } = {}) {
    const next = asFormat(n);
    return sql.transaction(() => {
      const cur = state();
      if (next <= cur.formatVersion || meta('formatChangedAt', null) !== null) {
        return { ...formatRecord(cur), changed: false };
      }
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
    // A parted body's row holds '' with a non-zero size; a real empty body has size 0.
    if (row.body !== '' || !row.size) return decode(row.body);
    return sql
      .exec(`SELECT body FROM blob_parts WHERE hash = ? ORDER BY n`, hash)
      .map((r) => decode(r.body))
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
      // V2-1.15 §5.3 (L4) — an AI run's publish carries its lease tokens; a
      // newer grant on any of its artboards refuses it in THIS transaction.
      const fenced = runs.fenceMismatches(input.fence, now());
      if (fenced.length) {
        throw new StoreConflict('lease-fenced', `${fenced.length} artboard(s)`, { keys: fenced });
      }
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
          // The empty body stays '' under every codec: '' + size 0 is how a
          // reader tells "empty" from "parted".
          const stored = b.body === '' ? '' : encode(b.body);
          sql.exec(`INSERT INTO blobs (hash, body, size) VALUES (?, ?, ?)`, b.hash, stored, size);
          continue;
        }
        // Parted: an empty body with a non-zero size (a real empty body has size 0).
        sql.exec(`INSERT INTO blobs (hash, body, size) VALUES (?, '', ?)`, b.hash, size || 1);
        blobParts(b.body).forEach((part, n) =>
          sql.exec(
            `INSERT INTO blob_parts (hash, n, body) VALUES (?, ?, ?)`,
            b.hash,
            n,
            encode(part)
          )
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
        `INSERT INTO actions (rev, tx, actor, action_id, kind, label, origin, committed_at, undoes, run_id, chat_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rev,
        input.tx,
        input.actor,
        input.actionId,
        input.kind,
        input.label ?? null,
        input.origin ? JSON.stringify(input.origin) : null,
        at,
        // A single-target undo keeps the plain id (v1); a multi-target one
        // (V2-1.5 §5.2) stores its id list as JSON. Readers accept both.
        Array.isArray(input.undoes) ? JSON.stringify(input.undoes) : (input.undoes ?? null),
        typeof input.origin?.runId === 'string' ? input.origin.runId : null,
        typeof input.origin?.chatId === 'string' ? input.origin.chatId : null
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
      // S1.6 — `history.name` (null removes the row; the action stays logged)
      // and `trash.clear`, in the same transaction as their action.
      for (const n of input.names ?? []) {
        if (n.name === null) {
          sql.exec(`DELETE FROM names WHERE entry = ? AND target_rev = ?`, n.entry, n.targetRev);
          continue;
        }
        sql.exec(
          `INSERT INTO names (entry, target_rev, name, actor, at, rev) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(entry, target_rev) DO UPDATE SET name = excluded.name, actor = excluded.actor, at = excluded.at, rev = excluded.rev`,
          n.entry,
          n.targetRev,
          n.name,
          input.actor,
          at,
          rev
        );
      }
      for (const c of input.cleared ?? []) {
        sql.exec(
          `INSERT INTO trash_cleared (entry, artboard, rev, by, at, cleared_rev) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(entry, artboard, rev) DO NOTHING`,
          c.entry,
          c.artboard ?? '',
          c.rev,
          input.actor,
          at,
          rev
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
      undoes: parseUndoes(a.undoes),
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

  /**
   * Logical history, newest first. `chat` / `run` / `actor` / `kind` are
   * additive filters (S5.1a): "this person's actions of chat X" reads the
   * indexed `chat_id` column, never `origin`.
   */
  function history({
    before = null,
    limit = 50,
    entry = null,
    chat = null,
    run = null,
    actor = null,
    kind = null,
  } = {}) {
    const lim = Math.max(1, Math.min(limit, 200));
    const where = [];
    const params = [];
    const add = (clause, v) => {
      where.push(clause);
      params.push(v);
    };
    if (entry) add('e.entry = ?', entry);
    if (before) add('a.rev < ?', before);
    if (typeof chat === 'string' && chat) add('a.chat_id = ?', chat);
    if (typeof run === 'string' && run) add('a.run_id = ?', run);
    if (typeof actor === 'string' && actor) add('a.actor = ?', actor);
    if (typeof kind === 'string' && kind) add('a.kind = ?', kind);
    const rows = sql.exec(
      `SELECT DISTINCT a.* FROM actions a ${entry ? 'JOIN effects e ON e.rev = a.rev' : ''}
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.rev DESC LIMIT ?`,
      ...params,
      lim
    );
    return rows.map((a) => ({ ...actionRow(a), effects: effectRows('WHERE rev = ?', a.rev) }));
  }

  function action(actionId) {
    const a = one(
      sql.exec(`SELECT * FROM actions WHERE action_id = ? ORDER BY rev LIMIT 1`, actionId)
    );
    return a ? { ...actionRow(a), effects: effectRows('WHERE action_id = ?', actionId) } : null;
  }

  /** `action` for up to 50 ids in one call (a multi-target undo is one RPC on a cell). */
  function actions(actionIds) {
    if (!Array.isArray(actionIds)) return [];
    return actionIds.slice(0, 50).map((id) => (typeof id === 'string' ? action(id) : null));
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

  /** S1.6 — the names of one canvas's versions, target newest first. */
  function names(entry) {
    if (typeof entry !== 'string' || !entry) return [];
    return sql
      .exec(
        `SELECT entry, target_rev, name, actor, at, rev FROM names WHERE entry = ? ORDER BY target_rev DESC`,
        entry
      )
      .map((n) => ({
        entry: n.entry,
        targetRev: Number(n.target_rev),
        name: n.name,
        actor: n.actor,
        at: Number(n.at),
        rev: Number(n.rev),
      }));
  }

  /** S1.6 — cleared trash items (S1-trash.md §4), newest clear first. */
  function trashCleared({ entry = null } = {}) {
    const byEntry = typeof entry === 'string' && entry;
    return sql
      .exec(
        `SELECT entry, artboard, rev, by, at, cleared_rev FROM trash_cleared ${byEntry ? 'WHERE entry = ?' : ''}
         ORDER BY cleared_rev DESC, entry, artboard`,
        ...(byEntry ? [entry] : [])
      )
      .map((c) => ({
        entry: c.entry,
        artboard: c.artboard,
        rev: Number(c.rev),
        by: c.by,
        at: Number(c.at),
        clearedRev: Number(c.cleared_rev),
      }));
  }

  /**
   * S1.6 — what is in the shared Trash, derived from the log (S1 Q2,
   * S1-trash.md §1), cleared items left out, newest first. A canvas: its
   * entry's NEWEST `@manifest delete`, while no live doc carries the entry
   * (the doc row alone would lose it to a new canvas at the same path). An
   * artboard: an action of kind `trash` naming it in `origin.trashed`.
   */
  function trash({ entry = null } = {}) {
    const byEntry = typeof entry === 'string' && entry;
    const canvases = sql
      .exec(
        `SELECT e.entry, e.doc, e.before_path, e.rev, e.action_id, a.actor, a.committed_at
         FROM effects e JOIN actions a ON a.rev = e.rev
         WHERE e.lane = '@manifest' AND e.op = 'delete' AND e.entry IS NOT NULL
           ${byEntry ? 'AND e.entry = ?' : ''}
           AND e.rev = (SELECT MAX(x.rev) FROM effects x
                        WHERE x.lane = '@manifest' AND x.op = 'delete' AND x.entry = e.entry)
           AND NOT EXISTS (SELECT 1 FROM docs d WHERE d.entry = e.entry AND d.retired = 0)
           AND NOT EXISTS (SELECT 1 FROM trash_cleared c
                           WHERE c.entry = e.entry AND c.artboard = '' AND c.rev = e.rev)
         ORDER BY e.rev DESC`,
        ...(byEntry ? [entry] : [])
      )
      .map((c) => ({
        id: `canvas:${c.entry}`,
        entry: c.entry,
        doc: c.doc,
        path: c.before_path,
        rev: Number(c.rev),
        actionId: c.action_id,
        actor: c.actor,
        at: Number(c.committed_at),
      }));
    const cleared = new Set(
      trashCleared({ entry }).map((c) => `${c.entry}\u0000${c.artboard}\u0000${c.rev}`)
    );
    const artboards = [];
    for (const a of sql.exec(`SELECT * FROM actions WHERE kind = 'trash' ORDER BY rev DESC`)) {
      const row = actionRow(a);
      const trashed = Array.isArray(row.origin?.trashed) ? row.origin.trashed : [];
      if (!trashed.length) continue;
      const first = effectRows('WHERE rev = ?', a.rev).find(
        (e) => LANES.includes(e.lane) && e.entry
      );
      if (!first || (byEntry && first.entry !== entry)) continue;
      for (const t of trashed) {
        if (cleared.has(`${first.entry}\u0000${t.artboard}\u0000${row.revision}`)) continue;
        artboards.push({
          id: `artboard:${row.actionId}/${t.artboard}`,
          entry: first.entry,
          doc: first.doc,
          artboard: t.artboard,
          label: typeof t.label === 'string' ? t.label : null,
          rev: row.revision,
          actionId: row.actionId,
          actor: row.actor,
          at: row.committedAt,
        });
      }
    }
    return { canvases, artboards };
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
    actions,
    manifest,
    docByPath,
    laneAt,
    effectsAfter,
    liveDocByEntry,
    // S1.6 — additive readers (S1-trash.md §4).
    names,
    trash,
    trashCleared,
    runsBegin: runs.runsBegin,
    runsClaim: runs.runsClaim,
    runsRenew: runs.runsRenew,
    runsEnd: runs.runsEnd,
    runsList: runs.runsList,
    votesStart: votes.votesStart,
    votesCast: votes.votesCast,
    votesEnd: votes.votesEnd,
    votesGet: votes.votesGet,
    votesList: votes.votesList,
  };
}
