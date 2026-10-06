// The desktop park — an idle desktop lets its cloud cell sleep.
//
// The reducer is the whole policy; the runtime only carries out its effects.
// Every transition the plan names is a row here, and the wiring pins at the
// bottom keep the runtime from quietly growing a second idea of "idle".

import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';

import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { createSyncRuntime, type SyncProvider } from '../sync/index.ts';

import {
  fileLaneBusy,
  initialParkState,
  isLocalWorkRel,
  PARK_AFTER_MS,
  PARK_MAX_MS,
  PARK_PROBE_MAX_MS,
  PARK_PROBE_MS,
  type ParkEvent,
  type ParkState,
  parkReducer,
  parseCellState,
} from '../sync/park.ts';
import { hasSelfRetryingWork, syncPresentation } from '../sync/presentation.ts';
import { createSyncStatusStore } from '../sync/status.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const T0 = 1_800_000_000_000;
const ASLEEP = (at: number, changedAt: number | null = null) =>
  ({ kind: 'state', state: 'asleep', changedAt, at }) as const;

function run(state: ParkState, ...events: ParkEvent[]) {
  const effects: string[] = [];
  let s = state;
  for (const e of events) {
    const step = parkReducer(s, e);
    s = step.state;
    effects.push(...step.effects);
  }
  return { state: s, effects };
}

/** Idle past the threshold, probe answered: parked at T0 + PARK_AFTER_MS. */
function parked(): ParkState {
  const now = T0 + PARK_AFTER_MS;
  const r = run(
    initialParkState({ now: T0, eligible: true }),
    { type: 'tick', now },
    { type: 'probeResult', result: ASLEEP(Math.floor(now / 60_000) * 60_000, T0 - 3_600_000), now }
  );
  expect(r.effects).toEqual(['probe', 'park']);
  expect(r.state.phase).toBe('parked');
  return r.state;
}

describe('parking', () => {
  test('an ineligible runtime (self-hosted hub) never parks or probes', () => {
    const s = initialParkState({ now: T0, eligible: false });
    const r = run(s, { type: 'tick', now: T0 + 10 * PARK_AFTER_MS });
    expect(r.state.phase).toBe('off');
    expect(r.effects).toEqual([]);
  });

  test('not before the idle threshold', () => {
    const r = run(initialParkState({ now: T0, eligible: true }), {
      type: 'tick',
      now: T0 + PARK_AFTER_MS - 1,
    });
    expect(r.effects).toEqual([]);
  });

  test('idle long enough → probe first, park only on a contract answer', () => {
    parked();
  });

  test('pending outbound work blocks the park', () => {
    const r = run(
      initialParkState({ now: T0, eligible: true }),
      { type: 'pendingChanged', pending: true, now: T0 },
      { type: 'tick', now: T0 + 2 * PARK_AFTER_MS }
    );
    expect(r.effects).toEqual([]);
    expect(r.state.phase).toBe('active');
  });

  test('UI activity and local edits push the threshold out', () => {
    const r = run(
      initialParkState({ now: T0, eligible: true }),
      { type: 'uiActivity', now: T0 + PARK_AFTER_MS - 1_000 },
      { type: 'tick', now: T0 + PARK_AFTER_MS + 1 },
      { type: 'localEdit', now: T0 + 2 * PARK_AFTER_MS - 1_000 },
      { type: 'tick', now: T0 + 2 * PARK_AFTER_MS + 1 }
    );
    expect(r.effects).toEqual([]);
  });

  test('an edit that lands while the probe is out cancels the park', () => {
    const now = T0 + PARK_AFTER_MS;
    const r = run(
      initialParkState({ now: T0, eligible: true }),
      { type: 'tick', now },
      { type: 'localEdit', now: now + 10 },
      { type: 'probeResult', result: ASLEEP(now), now: now + 20 }
    );
    expect(r.effects).toEqual(['probe']);
    expect(r.state.phase).toBe('active');
  });

  test('an old cell (no contract) → unsupported, never park again', () => {
    const now = T0 + PARK_AFTER_MS;
    const r = run(
      initialParkState({ now: T0, eligible: true }),
      { type: 'tick', now },
      { type: 'probeResult', result: { kind: 'unsupported' }, now },
      { type: 'tick', now: now + 10 * PARK_AFTER_MS }
    );
    expect(r.effects).toEqual(['probe']);
    expect(r.state.phase).toBe('unsupported');
  });

  test('a probe that never answered does not park; it is retried later', () => {
    const now = T0 + PARK_AFTER_MS;
    const r = run(
      initialParkState({ now: T0, eligible: true }),
      { type: 'tick', now },
      { type: 'probeResult', result: { kind: 'network-error' }, now },
      { type: 'tick', now: now + 1_000 }
    );
    expect(r.effects).toEqual(['probe']);
    expect(r.state.phase).toBe('active');
    const later = run(r.state, { type: 'tick', now: now + PARK_PROBE_MS });
    expect(later.effects).toEqual(['probe']);
  });
});

