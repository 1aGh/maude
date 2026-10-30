// S5.15 — the interleaving matrix's E rows and the two-Mac race, IN PROCESS: two studio runtimes (real
// HocuspocusProviders, real watchers, real projections) and two run registries (real hub leases) against ONE
// real hub, spawned under Node 24 (better-sqlite3). The agent is fake: a turn writes a fixed edit to the file,
// like the acp-bridge mock. The desktop rig (apps/desktop/e2e/multiplayer/ai-runs.e2e.ts) runs the same rows
// across two app processes; this file proves them without the desktop.
//
//   U3   your undo keeps Tereza's change on another object; she cannot undo yours
//   U6/U8 Undo this chat OUT OF ORDER (c1 · c2 · c1 · you · Tereza) = ONE version; c2, you and Tereza stay
//   U16  a restore is undone by ⌘Z (a new version each time)
//   MbA  "Made by AI" clears on the next person's edit — Tereza's, seen from the other Mac (action feed)
//   R1   both Macs ask on Post 1:1 within 5 ms, N rounds (50 by default): exactly one runs; the other waits
//        with the holder's label and starts by itself; one ai action per round lands before the second starts
//   R4   Mac 1 frozen 40 s (no renewals — the in-process SIGSTOP) holding Post; Mac 2 waiting runs; Mac 1
//        then hears lease-lost, its stage is held, nothing of its run reaches the head

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHubLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry, type RunRegistry } from '../ai/runs.ts';
import { EMPTY_MADE_BY_AI, isMadeByAi, reduceMadeByAi } from '../client/v2/ai/made-by-ai.js';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { createProjectUndoRoutes, runStageHooks } from '../routes/project-undo.ts';
import { createActionFeed } from '../sync/action-feed.ts';
import { hashBytes } from '../sync/echo-guard.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
const ROUNDS = Number(process.env.MAUDE_R1_ROUNDS ?? 50);
const FREEZE_MS = Number(process.env.MAUDE_R4_FREEZE_MS ?? 40_000);
if (!HUB_READY)
  console.warn('[ai-runs-two-mac] SKIPPED — apps/hub dependencies are not installed.');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(
  fn: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  what: string,
  ms = 30_000
): Promise<T> {
  const end = Date.now() + ms;
  let last: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch (err) {
      last = err;
    }
    if (Date.now() > end)
      throw new Error(`timed out waiting for ${what}${last ? ` (${last})` : ''}`);
    await sleep(50);
  }
}

/** Two artboards of one canvas; every changeable line apart from the next. */
const canvas = (o: { post?: string; postSub?: string; story?: string; storySub?: string } = {}) =>
  `import { DCArtboard } from '@maude/canvas-lib';

export default function Kampan() {
  return (
    <div>
      <DCArtboard id="post" width={1080} height={1080}>
        <h1>${o.post ?? 'Post title'}</h1>
        <p>keep one</p>
        <h2>${o.postSub ?? 'Post sub'}</h2>
      </DCArtboard>
      <p>keep two</p>
      <DCArtboard id="story" width={1080} height={1920}>
        <h1>${o.story ?? 'Story title'}</h1>
        <p>keep three</p>
        <h2>${o.storySub ?? 'Story sub'}</h2>
      </DCArtboard>
    </div>
  );
}
`;

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
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0 && code !== null) reject(new Error(`hub exited ${code}: ${buf}`));
    });
  });
}

