// S12.16 (live journey S1, ACP lane) — a canvas an AI session creates is that run's AI write.
//
// The chat makes a canvas through `maude design curl-local` → `POST /_api/canvas`, which carries no
// run identity: Version history recorded the create as `outside`. Option (a), recorded in the
// decision `v2-S12.16-create-claim-by-chat-header`: curl-local names its chat (`X-Maude-Chat`,
// from MAUDE_CHAT_ID, on that one request) and the route claims the new file for the chat's LIVE run
// (ai/create-claim.ts). Parts:
//   1. the verb: the header is set from the shell's own chat id, on POST /_api/canvas only, and a
//      typed one is refused; the server's lookup (`runForCreate`) accepts only a live, unqueued run
//   2. the stage, over a real local home: a claimed create ends as ONE `ai` row of its run (chat
//      named) — with two runs open; an unclaimed create (a person's shell) is never an `ai` row
//   3. a real studio: the route honours the header for a live run only, from the main origin only,
//      and an AI create publishes as `ai` when its run ends

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Subprocess } from 'bun';

import { createAgentActivityTracker } from '../acp/index.ts';
import { claimCreatedCanvas, runForCreate } from '../ai/create-claim.ts';
import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry } from '../ai/runs.ts';
import { chatHeaderFor, parseRequestArgv } from '../bin/_curl-local.mjs';
import type { AiActivity } from '../collab/ai-activity.ts';
import { type Context, createBus } from '../context.ts';
import { runStageHooks } from '../routes/project-undo.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

/* ------------------------------------------------------------------ 1. the verb and the lookup */

describe('curl-local names its chat on the one request that creates a canvas', () => {
  const url = 'http://127.0.0.1:4399/_api/canvas';
  const parse = (args: string[]) => parseRequestArgv(args);

  test('POST /_api/canvas inside a chat carries X-Maude-Chat; nothing else does', () => {
    const env = { MAUDE_CHAT_ID: 'chat-a_1' };
    expect(chatHeaderFor(parse([url, '--method', 'POST']), env)).toBe('X-Maude-Chat: chat-a_1');
    expect(chatHeaderFor(parse([url]), env)).toBeNull(); // a GET
    expect(chatHeaderFor(parse([url, '--method', 'DELETE']), env)).toBeNull();
    expect(
      chatHeaderFor(parse(['http://127.0.0.1:4399/_api/fs-move', '--method', 'POST']), env)
    ).toBeNull();
    expect(
      chatHeaderFor(parse(['http://127.0.0.1:3000/other', '--method', 'POST']), env)
    ).toBeNull();
    // not in a chat (a person's shell, a terminal Claude): nothing is said
    expect(chatHeaderFor(parse([url, '--method', 'POST']), {})).toBeNull();
    for (const bad of ['', 'a b', 'x'.repeat(65), 'c\r\nX-Evil: 1', 'a/b'])
      expect(chatHeaderFor(parse([url, '--method', 'POST']), { MAUDE_CHAT_ID: bad })).toBeNull();
  });

  test('a typed X-Maude-Chat is refused (one chat cannot claim for another)', () => {
    for (const h of ['X-Maude-Chat: c2', 'x-maude-chat:c2', ' X-MAUDE-CHAT ; c2'])
      expect(() => parse([url, '--method', 'POST', '--header', h])).toThrow(/x-maude-chat/);
    expect(parse([url, '--header', 'x-note: x-maude-chat']).headers).toEqual([
      'x-note: x-maude-chat',
    ]);
  });
});

describe('the server names a run only for a live, unqueued run of that chat', () => {
  test('runForCreate', async () => {
    const reg = createRunRegistry({
      designRoot: null,
      home: createLocalLeaseHome({ actor: 'you' }),
      autoRenew: false,
    });
    const first = await reg.ask({ origin: 'maude-chat', chatId: 'c1', label: 'x', lazy: true });
    const queued = await reg.ask({ origin: 'maude-chat', chatId: 'c1', label: 'y', lazy: true });
    expect(queued.behind).toBe(first.runId);
    const req = (h?: string) =>
      new Request('http://127.0.0.1:4399/_api/canvas', {
        method: 'POST',
        ...(h === undefined ? {} : { headers: { 'X-Maude-Chat': h } }),
      });
    expect(runForCreate(req('c1'), reg)).toMatchObject({ runId: first.runId, chatId: 'c1' });
    expect(runForCreate(req(), reg)).toBeNull(); // no header: a person's create
    expect(runForCreate(req('c9'), reg)).toBeNull(); // unknown chat
    expect(runForCreate(req('bad id'), reg)).toBeNull();
    expect(runForCreate(req('c1'), null)).toBeNull();
    reg.close();
  });
});

/* ------------------------------------------------------------------ 2. the stage */

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const canvas = (title: string) => `import { DCArtboard } from '@maude/canvas-lib';

export default function K() {
  return (
    <div>
      <DCArtboard id="p" width={100} height={100}>
        <h1>${title}</h1>
      </DCArtboard>
    </div>
  );
}
`;

