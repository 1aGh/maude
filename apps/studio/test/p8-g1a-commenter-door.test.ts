// P8 G1a — a Can comment person's comment reaches the project (decision v2-1.7-hub-comment-door).
//
// The bug (role-surfaces lane, md-comment-post): Petra, Can comment, posted a comment; her own
// window showed it, the owner's never did. Her studio PROPOSED the comments lane like an editor,
// and the project refuses every proposal from a session that cannot edit —
// `[sync/tx] Edit comments: refused (403); kept aside, not retried`. A commenter's comment has
// one way in: the hub's comment door, which judges `comment`, stamps the author from the session
// and saves the op itself. This drives the real thing: a hub in accepted mode, an editor's
// runtime that carries the canvas, a commenter's runtime that pulled it down, and the studio's
// own `commentOp` (what `POST /_api/comments/op` calls) on the commenter's side.
//
// Never widened: the commenter still cannot propose anything (the same 403), and a body that
// names another author is stamped as the commenter.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApi } from '../api.ts';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import { type Context, createBus } from '../context.ts';
import { readLaneFromDoc } from '../sync/codec.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
const FILE = 'design/ui/home.tsx';
const SLUG = 'ui-home';

async function waitFor<T>(fn: () => T | Promise<T>, what: string, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}

function startHub(
  dataDir: string
): Promise<{ proc: ChildProcess; port: string; tokens: Record<string, string> }> {
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
        resolve({ proc, port: info.port, tokens: info.tokens });
        return;
      }
    });
    proc.stderr?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
    });
  });
}

function hubCtx(repoRoot: string, url: string): Context {
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

const noRoom = () =>
  createRegistry({
    async seed() {},
    async persistJson() {},
    async persistBinary() {},
  } as RoomCallbacks);

describe.skipIf(!HUB_READY)('a Can comment person comments on a project in accepted mode', () => {
  let root = '';
  let hub: { proc: ChildProcess; port: string; tokens: Record<string, string> };
  let editor: SyncRuntime;
  let commenter: SyncRuntime;
  let commenterCtx: Context;
  const editorRooms = noRoom();
  const commenterRooms = noRoom();
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'p8-g1a-commenter-'));
    for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI']) saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    hub = await startHub(join(root, 'hub'));
    // Two people on one machine: the same hub under two names, one credential each.
    const editorUrl = `http://127.0.0.1:${hub.port}`;
    const commenterUrl = `http://localhost:${hub.port}`;
    const hubsFile = join(root, 'hubs.json');
    writeFileSync(
      hubsFile,
      JSON.stringify({
        hubs: {
          [editorUrl]: { token: hub.tokens.alice, role: 'member' },
          [commenterUrl]: { token: hub.tokens.viewer, role: 'viewer' },
        },
      }),
      { mode: 0o600 }
    );
    process.env.HUBS_CONFIG_PATH = hubsFile;

    mkdirSync(join(root, 'alice', 'design', 'ui'), { recursive: true });
    writeFileSync(join(root, 'alice', FILE), 'export default () => <p>home</p>;\n');
    const editorCtx = hubCtx(join(root, 'alice'), editorUrl);
    const e = createSyncRuntime(editorCtx, {
      registry: editorRooms,
      transactionRetryMs: 100,
      auth: { renewCredential: async () => null },
    });
    if (!e) throw new Error('the editor runtime refused to start');
    editor = e;
    await editor.start();
    await waitFor(() => editor.acceptedMode?.() === true, 'accepted mode');
    await waitFor(
      () => editor.proposeLane?.(SLUG, 'comments', '[]', { baseText: '' }) ?? null,
      'the canvas on the hub'
    );

    // Petra's checkout has the canvas (a clone); her runtime links it, read-only.
    mkdirSync(join(root, 'petra', 'design', 'ui'), { recursive: true });
    writeFileSync(join(root, 'petra', FILE), 'export default () => <p>home</p>;\n');
    commenterCtx = hubCtx(join(root, 'petra'), commenterUrl);
    const c = createSyncRuntime(commenterCtx, {
      registry: commenterRooms,
      transactionRetryMs: 100,
      auth: { renewCredential: async () => null },
    });
    if (!c) throw new Error('the commenter runtime refused to start');
    commenter = c;
    await commenter.start();
    // carried once her replica holds the project's source
    await waitFor(
      () => readLaneFromDoc(commenterRooms.getDoc(SLUG), 'html').includes('home'),
      'the commenter’s replica',
      30_000
    );
    commenterCtx.syncControl = { current: () => commenter } as Context['syncControl'];
  }, 90_000);

  afterAll(async () => {
    await commenter?.stop();
    await editor?.stop();
    if (hub && hub.proc.exitCode === null) {
      await new Promise<void>((r) => {
        hub.proc.once('exit', () => r());
        hub.proc.kill('SIGTERM');
      });
    }
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('the comment is saved on the project as the commenter, and the editor sees it', async () => {
    // server.ts's hook, as it is: a comments change is PROPOSED in accepted mode.
    const proposed: string[] = [];
    const api = createApi(commenterCtx, {
      onCommentsChanged: async (file, comments, base) => {
        const r = await commenter.proposeLane?.(
          api.fileSlug(file),
          'comments',
          JSON.stringify(comments),
          base ? { baseText: JSON.stringify(base) } : {}
        );
        proposed.push(`${r?.status} ${r?.code ?? ''}`.trim());
      },
    });
    const say = `Číslo by mělo být větší ${Date.now()}`;
    const out = await waitFor(async () => {
      const r = await api.commentOp(
        FILE,
        { op: 'add', file: FILE, text: say, author: 'Olga Owner' } as never,
        { name: 'Petra' }
      );
      // the canvas is carried once the commenter's provider is up
      return r.ok || (r as { code?: string }).code !== 'retryable' ? r : null;
    }, 'the comment answered');
    expect(out).toMatchObject({ ok: true });
    // it reaches the project: the editor's replica of the comments lane holds it
    const lane = await waitFor(() => {
      const text = readLaneFromDoc(editorRooms.getDoc(SLUG), 'comments');
      return text.includes(say) ? text : null;
    }, 'the comment on the editor’s side');
    const record = (JSON.parse(lane) as Array<{ text: string; author: string }>).find(
      (c) => c.text === say
    );
    // stamped from the session (the hub's viewer token), never the body's "Olga Owner"
    expect(record?.author).not.toBe('Olga Owner');
    expect(record?.author).toBe('viewer');
    // and nothing was proposed as an edit on the way
    expect(proposed).toEqual([]);
  }, 60_000);

  test('a commenter still cannot propose a lane: the project refuses it', async () => {
    const forged = JSON.stringify([
      { id: 'c_forged', file: FILE, text: 'rewritten', author: 'Olga Owner' },
    ]);
    const r = await commenter.proposeLane?.(SLUG, 'comments', forged, {
      baseText: readLaneFromDoc(commenterRooms.getDoc(SLUG), 'comments'),
    });
    expect(r?.status).toBe('rejected');
  }, 30_000);
});
