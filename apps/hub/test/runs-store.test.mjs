// S5.2 — AI runs, per-artboard leases and the waiting line in the store core
// (V2-1.15 §5.2, invariants L1–L10). A real store core over better-sqlite3 and a
// clock the test owns: the hub's clock is the only clock, so a "Mac asleep for
// 40 s" is the clock moving while one device stops renewing.
//
// The oracle is the store's own tables (who holds what, at which fence), never
// a method's return value alone.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { MAX_LIVE_RUNS_PER_ACTOR, RUN_TTL_MS } from '../src/project-transactions/runs-core.mjs';
import { createStoreCore } from '../src/project-transactions/store-core.mjs';
import { betterSqliteAdapter } from '../src/project-transactions/store-sqlite.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function rig(file = ':memory:') {
  const clock = { t: 1_000_000 };
  const db = new Database(file);
  const core = createStoreCore(betterSqliteAdapter(db), { now: () => clock.t });
  core.migrate();
  const sql = betterSqliteAdapter(db);
  /** Who holds each key now, read from the table. */
  const holder = (canvas, artboard) =>
    sql.exec(
      `SELECT run_id, fence FROM ai_leases WHERE entry = ? AND artboard = ?`,
      canvas,
      artboard
    )[0] ?? null;
  let n = 0;
  const id = (p) => `${p}_${String(++n).padStart(6, '0')}`;
  const begin = (actor, wants, opts = {}) =>
    core.runsBegin({
      runId: opts.runId ?? id('r'),
      askId: id('a'),
      actor,
      device: opts.device ?? `${actor}-mac`,
      origin: opts.origin ?? 'maude-chat',
      label: opts.label ?? 'Make it greener',
      wants,
      enqueue: opts.enqueue ?? true,
      ...(opts.extra ?? {}),
    });
  const renew = (actor, runIds, extra = {}) =>
    core.runsRenew({
      actor,
      device: extra.device ?? `${actor}-mac`,
      runs: runIds.map((runId) => ({ runId, ...(extra.entry ?? {}) })),
    });
  return { core, clock, db, sql, holder, begin, renew, id };
}

const P = { canvas: 'e-post', artboard: 'post-1-1' };
const key = (artboard, canvas = 'e-post') => ({ canvas, artboard });

describe('one AI per artboard, a FIFO line (L1, L3, L8)', () => {
  test('the second ask waits behind the holder; on release it is granted with token 2; the third moves up', () => {
    const { core, begin, holder } = rig();
    const a = begin('michal', [P], { label: 'Make it greener' });
    assert.deepEqual(a.granted, [{ ...P, token: 1 }]);
    assert.equal(a.run.state, 'running');
    const b = begin('tereza', [P], { label: 'Darker headline' });
    assert.deepEqual(b.granted, []);
    assert.equal(b.busy[0].position, 1);
    assert.equal(b.busy[0].heldBy.label, 'Make it greener');
    assert.equal(b.run.state, 'waiting');
    const c = begin('michal', [P], { label: 'Third' });
    assert.equal(c.busy[0].position, 2);

    const end = core.runsEnd({ runId: a.run.runId, actor: 'michal', outcome: 'done' });
    assert.equal(end.ended, 'done');
    assert.deepEqual(end.granted, [{ runId: b.run.runId, ...P, token: 2 }]);
    assert.equal(holder(P.canvas, P.artboard).run_id, b.run.runId, 'the head of the line holds it');
    const list = core.runsList({});
    const cNow = list.runs.find((r) => r.runId === c.run.runId);
    assert.deepEqual(cNow.waitingFor, [{ ...P, position: 1 }]);
    const bNow = list.runs.find((r) => r.runId === b.run.runId);
    assert.equal(bNow.state, 'running', 'a waiting run that is granted starts');
  });

  test('a newcomer never jumps a non-empty line; without enqueue it is told busy and takes no ticket', () => {
    const { core, begin, holder } = rig();
    const a = begin('michal', [P]);
    const b = begin('tereza', [P]);
    const peek = begin('ondra', [P], { enqueue: false });
    assert.deepEqual(peek.granted, []);
    assert.equal(peek.busy[0].position, null);
    assert.equal(
      core.runsList({}).runs.find((r) => r.runId === peek.run.runId).waitingFor.length,
      0,
      'no ticket'
    );
    const late = begin('ondra', [P]);
    assert.equal(late.busy[0].position, 2, 'behind tereza');
    core.runsEnd({ runId: a.run.runId, actor: 'michal', outcome: 'done' });
    assert.equal(holder(P.canvas, P.artboard).run_id, b.run.runId, 'not the newcomer');
  });

  test('whole canvas, 15 artboards with 2 busy: 13 granted at once, 2 tickets; a freed one goes to the whole-canvas run', () => {
    const { core, begin, holder } = rig();
    const mine = begin('michal', [key('ab-3')]);
    const hers = begin('tereza', [key('ab-9')]);
    const all = Array.from({ length: 15 }, (_, i) => key(`ab-${i + 1}`));
    const whole = begin('michal', all, { label: 'Whole canvas' });
    assert.equal(whole.granted.length, 13);
    assert.equal(whole.busy.length, 2);
    assert.deepEqual(whole.busy.map((b) => [b.artboard, b.position, b.heldBy.actor]).sort(), [
      ['ab-3', 1, 'michal'],
      ['ab-9', 1, 'tereza'],
    ]);
    assert.equal(whole.run.state, 'running');
    const g = core.runsEnd({ runId: hers.run.runId, actor: 'tereza', outcome: 'done' });
    assert.deepEqual(g.granted, [{ runId: whole.run.runId, ...key('ab-9'), token: 2 }]);
    assert.equal(holder('e-post', 'ab-9').run_id, whole.run.runId);
    assert.equal(holder('e-post', 'ab-3').run_id, mine.run.runId);
  });
});