describe('while parked', () => {
  test('probes on the PARK_PROBE_MS cadence, one at a time', () => {
    const s = parked();
    const at = s.parkedAt as number;
    const r = run(
      s,
      { type: 'tick', now: at + 1_000 },
      { type: 'tick', now: at + PARK_PROBE_MS },
      { type: 'tick', now: at + PARK_PROBE_MS + 1_000 }
    );
    expect(r.effects).toEqual(['probe']);
  });

  test('a local edit unparks', () => {
    const s = parked();
    expect(run(s, { type: 'localEdit', now: (s.parkedAt as number) + 5 }).effects).toEqual([
      'unpark',
    ]);
  });

  test('UI activity unparks', () => {
    const s = parked();
    expect(run(s, { type: 'uiActivity', now: (s.parkedAt as number) + 5 }).effects).toEqual([
      'unpark',
    ]);
  });

  test('new pending work unparks', () => {
    const s = parked();
    expect(
      run(s, { type: 'pendingChanged', pending: true, now: (s.parkedAt as number) + 5 }).effects
    ).toEqual(['unpark']);
  });

  test('a change another member made (changedAt ≥ the park mark) unparks', () => {
    const s = parked();
    const at = s.parkedAt as number;
    const mark = s.parkMark as number;
    const quiet = run(
      s,
      { type: 'tick', now: at + PARK_PROBE_MS },
      { type: 'probeResult', result: ASLEEP(mark + 60_000, mark - 60_000), now: at + PARK_PROBE_MS }
    );
    expect(quiet.effects).toEqual(['probe']);
    const woke = run(
      quiet.state,
      { type: 'tick', now: at + 2 * PARK_PROBE_MS },
      {
        type: 'probeResult',
        result: { kind: 'state', state: 'running', changedAt: mark + 60_000, at: mark + 120_000 },
        now: at + 2 * PARK_PROBE_MS,
      }
    );
    expect(woke.effects).toEqual(['probe', 'unpark']);
    expect(woke.state.phase).toBe('active');
  });

  test('a running cell with no change (someone just viewing) stays parked', () => {
    const s = parked();
    const at = s.parkedAt as number;
    const r = run(
      s,
      { type: 'tick', now: at + PARK_PROBE_MS },
      {
        type: 'probeResult',
        result: { kind: 'state', state: 'running', changedAt: null, at: null },
        now: at + PARK_PROBE_MS,
      }
    );
    expect(r.state.phase).toBe('parked');
  });

  test('network errors keep it parked and back the probe off, capped', () => {
    let s = parked();
    let now = s.parkedAt as number;
    const gaps: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      now = Math.max(now, s.nextProbeAt ?? now);
      const r = run(
        s,
        { type: 'tick', now },
        { type: 'probeResult', result: { kind: 'network-error' }, now }
      );
      s = r.state;
      gaps.push((s.nextProbeAt as number) - now);
      expect(s.phase).toBe('parked');
    }
    expect(gaps[0]).toBe(PARK_PROBE_MS);
    expect(gaps[1]).toBe(2 * PARK_PROBE_MS);
    expect(Math.max(...gaps)).toBe(PARK_PROBE_MAX_MS);
  });

  test('a cell that stops honouring the contract unparks into today', () => {
    const s = parked();
    const at = s.parkedAt as number;
    const r = run(
      s,
      { type: 'tick', now: at + PARK_PROBE_MS },
      { type: 'probeResult', result: { kind: 'unsupported' }, now: at + PARK_PROBE_MS }
    );
    expect(r.effects).toEqual(['probe', 'unpark']);
    expect(r.state.phase).toBe('unsupported');
  });

  test('the backstop: a long park resyncs even with no signal', () => {
    const s = parked();
    const r = run(s, { type: 'tick', now: (s.parkedAt as number) + PARK_MAX_MS });
    expect(r.effects).toEqual(['unpark']);
  });
});

