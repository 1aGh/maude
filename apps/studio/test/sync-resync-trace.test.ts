// S11.11 — Resync says what it did: "1 204 of 1 318", then { checked, sent, fetched, conflicts }
// and the log line `sync · resync · 1 318 checked · 3 sent · 0 conflicts` (06 ad-trace).
//
// The trace watches the RESTARTED runtime's status (the counters are per runtime, so they start at
// zero for a resync); here a fake runtime plays a seed that goes 1 204 of 1 318, then converges.

import { describe, expect, test } from 'bun:test';

import { createSyncRoutes } from '../routes/sync.ts';
import { createResyncTrace, groupDigits, readResync, resyncLogLine } from '../sync/resync-trace.ts';

type Status = Parameters<typeof readResync>[0];

const seed = (phase: string, delivered: number, extra: Record<string, unknown> = {}): Status =>
  ({
    canvases: 12,
    files: {
      synced: delivered,
      pulled: 0,
      conflicts: 0,
      pushed: 0,
      progress: { phase, tracked: 1318, delivered, remaining: 1318 - delivered },
      ...extra,
    },
  }) as unknown as Status;

describe('readResync — one reading of the new runtime', () => {
  test('mid-seed: running, with the numerator and the denominator', () => {
    const r = readResync(seed('seeding', 1204), true);
    expect(r?.state).toBe('running');
    expect([r?.done, r?.total]).toEqual([1204, 1318]);
  });

  test('converged: done, and the summary is what the runtime counted', () => {
    const r = readResync(seed('converged', 1318, { pushed: 3, pulled: 0, conflicts: 0 }), true);
    expect(r?.state).toBe('done');
    expect(r?.summary).toEqual({ checked: 1318, sent: 3, fetched: 0, conflicts: 0 });
    expect(r?.done).toBe(1318);
  });

  test('fetched and conflicts are reported, not folded into sent', () => {
    const r = readResync(seed('converged', 1318, { pushed: 2, pulled: 5, conflicts: 1 }), true);
    expect(r?.summary).toEqual({ checked: 1318, sent: 2, fetched: 5, conflicts: 1 });
  });

  test('paused / blocked stops the trace as "attention", with the numbers so far', () => {
    expect(readResync(seed('paused', 900), true)?.state).toBe('attention');
    expect(readResync(seed('blocked', 900), true)?.state).toBe('attention');
  });

  test('no status yet: nothing to say', () => {
    expect(readResync(null, true)).toBeNull();
    expect(readResync({ canvases: 3 } as Status, true)).toBeNull();
  });

  test('a project that syncs files is not "done" just because files have not reported yet', () => {
    const early = { canvases: 12, coldOpen: { canvasesMs: 40 } } as Status;
    expect(readResync(early, true)).toBeNull();
    // …but one with no file plane at all is: its canvases coming into step IS the comparison
    expect(readResync(early, false)?.state).toBe('done');
    expect(readResync(early, false)?.summary.checked).toBe(12);
  });
});

describe('readResync — a journal-less hub (the v1 manifest lane, no denominator)', () => {
  // p8-e2e-headless: a self-hosted team hub and a cell without a checkout carry no journal, so the file
  // plane never starts and `files` never gets a `progress` — the trace sat on "Resyncing…" until its
  // 15-minute give-up (team-project 10, cloud-attach 9). The v1 pass is the comparison there: one report
  // from the NEW runtime's v1 lane is one whole pass.
  const v1 = (extra: Record<string, unknown> = {}): Status =>
    ({
      canvases: 2,
      coldOpen: { canvasesMs: 9 },
      files: { synced: 2, pulled: 1, conflicts: 0, lane: 'v1', ...extra },
    }) as unknown as Status;

  test('a v1 pass report ends the trace: done, with what that pass counted', () => {
    const r = readResync(v1(), true);
    expect(r?.state).toBe('done');
    expect(r?.summary).toEqual({ checked: 2, sent: 0, fetched: 1, conflicts: 0 });
    expect([r?.done, r?.total]).toEqual([2, 2]);
    expect(readResync(v1({ conflicts: 1 }), true)?.summary.conflicts).toBe(1);
  });

  test('a report that does not say it is the v1 lane still waits for the plane to walk its tree', () => {
    const early = {
      canvases: 2,
      files: { synced: 0, pulled: 0, conflicts: 0 },
    } as unknown as Status;
    expect(readResync(early, true)?.state).toBe('running');
  });

  test('the trace finishes on a journal-less hub instead of running to its give-up', () => {
    let status: Status | null = null;
    const ticks: Array<() => void> = [];
    const trace = createResyncTrace({
      read: () => status,
      expectFiles: () => true,
      log: () => {},
      setTimer: (fn) => {
        ticks.push(fn);
        return ticks.length;
      },
      clearTimer: () => {},
    });
    trace.begin();
    status = { canvases: 2, coldOpen: { canvasesMs: 9 } } as unknown as Status;
    trace.tick();
    expect(trace.view()?.state).toBe('running');
    status = v1();
    trace.tick();
    expect(trace.view()?.state).toBe('done');
  });
});

describe('the log line and the digits', () => {
  test('groupDigits uses the canvases’ plain space', () => {
    expect(groupDigits(1318)).toBe('1 318');
    expect(groupDigits(12)).toBe('12');
    expect(groupDigits(1204567)).toBe('1 204 567');
  });

  test('the line is exactly the one 06 ad-trace draws', () => {
    expect(resyncLogLine({ checked: 1318, sent: 3, fetched: 0, conflicts: 0 })).toBe(
      '[sync] resync · 1 318 checked · 3 sent · 0 conflicts'
    );
  });
});