describe('TTL, lapse and the line (L2, L9)', () => {
  test('Mac asleep: the holder stops renewing, the waiter keeps renewing → after 40 s the waiter runs, the sleeper is told it lapsed', () => {
    const { core, begin, renew, clock, holder } = rig();
    const a = begin('michal', [P]);
    const b = begin('tereza', [P]);
    for (let s = 10; s <= 40; s += 10) {
      clock.t += 10_000;
      renew('tereza', [b.run.runId]);
    }
    assert.equal(holder(P.canvas, P.artboard).run_id, b.run.runId);
    assert.equal(Number(holder(P.canvas, P.artboard).fence), 2);
    const back = renew('michal', [a.run.runId]);
    assert.deepEqual(back.runs, [{ runId: a.run.runId, ended: 'lapsed' }]);
    const late = core.runsClaim({ runId: a.run.runId, actor: 'michal', keys: [P] });
    assert.deepEqual(late, { refused: 'ended', outcome: 'lapsed' });
  });

  test('a waiter whose Mac vanished lapses and is skipped at handoff; a lapsed ticket is never granted', () => {
    const { core, begin, renew, clock, holder } = rig();
    const a = begin('michal', [P]);
    const gone = begin('tereza', [P]);
    const c = begin('ondra', [P]);
    assert.equal(c.busy[0].position, 2);
    clock.t += RUN_TTL_MS / 2;
    renew('michal', [a.run.runId]);
    renew('ondra', [c.run.runId]);
    clock.t += RUN_TTL_MS / 2 + 1;
    const list = core.runsList({});
    assert.equal(
      list.runs.find((r) => r.runId === c.run.runId).waitingFor[0].position,
      1,
      'ondra moved up past the lapsed ticket'
    );
    assert.equal(
      list.runs.some((r) => r.runId === gone.run.runId),
      false
    );
    const end = core.runsEnd({ runId: a.run.runId, actor: 'michal', outcome: 'done' });
    assert.deepEqual(
      end.granted.map((g) => g.runId),
      [c.run.runId]
    );
    assert.equal(holder(P.canvas, P.artboard).run_id, c.run.runId);
  });

  test('only the run’s own device keeps it alive; renewing a run that is not yours renews nothing', () => {
    const { begin, renew, clock, core } = rig();
    const a = begin('michal', [P], { device: 'mac-1' });
    clock.t += 20_000;
    assert.deepEqual(renew('michal', [a.run.runId], { device: 'mac-2' }).runs, [
      { runId: a.run.runId, ended: 'unknown' },
    ]);
    assert.deepEqual(renew('tereza', [a.run.runId], { device: 'mac-1' }).runs, [
      { runId: a.run.runId, ended: 'unknown' },
    ]);
    clock.t += 15_000;
    assert.equal(core.runsList({}).runs.length, 0, 'lapsed: 35 s since its device renewed');
  });
});