async function rig() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-create-claim-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  writeFileSync(path.join(designRoot, 'ui', 'a.tsx'), canvas('a'));
  const h = openLocalHome({
    designRoot,
    designRel: '.design',
    canvasGroups: () => [{ path: 'ui' }],
    machine: { id: 'm_mac_one', name: 'Mac one' },
    bootId: 'boot-1',
    lockRetryMs: 0,
    settleMs: 5,
    aiSettleMs: 0,
    log: { warn() {}, error() {} },
  });
  homes.push(h);
  await h.ready();
  const ctx = {
    cfg: {},
    projectLabel: 'test',
    bus: createBus(),
    paths: { repoRoot: root, designRel: '.design', designRoot },
    syncControl: { current: () => h.runtime },
  } as unknown as Context;
  const stage = runStageHooks({ control: () => h.runtime as never });
  return { h, ctx, stage, designRoot };
}

const ai: AiActivity = {
  start: (file) => ({ file, author: 'x', startedAt: 0, lastHeartbeat: 0 }),
  heartbeat: (file) => ({ file, author: 'x', startedAt: 0, lastHeartbeat: 0 }),
  end: () => true,
  list: () => [],
  get: () => null,
  stop: () => {},
};

describe('a canvas created inside a run lands as that run’s ai version', () => {
  test('two chats open: the claimed create is ONE ai row of its run, naming its chat', async () => {
    const { h, ctx, stage, designRoot } = await rig();
    const t1 = createAgentActivityTracker(ctx, ai, 'c1');
    const t2 = createAgentActivityTracker(ctx, ai, 'c2');
    t1.beginTurn?.('Make a landing canvas', 'r_new1');
    t2.beginTurn?.('Tidy the a canvas', 'r_new2');
    // what POST /_api/canvas does: write the file, then (header present) claim it for the run
    writeFileSync(path.join(designRoot, 'ui', 'landing.tsx'), canvas('Landing'));
    claimCreatedCanvas(ctx.syncControl?.current?.(), {
      runId: 'r_new1',
      chatId: 'c1',
      label: 'Make a landing canvas',
      repoRel: '.design/ui/landing.tsx',
      abs: path.join(designRoot, 'ui', 'landing.tsx'),
    });
    h.observe('ui/landing.tsx');
    await h.flush();
    const fence = (runId: string) => ({ runId, leases: [] });
    expect(
      await stage.publish({ runId: 'r_new1' }, { partial: false, fence: fence('r_new1') })
    ).toMatchObject({ status: 'accepted' });
    await stage.publish({ runId: 'r_new2' }, { partial: false, fence: fence('r_new2') });
    const rows = (await h.runtime.acceptedHistory({ limit: 50 })).filter(
      (r) => r.kind !== 'migration.import'
    );
    const mine = rows.filter((r) => r.canvases.includes('ui/landing.tsx'));
    expect(mine.map((r) => [r.kind, r.runId, r.chatId])).toEqual([['ai', 'r_new1', 'c1']]);
    expect(rows.map((r) => r.kind)).not.toContain('outside');
  });

  test('ONE run open and a create nobody claimed: still a person’s create, not swallowed by the run', async () => {
    const { h, ctx, stage, designRoot } = await rig();
    createAgentActivityTracker(ctx, ai, 'c1').beginTurn?.('Work on a', 'r_one1');
    writeFileSync(path.join(designRoot, 'ui', 'mine.tsx'), canvas('Mine'));
    h.observe('ui/mine.tsx');
    await h.flush();
    await stage.publish(
      { runId: 'r_one1' },
      { partial: false, fence: { runId: 'r_one1', leases: [] } }
    );
    const rows = await h.runtime.acceptedHistory({ limit: 50 });
    const mine = rows.filter((r) => r.canvases.includes('ui/mine.tsx'));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.map((r) => r.kind)).not.toContain('ai');
  });

  test('the run keeps working on its new canvas: create + later edits are ONE action', async () => {
    const { h, ctx, stage, designRoot } = await rig();
    createAgentActivityTracker(ctx, ai, 'c1').beginTurn?.('Make a landing canvas', 'r_fold1');
    const file = path.join(designRoot, 'ui', 'landing.tsx');
    writeFileSync(file, canvas('Landing'));
    claimCreatedCanvas(ctx.syncControl?.current?.(), {
      runId: 'r_fold1',
      chatId: 'c1',
      label: 'Make a landing canvas',
      repoRel: '.design/ui/landing.tsx',
      abs: file,
    });
    h.observe('ui/landing.tsx');
    await h.flush();
    // the AI fills it in with an Edit, which lands as a change to the canvas the run created
    writeFileSync(file, canvas('Landing, filled in'));
    h.observe('ui/landing.tsx');
    await h.flush();
    await stage.publish(
      { runId: 'r_fold1' },
      { partial: false, fence: { runId: 'r_fold1', leases: [] } }
    );
    const rows = (await h.runtime.acceptedHistory({ limit: 50 })).filter(
      (r) => r.kind !== 'migration.import'
    );
    const mine = rows.filter((r) => r.canvases.includes('ui/landing.tsx'));
    expect(mine.map((r) => [r.kind, r.runId, r.chatId])).toEqual([['ai', 'r_fold1', 'c1']]);
    expect(
      await h.runtime.acceptedVersion('.design/ui/landing.tsx', mine[0].revision, 'html')
    ).toContain('Landing, filled in');
  });

  test('a create nobody claimed (a person’s shell) is never an ai row', async () => {
    const { h, ctx, stage, designRoot } = await rig();
    const t1 = createAgentActivityTracker(ctx, ai, 'c1');
    const t2 = createAgentActivityTracker(ctx, ai, 'c2');
    t1.beginTurn?.('Work on a', 'r_per1');
    t2.beginTurn?.('Work on a too', 'r_per2');
    writeFileSync(path.join(designRoot, 'ui', 'mine.tsx'), canvas('Mine'));
    h.observe('ui/mine.tsx');
    await h.flush();
    const fence = (runId: string) => ({ runId, leases: [] });
    await stage.publish({ runId: 'r_per1' }, { partial: false, fence: fence('r_per1') });
    await stage.publish({ runId: 'r_per2' }, { partial: false, fence: fence('r_per2') });
    const rows = await h.runtime.acceptedHistory({ limit: 50 });
    const mine = rows.filter((r) => r.canvases.includes('ui/mine.tsx'));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.map((r) => r.kind)).not.toContain('ai');
    expect(mine.map((r) => r.runId).filter(Boolean)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ 3. a real studio */

describe('POST /_api/canvas on a real studio', () => {
  let proc: Subprocess;
  let port: number;
  let designRoot: string;
  let canvasOrigin: string;
  beforeAll(async () => {
    const sb = makeSandbox();
    designRoot = sb.designRoot;
    port = nextPort();
    proc = await bootServer(sb.root, port, { MAUDE_NO_AUTOBUILD: '1' });
    canvasOrigin = JSON.parse(
      readFileSync(path.join(designRoot, '_server.json'), 'utf8')
    ).canvasOrigin;
  });
  afterAll(async () => {
    await killProc(proc);
  });

  const main = () => `http://localhost:${port}`;
  const hook = async (route: string, body: Record<string, unknown>) =>
    (await (
      await fetch(`${main()}/_api/agent/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).json()) as { run?: string };
  const create = (name: string, base = main(), headers: Record<string, string> = {}) =>
    fetch(`${base}/_api/canvas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ kind: 'blank', name }),
    });
  const history = async () =>
    (
      (await (await fetch(`${main()}/_api/project/history?limit=50`)).json()) as {
        ok: boolean;
        reason?: string;
        history?: Array<{ kind: string; runId?: string; chatId?: string; canvases: string[] }>;
      }
    ).history ?? [];

  test('a live chat run claims its create; a person’s create, an ended chat and the canvas origin do not', async () => {
    // two chats at once, so an unclaimed write is ambiguous (the failing live case)
    await hook('run/begin', { session: 'sess-cc1', actor: 'claude-code', chat: 'cc-1' });
    await hook('run/begin', { session: 'sess-cc2', actor: 'claude-code', chat: 'cc-2' });

    const ai1 = await create('From the chat', main(), { 'X-Maude-Chat': 'cc-1' });
    expect(ai1.status).toBe(201);
    const aiRel = ((await ai1.json()) as { rel: string }).rel;
    const person = await create('From a shell');
    expect(person.status).toBe(201);
    const personRel = ((await person.json()) as { rel: string }).rel;
    // an unknown chat and a malformed id: still created, claimed by nobody
    expect((await create('Unknown chat', main(), { 'X-Maude-Chat': 'cc-none' })).status).toBe(201);
    // a planted canvas posting cross-origin to the main port is refused outright
    const cross = await create('Planted', main(), {
      'X-Maude-Chat': 'cc-1',
      Origin: canvasOrigin,
    });
    expect(cross.status).toBe(403);
    // the canvas listener answers no create (DDR-054), whatever header it carries
    const fromCanvas = await create('From canvas', canvasOrigin, { 'X-Maude-Chat': 'cc-1' });
    expect(fromCanvas.ok).toBe(false);

    await Bun.sleep(1500); // the watcher imports the new files
    await hook('run/end', { session: 'sess-cc1', outcome: 'done', chat: 'cc-1' });
    await hook('run/end', { session: 'sess-cc2', outcome: 'done', chat: 'cc-2' });
    await Bun.sleep(1500);
    const rows = await history();
    const rowsOf = (rel: string) => rows.filter((r) => r.canvases.some((c) => c.endsWith(rel)));
    const mine = rowsOf(aiRel);
    expect(mine.map((r) => r.kind)).toEqual(['ai']);
    const theirs = rowsOf(personRel);
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.map((r) => r.kind)).not.toContain('ai');
  }, 60_000);
});