describe('attacker review fixes (2026-10-05)', () => {
  test('F2: activity while a probe is out does not block every later park', () => {
    const s = parked();
    const at = s.parkedAt as number;
    // A probe goes out, then the person comes back before it answers; the
    // runtime abandons that probe and it never reports.
    const r = run(
      s,
      { type: 'tick', now: at + PARK_PROBE_MS },
      { type: 'uiActivity', now: at + PARK_PROBE_MS + 10 }
    );
    expect(r.effects).toEqual(['probe', 'unpark']);
    expect(r.state.probeInFlight).toBe(false);
    const later = run(r.state, { type: 'tick', now: at + PARK_PROBE_MS + PARK_AFTER_MS + 20 });
    expect(later.effects).toEqual(['probe']);
  });

  test('F6: a park mark from the future is not believed', () => {
    const now = T0 + PARK_AFTER_MS;
    const r = run(
      initialParkState({ now: T0, eligible: true }),
      { type: 'tick', now },
      { type: 'probeResult', result: ASLEEP(9e15), now }
    );
    expect(r.state.parkMark).toBe(Math.floor(now / 60_000) * 60_000);
  });

  test('F6: rate limits, timeouts and edge challenges are transient, not "old cell"', () => {
    for (const code of [403, 408, 429]) {
      expect(parseCellState(code, 'text/html', '')).toEqual({ kind: 'network-error' });
    }
  });

  test('F1: work that retries on its own blocks a park', () => {
    expect(
      hasSelfRetryingWork({ accepted: { pending: 2, oldestPendingAt: 1, ackMs: {}, rejected: 0 } })
    ).toBe(true);
    // The file plane is judged from its ledger (`fileLaneBusy`), never from
    // its seeding phase: stuck rows kept that "seeding" all night (v1.6.13).
    expect(
      hasSelfRetryingWork({
        files: {
          synced: 3,
          pulled: 0,
          conflicts: 0,
          progress: { phase: 'seeding', tracked: 8, delivered: 3, blocked: [] },
        },
      })
    ).toBe(false);
    expect(hasSelfRetryingWork({ assets: { finished: false, done: 1, total: 4 } })).toBe(true);
    expect(hasSelfRetryingWork({ aiAction: { state: 'open' } })).toBe(true);
    expect(hasSelfRetryingWork({ files: { synced: 3, pulled: 0, conflicts: 0 } })).toBe(false);
    expect(hasSelfRetryingWork(null)).toBe(false);
  });

  test('F1: parked never says "Nothing to do" over a change held for a person', () => {
    const base = {
      state: 'offline' as const,
      queuedOps: 0,
      docs: { synced: 1, pending: 0, rejected: 0 },
    };
    expect(syncPresentation({ ...base, parked: { since: 1 } })?.phase).toBe('parked');
    const held = syncPresentation({
      ...base,
      parked: { since: 1 },
      files: { synced: 1, pulled: 0, conflicts: 0, held: [{ count: 1 }] },
    });
    expect(held?.phase).toBe('attention');
  });
});

