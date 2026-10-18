// AI runs, per-artboard leases, the waiting line and the fencing counters —
// V2-1.15 §5.2. Part of the store core: the SAME tables and methods run in a
// self-hosted hub's SQLite and in the cell Durable Object's SQLite.
//
// THE ONE RULE (L10): every operation is ONE store method, so one transaction
// and one RPC. A "read whether it is busy, then write" split across two calls
// double-grants under a race (the V2-1.15 §6 prototype measured 300 double
// grants in 300 rounds). Nothing here awaits; every method is synchronous over
// `sql.transaction`.
//
// Expiry is LAZY: every method sweeps lapsed runs first, inside its own
// transaction, releasing their artboards to the head of each line. The hub's
// clock (`now`) is the only clock.
//
// Refusals are DATA (`{ refused: code, … }`), never thrown: RPC to a Durable
// Object carries no error classes, and a refusal is an answer, not a fault.
//
// No Node, Bun or Worker globals. No I/O but `sql`.

/** A live run lapses this long after its device's last renewal (L2). */
export const RUN_TTL_MS = 30_000;
/** How often a studio renews (one call per project, every live run). */
export const RUN_RENEW_MS = 10_000;
/** Caps (V2-1.15 §5.2). */
export const MAX_LIVE_RUNS_PER_ACTOR = 20;
export const MAX_KEYS_PER_RUN = 200;
export const MAX_TICKETS_PER_RUN = 50;
export const MAX_OBJECTS = 200;
export const MAX_LABEL = 80;
export const MAX_RENEW_BATCH = 200;
/** An ended run's row is kept this long, so a late retry still learns how it ended. */
export const ENDED_RETAIN_MS = 24 * 60 * 60 * 1000;

export const RUN_ORIGINS = Object.freeze(['maude-chat', 'claude-code', 'design-edit']);
/** Outcomes a studio may report. `lapsed` is the hub's own (TTL). */
export const RUN_OUTCOMES = Object.freeze([
  'done',
  'stopped',
  'failed',
  'interrupted',
  'cancelled',
  'lease-lost',
]);

