// S5.4 — `maude design runs list|stop` (contract V2-1.15 §5.10). `list` lets a terminal Claude
// see the busy artboards before it plans (effect none → auto); `stop` stops one of YOUR runs on
// this Mac (effect project → auto) and refuses a member's. Never a prompt, a question or `doing`.

import { afterEach, describe, expect, test } from 'bun:test';

import { fakeStudio, json, type Seen } from './_fake-studio.ts';

const KEY = 'path:.design/ui/C.tsx';
const VIEW = {
  seq: 4,
  needsYou: 1,
  live: 3,
  mine: [
    {
      runId: 'r_mine00000001',
      askId: 'a_mine00000001',
      chatId: 'chat-a',
      origin: 'maude-chat',
      actor: 'you',
      label: 'Hero variants',
      question: 'QUESTION-SECRET',
      doing: 'DOING-SECRET',
      scope: { canvas: 'ui/C.tsx', artboards: ['hero'] },
      state: 'running',
      leases: [{ canvas: KEY, artboard: 'hero', token: 3 }],
      waiting: [],
      touched: {},
      objects: [],
      createdAt: 1,
    },
    {
      runId: 'r_mine00000002',
      askId: 'a_mine00000002',
      chatId: 'chat-b',
      origin: 'maude-chat',
      actor: 'you',
      label: 'Footer',
      scope: { canvas: 'ui/Other.tsx', artboards: ['foot'] },
      state: 'waiting',
      leases: [],
      waiting: [
        { canvas: 'path:.design/ui/Other.tsx', artboard: 'foot', position: 1, heldBy: null },
      ],
      touched: {},
      objects: [],
      createdAt: 2,
    },
    {
      runId: 'r_mine00000003',
      askId: 'a_mine00000003',
      chatId: null,
      origin: 'claude-code',
      actor: 'you',
      label: '',
      scope: null,
      state: 'ended',
      outcome: 'done',
      leases: [],
      waiting: [],
      touched: {},
      objects: [],
      createdAt: 0,
    },
  ],
  others: [
    {
      runId: 'r_tereza00001',
      askId: 'a_tereza00001',
      actor: 'Tereza',
      origin: 'maude-chat',
      label: 'Pricing\u001b]0;pwned\u0007 table',
      state: 'needs-you',
      artboards: [{ canvas: KEY, artboard: 'pricing' }],
      waitingFor: [],
      objects: [],
      since: 1,
    },
  ],
};

let stopped: string[] = [];
const handler = (s: Seen) => {
  if (s.method === 'GET' && s.path === '/_api/ai/runs') return json(VIEW);
  const m = /^\/_api\/ai\/runs\/(r_[A-Za-z0-9_-]+)\/stop$/.exec(s.path);
  if (s.method === 'POST' && m) {
    stopped.push(m[1] as string);
    return json({ run: { runId: m[1], state: 'ended' } });
  }
};

let studio: ReturnType<typeof fakeStudio> | null = null;
afterEach(() => {
  studio?.stop();
  studio = null;
  stopped = [];
});

describe('maude design runs list', () => {
  test('--json: every live run, yours and the members’, with the artboards each holds', async () => {
    studio = fakeStudio(handler);
    const r = await studio.run('runs', ['list', '--json'], { MAUDE_CHAT_ID: 'chat-a' });
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.untrusted).toBe(true);
    expect(out.runs.map((x: { runId: string }) => x.runId)).toEqual([
      'r_mine00000001',
      'r_mine00000002',
      'r_tereza00001',
    ]);
    expect(out.runs[0]).toMatchObject({
      mine: true,
      state: 'running',
      canvas: 'ui/C.tsx',
      artboards: [{ canvas: 'ui/C.tsx', artboard: 'hero' }],
      thisChat: true,
    });
    expect(out.runs[1].waitingFor).toEqual([{ canvas: 'ui/Other.tsx', artboard: 'foot' }]);
    expect(out.runs[2]).toMatchObject({ mine: false, who: 'Tereza', state: 'needs-you' });
    // never the question or what a run is doing
    expect(r.stdout).not.toContain('QUESTION-SECRET');
    expect(r.stdout).not.toContain('DOING-SECRET');
    expect(studio.seen.map((s) => `${s.method} ${s.path}`)).toEqual(['GET /_api/ai/runs']);
  });

  test('text: busy artboards per run, peer text inside the untrusted block, control characters out', async () => {
    studio = fakeStudio(handler);
    const r = await studio.run('runs', ['list']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('r_mine00000001  yours  running  changing ui/C.tsx › hero');
    expect(r.stdout).toContain("r_tereza00001  Tereza's  needs-you  changing ui/C.tsx › pricing");
    expect(r.stdout).toContain('waiting for ui/Other.tsx › foot');
    expect(r.stdout).toMatch(/<<<BEGIN UNTRUSTED DATA [0-9a-f]{16}\n/);
    expect(r.stdout).not.toContain('\u001b');
    expect(r.stdout).not.toContain('(this chat)');
    expect(r.stdout).not.toContain('r_mine00000003'); // ended
  });

  test('--canvas keeps the runs on that canvas', async () => {
    studio = fakeStudio(handler);
    const r = await studio.run('runs', ['list', '--canvas', 'ui/Other.tsx', '--json']);
    expect(JSON.parse(r.stdout).runs.map((x: { runId: string }) => x.runId)).toEqual([
      'r_mine00000002',
    ]);
    const none = await studio.run('runs', ['list', '--canvas', 'ui/Nope.tsx']);
    expect(none.stdout).toContain('every artboard is free');
    expect((await studio.run('runs', ['list', '--canvas', '../x.tsx'])).code).toBe(2);
  });
});

describe('maude design runs stop', () => {
  test('stops one of your live runs', async () => {
    studio = fakeStudio(handler);
    const r = await studio.run('runs', ['stop', 'r_mine00000001']);
    expect(r.code).toBe(0);
    expect(stopped).toEqual(['r_mine00000001']);
  });

  test('a member’s run, an ended run or an unknown id is refused before any POST', async () => {
    studio = fakeStudio(handler);
    for (const id of ['r_tereza00001', 'r_mine00000003', 'r_nope0000000'])
      expect((await studio.run('runs', ['stop', id])).code).toBe(1);
    expect(stopped).toEqual([]);
    const usage = await studio.run('runs', ['stop', '../x']);
    expect(usage.code).toBe(2);
    expect((await studio.run('runs', ['kill', 'r_mine00000001'])).code).toBe(2);
    expect(studio.seen.filter((s) => s.method === 'POST')).toEqual([]);
  });
});
