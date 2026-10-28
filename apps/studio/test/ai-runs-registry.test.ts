// S5.3 — the studio AI run registry (V2-1.15 §5.4–5.6, §5.9) and `/_api/ai/runs*`.
// Red first: before S5.3 there is no `ai/runs.ts` — every test here fails to import.

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createLocalLeaseHome,
  type LeaseHome,
  OLD_HUB_LINE,
  selectLeaseHome,
} from '../ai/lease-home.ts';
import {
  publicRun,
  type RunEvent,
  type RunRecord,
  reduceRun,
  runView,
} from '../ai/run-lifecycle.ts';
import { createRunRegistry, type RegistryOptions } from '../ai/runs.ts';
import { createAiRoutes } from '../routes/ai.ts';
import { matchRoute } from '../routes/table.ts';

const tick = () => new Promise((r) => setTimeout(r, 0));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmpRoot() {
  const d = mkdtempSync(path.join(tmpdir(), 'ai-runs-'));
  dirs.push(d);
  mkdirSync(path.join(d, '.design'), { recursive: true });
  return d;
}

function rec(over: Partial<RunRecord> = {}): RunRecord {
  return {
    v: 1,
    runId: 'r_aaaaaaaa',
    askId: 'a_aaaaaaaa',
    chatId: 'c1',
    sessionId: null,
    origin: 'maude-chat',
    actor: 'you',
    device: 'mac',
    label: 'Make the headline bigger',
    scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    state: 'running',
    leases: [{ canvas: 'path:.design/ui/C.tsx', artboard: 'P', token: 3 }],
    waiting: [],
    touched: {},
    objects: [],
    createdAt: 1,
    ...over,
  };
}

function registry(over: Partial<RegistryOptions> = {}) {
  const sent: Array<{ runId: string; text: string | null }> = [];
  const published: Array<{ runId: string; partial: boolean; tokens: number[] }> = [];
  const held: string[] = [];
  const reg = createRunRegistry({
    designRoot: null,
    home: over.home ?? createLocalLeaseHome({ actor: 'you' }),
    autoRenew: false,
    turns: { send: (r, text) => void sent.push({ runId: r.runId, text }) },
    stage: {
      publish: (r, o) => {
        published.push({
          runId: r.runId,
          partial: o.partial,
          tokens: o.fence.leases.map((l) => l.token),
        });
        return { status: 'accepted' };
      },
      hold: (r) => void held.push(r.runId),
    },
    ...over,
  });
  return { reg, sent, published, held };
}

