// p8-a1-claims — every AI writer verb claims its own writes; a person's own save during an AI run never ends
// up in that run's undo (Michal 2026-10-29, "A1: FIX NOW").
//
// V2-8.9 round B A1 / V2-8.9 final delta F3: an AI shell call running a `maude design` write verb opened a
// per-call WINDOW in which the run's stage took ANY unclaimed canvas write, so a person's save from an outside
// editor in those seconds joined the AI run and its one-step Undo. Now each verb claims its bytes before they
// land (ai/write-claim.ts) and a verb call opens no window; only an interpreter call (S7, python heredoc)
// keeps it. F17: an AI `maude design trash move` is the run's delete, not the person's `canvas.delete`.
//
// A real in-process local home (bun:sqlite, temp project) wired by the same bus server.ts uses
// (`attachLocalHome`), the real run registry, the real edit-op route behind the real claim wrapper
// (http.ts `claimingTableRoute`) and the real claim route (routes/agent.ts). The oracle is the store's
// history rows, the run's undo and the disk.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { SessionUpdate } from '@agentclientprotocol/sdk';

import { namedDesignFiles } from '../../../cli/lib/bash-guard.mjs';
import { shellOpensWindow } from '../acp/design-write-verb.ts';
import { createAgentActivityTracker } from '../acp/index.ts';
import { createAgentRuns } from '../agent-runs.ts';
import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry } from '../ai/runs.ts';
import { claimWritesForChat, hookClaims } from '../ai/write-claim.ts';
import { chatHeaderFor, parseRequestArgv } from '../bin/_curl-local.mjs';
import { chatWriteHeaders } from '../bin/_studio-verb.mjs';
import { applyEdit } from '../canvas-edit.ts';
import type { AiActivity } from '../collab/ai-activity.ts';
import type { Context } from '../context.ts';
import type { EditOp } from '../edit-ops/types.ts';
import { claimingTableRoute, guardTableRoute } from '../http.ts';
import { agentRouteSpecs } from '../routes/agent.ts';
import { createEditRoutes } from '../routes/edit.ts';
import { runStageHooks } from '../routes/project-undo.ts';
import type { RouteSpec } from '../routes/table.ts';
import { attachLocalHome, type LocalHome, OUTSIDE_KIND } from '../sync/local-kernel.ts';

