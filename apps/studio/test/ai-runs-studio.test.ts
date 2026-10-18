// S5.3 — the run registry wired into a REAL studio boot (MAUDE_NO_AUTOBUILD, NO_OPEN).
// test/ai-runs-registry.test.ts drives the registry and routes/ai.ts with injected deps; this
// pins what server.ts + http.ts mount: `/_api/ai/runs*` and the v1 `/_api/ai` routes come from
// the table on ONE registry (the legacy http.ts keys are gone), records land in `_state/runs/`,
// a kill -9 mid-run comes back `interrupted` at the next boot (R11), the shell socket hears
// `ai:runs`, and the canvas origin reaches `GET /_api/ai` but never `/_api/ai/runs`.

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Subprocess } from 'bun';

import {
  activitySnapshot,
  registerActivityProbe,
  registerLiveRuns,
  registerRunningChatsProbe,
  runningChats,
} from '../acp/running.ts';
import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry } from '../ai/runs.ts';
import { type CtlProviderLike, createCtlProvider } from '../sync/ctl-provider.ts';
import { parseRunsPoke } from '../sync/poke.ts';
import { bootServer, killProc, makeSandbox, nextPort, type Sandbox } from './_helpers.ts';

let box: Sandbox | null = null;
let proc: Subprocess | null = null;
afterEach(async () => {
  if (proc) await killProc(proc);
  if (box) rmSync(box.root, { recursive: true, force: true });
  proc = null;
  box = null;
});

const CARD =
  'export default function C() {\n  return <><DCArtboard id="a1" width={10} height={10} /><DCArtboard id="a2" width={10} height={10} /></>;\n}\n';
const ENV = { MAUDE_NO_AUTOBUILD: '1', NO_OPEN: '1' };
// biome-ignore lint/suspicious/noExplicitAny: the routes' JSON, read loosely by the assertions
type Json = any;

