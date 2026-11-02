// p8-a1-claims on a HUB-LINKED project — the same three rules as test/p8-a1-write-claims.test.ts (local home),
// on a studio runtime linked to a real hub (the serve-hub fixture the accepted-runtime suites use):
//
//   (a) a person's outside save while an AI verb runs is published as theirs, never in the run's ai action;
//   (b) a route write made inside the run's write claim (X-Maude-Chat → `withWriteClaim`) IS the run's;
//   (c) a delete the run claimed (`maude design trash move` → `DELETE /_api/canvas`) is the run's
//       `doc.delete`, inside its one ai action.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SessionUpdate } from '@agentclientprotocol/sdk';

import { createAgentActivityTracker } from '../acp/index.ts';
import { withWriteClaim } from '../ai/write-claim.ts';
import type { AiActivity } from '../collab/ai-activity.ts';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import { type Context, createBus } from '../context.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));

const src = (title: string) =>
  `export default function Home() {\n  return <h1 title="${title}">Home</h1>;\n}\n`;

async function waitFor<T>(
  fn: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  what: string,
  ms = 20_000
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch {
      /* not yet */
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

interface Hub {
  proc: ChildProcess;
  http: string;
  port: string;
  tokens: Record<'owner' | 'alice' | 'bob' | 'viewer', string>;
}

function startHub(dataDir: string): Promise<Hub> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [FIXTURE, dataDir, '0', '--transactions'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`hub did not start: ${buf}`)), 20_000);
    proc.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      for (const line of buf.split('\n')) {
        if (!line.startsWith('{')) continue;
        clearTimeout(timer);
        const info = JSON.parse(line);
        resolve({ proc, http: info.http, port: info.port, tokens: info.tokens });
        return;
      }
    });
    proc.stderr?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
    });
  });
}

const noopCallbacks = (): RoomCallbacks => ({
  async seed() {},
  async persistJson() {},
  async persistBinary() {},
});