const canvas = (title: string) => `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <h1 data-cd-id="title">${title}</h1>
        <footer data-cd-id="footer">Footer</footer>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const HOME = 'ui/Home.tsx';
const OTHER = 'ui/Other.tsx';
const repo = (rel: string) => `.design/${rel}`;

const paint: EditOp = {
  id: 'test.paint-red',
  apply: (src, r) => ({
    source: r.targets.reduce(
      (s, t) => applyEdit(r.file, s, t.element, 'style.color', "'red'").source,
      src
    ),
  }),
};

const ai: AiActivity = {
  start: (file) => ({ file, author: 'x', startedAt: 0, lastHeartbeat: 0 }),
  heartbeat: (file) => ({ file, author: 'x', startedAt: 0, lastHeartbeat: 0 }),
  end: () => true,
  list: () => [],
  get: () => null,
  stop: () => {},
};

const dirs: string[] = [];
const closers: Array<() => void> = [];
afterAll(() => {
  for (const c of closers) c();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function rig() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-a1-claims-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  writeFileSync(path.join(designRoot, HOME), canvas('Home'));
  writeFileSync(path.join(designRoot, OTHER), canvas('Other'));
  process.env.MAUDE_MACHINE_FILE = path.join(root, 'machine.json');
  const subs = new Map<string, Array<(x: unknown) => void>>();
  const bus = {
    on(ev: string, fn: (x: unknown) => void) {
      subs.set(ev, [...(subs.get(ev) ?? []), fn]);
      return () => {};
    },
    emit(ev: string, x?: unknown) {
      for (const fn of subs.get(ev) ?? []) fn(x);
    },
  };
  const att = attachLocalHome(
    { cfg: { canvasGroups: [{ path: 'ui' }] }, paths: { designRoot, designRel: '.design' }, bus },
    { current: () => null },
    {}
  );
  closers.push(() => att.close());
  const home = att.home() as LocalHome;
  await home.ready();
  const reg = createRunRegistry({
    designRoot: null,
    home: createLocalLeaseHome({ actor: 'you' }),
    autoRenew: false,
  });
  closers.push(() => reg.close());
  const ctx = {
    cfg: {},
    projectLabel: 'test',
    bus,
    paths: { repoRoot: root, designRel: '.design', designRoot },
    syncControl: { current: () => home.runtime },
  } as unknown as Context;
  const stage = runStageHooks({ control: () => home.runtime as never });
  // the edit-op route behind the claim wrapper, as http.ts mounts it
  const [editSpec] = createEditRoutes({
    designRoot,
    designRel: '.design',
    repoRoot: root,
    emit: (e, p) => bus.emit(e, p),
    ops: [paint],
  });
  // as http.ts mounts it: the two gates first, then the claim wrapper
  const edit = claimingTableRoute(guardTableRoute(editSpec as RouteSpec), reg);
  const editOp = (headers: Record<string, string> = {}) =>
    edit.handle(
      new Request('http://127.0.0.1:4399/_api/edit-op', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: '127.0.0.1:4399', ...headers },
        body: JSON.stringify({
          file: repo(HOME),
          op: 'test.paint-red',
          targets: [{ artboard: 'desktop', element: 'footer' }],
        }),
      }),
      {}
    );
  // the claim route, wired to the registry + runtime as http.ts wires it
  const claimSpec = agentRouteSpecs({
    repoRoot: root,
    designRel: '.design',
    shells: () => 0,
    emit: () => {},
    claimWrites: (chat, writes) => claimWritesForChat(reg, home.runtime, '.design', chat, writes),
  }).find((s) => s.path === '/_api/agent/write/claim') as RouteSpec;
  const claim = (body: unknown, headers: Record<string, string> = {}) =>
    claimSpec.handle(
      new Request('http://127.0.0.1:4399/_api/agent/write/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: '127.0.0.1:4399', ...headers },
        body: JSON.stringify(body),
      }),
      {}
    );
  const abs = (rel: string) => path.join(designRoot, rel);
  const read = (rel: string) => readFileSync(abs(rel), 'utf8');
  /** the file watcher delivers `rel` */
  const deliver = async (rel: string) => {
    bus.emit('fs:any', rel);
    await home.flush();
  };
  const ask = async (chatId: string, label: string) =>
    (await reg.ask({ origin: 'maude-chat', chatId, label, lazy: true })).runId as string;
  const publish = (runId: string) =>
    stage.publish({ runId }, { partial: false, fence: { runId, leases: [] } });
  const rows = async () =>
    (await home.runtime.acceptedHistory({ limit: 50 })).filter(
      (r) => r.kind !== 'migration.import'
    );
  return {
    root,
    designRoot,
    home,
    reg,
    ctx,
    bus,
    editOp,
    claim,
    abs,
    read,
    deliver,
    ask,
    publish,
    rows,
  };
}

const shell = (t: ReturnType<typeof createAgentActivityTracker>, command: string, id: string) =>
  t.onUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: id,
    kind: 'execute',
    status: 'in_progress',
    rawInput: { command },
  } as unknown as SessionUpdate);
const done = (t: ReturnType<typeof createAgentActivityTracker>, id: string) =>
  t.onUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: id,
    status: 'completed',
  } as unknown as SessionUpdate);

describe('A1 — a person’s save while an AI verb runs is never the run’s', () => {
  test('(a) an outside save during `maude design reel-place` lands as the person’s, not in the run or its undo', async () => {
    const r = await rig();
    const runId = await r.ask('c1', 'Cut the recap');
    const t = createAgentActivityTracker(r.ctx, ai, 'c1');
    t.beginTurn?.('Cut the recap', runId);
    shell(t, `maude design reel-place recap --next --canvas ${HOME}#desktop`, 'b1');
    // the person saves the canvas from their editor while the verb is running
    writeFileSync(r.abs(HOME), canvas('Home — my own words'));
    await r.deliver(HOME);
    done(t, 'b1');
    await r.publish(runId);
    const rows = await r.rows();
    const kinds = rows.filter((x) => x.canvases.includes(HOME)).map((x) => x.kind);
    expect(kinds).not.toContain('ai');
    expect(kinds).toContain(OUTSIDE_KIND);
    expect(r.read(HOME)).toContain('my own words');
  });

  test('(b) the verb’s own claimed write IS the run’s — one ai row, its undo takes back only that', async () => {
    const r = await rig();
    const runId = await r.ask('c1', 'Retitle Home');
    const t = createAgentActivityTracker(r.ctx, ai, 'c1');
    t.beginTurn?.('Retitle Home', runId);
    shell(t, `maude design canvas-edit ${HOME} title children 'AI title'`, 'b1');
    // the verb (bin/_write-claim.mjs) claims its bytes through the claim route, then writes them
    const next = canvas('AI title');
    const c = await r.claim({ chat: 'c1', writes: [{ path: HOME, content: next }] });
    expect(c.status).toBe(200);
    writeFileSync(r.abs(HOME), next);
    await r.deliver(HOME);
    // meanwhile the person saves ANOTHER canvas from their editor
    writeFileSync(r.abs(OTHER), canvas('Other — mine'));
    await r.deliver(OTHER);
    done(t, 'b1');
    expect(await r.publish(runId)).toMatchObject({ status: 'accepted' });
    const rows = await r.rows();
    const aiRows = rows.filter((x) => x.kind === 'ai');
    expect(aiRows.map((x) => [x.runId, x.chatId, x.canvases])).toEqual([[runId, 'c1', [HOME]]]);
    expect(rows.filter((x) => x.canvases.includes(OTHER)).map((x) => x.kind)).not.toContain('ai');
    // the run's undo takes back the AI title; the person's Other stays
    const u = await r.home.runtime.acceptedUndo(aiRows[0].actionId, false, { via: 'keys' });
    expect(u.status).toBe('accepted');
    await r.home.flush();
    expect(r.read(HOME)).toContain('<h1 data-cd-id="title">Home</h1>');
    expect(r.read(OTHER)).toContain('Other — mine');
  });

  test('(b) a route write the verb names its chat on (X-Maude-Chat → edit-op) is the run’s', async () => {
    const r = await rig();
    const runId = await r.ask('c1', 'Paint the footer');
    expect((await r.editOp({ 'X-Maude-Chat': 'c1' })).status).toBe(200);
    await r.deliver(HOME);
    expect(await r.publish(runId)).toMatchObject({ status: 'accepted' });
    const rows = await r.rows();
    expect(rows.filter((x) => x.canvases.includes(HOME)).map((x) => [x.kind, x.runId])).toEqual([
      ['ai', runId],
    ]);
  });

  test('(c) an AI trash move is recorded under the run and comes back with the run’s undo', async () => {
    const r = await rig();
    const runId = await r.ask('c1', 'Clean up');
    // what DELETE /_api/canvas does when `maude design trash move` names its chat: claim, then move
    const rt = r.home.runtime;
    rt.beginAiAction(`run:${runId}`, 'Clean up', { runId, chatId: 'c1', claimOnly: true });
    rt.claimAiDelete(runId, repo(OTHER));
    rmSync(r.abs(OTHER));
    await r.deliver(OTHER);
    expect(await r.publish(runId)).toMatchObject({ status: 'accepted' });
    const rows = await r.rows();
    const mine = rows.filter((x) => x.canvases.includes(OTHER));
    expect(mine.map((x) => [x.kind, x.runId, x.chatId])).toEqual([['ai', runId, 'c1']]);
    const u = await rt.acceptedUndo(mine[0].actionId, false, { via: 'keys' });
    expect(u.status).toBe('accepted');
    await r.home.flush();
    expect(existsSync(r.abs(OTHER))).toBe(true);
  });

  test('(c) an unclaimed delete during a run stays the person’s', async () => {
    const r = await rig();
    const runId = await r.ask('c1', 'Clean up');
    r.home.runtime.beginAiAction(`run:${runId}`, 'Clean up', {
      runId,
      chatId: 'c1',
      claimOnly: true,
    });
    rmSync(r.abs(OTHER));
    await r.deliver(OTHER);
    await r.publish(runId);
    const kinds = (await r.rows()).filter((x) => x.canvases.includes(OTHER)).map((x) => x.kind);
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds).not.toContain('ai');
  });

  test('the S7 interpreter fallback keeps its own window; a verb call opens none', () => {
    expect(shellOpensWindow(`maude design reel-place recap --next --canvas ${HOME}`)).toBe(false);
    expect(shellOpensWindow(`cd /tmp && maude design canvas-edit ${HOME} t x y`)).toBe(false);
    expect(shellOpensWindow("python3 - <<'EOF'\nopen('x','w')\nEOF")).toBe(true);
    // every verb claims now, ds-check --fix and import-figma included: no window
    expect(shellOpensWindow(`maude design ds-check --fix=mechanical --canvas ${HOME}`)).toBe(false);
    expect(shellOpensWindow(`maude design import-figma https://x.example --into ${HOME}`)).toBe(
      false
    );
    expect(shellOpensWindow('ls .design/ui')).toBe(false);
  });
});