describe('the lifecycle reducer — one case per §5.5 row', () => {
  const rows: Array<
    [RunRecord['state'], RunEvent, RunRecord['state'], string | undefined, string[]]
  > = [
    ['waiting', { type: 'granted' }, 'starting', undefined, ['send-turn']],
    ['starting', { type: 'accepted' }, 'running', undefined, ['renew']],
    [
      'running',
      { type: 'ask-permission', question: 'Replace Footer?' },
      'needs-you',
      undefined,
      ['renew'],
    ],
    ['needs-you', { type: 'answered' }, 'running', undefined, ['renew']],
    [
      'running',
      { type: 'turn-end' },
      'ended',
      'done',
      ['confirm', 'publish', 'end-leases', 'continuations'],
    ],
    [
      'needs-you',
      { type: 'turn-end' },
      'ended',
      'done',
      ['confirm', 'publish', 'end-leases', 'continuations'],
    ],
    [
      'running',
      { type: 'stop', by: 'you' },
      'ended',
      'stopped',
      ['cancel-turn', 'confirm', 'publish-partial', 'end-leases'],
    ],
    [
      'needs-you',
      { type: 'stop', by: 'quit' },
      'ended',
      'stopped',
      ['cancel-turn', 'confirm', 'publish-partial', 'end-leases'],
    ],
    ['waiting', { type: 'stop', by: 'quit' }, 'ended', 'stopped', ['end-leases']],
    ['waiting', { type: 'cancel' }, 'ended', 'cancelled', ['end-leases']],
    ['running', { type: 'fail' }, 'ended', 'failed', ['hold', 'end-leases']],
    ['running', { type: 'crash' }, 'ended', 'interrupted', ['hold', 'end-leases']],
    ['waiting', { type: 'crash' }, 'ended', 'interrupted', ['end-leases']],
    [
      'running',
      { type: 'lease-lost' },
      'ended',
      'lease-lost',
      ['cancel-turn', 'hold', 'end-leases'],
    ],
  ];
  for (const [from, ev, to, outcome, effects] of rows)
    test(`${from} --${ev.type}--> ${to}${outcome ? `:${outcome}` : ''}`, () => {
      const r = reduceRun(rec({ state: from, prompt: 'the full prompt' }), ev, 99);
      if ('refused' in r) throw new Error(r.refused);
      expect(r.rec.state).toBe(to);
      expect(r.rec.outcome).toBe(outcome as RunRecord['outcome']);
      expect(r.effects).toEqual(effects as typeof r.effects);
      if (to === 'ended') {
        expect(r.rec.leases).toEqual([]);
        expect(r.rec.prompt).toBeUndefined();
        expect(r.rec.endedAt).toBe(99);
      }
    });

  test('illegal events are refused, never applied', () => {
    expect('refused' in reduceRun(rec({ state: 'ended' }), { type: 'stop', by: 'you' }, 1)).toBe(
      true
    );
    expect('refused' in reduceRun(rec({ state: 'running' }), { type: 'cancel' }, 1)).toBe(true);
    expect('refused' in reduceRun(rec({ state: 'waiting' }), { type: 'turn-end' }, 1)).toBe(true);
    expect('refused' in reduceRun(rec({ state: 'running' }), { type: 'granted' }, 1)).toBe(true);
  });

  test('a quit stops a waiting ask unstarted; Stop by you cancels it', () => {
    const q = reduceRun(rec({ state: 'waiting' }), { type: 'stop', by: 'quit' }, 5);
    const y = reduceRun(rec({ state: 'waiting' }), { type: 'stop', by: 'you' }, 5);
    if ('refused' in q || 'refused' in y) throw new Error('refused');
    expect([q.rec.outcome, q.rec.stoppedBy]).toEqual(['stopped', 'quit']);
    expect(y.rec.outcome).toBe('cancelled');
  });
});

describe('RunPublic never carries prompt, question or doing', () => {
  test('the projection is a whitelist', () => {
    const r = rec({
      state: 'needs-you',
      prompt: 'SECRET-PROMPT',
      question: 'SECRET-QUESTION',
      doing: 'SECRET-DOING',
      sessionId: 'SECRET-SESSION',
      objects: [{ canvas: 'path:.design/ui/C.tsx', artboard: 'P', element: 'footer' }],
    });
    const wire = JSON.stringify(publicRun(r));
    for (const s of ['SECRET-PROMPT', 'SECRET-QUESTION', 'SECRET-DOING', 'SECRET-SESSION', 'c1'])
      expect(wire).not.toContain(s);
    expect(Object.keys(publicRun(r)).sort()).toEqual(
      [
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
      ].sort()
    );
    expect(publicRun(r).state).toBe('needs-you');
    expect(publicRun(rec({ state: 'starting' })).state).toBe('running');
    // your own view keeps the question (the in-app toast) but never the queued prompt
    expect(JSON.stringify(runView(r))).not.toContain('SECRET-PROMPT');
    expect(runView(r).question).toBe('SECRET-QUESTION');
  });
});