describe('begin, claim, renew, end (L5, L7)', () => {
  test('begin is idempotent per run id; another actor’s begin or end on it is forbidden', () => {
    const { core, begin } = rig();
    const a = begin('michal', [P], { runId: 'r_retry01' });
    const again = begin('michal', [P], { runId: 'r_retry01' });
    assert.deepEqual(again.granted, a.granted, 'a lost answer is re-read, not re-granted');
    assert.equal(again.run.runId, 'r_retry01');
    assert.equal(begin('tereza', [P], { runId: 'r_retry01' }).refused, 'forbidden');
    assert.equal(
      core.runsEnd({ runId: 'r_retry01', actor: 'tereza', outcome: 'done' }).refused,
      'forbidden'
    );
    assert.equal(
      core.runsEnd({ runId: 'r_retry01', actor: 'michal', outcome: 'done' }).ended,
      'done'
    );
    assert.deepEqual(
      core.runsEnd({ runId: 'r_retry01', actor: 'michal', outcome: 'failed' }),
      { ended: 'done', granted: [], seq: core.runsList({}).seq },
      'ending twice keeps the first outcome'
    );
    assert.deepEqual(begin('michal', [P], { runId: 'r_retry01' }), {
      refused: 'ended',
      outcome: 'done',
    });
  });

  test('mid-run claim without enqueue: free → granted, busy → refused with no ticket (L7)', () => {
    const { core, begin } = rig();
    const mine = begin('michal', [P]);
    const hers = begin('tereza', [key('story')]);
    const r = core.runsClaim({
      runId: mine.run.runId,
      actor: 'michal',
      keys: [key('square'), key('story')],
    });
    assert.deepEqual(r.granted, [{ ...key('square'), token: 1 }]);
    assert.equal(r.busy.length, 1);
    assert.equal(r.busy[0].artboard, 'story');
    assert.equal(r.busy[0].position, null);
    assert.equal(r.busy[0].heldBy.runId, hers.run.runId);
    const listed = core.runsList({}).runs.find((x) => x.runId === mine.run.runId);
    assert.deepEqual(listed.waitingFor, [], 'no ticket inside a turn');
    assert.equal(listed.artboards.length, 2);
  });

  test('a provisional claim is confirmed by CAS on the fence, and refused when someone was granted since (§5.6)', () => {
    const { core, begin } = rig();
    const first = begin('michal', [P]);
    core.runsEnd({ runId: first.run.runId, actor: 'michal', outcome: 'done' }); // fence 1, free
    const run = begin('michal', []);
    const ok = core.runsClaim({
      runId: run.run.runId,
      actor: 'michal',
      keys: [P],
      expectFence: { 'e-post|post-1-1': 1 },
    });
    assert.deepEqual(ok.granted, [{ ...P, token: 2 }]);
    core.runsEnd({ runId: run.run.runId, actor: 'michal', outcome: 'done' });
    const other = begin('tereza', [P]); // fence 3
    core.runsEnd({ runId: other.run.runId, actor: 'tereza', outcome: 'done' });
    const stale = begin('michal', []);
    const no = core.runsClaim({
      runId: stale.run.runId,
      actor: 'michal',
      keys: [P],
      expectFence: { 'e-post|post-1-1': 2 },
      enqueue: true,
    });
    assert.deepEqual(no.granted, []);
    assert.equal(no.busy[0].fenced, true);
    assert.equal(no.busy[0].position, null, 'a failed CAS takes no ticket');
  });

  test('needs-you is taken only while the run holds a lease; objects are validated V2-1.4 refs', () => {
    const { begin, renew } = rig();
    const holding = begin('michal', [P]);
    const waiting = begin('tereza', [P]);
    const objects = [
      { canvas: '.design/post.tsx', artboard: 'post-1-1', element: 'headline' },
      { canvas: '.design/post.tsx', artboard: 'post-1-1', element: 'deadbeef' }, // computed id
      { canvas: '.design/post.tsx', artboard: 'post-1-1', element: 'Bad Id' },
      { canvas: '.design/post.tsx', artboard: 'post-1-1', element: 'cta', occurrence: 2, x: 1 },
    ];
    const r = renew('michal', [holding.run.runId], { entry: { state: 'needs-you', objects } });
    assert.equal(r.runs[0].run.state, 'needs-you');
    assert.deepEqual(r.runs[0].run.objects, [
      { canvas: '.design/post.tsx', artboard: 'post-1-1', element: 'headline' },
      { canvas: '.design/post.tsx', artboard: 'post-1-1', element: 'cta', occurrence: 2 },
    ]);
    const w = renew('tereza', [waiting.run.runId], { entry: { state: 'running' } });
    assert.equal(w.runs[0].run.state, 'waiting', 'a waiting run cannot claim to run');
  });

  test('RunPublic never carries prompt, question or doing; the label is ≤ 80 with control characters stripped', () => {
    const { begin, sql } = rig();
    const r = begin('michal', [P], {
      label: `Make\u0007 it ${'x'.repeat(200)}`,
      extra: { prompt: 'the full secret prompt', question: 'Allow?', doing: 'Headline done' },
    });
    const text = JSON.stringify(r);
    for (const s of ['secret prompt', 'Allow?', 'Headline done'])
      assert.equal(text.includes(s), false);
    assert.equal(r.run.label.length, 80);
    assert.equal(r.run.label.startsWith('Make it '), true);
    const row = sql.exec(`SELECT * FROM ai_runs`)[0];
    assert.equal(JSON.stringify(row).includes('secret'), false, 'never stored either');
    assert.deepEqual(Object.keys(r.run).sort(), [
      'actor',
      'artboards',
      'askId',
      'label',
      'objects',
      'origin',
      'runId',
      'since',
      'state',
      'waitingFor',
    ]);
  });
});

