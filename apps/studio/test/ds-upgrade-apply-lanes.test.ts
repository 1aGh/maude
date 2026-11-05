// Bring-up apply sends the kernel only canvas LANES (the .tsx, .meta.json, .annotations.json of a
// canvas). A codemod also edits a canvas's CSS twin (`ui/Twin.css`: a native alias), which is no
// lane of any document: sent to the kernel, a linked hub answered `unknown-canvas` and the local home
// `invalid`, and the whole apply was refused. The twin rides the file plane like the system files,
// after the kernel accepted, and the one ⌘Z puts it back with them.
//
//   - a local project (the real local home)
//   - a project linked to a real hub in transactions mode (two peers: the action is on the hub and
//     the canvas lane reaches the OTHER peer's disk)
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
import { kernelPortFrom } from '../ds/engine.ts';
import { registerDsUndoHook } from '../ds/undo-hook.ts';
import { applyStage } from '../ds/upgrade-apply.ts';
import { proveStage, type RenderJob, type RenderResult } from '../ds/upgrade-prove.ts';
import { discardStage, stageUpgrade } from '../ds/upgrade-stage.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';
import { cleanup, makeProject, PERSON, type Project } from './_ds-engine-fixture.ts';
import { artboard, FX, fxConfigEntry, fxFiles, writeFx } from './_ds-upgrade-fixture.ts';

const TWIN_TSX = artboard(
  'twin',
  `<div className="fx twin" data-theme="light" style={{ width: 240, height: 160, color: "var(--accent-muted)" }} />`
).replace('import { DesignCanvas', `import "./Twin.css";\nimport { DesignCanvas`);
const TWIN_CSS = `.twin {\n  background: var(--accent-muted);\n}\n`;

const passAll = async (job: RenderJob): Promise<RenderResult> => ({
  canvases: job.canvases.map((c) => ({
    path: c.path,
    artboards: [{ id: 'a', theme: null, changed: 0, area: 1, fail: false }],
  })),
});
const fakeStudio = async () => ({ origin: 'http://127.0.0.1:1', stop: async () => {} });

describe('ds-upgrade apply — a CSS twin (local project)', () => {
  let p: Project;
  let off: () => void;
  beforeAll(async () => {
    p = await makeProject();
    off = registerDsUndoHook(p.engine);
    await writeFx((rel, text) => p.outside(rel, text));
    await p.outside('ui/Twin.css', TWIN_CSS);
    await p.outside('ui/Twin.tsx', TWIN_TSX);
    await p.outside('ui/Twin.meta.json', `${JSON.stringify({ designSystem: FX.name })}\n`);
    const cfg = JSON.parse(p.read('config.json') as string);
    cfg.designSystems.push(fxConfigEntry());
    p.write('config.json', `${JSON.stringify(cfg, null, 2)}\n`);
  });
  afterAll(() => {
    off();
    cleanup();
  });

  test('the twin is written on the file plane after the kernel accepted; ⌘Z puts it back', async () => {
    const { stage } = stageUpgrade({ designRoot: p.designRoot, ds: FX.name, judged: [] });
    const twin = stage.canvases.find((c) => c.path === 'ui/Twin.tsx');
    expect(twin?.files).toContain('ui/Twin.css');
    await proveStage(p.designRoot, FX.name, stage.stamp, {
      bootStudio: fakeStudio,
      render: passAll,
    });
    const r = await applyStage({
      designRoot: p.designRoot,
      ds: FX.name,
      stamp: stage.stamp,
      kernel: () => p.engine.kernel(),
      by: PERSON,
    });
    expect(typeof r.actionId).toBe('string');
    await p.home.flush();
    expect(p.read('ui/Twin.css')).toContain('var(--accent-soft)');
    expect(p.read('ui/Good.tsx')).toContain('var(--accent-soft)');
    const u = await p.undo({ actionId: r.actionId });
    expect(u.status).toBe(200);
    await p.home.flush();
    expect(p.read('ui/Twin.css')).toBe(TWIN_CSS);
  });
});

/* ------------------------------------------------------- a real hub */

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
if (!HUB_READY)
  console.warn('[ds-upgrade-apply-lanes] hub half SKIPPED — apps/hub dependencies missing.');

const GROUPS = [
  { label: 'Canvases', path: 'ui' },
  { label: 'Systems', path: 'system' },
];

async function waitFor<T>(fn: () => Promise<T | null | false>, what: string, ms = 30_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v as T;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

interface Hub {
  proc: ChildProcess;
  http: string;
  port: string;
  tokens: Record<'owner' | 'carol' | 'bob', string>;
}

function startHub(dataDir: string): Promise<Hub> {
  mkdirSync(dataDir, { recursive: true });
  const tokensMjs = pathToFileURL(join(HUB_DIR, 'src', 'tokens.mjs')).href;
  const mint = `
    import { writeFileSync } from 'node:fs';
    import { addToken } from ${JSON.stringify(tokensMjs)};
    const d = process.argv[1];
    writeFileSync(d + '/test-tokens.json', JSON.stringify({
      owner: addToken(d, { label: 'owner-machine', scope: '*' }).value,
      carol: addToken(d, { label: 'carol', scope: '*', role: 'owner', owner: 'carol@x.test' }).value,
      bob: addToken(d, { label: 'bob', scope: '*', role: 'member', owner: 'bob@x.test' }).value,
    }));`;
  const m = spawnSync('node', ['--input-type=module', '-e', mint, dataDir], { encoding: 'utf8' });
  if (m.status !== 0) throw new Error(`minting tokens failed: ${m.stderr}`);
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [FIXTURE, dataDir, '0', '--transactions'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`hub did not start: ${buf}`)), 20_000);
    proc.stdout?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
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
      themeDefault: 'light',
      tokensCssRel: FX.tokensCssRel,
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
      tokensUrlRel: `design/${FX.tokensCssRel}`,
      systemDirRel: 'system',
    },
    bus: createBus(),
  } as unknown as Context;
}