function makeCtx(repoRoot: string, url: string): Context {
  const designRoot = join(repoRoot, 'design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify({ canvasGroups: [{ label: 'Canvases', path: 'ui' }] })
  );
  return {
    canvasOrigin: 'http://canvas.localhost',
    sharedDoc: true,
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
      linkedHub: { url, linkedAt: 0, fileEvents: false },
      _source: 'defaults',
    },
    projectLabel: 'test',
    paths: {
      repoRoot,
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
}

const ai: AiActivity = {
  start: (file) => ({ file, author: 'x', startedAt: 0, lastHeartbeat: 0 }),
  heartbeat: (file) => ({ file, author: 'x', startedAt: 0, lastHeartbeat: 0 }),
  end: () => true,
  list: () => [],
  get: () => null,
  stop: () => {},
};

describe.skipIf(!HUB_READY)('A1 write claims — a studio runtime on a real hub', () => {
  let root: string;
  let hub: Hub;
  let ctx: Context;
  let runtime: SyncRuntime;
  const saved: Record<string, string | undefined> = {};
  const file = (rel: string) => join(ctx.paths.designRoot, rel);
  const write = (rel: string, text: string) => {
    writeFileSync(file(rel), text);
    ctx.bus.emit('fs:any', rel);
  };
  const history = async () => {
    const res = await fetch(`${hub.http}/api/projects/current/v1/history?limit=200`, {
      headers: { authorization: `Bearer ${hub.tokens.owner}`, 'x-maude-format': '2' },
    });
    return ((await res.json()) as { history: Array<Record<string, unknown>> }).history;
  };
  const docs = async () => {
    const res = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
      headers: { authorization: `Bearer ${hub.tokens.owner}`, 'x-maude-format': '2' },
    });
    return ((await res.json()) as { docs: Array<{ path: string; retired?: boolean }> }).docs;
  };
  const accepted = (rel: string) =>
    waitFor(async () => (await docs()).some((d) => d.path === rel), `the hub to hold ${rel}`);

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'a1-claims-hub-'));
    for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI', 'MAUDE_SHARED_DOC'])
      saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    hub = await startHub(join(root, 'hub'));
    const url = `http://127.0.0.1:${hub.port}`;
    const hubsFile = join(root, 'hubs.json');
    writeFileSync(hubsFile, JSON.stringify({ hubs: { [url]: { token: hub.tokens.alice } } }), {
      mode: 0o600,
    });
    process.env.HUBS_CONFIG_PATH = hubsFile;
    mkdirSync(join(root, 'alice', 'design', 'ui'), { recursive: true });
    for (const n of ['a', 'b', 'c', 'd'])
      writeFileSync(join(root, 'alice', 'design', 'ui', `${n}.tsx`), src(`${n} v1`));
    ctx = makeCtx(join(root, 'alice'), url);
    const r = createSyncRuntime(ctx, {
      registry: createRegistry(noopCallbacks()),
      transactionRetryMs: 100,
      auth: { renewCredential: async () => null },
    });
    if (!r) throw new Error('runtime refused to start');
    runtime = r;
    await runtime.start();
    for (const n of ['a', 'b', 'c', 'd']) await accepted(`ui/${n}.tsx`);
  }, 60_000);

  afterAll(async () => {
    await runtime?.stop();
    if (hub && hub.proc.exitCode === null) {
      const gone = new Promise((r) => hub.proc.once('exit', r));
      hub.proc.kill('SIGTERM');
      await gone;
    }
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('(a) an outside save while `maude design reel-place` runs is published as the person’s', async () => {
    ctx.syncControl = { current: () => runtime } as unknown as Context['syncControl'];
    const t = createAgentActivityTracker(ctx, ai, 'c1');
    t.beginTurn?.('Cut it', 'r_hub_a');
    t.onUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'b1',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: 'maude design reel-place recap --next --canvas ui/a.tsx#v' },
    } as unknown as SessionUpdate);
    write('ui/a.tsx', src('a — my own'));
    await new Promise((r) => setTimeout(r, 600));
    t.onUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'b1',
      status: 'completed',
    } as unknown as SessionUpdate);
    await runtime.endAiAction?.('r_hub_a', 'done');
    const h = await waitFor(async () => {
      const all = await history();
      return all.some((x) => JSON.stringify(x).includes('ui/a.tsx') && x.kind !== 'ai') && all;
    }, 'the person’s save on the hub');
    expect(h.filter((x) => x.kind === 'ai')).toEqual([]);
  });

  test('(b) a route write inside the run’s write claim is the run’s ai action', async () => {
    const run = { runId: 'r_hub_b', chatId: 'c1', label: 'Retitle b' };
    // what a table route does when the verb named its chat: announce, write, say it was written
    withWriteClaim(run, () => {
      ctx.bus.emit('activity:suppress', 'ui/b.tsx');
      writeFileSync(file('ui/b.tsx'), src('b by the AI'));
      ctx.bus.emit('source-written', { rel: 'ui/b.tsx', content: src('b by the AI') });
    });
    ctx.bus.emit('fs:any', 'ui/b.tsx');
    await new Promise((r) => setTimeout(r, 600));
    const ended = await runtime.endAiAction?.('r_hub_b', 'done');
    expect(ended?.status).toBe('accepted');
    const h = await history();
    const mine = h.filter((x) => x.kind === 'ai' && x.label === 'Retitle b');
    expect(mine.length).toBe(1);
  });

  test('(c) a claimed delete is the run’s doc.delete, in its one ai action', async () => {
    runtime.beginAiAction?.('run:r_hub_c', 'Clean up', {
      runId: 'r_hub_c',
      chatId: 'c1',
      claimOnly: true,
    });
    runtime.claimAiDelete?.('r_hub_c', 'design/ui/c.tsx');
    rmSync(file('ui/c.tsx'));
    // what api.deleteCanvas emits after the move (the privileged route, never the watcher)
    ctx.bus.emit('canvas-deleted', { slug: 'ui-c' });
    ctx.bus.emit('fs:any', 'ui/c.tsx');
    await new Promise((r) => setTimeout(r, 600));
    expect((await history()).filter((x) => x.label === 'Clean up')).toEqual([]); // staged, not sent
    const ended = await runtime.endAiAction?.('r_hub_c', 'done');
    expect(ended?.status).toBe('accepted');
    const h = await history();
    const mine = h.filter((x) => x.kind === 'ai' && x.label === 'Clean up');
    expect(mine.length).toBe(1);
    expect(h.filter((x) => x.kind === 'canvas.delete')).toEqual([]);
    expect(readFileSync(join(root, 'alice', 'design', 'ui', 'd.tsx'), 'utf8')).toBe(src('d v1'));
  });
});
