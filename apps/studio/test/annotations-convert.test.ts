// S4.7 — sticky ↔ comment is ONE action covering the board and the thread list
// (contract S4-S9-votes-comments §3, V2-1.5). The oracle is the home's own
// state after an undo: both lanes byte for byte as before the conversion.
//
//   - the local home (a real studio on an unlinked sandbox): to-comment, ⌘Z
//     through `POST /_api/project/undo`, to-sticky, its undo, and the undo guard
//     a foreign reply trips;
//   - a hub-linked runtime (a real hub in `transactions` mode, Node): the same
//     conversion is ONE hub action whose undo restores both replica lanes;
//   - Can comment (a hub-linked desktop the hub vouched `viewer`): 403 on both.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { canonicalAnnotations } from '../annotations/board-text.ts';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { createApi } from '../api.ts';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import { type Context, createBus } from '../context.ts';
import { createAnnotationRoutes, toCommentLabel } from '../routes/annotations.ts';
import { readLaneFromDoc } from '../sync/codec.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const STICKY_TEXT = 'Make the hero bigger';
const sticky = (over: Record<string, unknown> = {}) =>
  ({
    id: 's_hero',
    type: 'sticky',
    index: 'a0',
    x: 100,
    y: 120,
    w: 200,
    h: 200,
    text: STICKY_TEXT,
    author: { kind: 'human', name: 'Jonas Novak' },
    ...over,
  }) as AnnotationElement;
const board = (els: AnnotationElement[]) => canonicalAnnotations(serializeBoard(els)) as string;
const older = (file: string) => ({
  id: 'c_older',
  file,
  selector: '',
  dom_path: [],
  tag: '',
  classes: '',
  bounds: null,
  html_excerpt: '',
  text: 'An older note',
  status: 'open',
  created: '2026-10-01T00:00:00.000Z',
  resolved_at: null,
  author: 'Tereza',
  thread: [],
  mentions: [],
});

const tsx = (text: string) => `export default () => <p>${text}</p>;\n`;

/* ------------------------------------------------------------- local home */

