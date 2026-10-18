// S5.6 — the ACP chat turn moves onto the run registry (V2-1.15 §5.4–5.5).
//
// `prompt {askId, scope}` → `registry.ask` BEFORE `bridge.prompt`: the turn goes out only once the
// run is `starting`; a busy artboard keeps the ask waiting and it starts by itself when freed;
// one chat has one active run (chat-level FIFO); the same askId — or the same text within 2 s from
// an old client — is one ask; `{t:'run'}` frames follow every change; a permission makes the run
// Needs you; Stop goes through the registry; Keep going resumes the chat's session.
//
// Red first: before S5.6 `createAcp` takes no registry — every prompt reaches the bridge at once.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerWebSocket } from 'bun';

import { createAcp, parseRunScope } from '../acp/index.ts';
import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry } from '../ai/runs.ts';
import { type Context, createBus } from '../context.ts';
import type { WsData } from '../ws.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'mock-acp-agent.mjs');
const FIXTURE_PERM = join(import.meta.dir, 'fixtures', 'mock-acp-agent-permission.mjs');
const FIXTURE_SLOW = join(import.meta.dir, 'fixtures', 'mock-acp-agent-slow.mjs');
const TEST_ENV_KEYS = ['MAUDE_ACP_ADAPTER_ENTRY', 'MAUDE_ACP_RUNTIME', 'MAUDE_CLAUDE_BIN'];

function useMockAgent(fixture = FIXTURE) {
  process.env.MAUDE_ACP_ADAPTER_ENTRY = fixture;
  process.env.MAUDE_ACP_RUNTIME = process.execPath;
  process.env.MAUDE_CLAUDE_BIN = process.execPath;
}

const dirs: string[] = [];
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  for (const key of TEST_ENV_KEYS) delete process.env[key];
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function until<T>(fn: () => T | undefined, timeoutMs = 15000): Promise<T> {
  const start = performance.now();
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (performance.now() - start > timeoutMs) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeWs(id: string) {
  const frames: Array<Record<string, unknown>> = [];
  const ws = {
    data: { id } as WsData,
    send: (raw: string) => {
      frames.push(JSON.parse(raw));
    },
  } as unknown as ServerWebSocket<WsData>;
  return { ws, frames };
}

function rig() {
  const root = mkdtempSync(join(tmpdir(), 'maude-acp-runs-'));
  dirs.push(root);
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, '_chat'), { recursive: true });
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(join(designRoot, 'ui', 'a.tsx'), 'export default () => null;\n');
  const bus = createBus();
  const ctx = {
    paths: { repoRoot: root, designRoot, designRel: '.design' },
    bus,
  } as unknown as Context;
  let acpRef: ReturnType<typeof createAcp> | null = null;
  const runs = createRunRegistry({
    designRoot,
    designRel: '.design',
    home: createLocalLeaseHome({ actor: 'you' }),
    autoRenew: false,
    emit: (e, p) => bus.emit(e, p),
    turns: {
      send: (r, t) => acpRef?.sendTurn(r, t),
      cancel: (r) => acpRef?.cancelTurn(r),
    },
  });
  const acp = createAcp(ctx, undefined, { runs });
  acpRef = acp;
  cleanups.push(() => {
    acp.stopAll();
    runs.close();
  });
  return { ctx, runs, acp, designRoot };
}

const SCOPE = { canvas: 'ui/a.tsx', artboards: ['post'] };
const agentText = (frames: Array<Record<string, unknown>>) =>
  frames
    .filter((f) => f.t === 'update')
    .map((f) => (f.update as { content?: { text?: string } })?.content?.text ?? '')
    .join('');
const runFrames = (frames: Array<Record<string, unknown>>) =>
  frames.filter((f) => f.t === 'run').map((f) => f.run as { runId: string; state: string });

