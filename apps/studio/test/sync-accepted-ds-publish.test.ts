// S10.3b — a design-system publish on a LINKED project, on a real hub.
//
// Two studio sync runtimes talk to one real hub in `transactions` mode: Carol owns the project,
// Bob is a member. Each runs the S10.2 DS engine over THE kernel port of its own runtime
// (`kernelPortFrom(() => runtime)` — `SyncRuntime.proposeFiles`). Plane B (`revisions/**`,
// `head.json`, the working CSS) rides the file plane, which these runtimes do not run: both disks
// start from the same converted system, which is what the file plane would have delivered.
//
//   - Carol publishes: ONE action on the hub covers both canvases' lanes (the left-out canvas's
//     `dsRev` and the DS canvas's cleared `dsPending`), and Bob's disk shows both — the oracle is
//     always the OTHER peer's disk / the hub, never the proposer's view;
//   - Carol's ⌘Z (the undo route over her runtime) takes both lanes back on Bob's disk and the
//     registered DS hook moves her head.json back (one ⌘Z across Plane A + B);
//   - Bob publishes the other way (cloud and desktop are not symmetric — memory
//     maude-sync-test-both-directions), attributed to him;
//   - a refused proposal (one file the hub will not take) writes nothing on either disk and
//     leaves no action.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { createDsEngine, type DsEngine, kernelPortFrom } from '../ds/engine.ts';
import { newHead, readHead, writeHead } from '../ds/head.ts';
import { buildRevision, revisionWritePlan } from '../ds/revision.ts';
import { registerDsUndoHook } from '../ds/undo-hook.ts';
import { createProjectUndoRoutes } from '../routes/project-undo.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';
import {
  ACCENT,
  COMPONENTS_CSS,
  canvasTsx,
  DS,
  DS_PATH,
  PERSON,
  TOKENS_CSS,
} from './_ds-engine-fixture.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
if (!HUB_READY)
  console.warn('[sync-accepted-ds-publish] SKIPPED — apps/hub dependencies are not installed.');

const GROUPS = [
  { label: 'Canvases', path: 'ui' },
  { label: 'Systems', path: 'system' },
];
const CONFIG = {
  designSystems: [
    { name: DS, path: DS_PATH, themes: ['light', 'dark'], themeDefault: 'light', rootClass: DS },
  ],
  defaultDesignSystem: DS,
  canvasGroups: GROUPS,
};
const DS_CANVAS = `${DS_PATH}/design-system.tsx`;
const CANVASES = ['ui/Home.tsx', 'ui/Landing.tsx', 'ui/Pricing.tsx'];

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
    await new Promise((r) => setTimeout(r, 100));
  }
}

interface Hub {
  proc: ChildProcess;
  http: string;
  port: string;
  tokens: Record<'owner' | 'carol' | 'bob', string>;
}

function mintTokens(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  const tokensMjs = pathToFileURL(join(HUB_DIR, 'src', 'tokens.mjs')).href;
  const script = `
    import { writeFileSync } from 'node:fs';
    import { addToken } from ${JSON.stringify(tokensMjs)};
    const d = process.argv[1];
    const t = {
      owner: addToken(d, { label: 'owner-machine', scope: '*' }).value,
      carol: addToken(d, { label: 'carol-laptop', scope: '*', role: 'owner', owner: 'carol@x.test' }).value,
      bob: addToken(d, { label: 'bob-laptop', scope: '*', role: 'member', owner: 'bob@x.test' }).value,
    };
    writeFileSync(d + '/test-tokens.json', JSON.stringify(t));`;
  const r = spawnSync('node', ['--input-type=module', '-e', script, dataDir], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`minting tokens failed: ${r.stderr}`);
}