function harness(readings: Status[], over: Record<string, unknown> = {}) {
  let t = 1_000;
  let i = 0;
  const logs: string[] = [];
  const changes: string[] = [];
  let tick: (() => void) | null = null;
  const trace = createResyncTrace({
    read: () => readings[Math.min(i++, readings.length - 1)],
    expectFiles: () => true,
    log: (l) => logs.push(l),
    now: () => t,
    setTimer: (fn) => {
      tick = fn;
      return 1;
    },
    clearTimer: () => {
      tick = null;
    },
    onChange: (v) => changes.push(`${v.state}:${v.done}/${v.total}`),
    ...over,
  });
  return {
    trace,
    logs,
    changes,
    advance: (ms: number) => {
      t += ms;
    },
    fire: () => tick?.(),
    armed: () => tick !== null,
  };
}

describe('createResyncTrace — from "Resyncing… 1 204 of 1 318" to the sentence', () => {
  test('runs, converges, logs once, and stops watching', () => {
    const h = harness([
      seed('seeding', 400),
      seed('seeding', 1204),
      seed('converged', 1318, { pushed: 3 }),
    ]);
    expect(h.trace.view()).toBeNull();
    h.trace.begin();
    expect(h.trace.view()?.state).toBe('running');
    h.fire();
    h.advance(500);
    h.fire();
    expect(h.trace.view()).toMatchObject({ state: 'running', done: 1204, total: 1318 });
    expect(h.logs).toEqual([]);
    h.advance(500);
    h.fire();
    expect(h.trace.view()).toMatchObject({
      state: 'done',
      summary: { checked: 1318, sent: 3, fetched: 0, conflicts: 0 },
    });
    expect(h.logs).toEqual(['[sync] resync · 1 318 checked · 3 sent · 0 conflicts']);
    expect(h.armed()).toBe(false);
    // a late tick can't log it twice
    h.fire();
    expect(h.logs).toHaveLength(1);
    expect(h.changes.at(-1)).toBe('done:1318/1318');
  });

  test('gives up after the limit: "attention", never an endless "Resyncing…"', () => {
    const h = harness([null as unknown as Status], { giveUpMs: 60_000 });
    h.trace.begin();
    h.advance(61_000);
    h.fire();
    expect(h.trace.view()?.state).toBe('attention');
    expect(h.armed()).toBe(false);
  });

  test('a second begin() starts a fresh trace (the old numbers are gone)', () => {
    const h = harness([seed('converged', 1318, { pushed: 3 })]);
    h.trace.begin();
    h.fire();
    expect(h.trace.view()?.state).toBe('done');
    h.trace.begin();
    expect(h.trace.view()).toMatchObject({ state: 'running', done: 0, total: 0 });
  });

  test('a finished trace is not shown for ever', () => {
    const h = harness([seed('converged', 1318)]);
    h.trace.begin();
    h.fire();
    h.advance(11 * 60 * 1000);
    expect(h.trace.view()).toBeNull();
  });
});

describe('POST /_api/sync/resync (routes/sync.ts)', () => {
  function route(control: unknown) {
    const trace = harness([seed('seeding', 1)]);
    const specs = createSyncRoutes({ control: () => control as never, trace: trace.trace });
    const spec = specs.find((s) => s.path === '/_api/sync/resync');
    if (!spec) throw new Error('no resync spec');
    return { spec, trace };
  }
  const req = () => new Request('http://localhost/_api/sync/resync', { method: 'POST' });

  test('restarts with NO argument — this route can never unlink — and starts the trace', async () => {
    const calls: unknown[][] = [];
    const { spec, trace } = route({
      busy: () => false,
      restart: async (...a: unknown[]) => {
        calls.push(a);
        return { syncing: true, canvases: 12 };
      },
    });
    const res = await spec.handle(req(), {});
    expect(res.status).toBe(200);
    expect(calls).toEqual([[]]);
    expect(trace.trace.view()?.state).toBe('running');
    expect((await res.json()).sync.syncing).toBe(true);
  });

  test('a cycle in flight is a 409 and restarts nothing', async () => {
    let restarted = 0;
    const { spec, trace } = route({
      busy: () => true,
      restart: async () => {
        restarted++;
        return { syncing: true };
      },
    });
    const res = await spec.handle(req(), {});
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('busy');
    expect(restarted).toBe(0);
    expect(trace.trace.view()).toBeNull();
  });

  test('a restart that declined (unlinked) has nothing to trace', async () => {
    const { spec, trace } = route({
      restart: async () => ({ syncing: false, reason: 'unlinked', detail: 'Not linked.' }),
    });
    const res = await spec.handle(req(), {});
    expect(res.status).toBe(200);
    expect((await res.json()).sync.reason).toBe('unlinked');
    expect(trace.trace.view()).toBeNull();
  });

  test('no supervisor: an honest answer, not a crash', async () => {
    const { spec } = route(null);
    const j = await (await spec.handle(req(), {})).json();
    expect(j).toMatchObject({ ok: false, reason: 'no-supervisor' });
  });

  test('the gate refusals explain themselves and name nothing the caller sent', async () => {
    const { spec } = route(null);
    const res = spec.refuse?.('cross-origin');
    expect(res?.status).toBe(403);
    const j = (await res?.json()) as { ok: boolean; reason: string; detail: string };
    expect(j).toMatchObject({ ok: false, reason: 'cross-origin' });
    expect(j.detail.length).toBeGreaterThan(10);
    const host = (await spec.refuse?.('untrusted-host')?.json()) as { reason: string };
    expect(host.reason).toBe('untrusted-host');
  });

  test('main origin only, and a read-only session may not resync', () => {
    const { spec } = route(null);
    expect([spec.origin, spec.readOnly, spec.method]).toEqual(['main', 'refused', 'POST']);
  });
});