describe('S5.6 — the chat turn is a registry run', () => {
  test('prompt {askId, scope} → one run that leases the artboard, runs and ends done', async () => {
    useMockAgent();
    const { runs, acp } = rig();
    const a = fakeWs('h1');
    acp.onOpen(a.ws);
    acp.onMessage(
      a.ws,
      JSON.stringify({
        t: 'prompt',
        text: 'make it blue\n[maude-context canvas=".design/ui/a.tsx" mtime=1]\n[selected: h2 "Secret launch copy"]',
        chat: 'c1',
        askId: 'a_test01',
        scope: SCOPE,
      })
    );
    await until(() => a.frames.find((f) => f.t === 'turn-end'));
    await until(() => (runs.view().mine[0]?.state === 'ended' ? true : undefined));
    const [rec] = runs.view().mine;
    expect(rec.askId).toBe('a_test01');
    expect(rec.chatId).toBe('c1');
    expect(rec.origin).toBe('maude-chat');
    expect(rec.outcome).toBe('done');
    expect(rec.leases).toEqual([]); // an ended run holds nothing
    // the client saw the run move: starting/running, then ended
    await until(() => (runFrames(a.frames).some((r) => r.state === 'ended') ? true : undefined));
    const states = runFrames(a.frames).map((r) => r.state);
    expect(states).toContain('running');
    expect(states.at(-1)).toBe('ended');
    // while it ran it held exactly the scoped artboard
    const running = (
      a.frames.filter((f) => f.t === 'run').map((f) => f.run) as Array<{
        state: string;
        leases: Array<{ artboard: string }>;
      }>
    ).find((r) => r.state === 'running');
    expect(running?.leases.map((l) => l.artboard)).toEqual(['post']);
    // the queued prompt never reaches the client's run view
    // the label (shared with peers) is the typed text only; the queued prompt and the composer's
    // context lines (canvas copy, selectors) never reach a run frame
    expect(rec.label).toBe('make it blue');
    for (const r of runFrames(a.frames)) {
      expect(JSON.stringify(r)).not.toContain('Secret launch copy');
      expect(JSON.stringify(r)).not.toContain('maude-context');
      expect(r).not.toHaveProperty('prompt');
    }
  }, 20000);

  test('a busy artboard: the turn waits — bridge.prompt does not run — and starts by itself when freed', async () => {
    useMockAgent();
    const { runs, acp } = rig();
    // terminal Claude holds Post
    const holder = await runs.ask({ origin: 'claude-code', sessionId: 's-term', scope: SCOPE });
    expect(holder.state).toBe('running');
    const a = fakeWs('h2');
    acp.onOpen(a.ws);
    acp.onMessage(
      a.ws,
      JSON.stringify({ t: 'prompt', text: 'go', chat: 'c2', askId: 'a_test02', scope: SCOPE })
    );
    await until(() => (runFrames(a.frames).some((r) => r.state === 'waiting') ? true : undefined));
    await sleep(800);
    expect(agentText(a.frames)).toBe(''); // no turn went out
    expect(a.frames.find((f) => f.t === 'turn-end')).toBeUndefined();
    runs.endNow(holder.runId, 'done');
    await until(() => a.frames.find((f) => f.t === 'turn-end'));
    expect(agentText(a.frames).length).toBeGreaterThan(0);
  }, 20000);

  test('the same askId twice is ONE ask; an old client double-submit within 2 s is one too', async () => {
    useMockAgent();
    const { runs, acp } = rig();
    const a = fakeWs('h3');
    acp.onOpen(a.ws);
    const p = { t: 'prompt', text: 'once', chat: 'c3', askId: 'a_test03' };
    acp.onMessage(a.ws, JSON.stringify(p));
    acp.onMessage(a.ws, JSON.stringify(p));
    // old client: no askId, the same text twice
    acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', text: 'twice', chat: 'c4' }));
    acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', text: 'twice', chat: 'c4' }));
    await until(() =>
      runs.view().mine.length >= 2 && runs.view().mine.every((r) => r.state === 'ended')
        ? true
        : undefined
    );
    await sleep(300);
    expect(runs.view().mine.filter((r) => r.chatId === 'c3')).toHaveLength(1);
    expect(runs.view().mine.filter((r) => r.chatId === 'c4')).toHaveLength(1);
    expect(a.frames.filter((f) => f.t === 'turn-end')).toHaveLength(2);
  }, 20000);

  test('chat-level FIFO: a second ask in the same chat waits behind the first, then runs', async () => {
    useMockAgent(FIXTURE_SLOW);
    const { runs, acp } = rig();
    const a = fakeWs('h4');
    acp.onOpen(a.ws);
    acp.onMessage(
      a.ws,
      JSON.stringify({ t: 'prompt', text: 'first', chat: 'c5', askId: 'a_fifo01' })
    );
    await until(() => (runs.view().mine[0]?.state === 'running' ? true : undefined));
    acp.onMessage(
      a.ws,
      JSON.stringify({ t: 'prompt', text: 'second', chat: 'c5', askId: 'a_fifo02' })
    );
    await until(() => (runs.view().mine.length === 2 ? true : undefined));
    const second = runs.view().mine.find((r) => r.askId === 'a_fifo02');
    expect(second?.state).toBe('waiting');
    await until(
      () => (runs.view().mine.every((r) => r.state === 'ended') ? true : undefined),
      30000
    );
    const ended = runs.view().mine.sort((x, y) => (x.endedAt ?? 0) - (y.endedAt ?? 0));
    expect(ended.map((r) => r.askId)).toEqual(['a_fifo01', 'a_fifo02']);
    expect(a.frames.filter((f) => f.t === 'turn-end')).toHaveLength(2);
  }, 40000);

  test('a permission makes the run Needs you; the answer makes it running again', async () => {
    useMockAgent(FIXTURE_PERM);
    const { runs, acp } = rig();
    const a = fakeWs('h5');
    acp.onOpen(a.ws);
    acp.onMessage(
      a.ws,
      JSON.stringify({ t: 'prompt', text: 'write', chat: 'c6', askId: 'a_need01' })
    );
    const req = await until(() => a.frames.find((f) => f.t === 'permission-request'));
    await until(() => (runs.view().needsYou === 1 ? true : undefined));
    expect(runs.view().mine[0].question).toBe('Write file');
    acp.onMessage(
      a.ws,
      JSON.stringify({ t: 'permission-response', chat: 'c6', id: req.id, decision: 'allow-once' })
    );
    await until(() => a.frames.find((f) => f.t === 'turn-end'));
    await until(() => (runs.view().mine[0].state === 'ended' ? true : undefined));
    expect(runFrames(a.frames).map((r) => r.state)).toContain('needs-you');
    expect(runs.view().mine[0].outcome).toBe('done');
  }, 20000);

  test('Stop goes through the registry: the run ends stopped and the turn is cancelled', async () => {
    useMockAgent(FIXTURE_PERM);
    const { runs, acp } = rig();
    const a = fakeWs('h6');
    acp.onOpen(a.ws);
    acp.onMessage(
      a.ws,
      JSON.stringify({ t: 'prompt', text: 'write', chat: 'c7', askId: 'a_stop01' })
    );
    await until(() => a.frames.find((f) => f.t === 'permission-request'));
    acp.onMessage(a.ws, JSON.stringify({ t: 'cancel', chat: 'c7' }));
    await until(() => a.frames.find((f) => f.t === 'turn-end'));
    await until(() => (runs.view().mine[0].state === 'ended' ? true : undefined));
    expect(runs.view().mine[0].outcome).toBe('stopped');
    expect(runs.view().mine[0].stoppedBy).toBe('you');
  }, 20000);

  test('Keep going: a new run resumeOf the stopped one, on the chat’s persisted ACP session', async () => {
    useMockAgent(FIXTURE_PERM);
    const { runs, acp, designRoot } = rig();
    const a = fakeWs('h7');
    acp.onOpen(a.ws);
    acp.onMessage(
      a.ws,
      JSON.stringify({ t: 'prompt', text: 'write', chat: 'c8', askId: 'a_keep01' })
    );
    await until(() => a.frames.find((f) => f.t === 'permission-request'));
    const stopped = runs.view().mine[0];
    await runs.stop(stopped.runId, 'quit');
    await until(() => a.frames.find((f) => f.t === 'turn-end'));
    const sessionFile = JSON.parse(
      readFileSync(join(designRoot, '_chat', 'c8.session.json'), 'utf8')
    ) as { sessionId?: string };
    expect(sessionFile.sessionId).toBeTruthy();
    // the app quit: the bridge is gone; Keep going spawns a fresh one (no socket attached) that
    // resumes the persisted session (`loadSession`) — the session id stays the chat's
    acp.stopAll();
    expect(acp.size()).toBe(0);
    useMockAgent(FIXTURE); // supports session/load
    const kept = await runs.keepGoing(stopped.runId);
    expect(kept?.resumeOf).toBe(stopped.runId);
    await until(() => (runs.get(kept?.runId ?? '')?.state === 'ended' ? true : undefined));
    expect(runs.get(kept?.runId ?? '')?.outcome).toBe('done');
    expect(acp.size()).toBe(1);
    const after = JSON.parse(
      readFileSync(join(designRoot, '_chat', 'c8.session.json'), 'utf8')
    ) as {
      sessionId?: string;
    };
    expect(after.sessionId).toBe(sessionFile.sessionId);
    const transcript = readFileSync(join(designRoot, '_chat', 'c8.jsonl'), 'utf8');
    expect(transcript).toContain('Keep going from where you stopped.');
  }, 30000);
});

describe('S5.6 — parseRunScope (the structured scope is validated, never trusted)', () => {
  test('a well-formed scope passes; anything off is no scope at all', () => {
    expect(parseRunScope({ canvas: 'ui/a.tsx', artboards: ['p', 'p', 's'] })).toEqual({
      canvas: 'ui/a.tsx',
      artboards: ['p', 's'],
    });
    expect(parseRunScope({ canvas: 'ui/a.tsx', artboards: '*' })).toEqual({
      canvas: 'ui/a.tsx',
      artboards: '*',
    });
    for (const bad of [
      null,
      'ui/a.tsx',
      { canvas: '../x/a.tsx', artboards: ['p'] },
      { canvas: '/abs/a.tsx', artboards: ['p'] },
      { canvas: 'ui/a.ts', artboards: ['p'] },
      { canvas: '_state/a.tsx', artboards: ['p'] },
      { canvas: 'ui/a.tsx', artboards: [] },
      { canvas: 'ui/a.tsx', artboards: ['ok', 'no spaces'] },
      { canvas: 'ui/a.tsx', artboards: Array.from({ length: 65 }, (_, i) => `a${i}`) },
    ])
      expect(parseRunScope(bad)).toBeNull();
  });
});