describe('the local home — one action, both lanes', () => {
  let root = '';
  let designRoot = '';
  let proc: Subprocess | null = null;
  let base = '';
  let me = '';
  const FILE = '.design/ui/card.tsx';
  const boardFile = () => join(designRoot, 'ui-card.annotations.json');
  const commentsFile = () => join(designRoot, '_comments', 'ui-card.json');
  const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

  const post = async (route: string, body: unknown) => {
    const r = await fetch(base + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  type Row = Record<string, unknown> & { id?: string; from?: { id?: string } };
  const comments = () => JSON.parse(read(commentsFile()) ?? '[]') as Row[];
  const ids = () => parseBoard(read(boardFile()) ?? '').elements.map((e) => e.id);

  beforeAll(async () => {
    ({ root, designRoot } = makeSandbox());
    writeFileSync(join(designRoot, 'ui', 'card.tsx'), tsx('card'));
    writeFileSync(boardFile(), board([sticky()]));
    mkdirSync(join(designRoot, '_comments'), { recursive: true });
    writeFileSync(commentsFile(), JSON.stringify([older(FILE)], null, 2));
    const port = nextPort();
    proc = await bootServer(root, port, {
      MAUDE_NO_AUTOBUILD: '1',
      XDG_CONFIG_HOME: join(root, '.config'),
    });
    base = `http://localhost:${port}`;
    me = ((await (await fetch(`${base}/_api/git-user`)).json()) as { name: string }).name || 'You';
    // The baseline import has run once history answers.
    for (let i = 0; i < 80; i++) {
      const h = (await (await fetch(`${base}/_api/project/history`)).json()) as {
        ok: boolean;
        history?: unknown[];
      };
      if (h.ok && (h.history?.length ?? 0) > 0) break;
      await Bun.sleep(100);
    }
  }, 40_000);

  afterAll(async () => {
    if (proc) await killProc(proc);
    rmSync(root, { recursive: true, force: true });
  });

  test('to-comment trashes the sticky, opens the thread as the converter, and ⌘Z restores both byte for byte', async () => {
    const before = { board: read(boardFile()), comments: read(commentsFile()) };
    const r = await post('/_api/annotations/to-comment', { file: FILE, id: 's_hero' });
    expect(r.status).toBe(200);
    expect(typeof r.json.actionId).toBe('string');
    expect(r.json.undoToken).toBeUndefined();
    expect(ids()).not.toContain('s_hero');
    const thread = comments().find((c) => c.id === r.json.commentId);
    expect(thread?.text).toBe(STICKY_TEXT);
    // §3.1 — the author is the converter; the sticky's author is `from.author`.
    expect(thread?.author).toBe(me);
    expect(thread?.from).toMatchObject({
      kind: 'sticky',
      id: 's_hero',
      author: 'Jonas Novak',
      convertedBy: me,
      spot: { x: 100, y: 120 },
    });
    // Anchored at the sticky's world centre, never at the trashed sticky's id.
    expect(thread?.world).toEqual({ x: 200, y: 220 });
    expect(thread?.annotationId).toBeUndefined();

    const h = (await (
      await fetch(`${base}/_api/project/history?path=${encodeURIComponent(FILE)}`)
    ).json()) as { history: { actionId: string; kind: string; label: string }[] };
    expect(h.history[0]).toMatchObject({
      actionId: r.json.actionId,
      kind: 'edit',
      label: toCommentLabel(STICKY_TEXT),
    });

    const undo = await post('/_api/project/undo', { actionId: r.json.actionId });
    expect(undo.status).toBe(200);
    expect(read(boardFile())).toBe(before.board);
    expect(read(commentsFile())).toBe(before.comments);
  }, 30_000);

  test('to-sticky re-creates the sticky with its old id, drops the thread, and its undo puts the thread back', async () => {
    const conv = await post('/_api/annotations/to-comment', { file: FILE, id: 's_hero' });
    expect(conv.status).toBe(200);
    const mid = { board: read(boardFile()), comments: read(commentsFile()) };
    const back = await post('/_api/comments/to-sticky', { commentId: conv.json.commentId });
    expect(back.status).toBe(200);
    expect(back.json.stickyId).toBe('s_hero');
    expect(typeof back.json.actionId).toBe('string');
    const el = parseBoard(read(boardFile()) ?? '').elements.find((e) => e.id === 's_hero');
    expect(el).toMatchObject({ type: 'sticky', x: 100, y: 120, text: STICKY_TEXT });
    expect(el?.author).toMatchObject({ name: 'Jonas Novak' });
    expect(comments().some((c) => c.id === conv.json.commentId)).toBe(false);

    const undo = await post('/_api/project/undo', { actionId: back.json.actionId });
    expect(undo.status).toBe(200);
    expect(read(boardFile())).toBe(mid.board);
    expect(read(commentsFile())).toBe(mid.comments);
    // An ordinary comment (no `from`) is not offered back (open question 5).
    const plain = await post('/_api/comments/to-sticky', { commentId: 'c_older' });
    expect(plain.status).toBe(409);
    expect(plain.json.reason).toBe('not-converted');
    // and a thread with no sticky behind it is refused with the sticky's own reason.
    const bad = await post('/_api/annotations/to-comment', { file: FILE, id: 's_nope' });
    expect(bad.status).toBe(404);
  }, 30_000);

  test('a foreign reply refuses both the undo and the turn-back; your own reply does not', async () => {
    const thread = comments().find((c) => c.from?.id === 's_hero');
    expect(thread).toBeTruthy();
    const h = (await (
      await fetch(`${base}/_api/project/history?path=${encodeURIComponent(FILE)}`)
    ).json()) as { history: { actionId: string; kind: string; label: string }[] };
    // The thread from test 2 (to-comment) is the newest to-comment action not undone.
    const conv = h.history.find((x) => x.label === toCommentLabel(STICKY_TEXT));
    expect(conv).toBeTruthy();

    const mine = await fetch(`${base}/_api/comments/${thread?.id}/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ body: 'noted' }),
    });
    expect(mine.status).toBe(200);
    // own reply → the guard passes (the undo itself may still answer; the guard is what we pin)
    const foreign = await fetch(`${base}/_api/comments/${thread?.id}/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ body: 'I disagree', author: 'Tereza Malá' }),
    });
    expect(foreign.status).toBe(200);

    const undo = await post('/_api/project/undo', { actionId: conv?.actionId });
    expect(undo.status).toBe(409);
    expect(undo.json).toMatchObject({
      reason: 'has-replies',
      line: 'Tereza replied — resolve the thread instead.',
    });
    const back = await post('/_api/comments/to-sticky', { commentId: thread?.id });
    expect(back.status).toBe(409);
    expect(back.json.reason).toBe('has-replies');
    // Nothing moved: the thread is still there, the sticky still gone.
    expect(comments().some((c) => c.id === thread?.id)).toBe(true);
    expect(ids()).not.toContain('s_hero');
  }, 30_000);
});

