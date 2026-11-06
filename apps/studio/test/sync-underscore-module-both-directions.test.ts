// fix/207 — a `_` module inside a design system (`system/<ds>/preview/_ui-feedback.tsx`) is the
// user's file: it travels as a project document in BOTH directions and is never held as a
// "<canvas> differs from the project" conflict. Only a first design-root segment starting with `_`
// (`_state/`, `_history/`, …) is runtime state. Found read-only on design.studyfi.com, v2.0.6.
//
// Real hub (Node fixture), two peers, as offline-create-both-directions.test.ts. The oracle is the
// other peer's disk, the hub's own document list, and each peer's held-conflict notices.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry } from '../collab/registry.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';

const GROUPS = [
  { label: 'Canvases', path: 'ui' },
  { label: 'Design systems', path: 'system' },
];

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
if (!HUB_READY)
  console.warn('[sync-underscore-module-both-directions] SKIPPED — needs apps/hub deps.');

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
    await new Promise((r) => setTimeout(r, 50));
  }
}

interface Hub {
  proc: ChildProcess;
  http: string;
  port: string;
  tokens: Record<'owner' | 'alice' | 'bob' | 'viewer', string>;
}

function startHub(dataDir: string, port = '0'): Promise<Hub> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [FIXTURE, dataDir, port, '--transactions'], {
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

interface Peer {
  ctx: Context;
  runtime: SyncRuntime;
  read: (rel: string) => string | null;
  write: (rel: string, text: string) => void;
}

function makeCtx(repoRoot: string, url: string): Context {
  const designRoot = join(repoRoot, 'design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  writeFileSync(join(designRoot, 'config.json'), JSON.stringify({ canvasGroups: GROUPS }));
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

async function startPeer(repoRoot: string, url: string): Promise<Peer> {
  const ctx = makeCtx(repoRoot, url);
  const registry = createRegistry({
    async seed() {},
    async persistJson() {},
    async persistBinary() {},
  });
  const runtime = createSyncRuntime(ctx, {
    registry,
    transactionRetryMs: 100,
    auth: { renewCredential: async () => null },
  });
  if (!runtime) throw new Error('runtime refused to start');
  await runtime.start();
  const file = (rel: string) => join(ctx.paths.designRoot, rel);
  return {
    ctx,
    runtime,
    read: (rel) => {
      try {
        return readFileSync(file(rel), 'utf8');
      } catch {
        return null;
      }
    },
    write: (rel, text) => {
      writeFileSync(file(rel), text);
      ctx.bus.emit('fs:any', rel);
    },
  };
}

const MODULE = 'system/ds/preview/_ui-feedback.tsx';
const MODULE_CSS = 'system/ds/preview/_ui-feedback.css';
const SPECIMEN = 'system/ds/preview/components-banner.tsx';

/** A DS component module: named exports, its own stylesheet, no default export. */
const moduleSrc = (label: string) =>
  `import './_ui-feedback.css';\n\nexport type Intent = 'success' | 'error';\n\nexport function Banner({ intent = 'success' }: { intent?: Intent }) {\n  return <div className={\`ui-banner ui-banner--\${intent}\`}>${label}</div>;\n}\n\nexport function Toast() {\n  return <output className="ui-toast">${label}</output>;\n}\n`;
const moduleCss = (c: string) => `.ui-banner { color: ${c}; }\n.ui-toast { color: ${c}; }\n`;
const specimenSrc = `import { Banner } from './_ui-feedback';\n\nexport default function Specimen() {\n  return <Banner intent="success" />;\n}\n`;

/** The held source conflicts a peer reports (what the studio toasts as "differs from the project"). */
const held = (p: Peer) =>
  (p.runtime.status()?.notices ?? [])
    .map((n) => n.id)
    .filter((id) => id.startsWith('source-conflict-'));

describe.skipIf(!HUB_READY)('a `_` DS module — desktop ⇄ cloud on a real hub', () => {
  let root: string;
  let hub: Hub;
  let desktop: Peer;
  let cloud: Peer;
  const saved: Record<string, string | undefined> = {};

  const api = async (route: string) => {
    const res = await fetch(`${hub.http}/api/projects/current/v1/${route}`, {
      headers: { authorization: `Bearer ${hub.tokens.owner}` },
    });
    return (await res.json()) as Record<string, unknown>;
  };
  const hubDocAt = async (rel: string) =>
    ((await api('bootstrap')).docs as { path: string; retired: boolean }[]).some(
      (d) => d.path === rel && !d.retired
    );

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'underscore-module-'));
    for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI', 'MAUDE_SHARED_DOC'])
      saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    hub = await startHub(join(root, 'hub'));
    const desktopUrl = `http://127.0.0.1:${hub.port}`;
    const cloudUrl = `http://localhost:${hub.port}`;
    const hubsFile = join(root, 'hubs.json');
    writeFileSync(
      hubsFile,
      JSON.stringify({
        hubs: { [desktopUrl]: { token: hub.tokens.alice }, [cloudUrl]: { token: hub.tokens.bob } },
      }),
      { mode: 0o600 }
    );
    process.env.HUBS_CONFIG_PATH = hubsFile;
    mkdirSync(join(root, 'desktop', 'design', 'system', 'ds', 'preview'), { recursive: true });
    writeFileSync(join(root, 'desktop', 'design', MODULE), moduleSrc('v0'));
    writeFileSync(join(root, 'desktop', 'design', MODULE_CSS), moduleCss('red'));
    writeFileSync(join(root, 'desktop', 'design', SPECIMEN), specimenSrc);
    desktop = await startPeer(join(root, 'desktop'), desktopUrl);
    await waitFor(() => hubDocAt(SPECIMEN), 'the project to have the specimen');
    cloud = await startPeer(join(root, 'cloud'), cloudUrl);
    await waitFor(async () => {
      await cloud.runtime.pullRemoteNow();
      return cloud.read(SPECIMEN) === specimenSrc;
    }, 'the cloud peer to have the specimen');
  }, 90_000);

  afterAll(async () => {
    await desktop?.runtime.stop();
    await cloud?.runtime.stop();
    if (hub) await stopHub(hub);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('the module and its stylesheet are saved to the project and reach the other peer', async () => {
    await waitFor(() => hubDocAt(MODULE), 'the project to have the `_` module', 30_000);
    await waitFor(async () => {
      await cloud.runtime.pullRemoteNow();
      return cloud.read(MODULE) === moduleSrc('v0') && cloud.read(MODULE_CSS) === moduleCss('red');
    }, 'the `_` module and its css on the cloud peer');
    expect(held(desktop)).toEqual([]);
    expect(held(cloud)).toEqual([]);
  }, 60_000);

  test('desktop → cloud: an edit of the module is saved, never held', async () => {
    desktop.write(MODULE, moduleSrc('desktop edit'));
    desktop.write(MODULE_CSS, moduleCss('blue'));
    await waitFor(async () => {
      await cloud.runtime.pullRemoteNow();
      return (
        cloud.read(MODULE) === moduleSrc('desktop edit') &&
        cloud.read(MODULE_CSS) === moduleCss('blue')
      );
    }, 'the desktop edit on the cloud peer');
    await new Promise((r) => setTimeout(r, 1500));
    expect(held(desktop)).toEqual([]);
    expect(held(cloud)).toEqual([]);
    expect(desktop.read(MODULE)).toBe(moduleSrc('desktop edit'));
  }, 60_000);

  test('cloud → desktop: an edit of the module is saved, never held', async () => {
    cloud.write(MODULE, moduleSrc('cloud edit'));
    cloud.write(MODULE_CSS, moduleCss('green'));
    await waitFor(async () => {
      await desktop.runtime.pullRemoteNow();
      return (
        desktop.read(MODULE) === moduleSrc('cloud edit') &&
        desktop.read(MODULE_CSS) === moduleCss('green')
      );
    }, 'the cloud edit on the desktop');
    await new Promise((r) => setTimeout(r, 1500));
    expect(held(desktop)).toEqual([]);
    expect(held(cloud)).toEqual([]);
  }, 60_000);

  test('a restart of the desktop finds the module agreed, not differing', async () => {
    await desktop.runtime.stop();
    desktop = await startPeer(join(root, 'desktop'), `http://127.0.0.1:${hub.port}`);
    await new Promise((r) => setTimeout(r, 3000));
    await desktop.runtime.pullRemoteNow();
    expect(held(desktop)).toEqual([]);
    expect(desktop.read(MODULE)).toBe(moduleSrc('cloud edit'));
  }, 60_000);
});