describe('fileLaneBusy — moving, not merely unfinished (the v1.6.13 night)', () => {
  const now = 10_000_000;
  const opts = { now, lastProgressAt: now - 60_000, windowMs: PARK_AFTER_MS };
  test('Alligators: five stuck rows among thousands delivered do not hold the link', () => {
    const rows: Record<string, { state?: string; nextAttemptAt?: number }> = {};
    for (let i = 0; i < 4861; i += 1) rows[`a/${i}.png`] = { state: 'on-hub' };
    for (const r of ['ui-welcome.tsx', 'ui-how_to_use_maude.tsx', 'x.ts', 'y.tsx', 'z.tsx']) {
      rows[r] = { state: 'stuck' };
    }
    expect(fileLaneBusy(rows, opts)).toBe(false);
  });
  test('a row being pushed always holds it', () => {
    expect(fileLaneBusy({ a: { state: 'pushing' } }, { ...opts, lastProgressAt: 0 })).toBe(true);
  });
  test('unsent rows hold it only while the lane is making progress', () => {
    const rows = { a: { state: 'local-only' }, b: {} };
    expect(fileLaneBusy(rows, opts)).toBe(true);
    expect(fileLaneBusy(rows, { ...opts, lastProgressAt: now - PARK_AFTER_MS - 1 })).toBe(false);
  });
  test('rows in backoff, conflicts and refusals do not', () => {
    expect(
      fileLaneBusy(
        {
          a: { state: 'local-only', nextAttemptAt: now + 60_000 },
          b: { state: 'conflict' },
          c: { state: 'refused' },
          d: { state: 'referenced-but-unoffered' },
        },
        opts
      )
    ).toBe(false);
  });
});

describe('isLocalWorkRel — the studio talking to itself is not work', () => {
  test('runtime state is not', () => {
    for (const rel of [
      '_state/file-ledger/hub-1234abcd.json',
      '_state/file-ledger',
      '_state',
      '_canvas-state/x.view.json',
      '_history/x/1.tsx',
      '_sync.json',
      '_state\\file-ledger\\h.json',
      '',
    ]) {
      expect(isLocalWorkRel(rel)).toBe(false);
    }
  });
  test('a canvas, an asset, a system file are', () => {
    for (const rel of ['ui/screen.tsx', 'assets/a.png', 'system/ds/tokens.css', 'ui\\x.tsx']) {
      expect(isLocalWorkRel(rel)).toBe(true);
    }
  });
});

describe('parseCellState — anything outside the contract is an old cell', () => {
  test('the contract', () => {
    expect(
      parseCellState(200, 'application/json', '{"state":"asleep","changedAt":60000,"at":120000}')
    ).toEqual({ kind: 'state', state: 'asleep', changedAt: 60000, at: 120000 });
    expect(parseCellState(200, 'application/json; charset=utf-8', '{"state":"running"}')).toEqual({
      kind: 'state',
      state: 'running',
      changedAt: null,
      at: null,
    });
  });
  test('old cells and proxies', () => {
    expect(parseCellState(404, 'text/html', '<html>')).toEqual({ kind: 'unsupported' });
    expect(parseCellState(200, 'text/html', '<html>')).toEqual({ kind: 'unsupported' });
    expect(parseCellState(200, 'application/json', 'nope')).toEqual({ kind: 'unsupported' });
    expect(parseCellState(200, 'application/json', '{"state":"awake"}')).toEqual({
      kind: 'unsupported',
    });
    expect(parseCellState(401, 'application/json', '{}')).toEqual({ kind: 'unsupported' });
  });
  test('a 5xx says nothing about the contract', () => {
    expect(parseCellState(503, 'text/plain', '')).toEqual({ kind: 'network-error' });
  });
});