function stopHub(hub: Hub): Promise<void> {
  return new Promise((resolve) => {
    if (hub.proc.exitCode !== null) return resolve();
    hub.proc.once('exit', () => resolve());
    hub.proc.kill('SIGTERM');
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

interface Mac {
  name: string;
  ctx: Context;
  runtime: SyncRuntime;
  reg: RunRegistry;
  read: (rel: string) => string | null;
  /** An editor (or the person through the studio) writes the file; the watcher reports it. */
  write: (rel: string, text: string) => void;
  /** The fake agent's turns: what it writes, per run. */
  agent: { edit: (rec: { runId: string; label: string }, cur: string) => string; pause: boolean };
  events: Record<string, unknown>[];
}

const REPO = (rel: string) => `design/${rel}`;

async function startMac(
  name: string,
  repoRoot: string,
  url: string,
  token: string,
  hubHttp: string
) {
  const ctx = makeCtx(repoRoot, url);
  const registry = createRegistry(noopCallbacks());
  const runtime = createSyncRuntime(ctx, {
    registry,
    transactionRetryMs: 100,
    auth: { renewCredential: async () => null },
  });
  if (!runtime) throw new Error(`${name}: runtime refused to start`);
  await runtime.start();
  const file = (rel: string) => join(ctx.paths.designRoot, rel);
  const read = (rel: string) => {
    try {
      return readFileSync(file(rel), 'utf8');
    } catch {
      return null;
    }
  };
  const write = (rel: string, text: string) => {
    writeFileSync(file(rel), text);
    ctx.bus.emit('fs:any', rel);
  };
  const events: Record<string, unknown>[] = [];
  ctx.bus.on('project:action', (p: Record<string, unknown>) => events.push(p));
  const mac = { name, ctx, runtime, read, write, events } as unknown as Mac;
  mac.agent = { edit: (_r, cur) => cur, pause: false };
  const emit = (e: string, p: unknown) => ctx.bus.emit(e, p);
  mac.reg = createRunRegistry({
    designRoot: null,
    designRel: 'design',
    actor: name,
    device: `${name}-mac`,
    home: createHubLeaseHome({ hubUrl: hubHttp, token: () => token, budgetMs: 5_000 }),
    autoRenew: false,
    turns: {
      // The fake agent: accept the turn, write one edit as the run's tool, end the turn.
      send: (rec) =>
        void (async () => {
          await mac.reg.started(rec.runId);
          runtime.beginAiAction?.(`acp:${rec.chatId}`, rec.label, {
            runId: rec.runId,
            chatId: rec.chatId ?? undefined,
          });
          const rel = rec.scope?.canvas as string;
          const body = mac.agent.edit(rec, read(rel) ?? '');
          writeFileSync(file(rel), body);
          runtime.claimAiWrite?.(`acp:${rec.chatId}`, REPO(rel), hashBytes(body));
          ctx.bus.emit('fs:any', rel);
          await sleep(300);
          while (mac.agent.pause) await sleep(100);
          await mac.reg.turnEnded(rec.runId, 'done');
        })().catch((err) => console.warn(`[${name}] fake agent:`, err)),
    },
    stage: runStageHooks({ control: () => runtime as never, emit }),
    emit,
  });
  ctx.bus.on('hub:runs', (p: { seq?: unknown }) => {
    if (typeof p?.seq === 'number') mac.reg.poke(p.seq);
  });
  return mac;
}

describe.skipIf(!HUB_READY)('S5.15 — two studios, one hub, a fake agent', () => {
  let root: string;
  let hub: Hub;
  let you: Mac;
  let tereza: Mac;
  const saved: Record<string, string | undefined> = {};

  const api = async (route: string) => {
    const res = await fetch(`${hub.http}/api/projects/current/v1/${route}`, {
      headers: { authorization: `Bearer ${hub.tokens.owner}` },
    });
    return (await res.json()) as Record<string, unknown>;
  };
  const hubHistory = async () =>
    ((await api('history?limit=200')).history ?? []) as Array<{
      actionId: string;
      kind: string;
      actor: string;
      label: string;
      effects: Array<{ doc?: string }>;
    }>;
  /** Both disks hold `body`, and both replicas applied the newest revision. */
  const settle = async (rel: string, body: string, what: string) => {
    await waitFor(async () => {
      await tereza.runtime.pullRemoteNow();
      await you.runtime.pullRemoteNow();
      return you.read(rel) === body && tereza.read(rel) === body;
    }, what);
    const rev = ((await api('revisions?limit=500')).revisions as Array<{ revision: number }>).at(-1)
      ?.revision as number;
    // your replica holds the head before your next run stages on it (Tereza's disk is checked above)
    for (const m of [you])
      await waitFor(
        () =>
          ((m.runtime.status?.() as { appliedRevision?: number } | null)?.appliedRevision ?? 0) >=
          rev,
        `${m.name} to apply r${rev}`
      );
  };
  const newCanvas = async (rel: string, body: string) => {
    you.write(rel, body);
    await you.runtime.rescanNow();
    await settle(rel, body, `${rel} on both Macs`);
  };
  const runOnce = async (m: Mac, rel: string, chatId: string, label: string, artboard: string) => {
    const before = (await hubHistory()).length;
    const rec = await m.reg.ask({
      chatId,
      origin: 'maude-chat',
      label,
      prompt: label,
      scope: { canvas: rel, artboards: [artboard] },
    });
    await waitFor(() => m.reg.get(rec.runId)?.state === 'ended', `${label} to end`);
    await waitFor(async () => (await hubHistory()).length > before, `${label} on the hub`);
    return rec;
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'ai-runs-two-mac-'));
    for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI', 'MAUDE_SHARED_DOC'])
      saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    hub = await startHub(join(root, 'hub'));
    const youUrl = `http://127.0.0.1:${hub.port}`;
    const terezaUrl = `http://localhost:${hub.port}`;
    const hubsFile = join(root, 'hubs.json');
    writeFileSync(
      hubsFile,
      JSON.stringify({
        hubs: { [youUrl]: { token: hub.tokens.alice }, [terezaUrl]: { token: hub.tokens.bob } },
      }),
      { mode: 0o600 }
    );
    process.env.HUBS_CONFIG_PATH = hubsFile;
    mkdirSync(join(root, 'you', 'design', 'ui'), { recursive: true });
    writeFileSync(join(root, 'you', 'design', 'ui', 'seed.tsx'), canvas());
    you = await startMac('you', join(root, 'you'), youUrl, hub.tokens.alice, hub.http);
    await waitFor(async () => {
      const b = (await api('bootstrap')) as { docs?: { path: string }[] };
      return b.docs?.some((d) => d.path === 'ui/seed.tsx');
    }, 'the hub to accept the seed canvas');
    tereza = await startMac('tereza', join(root, 'tereza'), terezaUrl, hub.tokens.bob, hub.http);
  }, 90_000);

  afterAll(async () => {
    you?.reg.close?.();
    tereza?.reg.close?.();
    await you?.runtime.stop();
    await tereza?.runtime.stop();
    if (hub) await stopHub(hub);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('U3: your ⌘Z keeps Tereza’s change on another object; she cannot undo yours', async () => {
    const rel = 'ui/u3.tsx';
    await newCanvas(rel, canvas());
    you.ctx.bus.emit('activity:suppress', rel);
    you.write(rel, canvas({ post: 'x by you' }));
    await settle(rel, canvas({ post: 'x by you' }), 'your P.x');
    tereza.ctx.bus.emit('activity:suppress', rel);
    tereza.write(rel, canvas({ post: 'x by you', postSub: 'y by Tereza' }));
    await settle(rel, canvas({ post: 'x by you', postSub: 'y by Tereza' }), 'her P.y');
    const [mine] =
      (await you.runtime.acceptedHistory?.({ path: REPO(rel), limit: 10, mine: true })) ?? [];
    expect(mine).toMatchObject({ kind: 'edit', mine: true });
    // her ⌘Z on your action is refused
    const theirs = await tereza.runtime.acceptedUndo?.(mine.actionId);
    expect(theirs?.status).toBe('rejected');
    const u = await you.runtime.acceptedUndo?.(mine.actionId);
    expect(u?.status).toBe('accepted');
    await settle(rel, canvas({ postSub: 'y by Tereza' }), 'P.x back, P.y kept');
    // your undo stack names only your entries
    const specs = createProjectUndoRoutes({ control: () => you.runtime, designRel: 'design' });
    const stack = specs.find((s) => s.path === '/_api/project/undo-stack');
    const res = await stack?.handle(
      new Request(`http://localhost/_api/project/undo-stack?canvas=${REPO(rel)}`),
      {} as never
    );
    const body = (await res?.json()) as { entries: unknown[]; redo: unknown[]; chatUndo?: unknown };
    expect(body.chatUndo).toEqual({ ok: true }); // a current hub: Undo this chat is offered
    for (const e of [...body.entries, ...body.redo])
      expect((e as { who: string }).who).not.toBe('tereza');
  }, 90_000);

  test('U6/U8: Undo this chat out of order (c1 · c2 · c1 · you · Tereza) is ONE version; c2, you and Tereza stay', async () => {
    const rel = 'ui/u6.tsx';
    await newCanvas(rel, canvas());
    // c1 run 1 on Post · c2 on Story · c1 run 2 on Story (another object) — each landing in turn
    const state: Parameters<typeof canvas>[0] = {};
    const step = async (
      chat: string,
      label: string,
      artboard: string,
      o: Parameters<typeof canvas>[0]
    ) => {
      Object.assign(state, o);
      const body = canvas(state);
      you.agent.edit = () => body;
      await runOnce(you, rel, chat, label, artboard);
      await settle(rel, body, label);
    };
    await step('c1', 'c1 run 1', 'post', { postSub: 'c1 sub' });
    await step('c2', 'c2 run', 'story', { storySub: 'c2 sub' });
    await step('c1', 'c1 run 2', 'story', { story: 'c1 story' });
    // you edit the Post title, Tereza another object on Story
    you.ctx.bus.emit('activity:suppress', rel);
    Object.assign(state, { post: 'your title' });
    you.write(rel, canvas(state));
    await settle(rel, canvas(state), 'your title');
    // Tereza edits keep-three on Story — a plain object of hers
    const hers = canvas(state).replace('<p>keep three</p>', '<p>keep three by Tereza</p>');
    tereza.ctx.bus.emit('activity:suppress', rel);
    tereza.write(rel, hers);
    await settle(rel, hers, 'Tereza’s object on Story');
    const before = await hubHistory();

    const u = await you.runtime.acceptedUndo?.({ chatId: 'c1' }, false, { via: 'panel' });
    expect(u?.status).toBe('accepted');
    const after = await hubHistory();
    expect(after.length).toBe(before.length + 1); // ONE new version
    const expected = canvas({ storySub: 'c2 sub', post: 'your title' }).replace(
      '<p>keep three</p>',
      '<p>keep three by Tereza</p>'
    );
    await settle(rel, expected, 'Undo this chat on both Macs');
  }, 180_000);

  test('U16: ⌘Z undoes a restore — a new version each time', async () => {
    const rel = 'ui/u16.tsx';
    await newCanvas(rel, canvas());
    const [created] = (await you.runtime.acceptedHistory?.({ path: REPO(rel), limit: 5 })) ?? [];
    you.ctx.bus.emit('activity:suppress', rel);
    you.write(rel, canvas({ post: 'later' }));
    await settle(rel, canvas({ post: 'later' }), 'a later edit');
    const r = await you.runtime.acceptedRestore?.(REPO(rel), created.revision);
    expect(r?.status).toBe('accepted');
    await settle(rel, canvas(), 'the restore');
    const [restore] = (await you.runtime.acceptedHistory?.({ path: REPO(rel), limit: 5 })) ?? [];
    expect(['restore', 'history.restore']).toContain(restore.kind);
    const n = (await hubHistory()).length;
    const u = await you.runtime.acceptedUndo?.(restore.actionId);
    expect(u?.status).toBe('accepted');
    await settle(rel, canvas({ post: 'later' }), 'the restore undone');
    expect((await hubHistory()).length).toBe(n + 1);
  }, 90_000);

  test('Made by AI clears on the next person’s edit — Tereza’s, seen from your Mac', async () => {
    const rel = 'ui/mba.tsx';
    await newCanvas(rel, canvas());
    const feed = createActionFeed({
      control: () => you.runtime as never,
      designRel: 'design',
      emit: (e, p) => you.ctx.bus.emit(e, p),
      on: (e, fn) => you.ctx.bus.on(e, fn),
      debounceMs: 50,
      settleMs: 800,
    });
    const offProjected = you.ctx.bus.on('sync:projected', () => feed.poke());
    await feed.flush();
    const from = you.events.length;
    you.agent.edit = () => canvas({ post: 'AI post', story: 'AI story' });
    await runOnce(you, rel, 'cm', 'Restyle both', 'post');
    await settle(rel, canvas({ post: 'AI post', story: 'AI story' }), 'the run');
    const fold = () =>
      you.events.slice(from).reduce((s, a) => reduceMadeByAi(s, a), EMPTY_MADE_BY_AI);
    await waitFor(() => isMadeByAi(fold(), REPO(rel), 'post'), 'Made by AI on Post');
    expect(isMadeByAi(fold(), REPO(rel), 'story')).toBe(true);
    // Tereza edits the Story title by hand
    tereza.ctx.bus.emit('activity:suppress', rel);
    tereza.write(rel, canvas({ post: 'AI post', story: 'Tereza story' }));
    await settle(rel, canvas({ post: 'AI post', story: 'Tereza story' }), 'her edit');
    feed.poke();
    await waitFor(() => !isMadeByAi(fold(), REPO(rel), 'story'), 'Made by AI to clear on Story');
    expect(isMadeByAi(fold(), REPO(rel), 'post')).toBe(true); // only what she changed
    offProjected();
    feed.stop();
  }, 120_000);

  test(
    `R1: both Macs ask on Post 1:1 within 5 ms, ${ROUNDS} rounds — one runs, the other waits and starts by itself`,
    async () => {
      const rel = 'ui/race.tsx';
      await newCanvas(rel, canvas());
      let running = 0;
      let maxRunning = 0;
      const starts: Array<{ who: string; label: string; aiLanded: number }> = [];
      let aiLanded = 0;
      for (const m of [you, tereza]) {
        m.agent.edit = (rec, cur) => {
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          starts.push({ who: m.name, label: rec.label, aiLanded });
          return cur.replace(/<h1>[^<]*<\/h1>/, `<h1>${rec.label}</h1>`);
        };
        m.ctx.bus.on('project:action', (a: { kind?: string }) => {
          if (a?.kind === 'ai') {
            running -= 1;
            aiLanded += 1;
          }
        });
      }
      for (let i = 0; i < ROUNDS; i++) {
        const [a, b] = await Promise.all([
          you.reg.ask({
            chatId: 'race-you',
            origin: 'maude-chat',
            label: `r${i} you`,
            prompt: 'p',
            scope: { canvas: rel, artboards: ['post'] },
          }),
          tereza.reg.ask({
            chatId: 'race-tereza',
            origin: 'maude-chat',
            label: `r${i} tereza`,
            prompt: 'p',
            scope: { canvas: rel, artboards: ['post'] },
          }),
        ]);
        const states = [a.state, b.state].sort();
        expect(states).toEqual(['starting', 'waiting']);
        const waiter = a.state === 'waiting' ? { m: you, r: a } : { m: tereza, r: b };
        const holder = a.state === 'waiting' ? { m: tereza, r: b } : { m: you, r: a };
        expect(waiter.r.waiting[0]?.heldBy?.label).toBe(holder.r.label);
        // the holder's turn lands, then the waiter starts by itself on top of it
        await waitFor(
          () => holder.m.reg.get(holder.r.runId)?.state === 'ended',
          `round ${i} holder`
        );
        await settle(rel, canvas({ post: holder.r.label }), `round ${i} holder on both Macs`);
        await waitFor(async () => {
          await waiter.m.reg.pull();
          return waiter.m.reg.get(waiter.r.runId)?.state === 'ended';
        }, `round ${i} waiter`);
        await settle(rel, canvas({ post: waiter.r.label }), `round ${i} waiter on both Macs`);
      }
      expect(maxRunning).toBe(1); // never two writers on Post
      expect(starts).toHaveLength(ROUNDS * 2);
      // one V2-1.5 action per run, and each second start came after the first one's action landed
      for (let i = 0; i < ROUNDS; i++) expect(starts[2 * i + 1].aiLanded).toBe(2 * i + 1);
      const ai = (await hubHistory()).filter((h) => h.kind === 'ai' && /^r\d+ /.test(h.label));
      expect(ai).toHaveLength(ROUNDS * 2);
    },
    60_000 + ROUNDS * 15_000
  );

  test(
    `R4: Mac 1 frozen ${FREEZE_MS / 1000} s holding Post — Mac 2 runs; Mac 1 hears lease-lost, holds, publishes nothing`,
    async () => {
      const rel = 'ui/r4.tsx';
      await newCanvas(rel, canvas());
      you.agent.edit = () => canvas({ post: 'Mac 1 frozen' });
      you.agent.pause = true; // the turn never ends: the in-process SIGSTOP (no renewals, no end)
      const held = await you.reg.ask({
        chatId: 'r4-you',
        origin: 'maude-chat',
        label: 'frozen run',
        prompt: 'p',
        scope: { canvas: rel, artboards: ['post'] },
      });
      await waitFor(
        () => you.read(rel) === canvas({ post: 'Mac 1 frozen' }),
        'Mac 1’s staged write'
      );
      tereza.agent.edit = () => canvas({ post: 'Mac 2 ran' });
      const waiting = await tereza.reg.ask({
        chatId: 'r4-tereza',
        origin: 'maude-chat',
        label: 'waiting run',
        prompt: 'p',
        scope: { canvas: rel, artboards: ['post'] },
      });
      expect(waiting.state).toBe('waiting');
      // Mac 2 stays alive (renews its waiting ticket); Mac 1 says nothing for the whole freeze
      for (const end = Date.now() + FREEZE_MS; Date.now() < end; ) {
        await tereza.reg.renewNow();
        await sleep(5_000);
      }
      // Mac 2 runs: its line moves once the lapsed lease is swept
      await waitFor(
        async () => {
          await tereza.reg.renewNow();
          await tereza.reg.pull();
          return tereza.reg.get(waiting.runId)?.state === 'ended';
        },
        'Mac 2 to run after the lapse',
        60_000
      );
      expect(tereza.reg.get(waiting.runId)?.outcome).toBe('done');
      await waitFor(async () => {
        await tereza.runtime.pullRemoteNow();
        return tereza.read(rel) === canvas({ post: 'Mac 2 ran' });
      }, 'Mac 2’s run on its disk');
      // SIGCONT: Mac 1 renews and hears its run is gone
      await you.reg.renewNow();
      const rec = await waitFor(() => {
        const r = you.reg.get(held.runId);
        return r?.state === 'ended' ? r : null;
      }, 'Mac 1 to hear lease-lost');
      expect(rec.outcome).toBe('lease-lost');
      you.agent.pause = false;
      await sleep(800);
      // nothing of Mac 1's run is in the head
      const ais = (await hubHistory()).filter((h) => h.kind === 'ai' && h.label === 'frozen run');
      expect(ais).toEqual([]);
      await tereza.runtime.pullRemoteNow();
      expect(tereza.read(rel)).toBe(canvas({ post: 'Mac 2 ran' }));
    },
    FREEZE_MS + 180_000
  );
});