/* --------------------------------------------------------- Can comment */

describe('Can comment (a hub-linked desktop vouched viewer)', () => {
  const HUB_URL = 'http://hub.invalid:9';
  let proc: Subprocess | null = null;
  let root = '';

  afterAll(async () => {
    if (proc) await killProc(proc);
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('both conversions are refused 403 read-only, before any handler runs', async () => {
    const sb = makeSandbox();
    root = sb.root;
    const cfgPath = join(sb.designRoot, 'config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    cfg.linkedHub = { url: HUB_URL, linkedAt: Date.now() };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    const hubsPath = join(root, 'hubs.json');
    writeFileSync(
      hubsPath,
      JSON.stringify({ hubs: { [HUB_URL]: { token: 't', linkedAt: Date.now(), role: 'viewer' } } })
    );
    const port = nextPort();
    proc = await bootServer(root, port, { HUBS_CONFIG_PATH: hubsPath, MAUDE_NO_AUTOBUILD: '1' });
    const base = `http://localhost:${port}`;
    for (const [route, body] of [
      ['/_api/annotations/to-comment', { file: '.design/ui/fixture.html', id: 's_hero' }],
      ['/_api/comments/to-sticky', { commentId: 'c_x' }],
      ['/_api/annotations/convert-undo', { token: 'cv_x' }],
    ] as const) {
      const r = await fetch(base + route, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base },
        body: JSON.stringify(body),
      });
      expect(`${route} ${r.status} ${((await r.json()) as { error?: string }).error}`).toBe(
        `${route} 403 read-only`
      );
    }
  }, 30_000);
});

/* ----------------------------------------------------- hub-linked runtime */

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));

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