describe('caps and batch renew (S7)', () => {
  test('renew answers for 20 runs in one call; the 21st live run is capacity; keys and tickets are capped', () => {
    const { core, begin, renew } = rig();
    const ids = [];
    for (let i = 0; i < MAX_LIVE_RUNS_PER_ACTOR; i++)
      ids.push(begin('michal', [key(`a-${i}`)]).run.runId);
    const r = renew('michal', ids);
    assert.equal(r.runs.length, 20);
    assert.ok(r.runs.every((x) => x.run?.state === 'running'));
    assert.equal(begin('michal', [key('a-21')]).refused, 'capacity');
    assert.equal(begin('tereza', [key('a-21')]).run.state, 'running', 'the cap is per actor');
    const many = Array.from({ length: 201 }, (_, i) => key(`k-${i}`));
    assert.equal(begin('tereza', many).refused, 'capacity');
    // 51 busy artboards → more than 50 tickets.
    const busyKeys = Array.from({ length: 51 }, (_, i) => key(`b-${i}`));
    for (let i = 0; i < 3; i++)
      begin(`h${i}`, busyKeys.slice(i * 17, i * 17 + 17), { enqueue: false });
    assert.equal(begin('ondra', busyKeys).refused, 'capacity');
    assert.equal(
      begin('ondra', busyKeys, { enqueue: false }).busy.length,
      51,
      'no tickets, no cap'
    );
    assert.equal(
      core.runsList({}).runs.some((x) => x.actor === 'ondra' && x.waitingFor.length),
      false
    );
  });

  test('malformed input is refused as data, never thrown', () => {
    const { core, begin } = rig();
    assert.equal(begin('michal', [P], { runId: 'nope' }).refused, 'invalid');
    assert.equal(begin('michal', [{ canvas: 'x', artboard: 'a|b' }]).refused, 'invalid');
    assert.equal(begin('michal', [P], { origin: 'shell' }).refused, 'invalid');
    assert.equal(
      core.runsEnd({ runId: 'r_aaaaaa', actor: 'm', outcome: 'lapsed' }).refused,
      'invalid'
    );
    assert.equal(core.runsRenew({ actor: 'm', device: 'd', runs: 'x' }).refused, 'invalid');
  });
});

describe('the store survives a restart (durability)', () => {
  test('leases, line positions and fence counters survive close + reopen; the next grant is token 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'maude-runs-'));
    dirs.push(dir);
    const file = join(dir, 'store.sqlite');
    const one = rig(file);
    const a = one.begin('michal', [P]);
    const b = one.begin('tereza', [P]);
    one.db.close();
    const two = rig(file);
    const list = two.core.runsList({});
    assert.equal(list.runs.find((r) => r.runId === b.run.runId).waitingFor[0].position, 1);
    const end = two.core.runsEnd({ runId: a.run.runId, actor: 'michal', outcome: 'done' });
    assert.deepEqual(end.granted, [{ runId: b.run.runId, ...P, token: 2 }]);
    two.db.close();
  });
});

describe('the change counter (the poke’s cue)', () => {
  test('runsList answers unchanged until something a member can see moves', () => {
    const { core, begin, renew } = rig();
    const s0 = core.runsList({}).seq;
    assert.deepEqual(core.runsList({ after: s0 }), { seq: s0, unchanged: true });
    const a = begin('michal', [P]);
    assert.ok(a.seq > s0);
    assert.deepEqual(core.runsList({ after: a.seq }), { seq: a.seq, unchanged: true });
    const quiet = renew('michal', [a.run.runId]);
    assert.equal(quiet.seq, a.seq, 'a plain renewal is not a change');
    const loud = renew('michal', [a.run.runId], { entry: { state: 'needs-you' } });
    assert.ok(loud.seq > a.seq);
  });
});