const RUN_ID = /^r_[A-Za-z0-9_-]{6,64}$/;
const ASK_ID = /^a_[A-Za-z0-9_-]{6,64}$/;
const CHAT_ID = /^[A-Za-z0-9_-]{1,64}$/;
// V2-1.4 ElementId: readable, never a computed 8-hex id.
const ELEMENT_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const COMPUTED_ID = /^[0-9a-f]{8}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
const HAS_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export const RUNS_DDL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS ai_runs (
     run_id TEXT PRIMARY KEY, actor TEXT NOT NULL, device TEXT NOT NULL, ask_id TEXT, chat_id TEXT,
     origin TEXT NOT NULL, label TEXT, state TEXT NOT NULL, created_at INTEGER NOT NULL,
     renewed_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ended_at INTEGER, outcome TEXT,
     objects TEXT)`,
  `CREATE INDEX IF NOT EXISTS ai_runs_live ON ai_runs(state, expires_at)`,
  `CREATE INDEX IF NOT EXISTS ai_runs_actor ON ai_runs(actor, state)`,
  // The row outlives its holder: `fence` only ever grows (L3).
  `CREATE TABLE IF NOT EXISTS ai_leases (
     entry TEXT NOT NULL, artboard TEXT NOT NULL, fence INTEGER NOT NULL, run_id TEXT,
     granted_at INTEGER, PRIMARY KEY (entry, artboard))`,
  `CREATE INDEX IF NOT EXISTS ai_leases_run ON ai_leases(run_id)`,
  `CREATE TABLE IF NOT EXISTS ai_tickets (
     entry TEXT NOT NULL, artboard TEXT NOT NULL, run_id TEXT NOT NULL, enqueued_at INTEGER NOT NULL,
     n INTEGER NOT NULL, PRIMARY KEY (entry, artboard, run_id))`,
  `CREATE INDEX IF NOT EXISTS ai_tickets_run ON ai_tickets(run_id)`,
  `CREATE INDEX IF NOT EXISTS ai_tickets_line ON ai_tickets(entry, artboard, n)`,
]);

/**
 * The `expectFence` key of a lease (`runsClaim`): `<canvas>|<artboard>`.
 * Artboard ids never contain `|`, so the split is unambiguous.
 */
export function leaseKeyId(k) {
  return `${k.canvas}|${k.artboard}`;
}

const cleanText = (v, max) =>
  typeof v === 'string' ? v.replace(CONTROL, '').trim().slice(0, max) : '';

/** A wire `LeaseKey` → `{canvas, artboard}`, or null when malformed. */
export function asLeaseKey(k) {
  if (!k || typeof k !== 'object') return null;
  const { canvas, artboard } = k;
  if (typeof canvas !== 'string' || !canvas || canvas.length > 300 || HAS_CONTROL.test(canvas))
    return null;
  if (
    typeof artboard !== 'string' ||
    !artboard ||
    artboard.length > 128 ||
    artboard.includes('|') ||
    HAS_CONTROL.test(artboard)
  )
    return null;
  return { canvas, artboard };
}

/** Keys, deduplicated; null when any is malformed. */
function asLeaseKeys(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) return null;
  const out = [];
  const seen = new Set();
  for (const k of list) {
    const key = asLeaseKey(k);
    if (!key) return null;
    const id = leaseKeyId(key);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(key);
  }
  return out;
}

/** V2-1.4 `ElementRef[]`, ≤ 200 — malformed refs are dropped, never stored. */
export function asElementRefs(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list) {
    if (out.length >= MAX_OBJECTS) break;
    if (!r || typeof r !== 'object') continue;
    const key = asLeaseKey(r);
    if (!key) continue;
    const el = r.element;
    if (typeof el !== 'string' || el.length > 48 || !ELEMENT_ID.test(el) || COMPUTED_ID.test(el))
      continue;
    const ref = { canvas: key.canvas, artboard: key.artboard, element: el };
    if (Number.isSafeInteger(r.occurrence) && r.occurrence >= 0 && r.occurrence <= 10_000)
      ref.occurrence = r.occurrence;
    out.push(ref);
  }
  return out;
}

/**
 * The runs half of the store core. `meta`/`setMeta` are the core's own
 * `store_meta` accessors; every method opens its own transaction.
 */
export function createRunsCore(sql, { now, meta, setMeta }) {
  const one = (rows) => (rows.length ? rows[0] : null);
  let changed = false;

  const runRow = (runId) => one(sql.exec(`SELECT * FROM ai_runs WHERE run_id = ?`, runId));
  const leaseRow = (entry, artboard) =>
    one(
      sql.exec(
        `SELECT fence, run_id FROM ai_leases WHERE entry = ? AND artboard = ?`,
        entry,
        artboard
      )
    );
  const lineLength = (entry, artboard) =>
    Number(
      one(
        sql.exec(
          `SELECT COUNT(*) AS c FROM ai_tickets WHERE entry = ? AND artboard = ?`,
          entry,
          artboard
        )
      )?.c ?? 0
    );

  function parseObjects(v) {
    if (typeof v !== 'string' || !v) return [];
    try {
      const a = JSON.parse(v);
      return Array.isArray(a) ? a : [];
    } catch {
      return [];
    }
  }

  /** 1-based place in a line (L8: FIFO by `n`). */
  function position(entry, artboard, n) {
    return Number(
      one(
        sql.exec(
          `SELECT COUNT(*) AS c FROM ai_tickets WHERE entry = ? AND artboard = ? AND n <= ?`,
          entry,
          artboard,
          n
        )
      )?.c ?? 0
    );
  }

  /** What every member sees (`RunPublic`, V2-1.15 §5.1) — never prompt, question or doing. */
  function publicRun(row) {
    const artboards = sql
      .exec(
        `SELECT entry, artboard FROM ai_leases WHERE run_id = ? ORDER BY entry, artboard`,
        row.run_id
      )
      .map((l) => ({ canvas: l.entry, artboard: l.artboard }));
    const waitingFor = sql
      .exec(`SELECT entry, artboard, n FROM ai_tickets WHERE run_id = ? ORDER BY n`, row.run_id)
      .map((t) => ({
        canvas: t.entry,
        artboard: t.artboard,
        position: position(t.entry, t.artboard, Number(t.n)),
      }));
    return {
      runId: row.run_id,
      askId: row.ask_id ?? null,
      actor: row.actor,
      origin: row.origin,
      label: row.label ?? '',
      state: row.state,
      artboards,
      waitingFor,
      objects: parseObjects(row.objects),
      since: Number(row.created_at),
    };
  }

  function holderOf(entry, artboard) {
    const lease = leaseRow(entry, artboard);
    if (!lease?.run_id) return null;
    const row = runRow(lease.run_id);
    return row && row.state !== 'ended' ? publicRun(row) : null;
  }

  /** Grant `(entry, artboard)` to a run: the fence grows by one (L3). Returns the token. */
  function grant(entry, artboard, runId, t) {
    sql.exec(
      `INSERT INTO ai_leases (entry, artboard, fence, run_id, granted_at) VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(entry, artboard) DO UPDATE SET fence = fence + 1, run_id = excluded.run_id, granted_at = excluded.granted_at`,
      entry,
      artboard,
      runId,
      t
    );
    sql.exec(
      `DELETE FROM ai_tickets WHERE entry = ? AND artboard = ? AND run_id = ?`,
      entry,
      artboard,
      runId
    );
    sql.exec(`UPDATE ai_runs SET state = 'running' WHERE run_id = ? AND state = 'waiting'`, runId);
    changed = true;
    return Number(leaseRow(entry, artboard).fence);
  }

  function addTicket(entry, artboard, runId, t) {
    const prior = one(
      sql.exec(
        `SELECT n FROM ai_tickets WHERE entry = ? AND artboard = ? AND run_id = ?`,
        entry,
        artboard,
        runId
      )
    );
    if (prior) return Number(prior.n);
    const n = Number(meta('runs_ticket_n', 0)) + 1;
    setMeta('runs_ticket_n', n);
    sql.exec(
      `INSERT INTO ai_tickets (entry, artboard, run_id, enqueued_at, n) VALUES (?, ?, ?, ?, ?)`,
      entry,
      artboard,
      runId,
      t,
      n
    );
    changed = true;
    return n;
  }

  /** A free key with a line goes to the line's head. Returns the grant or null. */
  function settle(entry, artboard, t) {
    const lease = leaseRow(entry, artboard);
    if (lease?.run_id) return null;
    const head = one(
      sql.exec(
        `SELECT run_id FROM ai_tickets WHERE entry = ? AND artboard = ? ORDER BY n LIMIT 1`,
        entry,
        artboard
      )
    );
    if (!head) return null;
    const token = grant(entry, artboard, head.run_id, t);
    return { runId: head.run_id, canvas: entry, artboard, token };
  }

  /** End a run: its leases free (the fence is kept), its tickets drop (L5). Returns the freed keys. */
  function release(runId, outcome, t) {
    sql.exec(
      `UPDATE ai_runs SET state = 'ended', outcome = ?, ended_at = ? WHERE run_id = ?`,
      outcome,
      t,
      runId
    );
    const freed = sql.exec(`SELECT entry, artboard FROM ai_leases WHERE run_id = ?`, runId);
    sql.exec(`UPDATE ai_leases SET run_id = NULL, granted_at = NULL WHERE run_id = ?`, runId);
    sql.exec(`DELETE FROM ai_tickets WHERE run_id = ?`, runId);
    changed = true;
    return freed.map((k) => ({ entry: k.entry, artboard: k.artboard }));
  }

  function handoff(keys, t) {
    const granted = [];
    for (const k of keys) {
      const g = settle(k.entry, k.artboard, t);
      if (g) granted.push(g);
    }
    return granted;
  }

  /**
   * Lazy expiry (L2, L9): every run whose device stopped renewing ends
   * `lapsed` — every lapse first, so a lapsed ticket is never granted — and
   * then the freed keys move to the head of each line.
   */
  function sweep(t) {
    const lapsed = sql.exec(
      `SELECT run_id FROM ai_runs WHERE state != 'ended' AND expires_at <= ?`,
      t
    );
    const freed = [];
    for (const r of lapsed) freed.push(...release(r.run_id, 'lapsed', t));
    const granted = handoff(freed, t);
    sql.exec(`DELETE FROM ai_runs WHERE state = 'ended' AND ended_at < ?`, t - ENDED_RETAIN_MS);
    return granted;
  }

  /** `runs_seq` moves when anything a member can see changed (the poke's cue). */
  function flushSeq() {
    if (changed) setMeta('runs_seq', Number(meta('runs_seq', 0)) + 1);
    changed = false;
  }

  /** Run `fn` in one transaction, after a sweep. */
  function tx(fn) {
    return sql.transaction(() => {
      changed = false;
      const t = now();
      sweep(t);
      flushSeq();
      const out = fn(t);
      flushSeq();
      // Every answer names the runs change counter, so the caller knows when to poke.
      if (out && typeof out === 'object' && !out.refused && out.seq === undefined)
        out.seq = Number(meta('runs_seq', 0));
      return out;
    });
  }

  function heldKeys(runId) {
    return sql
      .exec(
        `SELECT entry, artboard, fence FROM ai_leases WHERE run_id = ? ORDER BY entry, artboard`,
        runId
      )
      .map((l) => ({ canvas: l.entry, artboard: l.artboard, token: Number(l.fence) }));
  }

  function waitingKeys(runId) {
    return sql
      .exec(`SELECT entry, artboard, n FROM ai_tickets WHERE run_id = ? ORDER BY n`, runId)
      .map((k) => ({
        canvas: k.entry,
        artboard: k.artboard,
        position: position(k.entry, k.artboard, Number(k.n)),
        heldBy: holderOf(k.entry, k.artboard),
      }));
  }

  const countTickets = (runId) =>
    Number(one(sql.exec(`SELECT COUNT(*) AS c FROM ai_tickets WHERE run_id = ?`, runId))?.c ?? 0);
  const countLeases = (runId) =>
    Number(one(sql.exec(`SELECT COUNT(*) AS c FROM ai_leases WHERE run_id = ?`, runId))?.c ?? 0);

  /**
   * Decide each key for a live run: held already → granted; free with no line
   * → granted; otherwise a ticket (when `enqueue`) or a plain busy answer. A
   * newcomer never jumps a non-empty line, even on a free artboard (L8).
   */
  function acquire(runId, keys, { enqueue, expectFence }, t) {
    const granted = [];
    const busy = [];
    for (const { canvas, artboard } of keys) {
      const lease = leaseRow(canvas, artboard);
      if (lease?.run_id === runId) {
        granted.push({ canvas, artboard, token: Number(lease.fence) });
        continue;
      }
      // Defensive: a free key that still has a line is the line's (never ours to jump).
      settle(canvas, artboard, t);
      const now2 = leaseRow(canvas, artboard);
      if (now2?.run_id === runId) {
        granted.push({ canvas, artboard, token: Number(now2.fence) });
        continue;
      }
      const free = !now2?.run_id && lineLength(canvas, artboard) === 0;
      const expected = expectFence ? expectFence[leaseKeyId({ canvas, artboard })] : undefined;
      if (expected !== undefined) {
        // CAS (§5.6): confirm a provisional claim only if nobody was granted since.
        if (free && Number(now2?.fence ?? 0) === expected) {
          granted.push({ canvas, artboard, token: grant(canvas, artboard, runId, t) });
        } else {
          busy.push({
            canvas,
            artboard,
            position: null,
            fenced: true,
            heldBy: holderOf(canvas, artboard),
          });
        }
        continue;
      }
      if (free) {
        granted.push({ canvas, artboard, token: grant(canvas, artboard, runId, t) });
        continue;
      }
      if (enqueue) {
        const n = addTicket(canvas, artboard, runId, t);
        busy.push({
          canvas,
          artboard,
          position: position(canvas, artboard, n),
          heldBy: holderOf(canvas, artboard),
        });
        continue;
      }
      busy.push({ canvas, artboard, position: null, heldBy: holderOf(canvas, artboard) });
    }
    return { granted, busy };
  }

  /** How many of `keys` this run would newly ticket — the cap is checked before any write. */
  function wouldTicket(runId, keys) {
    let n = 0;
    for (const { canvas, artboard } of keys) {
      const lease = leaseRow(canvas, artboard);
      if (lease?.run_id === runId) continue;
      if (!lease?.run_id && lineLength(canvas, artboard) === 0) continue;
      const mine = one(
        sql.exec(
          `SELECT 1 AS x FROM ai_tickets WHERE entry = ? AND artboard = ? AND run_id = ?`,
          canvas,
          artboard,
          runId
        )
      );
      if (!mine) n += 1;
    }
    return n;
  }

  // ------------------------------------------------------------ methods

  function runsBegin({
    runId,
    actor,
    device,
    askId = null,
    chatId = null,
    origin,
    label = '',
    wants,
    enqueue = false,
  } = {}) {
    return tx((t) => {
      if (typeof runId !== 'string' || !RUN_ID.test(runId))
        return { refused: 'invalid', reason: 'bad runId' };
      if (typeof actor !== 'string' || !actor) return { refused: 'invalid', reason: 'no actor' };
      const dev = cleanText(device, 128);
      if (!dev) return { refused: 'invalid', reason: 'bad device' };
      if (askId !== null && (typeof askId !== 'string' || !ASK_ID.test(askId)))
        return { refused: 'invalid', reason: 'bad askId' };
      if (chatId !== null && (typeof chatId !== 'string' || !CHAT_ID.test(chatId)))
        return { refused: 'invalid', reason: 'bad chatId' };
      if (!RUN_ORIGINS.includes(origin)) return { refused: 'invalid', reason: 'bad origin' };
      const keys = asLeaseKeys(wants);
      if (!keys) return { refused: 'invalid', reason: 'bad wants' };

      const existing = runRow(runId);
      if (existing) {
        // Idempotent by runId: a retried begin answers from what is held now.
        if (existing.actor !== actor) return { refused: 'forbidden', reason: 'not your run' };
        if (existing.state === 'ended') return { refused: 'ended', outcome: existing.outcome };
        return { run: publicRun(existing), granted: heldKeys(runId), busy: waitingKeys(runId) };
      }
      if (keys.length > MAX_KEYS_PER_RUN)
        return { refused: 'capacity', reason: `at most ${MAX_KEYS_PER_RUN} artboards a run` };
      const live = Number(
        one(
          sql.exec(`SELECT COUNT(*) AS c FROM ai_runs WHERE actor = ? AND state != 'ended'`, actor)
        )?.c ?? 0
      );
      if (live >= MAX_LIVE_RUNS_PER_ACTOR)
        return { refused: 'capacity', reason: `at most ${MAX_LIVE_RUNS_PER_ACTOR} live runs` };
      if (enqueue && wouldTicket(runId, keys) > MAX_TICKETS_PER_RUN)
        return { refused: 'capacity', reason: `at most ${MAX_TICKETS_PER_RUN} waiting artboards` };

      sql.exec(
        `INSERT INTO ai_runs (run_id, actor, device, ask_id, chat_id, origin, label, state, created_at, renewed_at, expires_at, objects)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, '[]')`,
        runId,
        actor,
        dev,
        askId,
        chatId,
        origin,
        cleanText(label, MAX_LABEL),
        t,
        t,
        t + RUN_TTL_MS
      );
      changed = true;
      const { granted, busy } = acquire(runId, keys, { enqueue: !!enqueue }, t);
      // Only tickets, nothing held: the run waits (it starts by itself, §5.5).
      if (!granted.length && busy.some((b) => b.position !== null)) {
        sql.exec(`UPDATE ai_runs SET state = 'waiting' WHERE run_id = ?`, runId);
      }
      return { run: publicRun(runRow(runId)), granted, busy };
    });
  }

  function runsClaim({ runId, actor, keys, enqueue = false, expectFence } = {}) {
    return tx((t) => {
      const list = asLeaseKeys(keys);
      if (!list) return { refused: 'invalid', reason: 'bad keys' };
      let expect = null;
      if (expectFence !== undefined && expectFence !== null) {
        if (typeof expectFence !== 'object' || Array.isArray(expectFence))
          return { refused: 'invalid', reason: 'bad expectFence' };
        expect = {};
        for (const [k, v] of Object.entries(expectFence)) {
          if (!Number.isSafeInteger(v) || v < 0)
            return { refused: 'invalid', reason: 'bad expectFence' };
          expect[k] = v;
        }
      }
      const row = typeof runId === 'string' ? runRow(runId) : null;
      if (!row) return { refused: 'ended', outcome: 'unknown' };
      if (row.actor !== actor) return { refused: 'forbidden', reason: 'not your run' };
      if (row.state === 'ended') return { refused: 'ended', outcome: row.outcome };
      const fresh = list.filter((k) => leaseRow(k.canvas, k.artboard)?.run_id !== runId);
      if (countLeases(runId) + countTickets(runId) + fresh.length > MAX_KEYS_PER_RUN)
        return { refused: 'capacity', reason: `at most ${MAX_KEYS_PER_RUN} artboards a run` };
      if (
        enqueue &&
        !expect &&
        countTickets(runId) + wouldTicket(runId, list) > MAX_TICKETS_PER_RUN
      )
        return { refused: 'capacity', reason: `at most ${MAX_TICKETS_PER_RUN} waiting artboards` };
      return acquire(runId, list, { enqueue: !!enqueue && !expect, expectFence: expect }, t);
    });
  }

  function runsRenew({ actor, device, runs } = {}) {
    return tx((t) => {
      if (!Array.isArray(runs) || runs.length > MAX_RENEW_BATCH)
        return { refused: 'invalid', reason: `runs: an array of at most ${MAX_RENEW_BATCH}` };
      const dev = cleanText(device, 128);
      const out = [];
      for (const r of runs) {
        const runId = typeof r?.runId === 'string' ? r.runId : '';
        const row = runId ? runRow(runId) : null;
        // Not yours, not this device's, or gone: nothing to renew (L2 — only its
        // own device's renewals keep a run).
        if (!row || row.actor !== actor || row.device !== dev) {
          out.push({ runId: runId.slice(0, 80), ended: 'unknown' });
          continue;
        }
        if (row.state === 'ended') {
          out.push({ runId, ended: row.outcome });
          continue;
        }
        let state = row.state;
        if ((r.state === 'running' || r.state === 'needs-you') && countLeases(runId) > 0)
          state = r.state;
        const objects = r.objects === undefined ? null : JSON.stringify(asElementRefs(r.objects));
        if (state !== row.state || (objects !== null && objects !== row.objects)) changed = true;
        sql.exec(
          `UPDATE ai_runs SET renewed_at = ?, expires_at = ?, state = ?, objects = COALESCE(?, objects) WHERE run_id = ?`,
          t,
          t + RUN_TTL_MS,
          state,
          objects,
          runId
        );
        out.push({ run: publicRun(runRow(runId)) });
      }
      return { runs: out };
    });
  }

  function runsEnd({ runId, actor, outcome } = {}) {
    return tx((t) => {
      if (!RUN_OUTCOMES.includes(outcome)) return { refused: 'invalid', reason: 'bad outcome' };
      const row = typeof runId === 'string' ? runRow(runId) : null;
      if (!row) return { ended: 'unknown', granted: [] };
      if (row.actor !== actor) return { refused: 'forbidden', reason: 'not your run' };
      if (row.state === 'ended') return { ended: row.outcome, granted: [] };
      return { ended: outcome, granted: handoff(release(runId, outcome, t), t) };
    });
  }

  function runsList({ after } = {}) {
    return tx(() => {
      const seq = Number(meta('runs_seq', 0));
      if (Number.isSafeInteger(after) && after === seq) return { seq, unchanged: true };
      const runs = sql
        .exec(`SELECT * FROM ai_runs WHERE state != 'ended' ORDER BY created_at, run_id`)
        .map(publicRun);
      return { seq, runs };
    });
  }

  /**
   * Inside `commit`'s transaction (L4): every token must equal its artboard's
   * current fence. Expiry alone never fences — only a newer grant does, so the
   * sweep runs first and a lapsed holder's line takes the artboard before the
   * check. Returns the mismatched keys (empty = accepted).
   */
  function fenceMismatches(fence, t) {
    if (!fence || !Array.isArray(fence.leases) || fence.leases.length === 0) return [];
    changed = false;
    sweep(t);
    flushSeq();
    const bad = [];
    for (const l of fence.leases) {
      const row = leaseRow(l.entry, l.artboard);
      const current = Number(row?.fence ?? 0);
      if (current !== l.token)
        bad.push({ entry: l.entry, artboard: l.artboard, token: l.token, fence: current });
    }
    return bad;
  }

  return { runsBegin, runsClaim, runsRenew, runsEnd, runsList, fenceMismatches };
}
