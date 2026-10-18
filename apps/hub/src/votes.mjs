// Formal votes with hub-held ballots — Gate 0 A18, contract
// `apps/studio/client/v2/contracts/S4-S9-votes-comments.md` §2.2 (S4.6).
//
// Part of the store core, built on the `runs-core.mjs` rules: the SAME tables
// and methods run in a self-hosted hub's SQLite and in the cell Durable
// Object's SQLite.
//
//   - ONE method = ONE transaction = ONE RPC. Nothing here awaits.
//   - Refusals are DATA (`{ refused: code }`), never thrown.
//   - The store's clock (`now`) is the only clock. Expiry is LAZY: every method
//     ends lapsed votes first, inside its own transaction, so a sleeping
//     container ends a vote on its next request.
//
// SECRECY IS THE BAR. A ballot (any `picks`, and any count derived from them
// before the end) lives in exactly two places: the `ballots` table and the
// voter's OWN answer (`mine` from `votesCast` / `votesGet`). Before the end the
// only live signal is `done` — WHO has voted, never WHAT. Ending a vote
// computes `tallies` + `voters`, and DELETES the vote's ballot rows, in one
// transaction: after the end nobody — hub, studio, backup, export — can tell
// who picked what, not even the voter.
//
// The voter is the caller's `actor` (the session's person); a body never names
// it. Roles are the route's business (`routes-v2/votes.mjs`); this module
// trusts the actor it is handed.
//
// No Node, Bun or Worker globals but the web-standard `crypto`. No I/O but `sql`.

/** One open vote per canvas; this many open per project. */
export const MAX_OPEN_PER_PROJECT = 20;
export const MAX_TARGETS = 32;
export const MAX_TITLE = 200;
export const MAX_PER_VOTER = 10;
export const DEFAULT_PER_VOTER = 3;
export const MIN_DURATION_S = 30;
export const MAX_DURATION_S = 3600;
export const DEFAULT_DURATION_S = 120;
export const MAX_EXPECTED = 99;
/** A stored vote body never exceeds this (JSON bytes). */
export const MAX_BODY_BYTES = 8 * 1024;
/** An ended vote's row (counts only) is kept this long after its end time. */
export const ENDED_RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

/** `vote-` + 10 lowercase base36 — a valid annotation id (the board element shares it). */
export const VOTE_ID = /^vote-[0-9a-z]{10}$/;

