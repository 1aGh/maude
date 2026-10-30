// S4.15 (canvas 15 `an-ai-apply`): "Make these changes" is ONE action. The apply run edits the design AND
// resolves the stickies it answered (`maude design annotate --resolve`, tagged `run:<runId>`, contract
// S4-S5-ai-annotations §2/§4.2). The result card's Undo, ⌘Z and "Undo this chat" revert both together: the
// design change and the resolves go back at once, and a teammate sees the same on the other side.
//
// Two studio sync runtimes against one REAL hub in `transactions` mode (spawned under Node — Bun cannot load the
// hub's better-sqlite3); the oracle is always the OTHER peer's files and replica, never the proposing side's view
// of its own success. Same harness shape as sync-accepted-runtime.test.ts (T-S4.5b is the board-only case).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiBatch } from '../annotations/ai-write.ts';
import { stageRunAnnotations } from '../annotations/run-tag.ts';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { readLaneFromDoc } from '../sync/codec.ts';
import { hashBytes } from '../sync/echo-guard.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';
import { board, elements, sticky } from './fixtures/annotations-v2/boards.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
if (!HUB_READY) {
  console.warn('[annotations-ai-undo] SKIPPED — apps/hub dependencies are not installed.');
}

const hero = (width: number) =>
  `export default function Hero() {\n  return <img data-cd-id="hero-picture" width={${width}} alt="Hero" />;\n}\n`;