describe('the registry over the in-process home', () => {
  test('R7: two of your chats on P and S of one file → two runs, two leases', async () => {
    const { reg } = registry();
    const a = await reg.ask({
      chatId: 'c1',
      origin: 'maude-chat',
      label: 'P',
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
    const b = await reg.ask({
      chatId: 'c2',
      origin: 'maude-chat',
      label: 'S',
      scope: { canvas: 'ui/C.tsx', artboards: ['S'] },
    });
    expect(a.runId).not.toBe(b.runId);
    expect([a.state, b.state]).toEqual(['starting', 'starting']);
    expect(reg.get(a.runId)?.leases.map((l) => l.artboard)).toEqual(['P']);
    expect(reg.get(b.runId)?.leases.map((l) => l.artboard)).toEqual(['S']);
    expect(reg.view().live).toBe(2);
  });

  test('R8: c2 waits behind c1 on P and starts by itself when c1 is done', async () => {
    const { reg, sent, published } = registry();
    const c1 = await reg.ask({
      chatId: 'c1',
      origin: 'maude-chat',
      label: 'Bigger headline',
      prompt: 'p1',
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
    await reg.started(c1.runId);
    const c2 = await reg.ask({
      chatId: 'c2',
      origin: 'maude-chat',
      label: 'Blue button',
      prompt: 'p2',
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
    expect(c2.state).toBe('waiting');
    expect(c2.waiting[0]?.heldBy?.label).toBe('Bigger headline');
    expect(c2.waiting[0]?.position).toBe(1);
    expect(sent.map((s) => s.runId)).toEqual([c1.runId]);
    await reg.turnEnded(c1.runId, 'done');
    expect(published.map((p) => p.runId)).toEqual([c1.runId]);
    expect(reg.get(c2.runId)?.state).toBe('starting');
    expect(sent.map((s) => s.runId)).toEqual([c1.runId, c2.runId]);
    // "on top of c1's result": c1 published before c2's turn was sent
    expect(reg.get(c2.runId)?.leases[0]?.token).toBe(2);
  });

  test('a /design:edit run that waited is RUNNING once granted (its turn is the terminal’s), so its end publishes', async () => {
    // P8 G2 (ai-runs R1): the grant handed to a line started a hook-driven run as `starting` — the state that
    // waits for a bridge to accept a prompt, which a terminal run never has — so its end was refused
    // (`turn-end from starting`), it never published, and it held Post for good.
    const { reg, published } = registry();
    const c1 = await reg.ask({
      chatId: 'c1',
      origin: 'maude-chat',
      label: 'Bigger headline',
      prompt: 'p1',
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
    await reg.started(c1.runId);
    const edit = await reg.ask({
      origin: 'design-edit',
      label: 'Claude edited C',
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
    expect(edit.state).toBe('waiting');
    await reg.turnEnded(c1.runId, 'done');
    expect(reg.get(edit.runId)?.state).toBe('running');
    reg.endNow(edit.runId, 'done');
    await tick();
    expect(reg.get(edit.runId)).toMatchObject({ state: 'ended', outcome: 'done' });
    expect(published.map((p) => p.runId)).toEqual([c1.runId, edit.runId]);
  });

  test('one chat has one active run: a second ask waits behind it, whatever the artboards', async () => {
    const { reg, sent } = registry();
    const r1 = await reg.ask({
      chatId: 'c1',
      origin: 'maude-chat',
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
    const r2 = await reg.ask({
      chatId: 'c1',
      origin: 'maude-chat',
      scope: { canvas: 'ui/C.tsx', artboards: ['S'] },
    });
    expect(r2.state).toBe('waiting');
    expect(r2.behind).toBe(r1.runId);
    await reg.started(r1.runId);
    await reg.turnEnded(r1.runId, 'done');
    expect(reg.get(r2.runId)?.state).toBe('starting');
    expect(sent.map((s) => s.runId)).toEqual([r1.runId, r2.runId]);
  });

  test('ask is idempotent by askId (the outbox release)', async () => {
    const { reg } = registry();
    const a = await reg.ask({
      askId: 'a_outbox01',
      chatId: 'c1',
      origin: 'maude-chat',
      scope: null,
    });
    const b = await reg.ask({
      askId: 'a_outbox01',
      chatId: 'c1',
      origin: 'maude-chat',
      scope: null,
    });
    expect(b.runId).toBe(a.runId);
    expect(reg.view().mine).toHaveLength(1);
  });

  test('R6: a whole-canvas ask with two artboards busy runs on the 13 free; each busy one continues by itself', async () => {
    const home = createLocalLeaseHome({ actor: 'you' });
    const ids = Array.from({ length: 15 }, (_, i) => `a${i + 1}`);
    const mine = registry({ home, artboardsOf: () => ids });
    const tereza = registry({ home, device: 'tereza-mac' });
    const c0 = await mine.reg.ask({
      chatId: 'c0',
      origin: 'maude-chat',
      label: 'yours',
      scope: { canvas: 'ui/C.tsx', artboards: ['a2'] },
    });
    const t = await tereza.reg.ask({
      chatId: 't1',
      origin: 'maude-chat',
      label: 'Tereza',
      scope: { canvas: 'ui/C.tsx', artboards: ['a7'] },
    });
    await mine.reg.started(c0.runId);
    await tereza.reg.started(t.runId);
    const whole = await mine.reg.ask({
      chatId: 'c1',
      origin: 'maude-chat',
      label: 'Retheme',
      scope: { canvas: 'ui/C.tsx', artboards: '*' },
    });
    expect(whole.state).toBe('starting');
    expect(mine.reg.get(whole.runId)?.leases).toHaveLength(13);
    expect(mine.reg.get(whole.runId)?.deferred?.map((k) => k.artboard)).toEqual(['a2', 'a7']);
    await mine.reg.started(whole.runId);
    await mine.reg.turnEnded(whole.runId, 'done');
    // one continuation per busy key; the chat's line keeps them one at a time
    const conts = mine.reg.view().mine.filter((r) => r.continuationOf === whole.runId);
    expect(conts).toHaveLength(2);
    expect(conts.every((r) => r.state === 'waiting')).toBe(true);
    // c0 frees a2 → the first continuation starts with a generated turn, no click
    await mine.reg.turnEnded(c0.runId, 'done');
    const first = conts[0]?.runId as string;
    expect(mine.reg.get(first)?.state).toBe('starting');
    expect(mine.sent.find((s) => s.runId === first)?.text).toBe(
      'a2 is free now — make the same change there.'
    );
    await mine.reg.started(first);
    await mine.reg.turnEnded(first, 'done');
    const second = conts[1]?.runId as string;
    expect(mine.reg.get(second)?.state).toBe('waiting');
    // Tereza ends on her Mac; this Mac hears it on its next pull
    await tereza.reg.turnEnded(t.runId, 'done');
    await mine.reg.pull();
    expect(mine.reg.get(second)?.state).toBe('starting');
    expect(mine.sent.find((s) => s.runId === second)?.text).toBe(
      'a7 is free now — make the same change there.'
    );
  });

  test('R12: Keep going while the artboard is busy waits in line, as a new run resumeOf', async () => {
    const home = createLocalLeaseHome({ actor: 'you' });
    const { reg } = registry({ home });
    const other = registry({ home, device: 'other' });
    const r1 = await reg.ask({
      chatId: 'c1',
      origin: 'maude-chat',
      label: 'L',
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
    await reg.started(r1.runId);
    await reg.stop(r1.runId, 'quit');
    const o = await other.reg.ask({
      chatId: 'o1',
      origin: 'maude-chat',
      label: 'Other',
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
    expect(o.state).toBe('starting');
    const kg = await reg.keepGoing(r1.runId);
    expect(kg?.resumeOf).toBe(r1.runId);
    expect(kg?.state).toBe('waiting');
    expect(kg?.chatId).toBe('c1');
    expect(await reg.keepGoing(o.runId)).toBe(null); // not ours / not ended
  });

  test('stop-all (quit) with 2 running + 1 waiting: 2 partial publishes, the waiting ask stopped unstarted, 0 leases', async () => {
    const home = createLocalLeaseHome({ actor: 'you' });
    const { reg, published } = registry({ home });
    const a = await reg.ask({
      chatId: 'c1',
      origin: 'maude-chat',
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
    const b = await reg.ask({
      chatId: 'c2',
      origin: 'maude-chat',
      scope: { canvas: 'ui/C.tsx', artboards: ['S'] },
    });
    const w = await reg.ask({
      chatId: 'c3',
      origin: 'maude-chat',
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
    await reg.started(a.runId);
    await reg.started(b.runId);
    expect(reg.view().live).toBe(3);
    expect(await reg.stopAll('quit')).toEqual({ stopped: 3, published: 2 });
    expect(published.every((p) => p.partial)).toBe(true);
    expect(reg.get(w.runId)).toMatchObject({
      state: 'ended',
      outcome: 'stopped',
      stoppedBy: 'quit',
    });
    expect(reg.get(a.runId)?.stoppedBy).toBe('quit');
    const list = await home.list();
    expect(list.refused ? [] : list.runs).toEqual([]);
  });
});

describe('records on disk and the boot crash scan', () => {
  test('a record is written tmp + rename before the home call', async () => {
    const root = tmpRoot();
    const calls: string[] = [];
    const inner = createLocalLeaseHome({ actor: 'you' });
    const home: LeaseHome = {
      ...inner,
      begin: (b) => {
        calls.push(
          existsSync(path.join(root, '.design', '_state', 'runs', `${b.runId}.json`))
            ? 'on-disk'
            : 'missing'
        );
        return inner.begin(b);
      },
    };
    const { reg } = registry({ home, designRoot: path.join(root, '.design') });
    await reg.ask({
      chatId: 'c1',
      origin: 'maude-chat',
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
    expect(calls).toEqual(['on-disk']);
    expect(
      readdirSync(path.join(root, '.design', '_state', 'runs')).filter((n) => n.endsWith('.tmp'))
    ).toEqual([]);
  });

  test('R11: kill -9 mid-run → the next boot ends it interrupted, holds its stage, frees the line', async () => {
    const root = tmpRoot();
    const designRoot = path.join(root, '.design');
    const first = registry({ designRoot });
    const r = await first.reg.ask({
      chatId: 'c1',
      origin: 'maude-chat',
      label: 'L',
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
    await first.reg.started(r.runId);
    // no stop, no end: the process is gone
    const ended: string[] = [];
    const inner = createLocalLeaseHome({ actor: 'you' });
    const second = registry({
      designRoot,
      home: { ...inner, end: (id, o) => (ended.push(`${id}:${o}`), inner.end(id, o)) },
    });
    const out = await second.reg.boot();
    expect(out.interrupted).toEqual([r.runId]);
    expect(second.reg.get(r.runId)).toMatchObject({
      state: 'ended',
      outcome: 'interrupted',
      stoppedBy: 'crash',
    });
    expect(second.held).toEqual([r.runId]);
    expect(ended).toEqual([`${r.runId}:interrupted`]);
    const disk = JSON.parse(
      readFileSync(path.join(designRoot, '_state', 'runs', `${r.runId}.json`), 'utf8')
    );
    expect(disk.outcome).toBe('interrupted');
    second.reg.close();
  });

  test('retention: ended records past 30 days are pruned, except each chat’s latest', async () => {
    const root = tmpRoot();
    const designRoot = path.join(root, '.design');
    let t = 1_000;
    const a = registry({ designRoot, now: () => t });
    const old1 = await a.reg.ask({ chatId: 'c1', origin: 'maude-chat', scope: null });
    await a.reg.started(old1.runId);
    await a.reg.turnEnded(old1.runId, 'done');
    t += 10;
    const old2 = await a.reg.ask({ chatId: 'c1', origin: 'maude-chat', scope: null });
    await a.reg.started(old2.runId);
    await a.reg.turnEnded(old2.runId, 'done');
    t += 31 * 24 * 60 * 60 * 1000;
    const b = registry({ designRoot, now: () => t });
    await b.reg.boot();
    expect(b.reg.get(old1.runId)).toBe(null);
    expect(b.reg.get(old2.runId)?.outcome).toBe('done');
    b.reg.close();
  });
});

describe('the hub unreachable mid-run (§5.6)', () => {
  test('a claim past its budget is provisional; a failed CAS before publish → lease-lost, stage held, nothing published', async () => {
    const inner = createLocalLeaseHome({ actor: 'you' });
    let away = false;
    const cas: Array<Record<string, number> | undefined> = [];
    const home: LeaseHome = {
      ...inner,
      kind: 'hub',
      claim: async (id, b, budget) => {
        if (b.expectFence) {
          cas.push(b.expectFence);
          return {
            granted: [],
            busy: b.keys.map((k) => ({
              ...k,
              position: null,
              heldBy: null,
              fenced: true as const,
            })),
          };
        }
        return away ? { refused: 'unreachable' } : inner.claim(id, b, budget);
      },
    };
    const { reg, published, held } = registry({ home });
    const r = await reg.ask({
      chatId: 'c1',
      origin: 'maude-chat',
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
    await reg.started(r.runId);
    away = true;
    const c = await reg.claim(r.runId, [{ canvas: 'path:.design/ui/C.tsx', artboard: 'S' }]);
    expect(c.provisional).toBe(true);
    expect(reg.get(r.runId)?.leases.find((l) => l.artboard === 'S')?.provisional).toBe(true);
    await reg.turnEnded(r.runId, 'done');
    expect(cas).toEqual([{ 'path:.design/ui/C.tsx|S': 0 }]);
    expect(reg.get(r.runId)?.outcome).toBe('lease-lost');
    expect(published).toEqual([]);
    expect(held).toEqual([r.runId]);
  });
});

describe('S5: a linked hub without runs-v1', () => {
  test('per-Mac leases and the Diagnostics line', () => {
    const linked = { hubUrl: 'https://hub.example', token: () => 't' };
    const old = selectLeaseHome({ actor: 'you', linked, capabilities: ['ledger'] });
    expect(old.home.kind).toBe('local');
    expect(old.diagnostics).toBe(OLD_HUB_LINE);
    expect(selectLeaseHome({ actor: 'you', linked, capabilities: ['runs-v1'] }).home.kind).toBe(
      'hub'
    );
    const solo = selectLeaseHome({ actor: 'you', linked: null, capabilities: null });
    expect([solo.home.kind, solo.diagnostics]).toEqual(['local', null]);
    const { reg } = registry({ home: old.home, diagnostics: old.diagnostics });
    expect(reg.diagnostics()).toEqual({ leaseHome: 'local', line: OLD_HUB_LINE });
  });
});

describe('/_api/ai/runs* and the v1 /_api/ai routes (routes/ai.ts)', () => {
  function table(over: Partial<Parameters<typeof createAiRoutes>[0]> = {}) {
    const root = tmpRoot();
    const events: Array<[string, unknown]> = [];
    const { reg } = registry({ emit: (e, p) => void events.push([e, p]) });
    const specs = createAiRoutes({ registry: reg, repoRoot: root, designRel: '.design', ...over });
    const call = async (method: 'GET' | 'POST', url: string, body?: unknown) => {
      const m = matchRoute(specs, method, url);
      if (!m) throw new Error(`no route ${method} ${url}`);
      const res = await m.spec.handle(
        new Request(`http://localhost${url}`, {
          method,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        }),
        m.params
      );
      const text = await res.text();
      let j: unknown = text;
      try {
        j = JSON.parse(text);
      } catch {
        /* text answer */
      }
      return { status: res.status, body: j as Record<string, unknown> };
    };
    return { reg, specs, call, events };
  }

  test('GET /_api/ai/runs: mine / others / needsYou / live, main origin only', async () => {
    const { reg, call, specs } = table();
    const r = await reg.ask({
      chatId: 'c1',
      origin: 'maude-chat',
      prompt: 'SECRET',
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
    await reg.started(r.runId);
    await reg.needsYou(r.runId, 'Replace Footer?');
    const res = await call('GET', '/_api/ai/runs');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ needsYou: 1, live: 1, others: [] });
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
    expect(
      specs.filter((s) => s.path.startsWith('/_api/ai/runs')).every((s) => s.origin === 'main')
    ).toBe(true);
  });

  test('stop / cancel / keep-going / stop-all answer by state', async () => {
    const { reg, call } = table();
    const r = await reg.ask({
      chatId: 'c1',
      origin: 'maude-chat',
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
    const w = await reg.ask({
      chatId: 'c2',
      origin: 'maude-chat',
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
    expect((await call('POST', `/_api/ai/runs/${r.runId}/cancel`)).status).toBe(409);
    expect((await call('POST', `/_api/ai/runs/${w.runId}/cancel`)).body).toMatchObject({
      run: { outcome: 'cancelled' },
    });
    expect((await call('POST', `/_api/ai/runs/${r.runId}/stop`)).body).toMatchObject({
      run: { outcome: 'stopped' },
    });
    const kg = await call('POST', `/_api/ai/runs/${r.runId}/keep-going`);
    expect(kg.body).toMatchObject({ run: { resumeOf: r.runId } });
    expect((await call('POST', '/_api/ai/runs/r_nosuchrun/stop')).status).toBe(404);
    expect((await call('POST', '/_api/ai/runs/nope/stop')).status).toBe(400);
    expect((await call('POST', '/_api/ai/runs/stop-all', { reason: 'later' })).status).toBe(400);
    expect((await call('POST', '/_api/ai/runs/stop-all', { reason: 'close-tab' })).body).toEqual({
      stopped: 1,
      published: 1,
    });
  });

  test('S6: the v1 /design:edit curl — start holds the selected artboard and shows a ring; heartbeat; end', async () => {
    const actions: string[] = [];
    const { reg, call, events } = table({
      selectedArtboard: () => 'hero',
      beginAction: (k, n) => void actions.push(`begin ${k} ${n}`),
      endAction: async (k, o) => (actions.push(`end ${k} ${o}`), { actionId: 'x' }),
    });
    const start = await call('POST', '/_api/ai/start', {
      file: '.design/ui/C.tsx',
      author: 'Claude',
    });
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ file: '.design/ui/C.tsx', author: 'Claude' });
    const run = reg.live()[0] as RunRecord;
    expect(run).toMatchObject({
      origin: 'design-edit',
      scope: { canvas: 'ui/C.tsx', artboards: ['hero'] },
    });
    expect(run.leases.map((l) => l.artboard)).toEqual(['hero']);
    const banner = await call('GET', '/_api/ai');
    expect((banner.body.entries as Array<{ file: string }>).map((e) => e.file)).toEqual([
      '.design/ui/C.tsx',
    ]);
    expect(events.some(([e, p]) => e === 'ai-activity' && (p as { entry: unknown }).entry)).toBe(
      true
    );
    // a second start on the same file is the same run
    await call('POST', '/_api/ai/start', { file: '.design/ui/C.tsx' });
    expect(reg.live()).toHaveLength(1);
    expect((await call('POST', '/_api/ai/heartbeat', { file: '.design/ui/C.tsx' })).status).toBe(
      200
    );
    const end = await call('POST', '/_api/ai/end', { file: '.design/ui/C.tsx' });
    expect(end.body).toEqual({ cleared: true, action: { actionId: 'x' } });
    expect(reg.get(run.runId)?.outcome).toBe('done');
    expect((await call('POST', '/_api/ai/heartbeat', { file: '.design/ui/C.tsx' })).status).toBe(
      404
    );
    await tick();
    expect(events.filter(([e]) => e === 'ai-activity').at(-1)?.[1]).toEqual({
      file: '.design/ui/C.tsx',
      entry: null,
    });
    expect(actions).toEqual([
      'begin edit:.design/ui/C.tsx Claude edited C',
      'end edit:.design/ui/C.tsx done',
    ]);
  });

  test('v1 start without a selection is lazy: the run holds nothing until an edit claims', async () => {
    const { reg, call } = table({ selectedArtboard: () => null });
    await call('POST', '/_api/ai/start', { file: '.design/ui/C.tsx' });
    expect(reg.live()[0]?.leases).toEqual([]);
    expect(reg.live()[0]?.state).toBe('running');
    expect((await call('POST', '/_api/ai/start', { file: '../x.tsx' })).status).toBe(400);
  });

  test('GET /_api/ai keeps the ACP chat’s own entries until S5.6', async () => {
    const { call } = table({
      legacyEntries: () => [
        { file: '.design/ui/Chat.tsx', author: 'Maude', startedAt: 1, lastHeartbeat: 1 },
      ],
    });
    const res = await call('GET', '/_api/ai');
    expect((res.body.entries as Array<{ file: string }>).map((e) => e.file)).toEqual([
      '.design/ui/Chat.tsx',
    ]);
  });

  test('every change emits ai:runs {seq}', async () => {
    const { reg, events } = table();
    await reg.ask({ chatId: 'c1', origin: 'maude-chat', scope: null });
    const seqs = events.filter(([e]) => e === 'ai:runs').map(([, p]) => (p as { seq: number }).seq);
    expect(seqs.length).toBeGreaterThan(0);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(reg.view().seq).toBe(seqs.at(-1) as number);
  });
});