async function start(existing?: Sandbox) {
  box = existing ?? makeSandbox();
  if (!existing) writeFileSync(path.join(box.designRoot, 'ui', 'card.tsx'), CARD);
  const port = nextPort();
  proc = await bootServer(box.root, port, ENV);
  const base = `http://localhost:${port}`;
  const post = async (p: string, body: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(`${base}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => null)) as Record<string, Json> };
  };
  const get = async (p: string) => (await (await fetch(`${base}${p}`)).json()) as Json;
  return { base, port, post, get };
}

const runFiles = () => {
  const dir = path.join(box?.designRoot ?? '', '_state', 'runs');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
};

describe('acp/running reads the registry, unioned with the bridge until S5.6', () => {
  afterEach(() => {
    registerLiveRuns(null);
    registerRunningChatsProbe(() => []);
    registerActivityProbe(() => []);
  });

  test('runningChats() / activitySnapshot() see a registry run the bridge has not', async () => {
    const t = 1_000;
    const reg = createRunRegistry({
      designRoot: null,
      home: createLocalLeaseHome({ actor: 'you', now: () => t }),
      now: () => t,
      autoRenew: false,
    });
    registerLiveRuns(() => reg.live());
    registerRunningChatsProbe(() => ['c-bridge']);
    registerActivityProbe(() => [{ chatId: 'c-bridge', state: 'running' }]);

    const a = await reg.ask({
      origin: 'maude-chat',
      chatId: 'c1',
      scope: { canvas: 'ui/a.tsx', artboards: ['P'] },
    });
    await reg.started(a.runId);
    // a second chat waiting behind c1 on P: it counts for the branch switch, it is no activity
    await reg.ask({
      origin: 'maude-chat',
      chatId: 'c2',
      scope: { canvas: 'ui/a.tsx', artboards: ['P'] },
    });
    expect(runningChats().sort()).toEqual(['c-bridge', 'c1', 'c2']);
    const snap = activitySnapshot();
    expect(snap.chats.sort((x, y) => x.chatId.localeCompare(y.chatId))).toEqual([
      { chatId: 'c-bridge', state: 'running' },
      { chatId: 'c1', state: 'running' },
    ]);

    await reg.needsYou(a.runId, 'May I?');
    const s2 = activitySnapshot();
    expect(s2.chats.find((c) => c.chatId === 'c1')?.state).toBe('awaiting-input');
    expect(s2.seq).toBeGreaterThan(snap.seq);

    // the bridge's busier state wins for a chat both know about
    registerActivityProbe(() => [{ chatId: 'c1', state: 'running' }]);
    expect(activitySnapshot().chats.find((c) => c.chatId === 'c1')?.state).toBe('awaiting-input');

    // a run that ended is gone from both
    await reg.stop(a.runId);
    expect(runningChats()).not.toContain('c1');
    reg.close();
  });

  test('a throwing registry probe answers with the bridge alone, never a throw', () => {
    registerLiveRuns(() => {
      throw new Error('boom');
    });
    registerRunningChatsProbe(() => ['c-bridge']);
    expect(runningChats()).toEqual(['c-bridge']);
  });
});

describe("the hub's {t:'runs', seq} on the control channel", () => {
  test('parseRunsPoke accepts only a runs frame with a whole seq', () => {
    expect(parseRunsPoke(JSON.stringify({ t: 'runs', seq: 7 }))).toBe(7);
    expect(parseRunsPoke(JSON.stringify({ t: 'files', head: 7 }))).toBeNull();
    expect(parseRunsPoke(JSON.stringify({ t: 'runs', seq: -1 }))).toBeNull();
    expect(parseRunsPoke(JSON.stringify({ t: 'runs', seq: 1.5 }))).toBeNull();
    expect(parseRunsPoke('garbage')).toBeNull();
    expect(parseRunsPoke(JSON.stringify({ t: 'runs', seq: 1, pad: 'x'.repeat(600) }))).toBeNull();
  });

  test('a runs frame reaches onRuns — not onPoke, and not counted malformed', async () => {
    const handlers = new Map<string, (d: unknown) => void>();
    const provider: CtlProviderLike = {
      on: ((event: string, cb: (d: unknown) => void) => {
        handlers.set(event, cb);
      }) as CtlProviderLike['on'],
      destroy() {},
    };
    const heads: number[] = [];
    const seqs: number[] = [];
    const ctl = createCtlProvider({
      url: 'http://127.0.0.1:1',
      token: 't',
      onPoke: (h) => heads.push(h),
      onRuns: (seq) => seqs.push(seq),
      log: { log() {}, warn() {}, error() {} },
      connect: () => provider,
    });
    await Promise.resolve();
    await Promise.resolve();
    const emit = (payload: string) => handlers.get('stateless')?.({ payload });
    emit(JSON.stringify({ t: 'runs', seq: 4 }));
    emit(JSON.stringify({ t: 'files', head: 9 }));
    expect(seqs).toEqual([4]);
    expect(heads).toEqual([9]);
    expect(ctl.malformed()).toBe(0);
    expect(ctl.received()).toBe(1);
    ctl.stop();
  });
});

describe('the run registry in a running studio (S5.3)', () => {
  test('v1 /design:edit curl → a design-edit run on the registry, a derived banner, records on disk', async () => {
    const { post, get } = await start();
    const s = await post('/_api/ai/start', { file: '.design/ui/card.tsx', author: 'Claude' });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ file: '.design/ui/card.tsx', author: 'Claude' });

    const runs = await get('/_api/ai/runs');
    expect(runs.live).toBe(1);
    expect(runs.mine[0]).toMatchObject({ origin: 'design-edit', scope: { canvas: 'ui/card.tsx' } });
    expect(runs.mine[0].prompt).toBeUndefined();
    expect(runs.diagnostics).toMatchObject({ leaseHome: 'local', line: null });
    expect((await get('/_api/ai')).entries.map((e: { file: string }) => e.file)).toEqual([
      '.design/ui/card.tsx',
    ]);
    expect(runFiles().length).toBe(1);

    expect((await post('/_api/ai/heartbeat', { file: '.design/ui/card.tsx' })).status).toBe(200);
    const e = await post('/_api/ai/end', { file: '.design/ui/card.tsx' });
    expect(e).toMatchObject({ status: 200, body: { cleared: true } });
    expect((await get('/_api/ai')).entries).toEqual([]);
    expect((await get('/_api/ai/runs')).live).toBe(0);
  }, 60_000);

  test('the moved POSTs keep the CSRF guard: a cross-origin start is refused', async () => {
    const { post, get } = await start();
    const r = await post(
      '/_api/ai/start',
      { file: '.design/ui/card.tsx' },
      { origin: 'http://evil.example' }
    );
    expect(r.status).toBe(403);
    expect((await get('/_api/ai/runs')).live).toBe(0);
  }, 60_000);

  test('R11 end to end: kill -9 mid-run → the next boot ends it interrupted', async () => {
    const first = await start();
    expect((await first.post('/_api/ai/start', { file: '.design/ui/card.tsx' })).status).toBe(200);
    const sandbox = box as Sandbox;
    proc?.kill(9);
    await proc?.exited;
    proc = null;

    const again = await start(sandbox);
    const runs = await again.get('/_api/ai/runs');
    expect(runs.live).toBe(0);
    expect(runs.mine).toHaveLength(1);
    expect(runs.mine[0]).toMatchObject({
      state: 'ended',
      outcome: 'interrupted',
      stoppedBy: 'crash',
    });
    const rec = JSON.parse(
      readFileSync(path.join(sandbox.designRoot, '_state', 'runs', runFiles()[0] as string), 'utf8')
    );
    expect(rec.outcome).toBe('interrupted');
    // the banner never comes back for a crashed run
    expect((await again.get('/_api/ai')).entries).toEqual([]);
  }, 90_000);

  test('the shell socket hears {type:"ai:runs", seq} on a change', async () => {
    const { port, post } = await start();
    const ws = new WebSocket(`ws://localhost:${port}/_ws`);
    const frames: Array<Record<string, unknown>> = [];
    ws.onmessage = (m) => {
      try {
        frames.push(JSON.parse(String(m.data)));
      } catch {
        /* not JSON */
      }
    };
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('ws error'));
    });
    await post('/_api/ai/start', { file: '.design/ui/card.tsx' });
    const deadline = Date.now() + 5_000;
    while (!frames.some((f) => f.type === 'ai:runs') && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 50));
    ws.close();
    const hit = frames.find((f) => f.type === 'ai:runs');
    expect(hit).toBeDefined();
    expect(typeof hit?.seq).toBe('number');
    expect(Object.keys(hit ?? {}).sort()).toEqual(['seq', 'type']);
  }, 60_000);

  test('the canvas origin reaches GET /_api/ai, never /_api/ai/runs', async () => {
    const { get } = await start();
    const server = JSON.parse(
      readFileSync(path.join(box?.designRoot ?? '', '_server.json'), 'utf8')
    );
    const canvas = String(server.canvasOrigin ?? '').replace(/\/+$/, '');
    expect(canvas).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
    expect((await fetch(`${canvas}/_api/ai`)).status).toBe(200);
    expect((await fetch(`${canvas}/_api/ai/runs`)).status).not.toBe(200);
    expect(
      (await fetch(`${canvas}/_api/ai/runs/stop-all`, { method: 'POST', body: '{}' })).status
    ).not.toBe(200);
    // the main origin still answers it
    expect((await get('/_api/ai/runs')).seq).toBeGreaterThanOrEqual(0);
  }, 60_000);
});