describe('L1 under a random schedule', () => {
  test('every lease is held by one live run, and each artboard’s fence grows by exactly one per grant', () => {
    const { core, begin, renew, clock, sql } = rig();
    const actors = ['a', 'b', 'c', 'd'];
    const boards = ['p', 's', 'q'];
    let seed = 7;
    const rnd = (n) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const live = [];
    const grants = new Map();
    const note = (gs) => {
      for (const g of gs ?? []) grants.set(g.artboard, (grants.get(g.artboard) ?? 0) + 1);
    };
    for (let step = 0; step < 600; step++) {
      const op = rnd(5);
      const actor = actors[rnd(actors.length)];
      if (op <= 1) {
        const wants = boards.filter(() => rnd(2)).map((b) => key(b));
        const r = begin(actor, wants, { enqueue: rnd(2) === 1 });
        if (!r.refused) {
          live.push({ runId: r.run.runId, actor });
          note(r.granted);
        }
      } else if (op === 2 && live.length) {
        const r = live.splice(rnd(live.length), 1)[0];
        note(core.runsEnd({ runId: r.runId, actor: r.actor, outcome: 'done' }).granted);
      } else if (op === 3) {
        clock.t += rnd(15_000);
        // A random half of the devices renew.
        for (const ac of actors.filter(() => rnd(2))) {
          renew(
            ac,
            live.filter((x) => x.actor === ac).map((x) => x.runId)
          );
        }
      } else {
        core.runsList({});
      }
      const bad = sql.exec(
        `SELECT l.entry, l.artboard FROM ai_leases l LEFT JOIN ai_runs r ON r.run_id = l.run_id
         WHERE l.run_id IS NOT NULL AND (r.run_id IS NULL OR r.state = 'ended')`
      );
      assert.deepEqual(bad, [], `step ${step}: a lease held by a run that is not live`);
    }
    // Every grant moved a fence by one; the handoffs inside sweeps are grants too.
    const fences = sql.exec(`SELECT artboard, fence FROM ai_leases`);
    for (const f of fences) assert.ok(Number(f.fence) >= (grants.get(f.artboard) ?? 0));
  });
});

describe('L10 — why every operation is one store call', () => {
  test('the split shape (read whether busy → an RPC’s await → write) double-grants; one runsBegin never does', async () => {
    const { core, begin, sql } = rig();
    const tick = () => new Promise((r) => setTimeout(r, 2));
    // The shape L10 forbids, over the same tables: two calls, an await between.
    async function splitAcquire(runId, artboard) {
      const busy = sql.exec(
        `SELECT run_id FROM ai_leases WHERE entry = 'e-split' AND artboard = ? AND run_id IS NOT NULL`,
        artboard
      ).length;
      await tick();
      if (busy) return false;
      sql.exec(
        `INSERT INTO ai_leases (entry, artboard, fence, run_id, granted_at) VALUES ('e-split', ?, 1, ?, 0)
         ON CONFLICT(entry, artboard) DO UPDATE SET fence = fence + 1, run_id = excluded.run_id`,
        artboard,
        runId
      );
      return true;
    }
    const later = async (fn) => {
      await tick();
      return fn();
    };
    let splitDoubles = 0;
    let oneCallDoubles = 0;
    for (let i = 0; i < 30; i++) {
      const [x, y] = await Promise.all([
        splitAcquire(`r_x${i}`, `s-${i}`),
        splitAcquire(`r_y${i}`, `s-${i}`),
      ]);
      if (x && y) splitDoubles += 1;
      const key = { canvas: 'e-one', artboard: `o-${i}` };
      const [a, b] = await Promise.all([
        later(() => begin('michal', [key])),
        later(() => begin('tereza', [key])),
      ]);
      if (a.granted.length && b.granted.length) oneCallDoubles += 1;
      // End both (the per-actor cap would otherwise fire — the cap working).
      core.runsEnd({ runId: a.run.runId, actor: 'michal', outcome: 'done' });
      core.runsEnd({ runId: b.run.runId, actor: 'tereza', outcome: 'done' });
    }
    assert.ok(splitDoubles > 0, 'the split shape double-grants under a race');
    assert.equal(oneCallDoubles, 0);
  });
});