function startHub(dataDir: string): Promise<Hub> {
  mintTokens(dataDir);
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

/** The converted system (Plane B) — what the file plane delivers to every peer. R0 = head = base. */
function writeSystem(designRoot: string): string {
  const write = (rel: string, text: string) => {
    const abs = join(designRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  write('config.json', `${JSON.stringify(CONFIG, null, 2)}\n`);
  write(`${DS_PATH}/colors_and_type.css`, TOKENS_CSS);
  write(`${DS_PATH}/preview/_components.css`, COMPONENTS_CSS);
  const R0 = buildRevision(DS, {
    'colors_and_type.css': TOKENS_CSS,
    'preview/_components.css': COMPONENTS_CSS,
  });
  for (const w of revisionWritePlan(() => null, R0, {})) write(`${DS_PATH}/${w.path}`, w.text);
  writeHead(join(designRoot, DS_PATH), newHead(DS, { head: R0.id, base: R0.id }), 'absent');
  return R0.id;
}

/** The canvases (Plane A) — only the first peer has them; the other receives them. */
function writeCanvases(designRoot: string): void {
  const write = (rel: string, text: string) => {
    const abs = join(designRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  write(DS_CANVAS, canvasTsx('Design system'));
  write(DS_CANVAS.replace(/\.tsx$/, '.meta.json'), '{\n  "title": "Design system"\n}\n');
  for (const c of CANVASES) {
    const name = c.slice(3, -4);
    write(c, canvasTsx(name, name === 'Pricing'));
    write(c.replace(/\.tsx$/, '.meta.json'), `{\n  "title": "${name}"\n}\n`);
  }
}

function makeCtx(repoRoot: string, url: string): Context {
  const designRoot = join(repoRoot, 'design');
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  return {
    canvasOrigin: 'http://canvas.localhost',
    sharedDoc: true,
    cfg: {
      name: 'test',
      projectLabel: null,
      designRoot: 'design',
      canvasGroups: GROUPS,
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

interface Peer {
  ctx: Context;
  runtime: SyncRuntime;
  engine: DsEngine;
  read: (rel: string) => string | null;
  meta: (canvas: string) => Record<string, unknown>;
  undo: (
    body: Record<string, unknown>
  ) => Promise<{ status: number; body: Record<string, unknown> }>;
}

async function startPeer(repoRoot: string, url: string): Promise<Peer> {
  const ctx = makeCtx(repoRoot, url);
  const runtime = createSyncRuntime(ctx, {
    registry: createRegistry(noopCallbacks()),
    transactionRetryMs: 100,
    auth: { renewCredential: async () => null },
  });
  if (!runtime) throw new Error('runtime refused to start');
  await runtime.start();
  const designRoot = ctx.paths.designRoot;
  const read = (rel: string) => {
    const abs = join(designRoot, rel);
    return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  };
  const engine = createDsEngine({
    designRoot,
    kernel: kernelPortFrom(() => runtime),
    log: { warn() {}, error() {} },
  });
  const undoSpec = createProjectUndoRoutes({
    control: () => runtime as never,
    designRel: 'design',
  }).find((s) => s.method === 'POST' && s.path === '/_api/project/undo') as unknown as {
    handle: (r: Request) => Promise<Response>;
  };
  return {
    ctx,
    runtime,
    engine,
    read,
    meta: (c) => JSON.parse(read(c.replace(/\.tsx$/, '.meta.json')) ?? '{}'),
    undo: async (body) => {
      const res = await undoSpec.handle(
        new Request('http://localhost/_api/project/undo', {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        })
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
  };
}

const pendingOf = (p: Peer) =>
  p.meta(DS_CANVAS).dsPending as { tokens?: Record<string, { light: string }> } | undefined;

describe.skipIf(!HUB_READY)('a design-system publish on a linked project — real hub', () => {
  let root: string;
  let hub: Hub;
  let carol: Peer;
  let bob: Peer;
  let R0 = '';
  const saved: Record<string, string | undefined> = {};
  let unhook: (() => void) | null = null;
  let published = { actionId: '', rev: '' };

  /** The hub's action log, newest first (the owner's machine token reads it). */
  const hubHistory = async () => {
    const res = await fetch(`${hub.http}/api/projects/current/v1/history?limit=20`, {
      headers: { authorization: `Bearer ${hub.tokens.owner}` },
    });
    return ((await res.json()) as { history: Array<Record<string, unknown>> }).history;
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'accepted-ds-'));
    for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI', 'MAUDE_SHARED_DOC'])
      saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    hub = await startHub(join(root, 'hub'));
    const carolUrl = `http://127.0.0.1:${hub.port}`;
    const bobUrl = `http://localhost:${hub.port}`;
    const hubsFile = join(root, 'hubs.json');
    writeFileSync(
      hubsFile,
      JSON.stringify({
        hubs: { [carolUrl]: { token: hub.tokens.carol }, [bobUrl]: { token: hub.tokens.bob } },
      }),
      { mode: 0o600 }
    );
    process.env.HUBS_CONFIG_PATH = hubsFile;
    R0 = writeSystem(join(root, 'carol', 'design'));
    writeCanvases(join(root, 'carol', 'design'));
    writeSystem(join(root, 'bob', 'design'));
    carol = await startPeer(join(root, 'carol'), carolUrl);
    await waitFor(async () => {
      const res = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
        headers: { authorization: `Bearer ${hub.tokens.owner}` },
      });
      const b = (await res.json()) as { docs: { path: string }[] };
      return [DS_CANVAS, ...CANVASES].every((p) => b.docs.some((d) => d.path === p));
    }, 'the hub to accept the four canvases');
    bob = await startPeer(join(root, 'bob'), bobUrl);
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return (
        [DS_CANVAS, ...CANVASES].every((c) => bob.read(c) !== null) &&
        bob.meta('ui/Landing.tsx').title === 'Landing'
      );
    }, "bob's copy of the canvases");
  }, 120_000);

  afterAll(async () => {
    unhook?.();
    await carol?.runtime.stop();
    await bob?.runtime.stop();
    if (hub) await stopHub(hub);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('Carol publishes: one action on the hub, both canvases change on Bob’s disk', async () => {
    unhook = registerDsUndoHook(carol.engine);
    await carol.engine.mergePending(DS, {
      tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
      by: PERSON,
    });
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return pendingOf(bob)?.tokens?.['--accent']?.light === 'oklch(0.5 0.19 255)';
    }, "the pending change on bob's disk");
    const before = (await hubHistory()).length;
    const r = await carol.engine.publish(DS, {
      expectHead: R0,
      canvases: [{ path: 'ui/Landing.tsx', ticked: false }],
      by: PERSON,
    });
    expect(typeof r.actionId).toBe('string');
    // the proposer's disk holds the accepted lanes on return (the local kernel's contract)
    expect(carol.meta('ui/Landing.tsx').dsRev).toBe(R0);
    expect(pendingOf(carol)).toBeUndefined();
    expect(readHead(join(carol.ctx.paths.designRoot, DS_PATH))).toMatchObject({
      state: 'ok',
      doc: { head: r.rev, log: [{ action: 'publish', actionId: r.actionId }] },
    });
    // the OTHER peer: both lanes, from one action
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return bob.meta('ui/Landing.tsx').dsRev === R0 && pendingOf(bob) === undefined;
    }, "the publish on bob's disk");
    expect(bob.meta('ui/Home.tsx').dsRev).toBeUndefined();
    const history = await hubHistory();
    expect(history.length).toBe(before + 1);
    const action = history[0] as {
      actionId: string;
      actor: string;
      kind: string;
      label: string;
      effects: { afterPath: string | null; lane: string }[];
    };
    expect(action.actionId).toBe(r.actionId as string);
    expect(action).toMatchObject({ actor: 'carol@x.test', kind: 'edit', label: r.summary });
    // one action, two canvases, their meta lanes only
    expect(new Set(action.effects.map((e) => e.doc)).size).toBe(2);
    expect(new Set(action.effects.map((e) => e.lane))).toEqual(new Set(['meta']));
    published = { actionId: r.actionId as string, rev: r.rev as string };
  });

  test('Carol’s ⌘Z takes both lanes back on Bob’s disk and moves her head.json back', async () => {
    const u = await carol.undo({ actionId: published.actionId });
    expect(u.status).toBe(200);
    expect(u.body.ok).toBe(true);
    // Plane B on the proposer (the registered DS hook): head = base = R0, a restore entry
    const h = readHead(join(carol.ctx.paths.designRoot, DS_PATH));
    if (h.state !== 'ok') throw new Error(`head.json is ${h.state}`);
    expect([h.doc.head, h.doc.base]).toEqual([R0, R0]);
    expect(h.doc.log[0]).toMatchObject({ action: 'restore', actionId: u.body.actionId });
    expect(carol.read(`${DS_PATH}/colors_and_type.css`)).toBe(TOKENS_CSS);
    // Plane A on the OTHER peer: the left-out canvas follows again, the pending entry is back
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return (
        bob.meta('ui/Landing.tsx').dsRev === undefined &&
        pendingOf(bob)?.tokens?.['--accent']?.light === 'oklch(0.5 0.19 255)'
      );
    }, "the undo on bob's disk");
    unhook?.();
    unhook = null;
  });

  test('Bob publishes the other way: Carol’s disk changes, the action is his', async () => {
    unhook = registerDsUndoHook(bob.engine);
    const BOB = { kind: 'person', name: 'Bob' } as const;
    // Carol's entry is back (her undo): Bob changes it having read it (S10.2's per-token rule)
    const seen = (pendingOf(bob)?.tokens?.['--accent'] as { at?: string } | undefined)?.at;
    expect(typeof seen).toBe('string');
    await bob.engine.mergePending(DS, {
      tokens: ACCENT('oklch(0.45 0.2 140)', 'oklch(0.62 0.18 140)'),
      expect: { '--accent': seen as string },
      by: BOB,
    });
    const r = await bob.engine.publish(DS, {
      expectHead: R0,
      canvases: [{ path: 'ui/Pricing.tsx', ticked: false }],
      by: BOB,
    });
    expect(typeof r.actionId).toBe('string');
    await waitFor(async () => {
      await carol.runtime.pullRemoteNow();
      return carol.meta('ui/Pricing.tsx').dsRev === R0 && pendingOf(carol) === undefined;
    }, "bob's publish on carol's disk");
    const [action] = await hubHistory();
    expect(action).toMatchObject({ actionId: r.actionId, actor: 'bob@x.test', kind: 'edit' });
    expect(new Set((action.effects as { doc: string }[]).map((e) => e.doc)).size).toBe(2);
  });

  test('a refused proposal writes nothing on either disk and leaves no action', async () => {
    const before = await hubHistory();
    const homeMeta = carol.read('ui/Home.meta.json');
    const homeTsx = carol.read('ui/Home.tsx');
    const r = await carol.runtime.proposeFiles?.(
      [
        { rel: 'ui/Home.meta.json', text: '{\n  "title": "Home",\n  "dsRev": "nope"\n}\n' },
        { rel: 'ui/Home.tsx', text: 'export default () => <section><h1>Home' },
      ],
      { kind: 'edit', label: 'Update to the design system' }
    );
    expect(r).toMatchObject({ status: 'rejected', code: 'source-invalid' });
    expect(r?.actionId).toBeUndefined();
    await bob.runtime.pullRemoteNow();
    await new Promise((res) => setTimeout(res, 500));
    expect(carol.read('ui/Home.meta.json')).toBe(homeMeta);
    expect(carol.read('ui/Home.tsx')).toBe(homeTsx);
    expect(bob.meta('ui/Home.tsx').dsRev).toBeUndefined();
    expect((await hubHistory()).length).toBe(before.length);
  });

  test('a file that is not a synced canvas is refused before anything is sent', async () => {
    const r = await carol.runtime.proposeFiles?.([{ rel: 'ui/Nowhere.meta.json', text: '{}' }], {
      kind: 'edit',
      label: 'x',
    });
    expect(r).toMatchObject({ status: 'rejected', code: 'unknown-canvas' });
  });

  // p8-dead-reasons part 3 — "Keep this version" (`ds.canvas-leave`) is versioned (`.meta.json` `dsRev` / `dsKept`),
  // so it rides the meta lane: each direction is proven on the OTHER peer's disk.
  test('Bob keeps Pricing on its version: dsKept on Carol’s disk, dsRev not moved', async () => {
    const BOB = { kind: 'person', name: 'Bob' } as const;
    const bobHead = readHead(join(bob.ctx.paths.designRoot, DS_PATH));
    if (bobHead.state !== 'ok') throw new Error(`bob's head.json is ${bobHead.state}`);
    expect(bob.meta('ui/Pricing.tsx').dsRev).toBe(R0); // left out by his publish
    const r = await bob.engine.canvasLeave('ui/Pricing.tsx', { by: BOB });
    expect(typeof r.actionId).toBe('string');
    expect(bob.meta('ui/Pricing.tsx')).toMatchObject({ dsRev: R0, dsKept: bobHead.doc.head });
    await waitFor(async () => {
      await carol.runtime.pullRemoteNow();
      return carol.meta('ui/Pricing.tsx').dsKept === bobHead.doc.head;
    }, "bob's keep on carol's disk");
    expect(carol.meta('ui/Pricing.tsx').dsRev).toBe(R0);
    const [action] = await hubHistory();
    expect(action).toMatchObject({ actionId: r.actionId, actor: 'bob@x.test' });
  });

  test('Carol keeps a following canvas: its pin lands on Bob’s disk', async () => {
    expect(carol.meta('ui/Landing.tsx').dsRev).toBeUndefined();
    const r = await carol.engine.canvasLeave('ui/Landing.tsx', { by: PERSON });
    expect(typeof r.actionId).toBe('string');
    expect(carol.meta('ui/Landing.tsx').dsRev).toBe(R0);
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return bob.meta('ui/Landing.tsx').dsRev === R0;
    }, "carol's keep on bob's disk");
    const [action] = await hubHistory();
    expect(action).toMatchObject({ actionId: r.actionId, actor: 'carol@x.test' });
  });

  test('a later Update moves the pin on every peer: dsRev and dsKept go', async () => {
    const BOB = { kind: 'person', name: 'Bob' } as const;
    const u = await bob.engine.canvasUpdate('ui/Pricing.tsx', { by: BOB });
    expect(typeof u.actionId).toBe('string');
    await waitFor(async () => {
      await carol.runtime.pullRemoteNow();
      const m = carol.meta('ui/Pricing.tsx');
      return m.dsRev === undefined && m.dsKept === undefined;
    }, "bob's update on carol's disk");
  });
});