// A target is an annotation id or an `ab:` / `el:` ref — the S4.1 `targetField`
// (`apps/studio/annotations/elements/_shared.ts`); parity is pinned in
// `test/votes-core.test.mjs` against the studio's own parser.
const ANNOTATION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HOST_REF =
  /^(?:ab:[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}|el:[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:#(?:0|[1-9][0-9]{0,3}))?)$/;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
const HAS_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export const VOTES_DDL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS votes (
     project TEXT NOT NULL, id TEXT NOT NULL, canvas TEXT NOT NULL, body_json TEXT NOT NULL,
     state TEXT NOT NULL, ends_at INTEGER NOT NULL, seq INTEGER NOT NULL,
     PRIMARY KEY (project, id))`,
  `CREATE INDEX IF NOT EXISTS votes_open ON votes(project, state, ends_at)`,
  `CREATE INDEX IF NOT EXISTS votes_seq ON votes(project, seq)`,
  `CREATE TABLE IF NOT EXISTS ballots (
     project TEXT NOT NULL, vote_id TEXT NOT NULL, voter TEXT NOT NULL, picks_json TEXT NOT NULL,
     cast_at INTEGER NOT NULL, PRIMARY KEY (project, vote_id, voter))`,
  `CREATE TABLE IF NOT EXISTS votes_meta (project TEXT PRIMARY KEY, seq INTEGER NOT NULL)`,
]);

/** An annotation id or an `ab:` / `el:` ref (S4.1 `targetField`). */
export function isVoteTarget(v) {
  if (typeof v !== 'string' || v.length === 0 || v.length > 200) return false;
  if (DANGEROUS_KEYS.has(v)) return false;
  return ANNOTATION_ID.test(v) || HOST_REF.test(v);
}

/** A designRoot-relative canvas path (the scope key canvas grants are written against). */
export function asVoteCanvas(v) {
  if (typeof v !== 'string' || v.length === 0 || v.length > 300) return null;
  if (HAS_CONTROL.test(v) || v.includes('\\') || v.startsWith('/')) return null;
  const parts = v.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  return v;
}

const isProject = (v) => typeof v === 'string' && v.length > 0 && v.length <= 128;
const isActor = (v) =>
  typeof v === 'string' && v.length > 0 && v.length <= 200 && !HAS_CONTROL.test(v);

/**
 * The picks rule — the same one `tallyBallots` counts by
 * (`apps/studio/annotations/elements/ballot.model.ts`), so a local and a hub
 * tally agree: keys ⊆ `targets`, integers ≥ 1, sum ≤ `perVoter`. Anything else
 * is null (refused `invalid`), NEVER clamped. `{}` is a valid, empty ballot.
 *
 * @returns {Record<string, number> | null} sorted keys
 */
export function asPicks(raw, targets, perVoter) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const allowed = new Set(targets);
  const keys = Object.keys(raw).sort();
  if (keys.length > allowed.size) return null;
  const out = {};
  let sum = 0;
  for (const k of keys) {
    if (DANGEROUS_KEYS.has(k) || !allowed.has(k)) return null;
    const n = raw[k];
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) return null;
    sum += n;
    if (sum > perVoter) return null;
    out[k] = n;
  }
  return out;
}

function intIn(v, min, max, fallback) {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) return undefined;
  return v;
}

function defaultVoteId() {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let s = 'vote-';
  for (const b of bytes) s += (b % 36).toString(36);
  return s;
}

/**
 * The votes half of the store core. Every method opens its own transaction.
 *
 * @param {{ exec: Function, transaction: Function }} sql
 * @param {{ now?: () => number, newId?: () => string }} [opts]
 */
/**
 * @param {object} [o]
 * @param {() => void} [o.onBallotsDeleted] told (inside the transaction) when a
 *   vote's end deletes its ballots, so a store whose bytes outlive a DELETE
 *   (SQLite's WAL) can purge them once the transaction commits.
 */
export function createVotesCore(
  sql,
  { now = () => Date.now(), newId = defaultVoteId, onBallotsDeleted = null } = {}
) {
  const one = (rows) => (rows.length ? rows[0] : null);

  const seqOf = (project) =>
    Number(one(sql.exec(`SELECT seq FROM votes_meta WHERE project = ?`, project))?.seq ?? 0);
  function nextSeq(project) {
    const n = seqOf(project) + 1;
    sql.exec(
      `INSERT INTO votes_meta (project, seq) VALUES (?, ?)
       ON CONFLICT(project) DO UPDATE SET seq = excluded.seq`,
      project,
      n
    );
    return n;
  }

  const voteRow = (project, id) =>
    one(sql.exec(`SELECT * FROM votes WHERE project = ? AND id = ?`, project, id));
  const bodyOf = (row) => JSON.parse(row.body_json);
  const doneOf = (project, id) =>
    sql
      .exec(
        `SELECT voter FROM ballots WHERE project = ? AND vote_id = ? ORDER BY voter`,
        project,
        id
      )
      .map((r) => r.voter);

  /** A row as every reader may see it: `done` is WHO voted, never WHAT. */
  function publicVote(project, row) {
    const body = bodyOf(row);
    if (body.state === 'ended') return { ...body, done: body.done ?? [] };
    // An open vote carries no count derived from picks — only who has voted.
    const { tallies: _t, voters: _v, ...open } = body;
    return { ...open, done: doneOf(project, row.id) };
  }

  /**
   * End one vote, atomically (caller is inside the transaction): tallies and
   * voters from the ballots, then the ballots are DELETED.
   */
  function endVote(project, row, t, touched) {
    const body = bodyOf(row);
    const ballots = sql.exec(
      `SELECT voter, picks_json FROM ballots WHERE project = ? AND vote_id = ? ORDER BY voter`,
      project,
      row.id
    );
    const tallies = {};
    const done = [];
    for (const b of ballots) {
      let picks = null;
      try {
        picks = asPicks(JSON.parse(b.picks_json), body.targets, body.perVoter);
      } catch {
        picks = null;
      }
      // A stored ballot was validated when it was cast; re-checked so a row
      // nobody can explain still counts nothing (as `tallyBallots`).
      if (!picks || Object.keys(picks).length === 0) continue;
      done.push(b.voter);
      for (const [k, n] of Object.entries(picks)) tallies[k] = (tallies[k] ?? 0) + n;
    }
    const sorted = {};
    for (const k of Object.keys(tallies).sort()) sorted[k] = tallies[k];
    const ended = {
      ...body,
      state: 'ended',
      endedAt: t,
      done,
      tallies: sorted,
      voters: done.length,
    };
    sql.exec(`DELETE FROM ballots WHERE project = ? AND vote_id = ?`, project, row.id);
    onBallotsDeleted?.();
    sql.exec(
      `UPDATE votes SET body_json = ?, state = 'ended', seq = ? WHERE project = ? AND id = ?`,
      JSON.stringify(ended),
      nextSeq(project),
      project,
      row.id
    );
    touched.add(row.canvas);
    return ended;
  }

  /** Lazy expiry: every lapsed open vote ends; long-ended rows go. */
  function sweep(project, t, touched) {
    const lapsed = sql.exec(
      `SELECT * FROM votes WHERE project = ? AND state = 'open' AND ends_at <= ? ORDER BY ends_at, id`,
      project,
      t
    );
    for (const row of lapsed) endVote(project, row, t, touched);
    sql.exec(
      `DELETE FROM votes WHERE project = ? AND state = 'ended' AND ends_at < ?`,
      project,
      t - ENDED_RETAIN_MS
    );
  }

  /**
   * Run `fn` in one transaction, after a sweep. Every answer (refusals too)
   * carries the project's `seq` and the canvases whose votes changed
   * (`touched`, for the route's scoped poke — never sent to a client).
   */
  function tx(project, fn) {
    if (!isProject(project)) return { refused: 'invalid', seq: 0, touched: [] };
    return sql.transaction(() => {
      const t = now();
      const touched = new Set();
      sweep(project, t, touched);
      const out = fn(t, touched);
      out.seq = seqOf(project);
      out.touched = [...touched].sort();
      return out;
    });
  }

  function votesStart({ project, canvas, targets, title, perVoter, durationS, expected, actor }) {
    return tx(project, (t, touched) => {
      const c = asVoteCanvas(canvas);
      if (!c || !isActor(actor)) return { refused: 'invalid' };
      if (!Array.isArray(targets) || targets.length === 0 || targets.length > MAX_TARGETS)
        return { refused: 'invalid' };
      const list = [];
      for (const x of targets) {
        if (!isVoteTarget(x)) return { refused: 'invalid' };
        if (!list.includes(x)) list.push(x);
      }
      const per = intIn(perVoter, 1, MAX_PER_VOTER, DEFAULT_PER_VOTER);
      const dur = intIn(durationS, MIN_DURATION_S, MAX_DURATION_S, DEFAULT_DURATION_S);
      const exp = intIn(expected, 1, MAX_EXPECTED, null);
      if (per === undefined || dur === undefined || exp === undefined)
        return { refused: 'invalid' };
      if (title !== undefined && title !== null && typeof title !== 'string')
        return { refused: 'invalid' };
      const name = typeof title === 'string' ? title.replace(CONTROL, '').trim() : '';
      if (name.length > MAX_TITLE) return { refused: 'invalid' };

      const openHere = one(
        sql.exec(
          `SELECT id FROM votes WHERE project = ? AND canvas = ? AND state = 'open' LIMIT 1`,
          project,
          c
        )
      );
      if (openHere) return { refused: 'vote-open' };
      const open = Number(
        one(
          sql.exec(`SELECT COUNT(*) AS n FROM votes WHERE project = ? AND state = 'open'`, project)
        )?.n ?? 0
      );
      if (open >= MAX_OPEN_PER_PROJECT) return { refused: 'capacity' };

      let id = null;
      for (let i = 0; i < 4 && id === null; i++) {
        const candidate = newId();
        if (VOTE_ID.test(candidate) && !voteRow(project, candidate)) id = candidate;
      }
      if (id === null) return { refused: 'capacity' };
      const body = {
        id,
        canvas: c,
        targets: list,
        title: name,
        perVoter: per,
        state: 'open',
        startedBy: actor,
        startedAt: t,
        endsAt: t + dur * 1000,
        ...(exp !== null ? { expected: exp } : {}),
      };
      const json = JSON.stringify(body);
      if (json.length > MAX_BODY_BYTES) return { refused: 'invalid' };
      sql.exec(
        `INSERT INTO votes (project, id, canvas, body_json, state, ends_at, seq)
         VALUES (?, ?, ?, ?, 'open', ?, ?)`,
        project,
        id,
        c,
        json,
        body.endsAt,
        nextSeq(project)
      );
      touched.add(c);
      return { vote: { ...body, done: [] } };
    });
  }

  function votesCast({ project, voteId, actor, picks }) {
    return tx(project, (t, touched) => {
      if (typeof voteId !== 'string' || !VOTE_ID.test(voteId)) return { refused: 'not-found' };
      if (!isActor(actor)) return { refused: 'invalid' };
      const row = voteRow(project, voteId);
      if (!row) return { refused: 'not-found' };
      if (row.state !== 'open') return { refused: 'ended' };
      const body = bodyOf(row);
      const mine = asPicks(picks, body.targets, body.perVoter);
      if (!mine) return { refused: 'invalid' };
      const had =
        one(
          sql.exec(
            `SELECT 1 AS x FROM ballots WHERE project = ? AND vote_id = ? AND voter = ?`,
            project,
            voteId,
            actor
          )
        ) !== null;
      const empty = Object.keys(mine).length === 0;
      if (empty) {
        sql.exec(
          `DELETE FROM ballots WHERE project = ? AND vote_id = ? AND voter = ?`,
          project,
          voteId,
          actor
        );
      } else {
        sql.exec(
          `INSERT INTO ballots (project, vote_id, voter, picks_json, cast_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(project, vote_id, voter) DO UPDATE SET
             picks_json = excluded.picks_json, cast_at = excluded.cast_at`,
          project,
          voteId,
          actor,
          JSON.stringify(mine),
          t
        );
      }
      // Only WHO-has-voted is visible to others: the seq (and so the poke)
      // moves when `done` changes, never when someone moves a dot.
      if (had === empty) {
        sql.exec(
          `UPDATE votes SET seq = ? WHERE project = ? AND id = ?`,
          nextSeq(project),
          project,
          voteId
        );
        touched.add(row.canvas);
      }
      return { vote: publicVote(project, voteRow(project, voteId)), mine };
    });
  }

  function votesEnd({ project, voteId, actor }) {
    return tx(project, (t, touched) => {
      if (typeof voteId !== 'string' || !VOTE_ID.test(voteId)) return { refused: 'not-found' };
      if (!isActor(actor)) return { refused: 'invalid' };
      const row = voteRow(project, voteId);
      if (!row) return { refused: 'not-found' };
      if (row.state !== 'open') return { refused: 'ended' };
      const ended = endVote(project, row, t, touched);
      return { vote: ended };
    });
  }

  function votesGet({ project, voteId, actor }) {
    return tx(project, () => {
      if (typeof voteId !== 'string' || !VOTE_ID.test(voteId)) return { refused: 'not-found' };
      const row = voteRow(project, voteId);
      if (!row) return { refused: 'not-found' };
      const vote = publicVote(project, row);
      if (row.state !== 'open' || !isActor(actor)) return { vote };
      const b = one(
        sql.exec(
          `SELECT picks_json FROM ballots WHERE project = ? AND vote_id = ? AND voter = ?`,
          project,
          voteId,
          actor
        )
      );
      return b ? { vote, mine: JSON.parse(b.picks_json) } : { vote };
    });
  }

  /**
   * Open votes and ended ones within retention. `after` = only rows changed
   * since that seq; `canvases` (array) = only those canvases. No `mine`.
   */
  function votesList({ project, canvases, after } = {}) {
    return tx(project, () => {
      const since = Number.isSafeInteger(after) && after > 0 ? after : 0;
      const only = Array.isArray(canvases) ? new Set(canvases) : null;
      const rows = sql.exec(
        `SELECT * FROM votes WHERE project = ? AND seq > ? ORDER BY seq, id`,
        project,
        since
      );
      const votes = [];
      for (const row of rows) {
        if (only && !only.has(row.canvas)) continue;
        votes.push(publicVote(project, row));
      }
      return { votes };
    });
  }

  return { votesStart, votesCast, votesEnd, votesGet, votesList };
}