async function waitFor<T>(
  fn: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  what: string,
  ms = 20_000
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

interface Peer {
  ctx: Context;
  runtime: SyncRuntime;
  registry: ReturnType<typeof createRegistry>;
  read: (rel: string) => string | null;
  write: (rel: string, text: string) => void;
}

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

async function startPeer(repoRoot: string, url: string): Promise<Peer> {
  const ctx = makeCtx(repoRoot, url);
  const registry = createRegistry(noopCallbacks());
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
    registry,
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

describe.skipIf(!HUB_READY)('annotations — AI run: design change + resolves are one undo', () => {
  let root: string;
  let hub: Hub;
  let alice: Peer;
  let bob: Peer;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'annotations-ai-undo-'));
    for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI', 'MAUDE_SHARED_DOC'])
      saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    hub = await startHub(join(root, 'hub'));
    const aliceUrl = `http://127.0.0.1:${hub.port}`;
    const bobUrl = `http://localhost:${hub.port}`;
    const hubsFile = join(root, 'hubs.json');
    writeFileSync(
      hubsFile,
      JSON.stringify({
        hubs: { [aliceUrl]: { token: hub.tokens.alice }, [bobUrl]: { token: hub.tokens.bob } },
      }),
      { mode: 0o600 }
    );
    process.env.HUBS_CONFIG_PATH = hubsFile;
    mkdirSync(join(root, 'alice', 'design', 'ui'), { recursive: true });
    writeFileSync(join(root, 'alice', 'design', 'ui', 'home.tsx'), hero(616));
    alice = await startPeer(join(root, 'alice'), aliceUrl);
    await waitFor(async () => {
      const res = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
        headers: { authorization: `Bearer ${hub.tokens.owner}` },
      });
      const b = (await res.json()) as { docs: { path: string }[] };
      return b.docs.some((d) => d.path === 'ui/home.tsx');
    }, 'the hub to accept ui/home.tsx');
    bob = await startPeer(join(root, 'bob'), bobUrl);
  }, 60_000);

  afterAll(async () => {
    await alice?.runtime.stop();
    await bob?.runtime.stop();
    if (hub) await stopHub(hub);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('the apply run changes the design and resolves three stickies: one action, one Undo this chat', async () => {
    // The canvas, and a board of three stickies a person left on it.
    alice.write('ui/hero.tsx', hero(616));
    await alice.runtime.rescanNow();
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return bob.read('ui/hero.tsx') === hero(616);
    }, 'the hero canvas on bob');
    const slug = 'ui-hero';
    const people = [
      sticky('s_a1', 'Photo bigger?'),
      sticky('s_b2', 'Hero feels small next to the headline', { x: 220 }),
      sticky('s_c3', 'Let it fill the right half', { x: 440 }),
      sticky('s_d4', 'Warmer sun?', { x: 660 }),
    ];
    const seed = board(...people);
    const base0 = readLaneFromDoc(alice.registry.getDoc(slug), 'annotations');
    const proposed = await alice.runtime.proposeLane?.(slug, 'annotations', seed, {
      baseText: base0,
    });
    expect(proposed?.status).toBe('accepted');
    const bobBoard = () => readLaneFromDoc(bob.registry.getDoc(slug), 'annotations');
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return bobBoard().includes('s_c3');
    }, 'the stickies on bob');
    expect(parseBoard(bobBoard()).elements.every((e) => e.resolved === undefined)).toBe(true);

    // What the verb sends: the board with the answered stickies resolved (the real AiBatch semantics).
    const batch = new AiBatch(elements(...people));
    expect(batch.resolveStickies({ ids: ['s_a1', 's_b2', 's_c3'] })).toEqual([
      's_a1',
      's_b2',
      's_c3',
    ]);
    const resolvedBoard = serializeBoard(batch.elements);
    expect(
      parseBoard(resolvedBoard).elements.find((e) => e.id === 's_d4')?.resolved
    ).toBeUndefined();

    // The run: it edits the design, then the tagged annotation batch joins the same stage.
    const base = readLaneFromDoc(alice.registry.getDoc(slug), 'annotations');
    alice.runtime.beginAiAction?.('acp:chat-apply', 'Claude: make these changes', {
      runId: 'r_apply0001',
      chatId: 'chat-apply',
    });
    // p8-a1-claims — the run's tool claims the exact bytes it writes (every run is claim-only)
    alice.runtime.claimAiWrite?.('r_apply0001', 'design/ui/hero.tsx', hashBytes(hero(720)));
    alice.write('ui/hero.tsx', hero(720));
    await new Promise((r) => setTimeout(r, 400));
    const staged = stageRunAnnotations(alice.runtime, {
      runId: 'r_apply0001',
      open: true,
      chatId: 'chat-apply',
      label: 'Claude: make these changes',
      slug,
      canvasRel: 'design/ui/hero.tsx',
      text: resolvedBoard,
      base,
      writeId: 'run:r_apply0001',
    });
    expect(staged).not.toBeNull();
    await new Promise((r) => setTimeout(r, 800));
    // staged with the run: a teammate sees neither half yet
    expect(bob.read('ui/hero.tsx')).toBe(hero(616));
    expect(parseBoard(bobBoard()).elements.some((e) => e.resolved)).toBe(false);

    const ended = await alice.runtime.endAiAction?.('r_apply0001', 'done');
    expect(ended?.status).toBe('accepted');
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return bob.read('ui/hero.tsx') === hero(720);
    }, 'the design change on bob');
    await waitFor(
      () => parseBoard(bobBoard()).elements.filter((e) => e.resolved).length === 3,
      'the three resolves on bob'
    );
    // ONE action for the chat, covering both the design and the board
    const rows = (await alice.runtime.acceptedHistory?.({ chat: 'chat-apply', limit: 20 })) ?? [];
    expect(rows.length).toBe(1);
    // "Warmer sun?" was not answered: it stays open
    expect(parseBoard(bobBoard()).elements.find((e) => e.id === 's_d4')?.resolved).toBeUndefined();
    // the stickies are KEPT (resolved, never deleted)
    expect(
      parseBoard(bobBoard())
        .elements.map((e) => e.id)
        .sort()
    ).toEqual(['s_a1', 's_b2', 's_c3', 's_d4'].sort());

    // Undo this chat: the design AND the resolves go back together.
    const undone = await alice.runtime.acceptedUndo?.({ chatId: 'chat-apply' });
    expect(undone?.status).toBe('accepted');
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return bob.read('ui/hero.tsx') === hero(616);
    }, 'the design change undone on bob');
    await waitFor(
      () => parseBoard(bobBoard()).elements.every((e) => e.resolved === undefined),
      'the resolves undone on bob'
    );
    expect(alice.read('ui/hero.tsx')).toBe(hero(616));
    expect(
      parseBoard(bobBoard())
        .elements.map((e) => e.id)
        .sort()
    ).toEqual(['s_a1', 's_b2', 's_c3', 's_d4'].sort());
  }, 90_000);

  test('an untagged batch (an outside write) is its own action: Undo this chat does not touch it', async () => {
    const slug = 'ui-hero';
    const before = readLaneFromDoc(alice.registry.getDoc(slug), 'annotations');
    const els = parseBoard(before).elements;
    const batch = new AiBatch(els as never);
    batch.resolveStickies({ ids: ['s_d4'] });
    alice.runtime.beginAiAction?.('acp:chat-other', 'Claude: other', {
      runId: 'r_other0001',
      chatId: 'chat-other',
    });
    // proposed on its own — no claim, so it is NOT the run's
    const r = await alice.runtime.proposeLane?.(
      slug,
      'annotations',
      serializeBoard(batch.elements),
      {
        baseText: before,
        writeId: 'ai-annotate-abc123',
      }
    );
    expect(r?.status).toBe('accepted');
    await alice.runtime.endAiAction?.('r_other0001', 'done');
    const rows = (await alice.runtime.acceptedHistory?.({ chat: 'chat-other', limit: 20 })) ?? [];
    expect(rows.length).toBe(0);
  }, 60_000);
});