describe('A1 — a claim comes only from the AI session itself', () => {
  test('(d) the claim route refuses a browser (canvas origin or any page), a missing chat, a foreign or queued run', async () => {
    const r = await rig();
    const runId = await r.ask('c1', 'Retitle');
    const queued = await r.reg.ask({
      origin: 'maude-chat',
      chatId: 'c1',
      label: 'next',
      lazy: true,
    });
    expect(queued.behind).toBe(runId);
    const w = { writes: [{ path: HOME, content: canvas('Planted') }] };
    for (const headers of [
      { origin: 'http://127.0.0.1:4400' }, // the canvas origin's frame
      { origin: 'http://127.0.0.1:4399' }, // even the trusted shell page: agent routes are non-browser
      { 'sec-fetch-site': 'same-origin' },
    ])
      expect((await r.claim({ chat: 'c1', ...w }, headers)).status).toBe(403);
    expect((await r.claim(w)).status).toBe(400); // no chat
    expect((await r.claim({ chat: 'bad id', ...w })).status).toBe(400);
    expect((await r.claim({ chat: 'c9', ...w })).status).toBe(409); // a chat with no live run
    expect(
      (await r.claim({ chat: 'c1', writes: [{ path: '_state/x.json', content: '{}' }] })).status
    ).toBe(400); // runtime state is never a canvas lane
    expect(
      (await r.claim({ chat: 'c1', writes: [{ path: '../x.tsx', content: 'x' }] })).status
    ).toBe(400);
    // nothing planted reached the run: the planted bytes, written now, are not the run's
    writeFileSync(r.abs(HOME), canvas('Planted'));
    await r.deliver(HOME);
    await r.publish(runId);
    expect((await r.rows()).map((x) => x.kind)).not.toContain('ai');
  });

  test('(d) a route write with no header, a malformed one, or a cross-origin Origin claims nothing', async () => {
    for (const headers of [
      {},
      { 'X-Maude-Chat': 'c 1' },
      { 'X-Maude-Chat': 'c9' },
      { 'X-Maude-Chat': 'c1', origin: 'http://evil.example' },
    ]) {
      const r = await rig();
      const runId = await r.ask('c1', 'Paint');
      const res = await r.editOp(headers);
      if ('origin' in headers) expect(res.status).toBe(403);
      else expect(res.status).toBe(200);
      await r.deliver(HOME);
      await r.publish(runId);
      expect((await r.rows()).map((x) => x.kind)).not.toContain('ai');
    }
  });

  test('(d) a canvas-origin table spec is never wrapped; a read is never wrapped', () => {
    const spec: RouteSpec = {
      method: 'POST',
      path: '/_api/x',
      origin: 'canvas',
      readOnly: 'allowed',
      handle: () => new Response('ok'),
    } as unknown as RouteSpec;
    expect(claimingTableRoute(spec, null)).toBe(spec);
    const get = { ...spec, origin: 'main', method: 'GET' } as unknown as RouteSpec;
    expect(claimingTableRoute(get, null)).toBe(get);
  });

  test('(d) the verbs name their chat on writes only, and only from their own MAUDE_CHAT_ID', () => {
    const env = { MAUDE_CHAT_ID: 'c1' };
    expect(chatWriteHeaders('POST', env)).toEqual({ 'x-maude-chat': 'c1' });
    expect(chatWriteHeaders('DELETE', env)).toEqual({ 'x-maude-chat': 'c1' });
    expect(chatWriteHeaders('GET', env)).toEqual({});
    expect(chatWriteHeaders('POST', {})).toEqual({});
    expect(chatWriteHeaders('POST', { MAUDE_CHAT_ID: 'x y' })).toEqual({});
    const p = (a: string[]) => parseRequestArgv(a);
    const api = 'http://127.0.0.1:4399/_api/edit-op';
    expect(chatHeaderFor(p([api, '--method', 'POST']), env)).toBe('X-Maude-Chat: c1');
    expect(chatHeaderFor(p([api, '--method', 'DELETE']), env)).toBe('X-Maude-Chat: c1');
    expect(chatHeaderFor(p([api]), env)).toBeNull(); // a read
    expect(chatHeaderFor(p(['http://127.0.0.1:3000/other', '--method', 'POST']), env)).toBeNull();
  });
});