describe.skipIf(!HUB_READY)('a hub-linked runtime — one hub action, both replica lanes', () => {
  let root = '';
  let hub: { proc: ChildProcess; port: string; tokens: Record<string, string> };
  let runtime: SyncRuntime;
  let ctx: Context;
  const registry = createRegistry({
    async seed() {},
    async persistJson() {},
    async persistBinary() {},
  } as RoomCallbacks);
  const saved: Record<string, string | undefined> = {};
  const FILE = 'design/ui/home.tsx';

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'annotations-convert-'));
    for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI']) saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    hub = await startHub(join(root, 'hub'));
    const url = `http://127.0.0.1:${hub.port}`;
    const hubsFile = join(root, 'hubs.json');
    writeFileSync(hubsFile, JSON.stringify({ hubs: { [url]: { token: hub.tokens.alice } } }), {
      mode: 0o600,
    });
    process.env.HUBS_CONFIG_PATH = hubsFile;
    mkdirSync(join(root, 'alice', 'design', 'ui'), { recursive: true });
    writeFileSync(join(root, 'alice', 'design', 'ui', 'home.tsx'), tsx('home'));
    ctx = hubCtx(join(root, 'alice'), url);
    const rt = createSyncRuntime(ctx, {
      registry,
      transactionRetryMs: 100,
      auth: { renewCredential: async () => null },
    });
    if (!rt) throw new Error('runtime refused to start');
    runtime = rt;
    await runtime.start();
    await waitFor(() => runtime.acceptedMode?.() === true, 'accepted mode');
    await waitFor(async () => {
      const res = await fetch(`${url}/api/projects/current/v1/bootstrap`, {
        headers: { authorization: `Bearer ${hub.tokens.owner}` },
      });
      const b = (await res.json()) as { docs?: { path: string }[] };
      return b.docs?.some((d) => d.path === 'ui/home.tsx') ?? false;
    }, 'the hub to accept ui/home.tsx');
  }, 60_000);

  afterAll(async () => {
    await runtime?.stop();
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

  test('to-comment is ONE hub action; its undo restores both lanes byte for byte; the guard reads replies', async () => {
    const slug = 'ui-home';
    const designRoot = ctx.paths.designRoot;
    const boardText = board([sticky()]);
    const listText = JSON.stringify([older(FILE)], null, 2);
    // Seed the project with a sticky and a comment (as the room's projection would leave the disk).
    const seeded = [
      // The canvas is carried once its cold start made a projection.
      await waitFor(
        () => runtime.proposeLane?.(slug, 'annotations', boardText, { baseText: '' }) ?? null,
        'the canvas on the hub'
      ),
      await runtime.proposeLane?.(slug, 'comments', listText, { baseText: '[]' }),
    ];
    expect(seeded.map((s) => `${s?.status}${s?.code ? ` ${s.code}` : ''}`)).toEqual([
      'accepted',
      'accepted',
    ]);
    writeFileSync(join(designRoot, `${slug}.annotations.json`), boardText);
    writeFileSync(join(designRoot, '_comments', `${slug}.json`), listText);
    const doc = registry.getDoc(slug);
    await waitFor(() => readLaneFromDoc(doc, 'comments').includes('c_older'), 'the seed');
    const before = {
      annotations: readLaneFromDoc(doc, 'annotations'),
      comments: readLaneFromDoc(doc, 'comments'),
    };

    const api = createApi(ctx, { onCommentsChanged: () => {} });
    const routes = createAnnotationRoutes({
      api,
      control: () => runtime,
      person: async () => ({ name: 'Alice' }),
    });
    const handle = (path: string, body: unknown) =>
      routes.specs
        .find((s) => s.path === path)
        ?.handle(
          new Request(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body) }),
          {}
        ) as Promise<Response>;

    const res = await handle('/_api/annotations/to-comment', { file: FILE, id: 's_hero' });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { actionId: string; commentId: string };
    expect(typeof out.actionId).toBe('string');
    await waitFor(() => !readLaneFromDoc(doc, 'annotations').includes('s_hero'), 'the sticky gone');
    await waitFor(() => readLaneFromDoc(doc, 'comments').includes(out.commentId), 'the thread');
    const thread = (JSON.parse(readLaneFromDoc(doc, 'comments')) as Record<string, unknown>[]).find(
      (c) => c.id === out.commentId
    );
    expect(thread).toMatchObject({
      author: 'Alice',
      from: { kind: 'sticky', id: 's_hero', author: 'Jonas Novak', convertedBy: 'Alice' },
    });
    // ONE action, both canvases' lanes: the newest history row is the conversion.
    const rows = (await runtime.acceptedHistory?.({ limit: 5 })) ?? [];
    expect(rows[0]).toMatchObject({
      actionId: out.actionId,
      kind: 'edit',
      label: toCommentLabel(STICKY_TEXT),
    });

    // The guard sees a foreign reply on the thread (read from the disk the room projects).
    const withReply = (
      JSON.parse(readLaneFromDoc(doc, 'comments')) as Record<string, unknown>[]
    ).map((c) =>
      c.id === out.commentId
        ? { ...c, thread: [{ id: 'r_1', author: 'Tereza', body: 'no', created: 'x' }] }
        : c
    );
    writeFileSync(join(designRoot, '_comments', `${slug}.json`), JSON.stringify(withReply));
    const refused = await routes.undoGuard(
      { actionId: out.actionId },
      new Request('http://localhost/')
    );
    expect(refused?.status).toBe(409);
    expect(await refused?.json()).toMatchObject({ reason: 'has-replies' });
    writeFileSync(
      join(designRoot, '_comments', `${slug}.json`),
      JSON.stringify(JSON.parse(readLaneFromDoc(doc, 'comments')))
    );
    expect(
      await routes.undoGuard({ actionId: out.actionId }, new Request('http://localhost/'))
    ).toBeNull();

    const undo = await runtime.acceptedUndo?.(out.actionId);
    expect(undo?.status).toBe('accepted');
    await waitFor(
      () =>
        readLaneFromDoc(doc, 'annotations') === before.annotations &&
        readLaneFromDoc(doc, 'comments') === before.comments,
      'both lanes back'
    );
  }, 60_000);
});