describe('wiring pins', () => {
  const index = readFileSync(join(HERE, '../sync/index.ts'), 'utf8');
  test('the park judges the file plane from its ledger and says why it holds', () => {
    expect(index).toMatch(/fileLaneBusy\(fileLedger\.rows\(\)/);
    expect(index).toMatch(/idle, but staying connected: \$\{reason\}/);
  });

  test('the plane trigger ignores runtime state (the ledger loop, Bug A)', () => {
    expect(index).toMatch(/if \(fileLedger && isLocalWorkRel\(rel\)\)/);
  });
});

// ── The runtime, end to end, against a fake hub and a fake `/_cell/state` ──
//
// Nothing may be lost across a park/unpark cycle: edit → sync; idle → park
// (sockets closed, no poll); a change somebody else made → unpark, and it
// arrives; idle → park; a local edit while parked → unpark, and it reaches the
// hub. The provider pair below models the hub: while "parked" the transport is
// cut and updates queue on both sides, exactly what a closed socket means to
// Yjs — and the reconnect exchanges full state, which is what a handshake is.

function parkHarness(opts: { oldCell?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-park-'));
  const prevHubs = process.env.HUBS_CONFIG_PATH;
  process.env.HUBS_CONFIG_PATH = join(dir, 'hubs.json');
  const url = 'https://park-test.invalid';
  writeFileSync(
    process.env.HUBS_CONFIG_PATH,
    JSON.stringify({ hubs: { [url]: { token: 'mau_test', linkedAt: 1 } } })
  );
  chmodSync(process.env.HUBS_CONFIG_PATH, 0o600);
  const designRoot = join(dir, 'design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  writeFileSync(join(designRoot, 'ui', 'screen.html'), '<p>one</p>');
  const ctx = {
    cfg: {
      name: 'test',
      projectLabel: null,
      designRoot: 'design',
      canvasGroups: [{ label: 'Canvases', path: 'ui' }],
      rootClass: 'app',
      themeDefault: 'dark',
      tokensCssRel: 'system/colors.css',
      teamAccentDefault: null,
      handoffTargets: [],
      newCanvasDir: 'ui',
      newComponentDir: 'ui/components',
      // The capability probe is opted out: this test is about the park, and
      // the legacy lane keeps the boot quiet.
      linkedHub: { url, linkedAt: 1, fileEvents: false, syncFiles: false },
      _source: 'defaults',
    },
    projectLabel: 'test',
    paths: {
      repoRoot: dir,
      designRel: 'design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: 'design/system/colors.css',
      systemDirRel: 'system',
    },
    bus: createBus(),
  } as unknown as Context;

  // ── the hub: one peer doc per document, a cuttable transport ──
  let linked = true;
  const pairs: Array<{ local: Y.Doc; peer: Y.Doc; status: Set<(s: string) => void> }> = [];
  const T = Symbol('transport');
  const exchange = (a: Y.Doc, b: Y.Doc) => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), T);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)), T);
  };
  let parks = 0;
  let unparks = 0;
  const factory = Object.assign(
    (args: { documentName: string; document?: Y.Doc }): SyncProvider => {
      const local = args.document ?? new Y.Doc();
      const peer = new Y.Doc();
      const status = new Set<(s: string) => void>();
      pairs.push({ local, peer, status });
      local.on('update', (u: Uint8Array, o: unknown) => {
        if (o !== T && linked) Y.applyUpdate(peer, u, T);
      });
      peer.on('update', (u: Uint8Array, o: unknown) => {
        if (o !== T && linked) Y.applyUpdate(local, u, T);
      });
      return {
        document: local,
        async onceSynced() {},
        onStatus(cb: (s: 'connected' | 'connecting' | 'disconnected') => void) {
          status.add(cb as (s: string) => void);
          cb('connected');
          return () => status.delete(cb as (s: string) => void);
        },
        destroy() {},
      } as SyncProvider;
    },
    {
      dispose() {},
      reconnect() {},
      park() {
        parks += 1;
        linked = false;
        for (const p of pairs) for (const cb of p.status) cb('disconnected');
      },
      unpark() {
        unparks += 1;
        linked = true;
        for (const p of pairs) {
          exchange(p.local, p.peer);
          for (const cb of p.status) cb('connected');
        }
      },
    }
  );

  // ── the cell's DO: `/_cell/state` on its own clock ──
  let now = 10_000_000;
  let changedAt: number | null = null;
  const probes: string[] = [];
  const parkFetch = (async (input: string, init?: RequestInit) => {
    probes.push(String(input));
    const h = new Headers(init?.headers);
    expect(h.get('x-maude-sync-park')).toBe('1');
    expect(h.get('authorization')).toBe('Bearer mau_test');
    if (opts.oldCell) {
      return new Response('<html>not found</html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      });
    }
    return new Response(
      JSON.stringify({
        state: linked ? 'running' : 'asleep',
        changedAt: changedAt === null ? null : Math.floor(changedAt / 60_000) * 60_000,
        at: Math.floor(now / 60_000) * 60_000,
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  }) as unknown as typeof fetch;

  const store = createSyncStatusStore({ url, canvases: 1, write() {}, broadcast() {} });
  const runtime = createSyncRuntime(ctx, {
    providerFactory: factory,
    statusStore: store,
    park: {
      timings: { afterMs: 60_000, probeMs: 30_000 },
      tickMs: 5,
      now: () => now,
      fetch: parkFetch,
    },
  });
  if (!runtime) throw new Error('runtime did not start');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return {
    ctx,
    runtime,
    store,
    peer: () => pairs[0]?.peer as Y.Doc,
    local: () => pairs[0]?.local as Y.Doc,
    advance: async (ms: number) => {
      now += ms;
      await wait(40);
    },
    remoteChange: (fn: (peer: Y.Doc) => void) => {
      fn(pairs[0]?.peer as Y.Doc);
      changedAt = now; // the hub's `noteChange`, on the DO's clock
    },
    counts: () => ({ parks, unparks, probes: probes.length }),
    cleanup: async () => {
      await runtime.stop();
      if (prevHubs === undefined) delete process.env.HUBS_CONFIG_PATH;
      else process.env.HUBS_CONFIG_PATH = prevHubs;
      rmSync(dir, { recursive: true, force: true });
    },
    wait,
  };
}

describe('the park, in the runtime', () => {
  test('nothing is lost across park → remote change → unpark → park → local edit → unpark', async () => {
    const h = parkHarness();
    try {
      await h.runtime.start();
      const html = () => h.peer().getText('html').toString();

      // 1. edit → sync
      writeFileSync(join(h.ctx.paths.designRoot, 'ui', 'screen.html'), '<p>two</p>');
      h.ctx.bus.emit('fs:any', 'ui/screen.html');
      await h.wait(400);
      expect(html()).toBe('<p>two</p>');
      expect(h.counts().parks).toBe(0);

      // 2. idle → probe → park: sockets closed, status honest
      await h.advance(61_000);
      expect(h.counts().probes).toBe(1);
      expect(h.counts().parks).toBe(1);
      expect(h.store.get().parked?.since).toBeGreaterThan(0);
      // …and the studio talking to itself does not wake it.
      h.ctx.bus.emit('fs:any', '_state/file-ledger/x.json');
      h.ctx.bus.emit('fs:any', '_canvas-state/screen.view.json');
      await h.wait(30);
      expect(h.counts().unparks).toBe(0);

      // 3. somebody else changes something while we are parked
      h.remoteChange((peer) => {
        peer.getText('html').delete(0, peer.getText('html').length);
        peer.getText('html').insert(0, '<p>from a peer</p>');
      });
      expect(h.local().getText('html').toString()).toBe('<p>two</p>'); // cut, as a closed socket is
      await h.advance(61_000);
      // 4. the probe saw it → unpark → it arrives
      expect(h.counts().unparks).toBe(1);
      expect(h.local().getText('html').toString()).toBe('<p>from a peer</p>');
      expect(h.store.get().parked).toBeUndefined();

      // 5. idle → park again. The reconnect's own catch-up poll (1.5 s, real
      // time) is pending work, and a park waits for it — let it land first.
      await h.wait(1_700);
      await h.advance(61_000);
      expect(h.counts().parks).toBe(2);

      // 6. a local edit while parked → unpark at once, and it reaches the hub
      writeFileSync(join(h.ctx.paths.designRoot, 'ui', 'screen.html'), '<p>three</p>');
      h.ctx.bus.emit('fs:any', 'ui/screen.html');
      await h.wait(400);
      expect(h.counts().unparks).toBe(2);
      expect(html()).toBe('<p>three</p>');
    } finally {
      await h.cleanup();
    }
  });

  test('UI presence keeps an attended desktop connected, and wakes a parked one', async () => {
    const h = parkHarness();
    try {
      await h.runtime.start();
      for (let i = 0; i < 4; i += 1) {
        await h.advance(30_000);
        h.ctx.bus.emit('ui:active');
      }
      expect(h.counts().parks).toBe(0);
      await h.advance(61_000);
      expect(h.counts().parks).toBe(1);
      h.ctx.bus.emit('ui:active');
      expect(h.counts().unparks).toBe(1);
    } finally {
      await h.cleanup();
    }
  });

  test('a hub that cannot answer the contract is never parked under', async () => {
    const h = parkHarness({ oldCell: true });
    try {
      await h.runtime.start();
      await h.advance(61_000);
      await h.advance(61_000);
      await h.advance(600_000);
      // One ask, a 404 page, and never again this session — today's behaviour.
      expect(h.counts().probes).toBe(1);
      expect(h.counts().parks).toBe(0);
      expect(h.store.get().parked).toBeUndefined();
    } finally {
      await h.cleanup();
    }
  });
});