describe('A1 — the design hook’s post-bash binding takes only what the verbs claimed', () => {
  test('a pure-verb call (claimedOnly) binds the claimed canvas, never the person’s save in the same seconds', async () => {
    const r = await rig();
    await r.ask('c1', 'Retitle');
    const touched: string[] = [];
    const specs = agentRouteSpecs({
      repoRoot: r.root,
      designRel: '.design',
      shells: () => 0,
      emit: () => {},
      bracket: { begin() {}, touch: (_run, rel) => void touched.push(rel) },
      claimWrites: (chat, writes) =>
        claimWritesForChat(r.reg, r.home.runtime, '.design', chat, writes),
    });
    const post = (p: string, body: unknown) =>
      (specs.find((s) => s.path === p) as RouteSpec).handle(
        new Request(`http://127.0.0.1:4399${p}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', host: '127.0.0.1:4399' },
          body: JSON.stringify(body),
        }),
        {}
      );
    const begin = await post('/_api/agent/run/begin', {
      session: 's1',
      actor: 'maude-chat',
      chat: 'c1',
    });
    expect(begin.status).toBe(200);
    const since = Date.now() - 1000;
    // the verb claims and writes Home; the person saves Other in the same seconds
    const next = canvas('AI title');
    const c = await r.claim({ chat: 'c1', writes: [{ path: HOME, content: next }] });
    expect(c.status).toBe(200);
    writeFileSync(r.abs(HOME), next);
    writeFileSync(r.abs(OTHER), canvas('Other — mine'));
    const bound = await post('/_api/agent/edit/touched', {
      session: 's1',
      chat: 'c1',
      toolUseId: 't1',
      via: 'bash',
      since,
      claimedOnly: true,
    });
    expect(bound.status).toBe(200);
    expect(touched).toEqual([HOME]);
    // the S7 interpreter fallback (no claimedOnly) still binds what changed in the call's window
    touched.length = 0;
    const all = { session: 's1', chat: 'c1', toolUseId: 't2', via: 'bash', since };
    await post('/_api/agent/edit/touched', all);
    expect(touched.sort()).toEqual([HOME, OTHER].sort());
  });
});

// ── p8-a1-claims round 2 (lead 2026-10-29): Edit/Write tools, interpreter calls, the terminal lane ────

const editCall = (
  t: ReturnType<typeof createAgentActivityTracker>,
  id: string,
  rawInput: Record<string, unknown>,
  status: 'pending' | 'completed' = 'pending'
) =>
  t.onUpdate({
    sessionUpdate: status === 'pending' ? 'tool_call' : 'tool_call_update',
    toolCallId: id,
    kind: 'edit',
    status,
    rawInput,
  } as unknown as SessionUpdate);

/** The hook routes over the rig's registry + runtime, wired as http.ts wires them. */
function hooks(r: Awaited<ReturnType<typeof rig>>) {
  const bracket = {
    begin: (run: { actor: string; session: string; label: string | null; run: string }) => {
      if (run.actor === 'maude-chat') return;
      r.home.runtime.beginAiAction(`agent:${run.session}`, run.label || 'Claude Code', {
        runId: run.run,
      });
    },
    ...hookClaims(() => r.home.runtime, '.design'),
  };
  const specs = agentRouteSpecs({
    repoRoot: r.root,
    designRel: '.design',
    shells: () => 0,
    emit: () => {},
    bracket,
    runs: createAgentRuns(bracket, undefined, r.reg),
  });
  return (p: string, body: unknown, headers: Record<string, string> = {}) =>
    (specs.find((s) => s.path === p) as RouteSpec).handle(
      new Request(`http://127.0.0.1:4399${p}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: '127.0.0.1:4399', ...headers },
        body: JSON.stringify(body),
      }),
      {}
    );
}

describe('A1 round 2 — an AI Edit/Write claims its exact bytes; the person’s saves stay theirs', () => {
  const TITLE = '<h1 data-cd-id="title">Home</h1>';
  test('(a) AI Edit, then the person saves the same canvas in the same turn: the save is not the run’s', async () => {
    const r = await rig();
    const runId = await r.ask('c1', 'Retitle Home');
    const t = createAgentActivityTracker(r.ctx, ai, 'c1');
    t.beginTurn?.('Retitle Home', runId);
    const edit = {
      file_path: r.abs(HOME),
      old_string: TITLE,
      new_string: TITLE.replace('Home', 'AI one'),
    };
    editCall(t, 'e1', edit);
    writeFileSync(r.abs(HOME), r.read(HOME).replace(TITLE, edit.new_string));
    await r.deliver(HOME);
    editCall(t, 'e1', edit, 'completed');
    // the person, from their editor, after the AI's edit — same canvas, same turn
    writeFileSync(r.abs(HOME), r.read(HOME).replace('Footer', 'My footer'));
    await r.deliver(HOME);
    // a second AI edit on top of the person's bytes
    const edit2 = {
      file_path: r.abs(HOME),
      old_string: edit.new_string,
      new_string: TITLE.replace('Home', 'AI two'),
    };
    editCall(t, 'e2', edit2);
    writeFileSync(r.abs(HOME), r.read(HOME).replace(edit.new_string, edit2.new_string));
    await r.deliver(HOME);
    editCall(t, 'e2', edit2, 'completed');
    expect(await r.publish(runId)).toMatchObject({ status: 'accepted' });
    const rows = (await r.rows()).filter((x) => x.canvases.includes(HOME));
    const aiRows = rows.filter((x) => x.kind === 'ai');
    expect(aiRows.length).toBe(1);
    expect(rows.filter((x) => x.kind !== 'ai').length).toBeGreaterThan(0);
    // the run's undo takes back its own titles; the person's footer stays
    const undo = await r.home.runtime.acceptedUndo(aiRows[0].actionId, false, { via: 'keys' });
    expect(undo.status).toBe('accepted');
    await r.home.flush();
    expect(r.read(HOME)).toContain('My footer');
    expect(r.read(HOME)).toContain(TITLE);
  });

  test('(b) an AI Write is the run’s and undoes with it', async () => {
    const r = await rig();
    const runId = await r.ask('c1', 'Rewrite Other');
    const t = createAgentActivityTracker(r.ctx, ai, 'c1');
    t.beginTurn?.('Rewrite Other', runId);
    const before = r.read(OTHER);
    const content = canvas('Other — by the AI');
    editCall(t, 'w1', { file_path: r.abs(OTHER), content });
    writeFileSync(r.abs(OTHER), content);
    await r.deliver(OTHER);
    editCall(t, 'w1', { file_path: r.abs(OTHER), content }, 'completed');
    expect(await r.publish(runId)).toMatchObject({ status: 'accepted' });
    const aiRows = (await r.rows()).filter((x) => x.kind === 'ai');
    expect(aiRows.map((x) => [x.runId, x.canvases])).toEqual([[runId, [OTHER]]]);
    const undo = await r.home.runtime.acceptedUndo(aiRows[0].actionId, false, { via: 'keys' });
    expect(undo.status).toBe('accepted');
    await r.home.flush();
    expect(r.read(OTHER)).toBe(before);
  });

  test('(b) the hook’s PreToolUse claim (edit/check) puts a Maude-chat Edit in the run before it lands', async () => {
    const r = await rig();
    const runId = await r.ask('c1', 'Retitle');
    const post = hooks(r);
    const begun = await post('/_api/agent/run/begin', {
      session: 's1',
      actor: 'maude-chat',
      chat: 'c1',
    });
    expect(begun.status).toBe(200);
    const next = TITLE.replace('Home', 'Hooked');
    const res = await post('/_api/agent/edit/check', {
      session: 's1',
      chat: 'c1',
      toolUseId: 'u1',
      tool: 'Edit',
      path: HOME,
      edit: { old: TITLE, new: next },
    });
    expect(res.status).toBe(200);
    writeFileSync(r.abs(HOME), r.read(HOME).replace(TITLE, next));
    await r.deliver(HOME);
    expect(await r.publish(runId)).toMatchObject({ status: 'accepted' });
    expect((await r.rows()).filter((x) => x.kind === 'ai').map((x) => x.runId)).toEqual([runId]);
  });

  test('(c) a spoofed claim — a browser (canvas origin), another chat, no run — claims nothing', async () => {
    const r = await rig();
    const runId = await r.ask('c1', 'Retitle');
    const post = hooks(r);
    await post('/_api/agent/run/begin', { session: 's1', actor: 'maude-chat', chat: 'c1' });
    const planted = TITLE.replace('Home', 'Planted');
    const check = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
      post(
        '/_api/agent/edit/check',
        { toolUseId: 'u1', tool: 'Edit', path: HOME, edit: { old: TITLE, new: planted }, ...body },
        headers
      );
    const canvasOrigin = { origin: 'http://127.0.0.1:4400' };
    expect((await check({ session: 's1', chat: 'c1' }, canvasOrigin)).status).toBe(403);
    const fetchMeta = { 'sec-fetch-site': 'same-origin' };
    expect((await check({ session: 's1', chat: 'c1' }, fetchMeta)).status).toBe(403);
    await check({ session: 's2', chat: 'c2' }); // another chat: it has no live run to claim into
    await check({ session: 's9' }); // a session with no run at all
    const window = await post(
      '/_api/agent/bash/window',
      { session: 's1', chat: 'c1', toolUseId: 'b1', open: true, files: [HOME] },
      canvasOrigin
    );
    expect(window.status).toBe(403);
    // the planted bytes, now written: nobody claimed them for c1's run
    writeFileSync(r.abs(HOME), r.read(HOME).replace(TITLE, planted));
    await r.deliver(HOME);
    await r.publish(runId);
    expect((await r.rows()).map((x) => x.kind)).not.toContain('ai');
  });
});

describe('A1 round 2 — a call that cannot claim gets a window for the files it NAMES only', () => {
  test('(a) S7 python names Home: its write is the run’s; the person’s save to Other meanwhile stays theirs', async () => {
    const r = await rig();
    const runId = await r.ask('c1', 'Shorten');
    const t = createAgentActivityTracker(r.ctx, ai, 'c1');
    t.beginTurn?.('Shorten', runId);
    const py =
      `cd "${r.designRoot}/ui" && python3 - <<'EOF'\np='Home.tsx'\ns=open(p).read()\n` +
      `open(p,'w').write(s.replace('Footer','Short'))\nEOF`;
    shell(t, py, 'p1');
    writeFileSync(r.abs(HOME), r.read(HOME).replace('Footer', 'Short'));
    await r.deliver(HOME);
    writeFileSync(r.abs(OTHER), canvas('Other — mine'));
    await r.deliver(OTHER);
    done(t, 'p1');
    expect(await r.publish(runId)).toMatchObject({ status: 'accepted' });
    const rows = await r.rows();
    expect(rows.filter((x) => x.kind === 'ai').map((x) => x.canvases)).toEqual([[HOME]]);
    const other = rows.filter((x) => x.canvases.includes(OTHER)).map((x) => x.kind);
    expect(other).not.toContain('ai');
  });

  test('(a) the terminal lane: the hook’s window names its files; another file stays the person’s', async () => {
    const r = await rig();
    const post = hooks(r);
    const begun = await post('/_api/agent/run/begin', { session: 't1', actor: 'claude-code' });
    expect(begun.status).toBe(200);
    const runId = ((await begun.json()) as { run: string }).run;
    const win = (open: boolean) =>
      post('/_api/agent/bash/window', { session: 't1', toolUseId: 'b1', open, files: [HOME] });
    expect((await win(true)).status).toBe(200);
    writeFileSync(r.abs(HOME), r.read(HOME).replace('Footer', 'Terminal'));
    await r.deliver(HOME);
    writeFileSync(r.abs(OTHER), canvas('Other — mine'));
    await r.deliver(OTHER);
    await win(false);
    // a person's save to the same file AFTER the window settled is theirs too
    await new Promise((res) => setTimeout(res, 1_100));
    // (a different part of the canvas than the run's staged change: an overlap would be a conflict)
    writeFileSync(r.abs(HOME), r.read(HOME).replace('>Home</h1>', '>Mine again</h1>'));
    await r.deliver(HOME);
    expect(await r.publish(runId)).toMatchObject({ status: 'accepted' });
    const rows = await r.rows();
    expect(rows.filter((x) => x.kind === 'ai').map((x) => x.canvases)).toEqual([[HOME]]);
    const other = rows.filter((x) => x.canvases.includes(OTHER)).map((x) => x.kind);
    expect(other).not.toContain('ai');
    // the person's later save, made on top of the run's staged bytes, waits behind the run and then
    // lands as their own action
    await r.home.flush();
    const home = (await r.rows()).filter((x) => x.canvases.includes(HOME)).map((x) => x.kind);
    expect(home.filter((k) => k !== 'ai').length).toBeGreaterThan(0);
  });
});

describe('A1 round 2 — which canvases a command names (bash-guard namedDesignFiles)', () => {
  test('by design-root path or file name, at a name boundary; a look-alike or a glob names nothing', async () => {
    const r = await rig();
    const named = (cmd: string) => namedDesignFiles(r.designRoot, cmd);
    expect(named("python3 - <<'EOF'\np='Home.tsx'\nEOF")).toEqual([HOME]);
    expect(named(`sed -i s/a/b/ .design/${OTHER}`)).toEqual([OTHER]);
    expect(named('cat MyHome.tsx Home.tsx.bak')).toEqual([]);
    expect(named('for f in ui/*.tsx; do sed -i s/a/b/ "$f"; done')).toEqual([]);
  });
});