/** The system + every file the file plane would have delivered (Plane B is not run here). */
function writeProject(designRoot: string, canvases: boolean) {
  const put = (rel: string, text: string) => {
    mkdirSync(dirname(join(designRoot, rel)), { recursive: true });
    writeFileSync(join(designRoot, rel), text);
  };
  put(
    'config.json',
    `${JSON.stringify({ designSystems: [fxConfigEntry()], defaultDesignSystem: FX.name, canvasGroups: GROUPS }, null, 2)}\n`
  );
  for (const [rel, text] of Object.entries(fxFiles())) put(rel, text);
  put('ui/Twin.css', TWIN_CSS);
  if (!canvases) return;
  put('ui/Twin.tsx', TWIN_TSX);
  put('ui/Twin.meta.json', `${JSON.stringify({ designSystem: FX.name })}\n`);
}

async function peer(repoRoot: string, url: string): Promise<SyncRuntime> {
  const rt = createSyncRuntime(makeCtx(repoRoot, url), {
    registry: createRegistry(noopCallbacks()),
    transactionRetryMs: 100,
    auth: { renewCredential: async () => null },
  });
  if (!rt) throw new Error('runtime refused to start');
  await rt.start();
  return rt;
}

describe.skipIf(!HUB_READY)('ds-upgrade apply — a CSS twin (linked to a real hub)', () => {
  let root: string;
  let hub: Hub;
  let carol: SyncRuntime;
  let bob: SyncRuntime;
  const saved: Record<string, string | undefined> = {};
  const carolDesign = () => join(root, 'carol', 'design');
  const bobDesign = () => join(root, 'bob', 'design');
  const read = (dr: string, rel: string) =>
    existsSync(join(dr, rel)) ? readFileSync(join(dr, rel), 'utf8') : null;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'ds-upgrade-hub-'));
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
    writeProject(carolDesign(), true);
    writeProject(bobDesign(), false);
    carol = await peer(join(root, 'carol'), carolUrl);
    await waitFor(async () => {
      const res = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
        headers: { authorization: `Bearer ${hub.tokens.owner}` },
      });
      const b = (await res.json()) as { docs: { path: string }[] };
      return b.docs.some((d) => d.path === 'ui/Twin.tsx');
    }, 'the hub to accept the canvas');
    bob = await peer(join(root, 'bob'), bobUrl);
    await waitFor(async () => {
      await bob.pullRemoteNow();
      return read(bobDesign(), 'ui/Twin.tsx') !== null;
    }, "bob's copy");
  }, 120_000);

  afterAll(async () => {
    await carol?.stop();
    await bob?.stop();
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

  test('apply is accepted: ONE action on the hub, the canvas on the other peer, the twin on disk', async () => {
    const dr = carolDesign();
    const { stage } = stageUpgrade({ designRoot: dr, ds: FX.name, judged: [] });
    try {
      expect(stage.canvases.find((c) => c.path === 'ui/Twin.tsx')?.files).toContain('ui/Twin.css');
      await proveStage(dr, FX.name, stage.stamp, { bootStudio: fakeStudio, render: passAll });
      const r = await applyStage({
        designRoot: dr,
        ds: FX.name,
        stamp: stage.stamp,
        kernel: kernelPortFrom(() => carol),
        by: PERSON,
      });
      expect(typeof r.actionId).toBe('string');
      expect(r.updated).toBe(1);
      expect(read(dr, 'ui/Twin.css')).toContain('var(--accent-soft)');
      expect(read(dr, 'ui/Twin.tsx')).toContain('className="ds twin"');
      expect(read(dr, FX.tokensCssRel)).toContain('--accent-muted: var(--accent-soft);');
      const res = await fetch(`${hub.http}/api/projects/current/v1/history?limit=5`, {
        headers: { authorization: `Bearer ${hub.tokens.owner}` },
      });
      const history = ((await res.json()) as { history: { actionId: string; label: string }[] })
        .history;
      expect(history[0]).toMatchObject({
        actionId: r.actionId,
        label: `Brought ${FX.name} up to schema v1`,
      });
      // the OTHER peer: the canvas lane arrived through the hub
      await waitFor(async () => {
        await bob.pullRemoteNow();
        return read(bobDesign(), 'ui/Twin.tsx')?.includes('className="ds twin"') ?? false;
      }, "the upgraded canvas on bob's disk");
    } finally {
      try {
        discardStage(dr, FX.name, stage.stamp);
      } catch {
        /* applied: the stage is gone */
      }
    }
  }, 60_000);
});
