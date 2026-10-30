// p8-a1-save-hold (Michal 2026-10-29, `maude/v2-michal-a1-hold-save-during-interpreter`) — a person's save to
// a file a running interpreter call names is HELD until the call's window closes (+ SHELL_SETTLE_MS), then
// lands as the person's write: their own undo step, never the AI run's, never bound by the post-bash binding.
// Repeated saves collapse into one write; a 10 s cap lands it with a warning; a crashed / cancelled / killed
// call still releases it; shutdown lands it; a save to a file the call does not name is never held.
//
// Same rig as p8-a1-write-claims.test.ts: a real local home, the run registry, the edit-op route behind the
// claim wrapper, the ACP tracker for the S7 window and the hook routes for the terminal lane's.

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { SessionUpdate } from '@agentclientprotocol/sdk';

import { createAgentActivityTracker } from '../acp/index.ts';
import { createAgentRuns } from '../agent-runs.ts';
import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry } from '../ai/runs.ts';
import {
  asPersonSave,
  CAP_WARNING,
  createSaveHold,
  HOLD_NOTICE,
  type SaveHold,
  type SaveHoldNotice,
  setSaveHoldForTest,
} from '../ai/save-hold.ts';
import { currentWriteClaim, hookClaims, withWriteClaim } from '../ai/write-claim.ts';
import { noWriteClaim } from '../ai/write-claim-scope.ts';
import { serializeBoard } from '../annotations/schema.ts';
import { createApi } from '../api.ts';
import { applyEdit } from '../canvas-edit.ts';
import {
  FLUSH_ROUTE,
  flushHeldSaves,
  noteSaveHold,
  resetSaveHoldNoticeForTest,
} from '../client/v2/shell/save-hold-notice.js';
import type { AiActivity } from '../collab/ai-activity.ts';
import { type Context, createBus } from '../context.ts';
import type { EditOp } from '../edit-ops/types.ts';
import { claimingTableRoute, guardTableRoute } from '../http.ts';
import { agentRouteSpecs } from '../routes/agent.ts';
import { createDiagnosticsRoutes } from '../routes/diagnostics.ts';
import { createEditRoutes } from '../routes/edit.ts';
import { runStageHooks } from '../routes/project-undo.ts';
import { shellStatus } from '../routes/shell.ts';
import type { RouteSpec } from '../routes/table.ts';
import { SHELL_SETTLE_MS } from '../sync/action-stage.ts';
import { attachLocalHome, type LocalHome } from '../sync/local-kernel.ts';

const canvas = (title: string) => `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <h1 data-cd-id="title">${title}</h1>
        <p data-cd-id="body">Body copy</p>
        <footer data-cd-id="footer">Footer</footer>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const HOME = 'ui/Home.tsx';
const OTHER = 'ui/Other.tsx';
const repo = (rel: string) => `.design/${rel}`;
const ORIGIN = 'http://127.0.0.1:4399';

/** `test.set` — one attribute on one element, from the body's `value` (`attr=value`). */
const setOp: EditOp = {
  id: 'test.set',
  apply: (src, r) => {
    const [attr, value] = String(r.params.value ?? '').split('=');
    return {
      source: r.targets.reduce(
        (s, t) => applyEdit(r.file, s, t.element, attr, `'${value}'`).source,
        src
      ),
    };
  },
};

const ai: AiActivity = {
  start: (file) => ({ file, author: 'x', startedAt: 0, lastHeartbeat: 0 }),
  heartbeat: (file) => ({ file, author: 'x', startedAt: 0, lastHeartbeat: 0 }),
  end: () => true,
  list: () => [],
  get: () => null,
  stop: () => {},
};

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const dirs: string[] = [];
const closers: Array<() => void> = [];
afterAll(() => {
  for (const c of closers) c();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
afterEach(() => setSaveHoldForTest(null));

async function rig(holdOpts: Parameters<typeof createSaveHold>[0] = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-a1-save-hold-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  writeFileSync(path.join(designRoot, HOME), canvas('Home'));
  writeFileSync(path.join(designRoot, OTHER), canvas('Other'));
  process.env.MAUDE_MACHINE_FILE = path.join(root, 'machine.json');
  const subs = new Map<string, Array<(x: unknown) => void>>();
  const said: Array<[string, unknown]> = [];
  const bus = {
    on(ev: string, fn: (x: unknown) => void) {
      subs.set(ev, [...(subs.get(ev) ?? []), fn]);
      return () => {};
    },
    emit(ev: string, x?: unknown) {
      said.push([ev, x]);
      for (const fn of subs.get(ev) ?? []) fn(x);
    },
  };
  const hold: SaveHold = createSaveHold(holdOpts);
  setSaveHoldForTest(hold);
  // what api.ts createApi does at boot
  hold.attach({ emit: (ev, p) => bus.emit(ev, p), designRoot });
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
  const [editSpec] = createEditRoutes({
    designRoot,
    designRel: '.design',
    repoRoot: root,
    emit: (e, p) => bus.emit(e, p),
    ops: [setOp],
  });
  const edit = claimingTableRoute(guardTableRoute(editSpec as RouteSpec), reg);
  /** The person's save from the studio page (a browser write: it carries Origin). */
  const save = async (rel: string, element: string, value: string) => {
    const res = await edit.handle(
      new Request(`${ORIGIN}/_api/edit-op`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: '127.0.0.1:4399', origin: ORIGIN },
        body: JSON.stringify({
          file: repo(rel),
          op: 'test.set',
          params: { value },
          targets: [{ artboard: 'desktop', element }],
        }),
      }),
      {}
    );
    expect(res.status).toBe(200);
  };
  const abs = (rel: string) => path.join(designRoot, rel);
  const read = (rel: string) => readFileSync(abs(rel), 'utf8');
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
  const notices = () => said.filter(([e]) => e === 'save-hold').map(([, p]) => p as SaveHoldNotice);
  const written = (rel: string) =>
    said.filter(([e, p]) => e === 'source-written' && (p as { rel: string }).rel === rel);
  return {
    root,
    designRoot,
    home,
    reg,
    ctx,
    bus,
    hold,
    save,
    abs,
    read,
    deliver,
    ask,
    publish,
    rows,
    notices,
    written,
  };
}
type Rig = Awaited<ReturnType<typeof rig>>;

function hooks(r: Rig) {
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
  return async (p: string, body: unknown) => {
    const res = await (specs.find((s) => s.path === p) as RouteSpec).handle(
      new Request(`${ORIGIN}${p}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: '127.0.0.1:4399' },
        body: JSON.stringify(body),
      }),
      {}
    );
    return (await res.json()) as Record<string, unknown>;
  };
}

/** A Maude chat turn whose python heredoc names Home (the S7 window, acp/index.ts). */
async function pythonTurn(r: Rig) {
  const runId = await r.ask('c1', 'Retitle');
  const t = createAgentActivityTracker(r.ctx, ai, 'c1');
  t.beginTurn?.('Retitle', runId);
  const py =
    `cd "${r.designRoot}/ui" && python3 - <<'EOF'\np='Home.tsx'\ns=open(p).read()\n` +
    `open(p,'w').write(s.replace('>Home<','>AI title<'))\nEOF`;
  t.onUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'p1',
    kind: 'execute',
    status: 'in_progress',
    rawInput: { command: py },
  } as unknown as SessionUpdate);
  const end = (status: 'completed' | 'failed') =>
    t.onUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'p1',
      status,
    } as unknown as SessionUpdate);
  return { runId, t, end };
}

const RED = "color: 'red'";

describe('A1 hold — a person’s save inside an interpreter call’s window waits, then lands as theirs', () => {
  test('1. attribution: held while the call runs, lands after close + settle as the person’s edit; the AI’s own write stays the run’s', async () => {
    const r = await rig();
    const before = r.read(HOME);
    const { runId, end } = await pythonTurn(r);
    // the person paints the footer while python runs
    await r.save(HOME, 'footer', 'style.color=red');
    expect(r.read(HOME)).not.toContain(RED); // held, not written
    expect(r.notices().map((n) => [n.file, n.state, n.text])).toEqual([
      [HOME, 'held', HOLD_NOTICE],
    ]);
    // python — which read the file before the save — writes its bytes
    writeFileSync(r.abs(HOME), before.replace('>Home<', '>AI title<'));
    await r.deliver(HOME);
    end('completed');
    await sleep(SHELL_SETTLE_MS / 2);
    expect(r.read(HOME)).not.toContain(RED); // the AI's last bytes settle first
    await sleep(SHELL_SETTLE_MS / 2 + 300);
    // landed on top of the AI's bytes: both changes are there
    const now = r.read(HOME);
    expect(now).toContain('AI title');
    expect(now).toContain(RED);
    expect(r.notices().at(-1)).toMatchObject({ file: HOME, state: 'landed' });
    await r.deliver(HOME);
    expect(await r.publish(runId)).toMatchObject({ status: 'accepted' });
    await r.home.flush();
    const rows = await r.rows();
    const home = rows.filter((x) => x.canvases.includes(HOME));
    // the run's undo takes back only its retitle; the person's paint is its own step
    expect(home.filter((x) => x.kind === 'ai')).toHaveLength(1);
    expect(home.filter((x) => x.kind === 'edit')).toHaveLength(1);
  });

  test('2. merge: three saves during one hold land as ONE write with every edit — one person undo step', async () => {
    const r = await rig();
    const { runId, end } = await pythonTurn(r);
    await r.save(HOME, 'footer', 'style.color=red');
    await r.save(HOME, 'title', 'style.color=blue');
    await r.save(HOME, 'body', 'style.fontWeight=700');
    expect(r.read(HOME)).not.toContain(RED);
    end('completed');
    await sleep(SHELL_SETTLE_MS + 300);
    const now = r.read(HOME);
    expect(now).toContain(RED);
    expect(now).toContain("color: 'blue'");
    expect(now).toContain("fontWeight: '700'");
    expect(r.written(HOME)).toHaveLength(1);
    await r.deliver(HOME);
    await r.publish(runId);
    await r.home.flush();
    const home = (await r.rows()).filter((x) => x.canvases.includes(HOME));
    expect(home.map((x) => x.kind)).toEqual(['edit']);
    // one notice held, one landed — not one per save
    expect(r.notices().map((n) => n.state)).toEqual(['held', 'landed']);
  });

  test('3. cap: a window that never closes lands the save at the cap as the person’s, with the warning', async () => {
    const r = await rig({ capMs: 600 });
    await pythonTurn(r); // never ends
    await r.save(HOME, 'footer', 'style.color=red');
    await sleep(300);
    expect(r.read(HOME)).not.toContain(RED);
    await sleep(600);
    expect(r.read(HOME)).toContain(RED);
    expect(r.notices().at(-1)).toMatchObject({
      file: HOME,
      state: 'landed',
      warning: 'cap',
      text: CAP_WARNING,
    });
    // still inside the open window: the note keeps it the person's, not the run's stage
    await r.deliver(HOME);
    const home = (await r.rows()).filter((x) => x.canvases.includes(HOME));
    expect(home.map((x) => x.kind)).toEqual(['edit']);
    // a call past the cap is likely gone without a close: the next save does not wait again
    await r.save(HOME, 'title', 'style.color=blue');
    expect(r.read(HOME)).toContain("color: 'blue'");
  });

  test('3b. the terminal lane at the cap: the post-bash binding does not mark the person’s landed save Made by AI', async () => {
    const r = await rig({ capMs: 400 });
    const post = hooks(r);
    const begun = await post('/_api/agent/run/begin', { session: 't1', actor: 'claude-code' });
    const since = Date.now() - 5;
    await post('/_api/agent/bash/window', {
      session: 't1',
      toolUseId: 'b1',
      open: true,
      files: [HOME],
    });
    await r.save(HOME, 'footer', 'style.color=red');
    expect(r.read(HOME)).not.toContain(RED);
    await sleep(700);
    expect(r.read(HOME)).toContain(RED);
    const bound = await post('/_api/agent/edit/touched', {
      session: 't1',
      toolUseId: 'b1',
      via: 'bash',
      since,
      files: [HOME],
    });
    expect(bound.artboards).toEqual([]);
    expect(begun.run).toBeTruthy();
  });

  test('4. crash: a failed call closes its window and the save lands', async () => {
    const r = await rig();
    const { end } = await pythonTurn(r);
    await r.save(HOME, 'footer', 'style.color=red');
    expect(r.read(HOME)).not.toContain(RED); // held while the call runs
    end('failed');
    await sleep(SHELL_SETTLE_MS + 300);
    expect(r.read(HOME)).toContain(RED);
  });

  test('4b. cancel: the turn ends mid-call (Stop / socket gone) and the save lands', async () => {
    const r = await rig();
    const { t } = await pythonTurn(r);
    await r.save(HOME, 'footer', 'style.color=red');
    expect(r.read(HOME)).not.toContain(RED); // held while the call runs
    t.endTurn('failed');
    await sleep(SHELL_SETTLE_MS + 300);
    expect(r.read(HOME)).toContain(RED);
  });

  test('4c. killed on the terminal lane (no PostToolUse ever): the run’s end closes its windows and the save lands', async () => {
    const r = await rig();
    const post = hooks(r);
    await post('/_api/agent/run/begin', { session: 't1', actor: 'claude-code' });
    await post('/_api/agent/bash/window', {
      session: 't1',
      toolUseId: 'b1',
      open: true,
      files: [HOME],
    });
    await r.save(HOME, 'footer', 'style.color=red');
    expect(r.read(HOME)).not.toContain(RED); // held while the call runs
    await post('/_api/agent/run/end', { session: 't1', outcome: 'failed' });
    await sleep(SHELL_SETTLE_MS + 300);
    expect(r.read(HOME)).toContain(RED);
  });

  test('5. close: shutdown during a hold puts the held bytes on disk as the person’s; the shell counts it unsent meanwhile', async () => {
    const r = await rig();
    await pythonTurn(r);
    await r.save(HOME, 'footer', 'style.color=red');
    const status = shellStatus({
      outbox: { content: () => ({ pending: 0 }), store: { list: () => [] } } as never,
      exportJobs: { list: () => [] },
      generateJobs: { list: () => [] },
      activity: () => [],
      version: () => 'x',
    });
    expect(status.unsent).toBe(1);
    expect(await r.hold.flushAll()).toBe(1);
    expect(r.read(HOME)).toContain(RED);
    await r.deliver(HOME);
    const home = (await r.rows()).filter((x) => x.canvases.includes(HOME));
    expect(home.map((x) => x.kind)).toEqual(['edit']);
    expect(r.hold.size()).toBe(0);
  });

  test('6. a save to a file the call does NOT name is never held', async () => {
    const r = await rig();
    await pythonTurn(r);
    await r.save(OTHER, 'footer', 'style.color=red');
    expect(r.read(OTHER)).toContain(RED);
    expect(r.notices()).toEqual([]);
  });

  test('6b. a write with no Origin (a terminal verb through the route) is never held — it may be the call itself', async () => {
    const r = await rig({ capMs: 5_000 });
    await pythonTurn(r);
    const [spec] = createEditRoutes({
      designRoot: r.designRoot,
      designRel: '.design',
      repoRoot: r.root,
      emit: (e, p) => r.bus.emit(e, p),
      ops: [setOp],
    });
    const res = await (spec as RouteSpec).handle(
      new Request(`${ORIGIN}/_api/edit-op`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: '127.0.0.1:4399' },
        body: JSON.stringify({
          file: repo(HOME),
          op: 'test.set',
          params: { value: 'style.color=red' },
          targets: [{ artboard: 'desktop', element: 'footer' }],
        }),
      }),
      {}
    );
    expect(res.status).toBe(200);
    expect(r.read(HOME)).toContain(RED);
  });
});

/** createApi over a fresh project (Home.tsx + its meta), with the hooks the home would get. */
function apiRig() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-a1-save-hold-api-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  const tsx = path.join(designRoot, HOME);
  const meta = tsx.replace(/\.tsx$/, '.meta.json');
  writeFileSync(tsx, canvas('Home'));
  writeFileSync(meta, `${JSON.stringify({ title: 'Home' }, null, 2)}\n`);
  const hold = createSaveHold();
  setSaveHoldForTest(hold);
  const proposed: string[] = [];
  const boards: string[] = [];
  const api = createApi(
    {
      cfg: { designRoot: '.design', canvasGroups: [{ label: 'UI', path: 'ui' }] },
      projectLabel: 'test',
      paths: {
        repoRoot: root,
        designRel: '.design',
        designRoot,
        serverInfoFile: path.join(designRoot, '_server.json'),
        activeFile: path.join(designRoot, '_active.json'),
        commentsDir: path.join(designRoot, '_comments'),
        canvasStateDir: path.join(designRoot, '_canvas-state'),
        historyDir: path.join(designRoot, '_history'),
        tokensUrlRel: '.design/system/colors.css',
        systemDirRel: 'system',
      },
      bus: createBus(),
    } as unknown as Context,
    {
      onCommentsChanged: () => {},
      onMetaChanged: (_f, text) => void proposed.push(text),
      onAnnotationsChanged: (_f, text) => void boards.push(text),
    }
  );
  const board = path.join(designRoot, `${api.fileSlug(repo(HOME))}.annotations.json`);
  const readOr = (f: string) => {
    try {
      return readFileSync(f, 'utf8');
    } catch {
      return '';
    }
  };
  return { root, designRoot, tsx, meta, board, hold, api, proposed, boards, readOr };
}

const sticky = (id: string, x = 100) => ({
  id,
  type: 'sticky',
  index: 'a0',
  x,
  y: 120,
  w: 200,
  h: 200,
  text: 'Make the hero bigger',
  parentArtboard: 'desktop',
});

describe('A1 hold — the layout and board lanes, and the notice', () => {
  test('7. a person’s artboard move to a canvas the call names waits, then lands through the same write + proposal', async () => {
    const r = apiRig();
    // the python call names the canvas: its layout lane is covered too
    r.hold.window('p1', true, [r.tsx]);
    const move = { layout: { artboards: [{ id: 'desktop', x: 300, y: 40 }] } };
    const back = await asPersonSave(() => r.api.patchCanvasMeta(repo(HOME), move));
    expect((back?.layout as { artboards?: unknown[] } | undefined)?.artboards).toEqual(
      move.layout.artboards
    );
    expect(r.readOr(r.meta)).not.toContain('300');
    expect(r.proposed).toEqual([]);
    r.hold.window('p1', false, []);
    await sleep(SHELL_SETTLE_MS + 300);
    expect(r.readOr(r.meta)).toContain('"x": 300');
    expect(r.proposed).toHaveLength(1);
    expect(r.proposed[0]).toContain('"x": 300');
  });

  test('9. board: a person’s op batch to a board the call names waits, then runs on the board as it is then', async () => {
    const r = apiRig();
    r.hold.window('p1', true, [r.board]);
    const done = asPersonSave(() =>
      r.api.applyAnnotationOps(repo(HOME), [{ op: 'put', el: sticky('s_mine') } as never])
    );
    await sleep(200);
    expect(r.readOr(r.board)).not.toContain('s_mine'); // held, not written
    expect(r.boards).toEqual([]);
    // the interpreter writes its own sticky meanwhile
    writeFileSync(r.board, serializeBoard([sticky('s_ai', 900) as never]));
    r.hold.window('p1', false, []);
    expect((await done).ok).toBe(true);
    const now = r.readOr(r.board);
    expect(now).toContain('s_mine');
    expect(now).toContain('s_ai'); // composed on the AI's board, not over it
    expect(r.boards).toHaveLength(1);
  });

  test('9b. board: the collab room’s flush (the person’s strokes) waits too, and the last flush lands', async () => {
    const r = apiRig();
    r.hold.window('p1', true, [r.board]);
    const first = r.api.projectAnnotations(
      repo(HOME),
      serializeBoard([sticky('s_one') as never]),
      () => false
    );
    const second = r.api.projectAnnotations(
      repo(HOME),
      serializeBoard([sticky('s_two') as never]),
      () => true
    );
    await sleep(200);
    expect(r.readOr(r.board)).toBe('');
    r.hold.window('p1', false, []);
    expect(await first).toBe(false); // superseded by the newer flush
    expect(await second).toBe(true);
    expect(r.readOr(r.board)).toContain('s_two');
  });

  test('10. rider: an artboard move with its annotations waits as ONE action and lands both lanes', async () => {
    const r = apiRig();
    writeFileSync(r.board, serializeBoard([sticky('s_hero') as never]));
    r.hold.window('p1', true, [r.tsx]);
    const rider = {
      ops: [{ op: 'patch', id: 's_hero', set: { x: 400 }, expect: { x: 100 } }],
      check: () => null,
    };
    const moved = asPersonSave(() =>
      r.api.moveArtboardsWithRider(
        repo(HOME),
        { artboards: [{ id: 'desktop', x: 300, y: 0 }] },
        rider as never,
        null
      )
    );
    await sleep(200);
    expect(r.readOr(r.meta)).not.toContain('300');
    expect(r.readOr(r.board)).toContain('"x":100');
    r.hold.window('p1', false, []);
    expect((await moved).ok).toBe(true);
    expect(r.readOr(r.meta)).toContain('"x": 300');
    expect(r.readOr(r.board)).toContain('"x":400');
  });

  test('11. close: the closing page’s flush lands its held saves at once (the route behind the beacon)', async () => {
    const r = apiRig();
    r.hold.window('p1', true, [r.tsx]);
    const move = { layout: { artboards: [{ id: 'desktop', x: 300, y: 40 }] } };
    await asPersonSave(() => r.api.patchCanvasMeta(repo(HOME), move));
    r.hold.window('p2', true, [r.board]);
    const board = asPersonSave(() =>
      r.api.applyAnnotationOps(repo(HOME), [{ op: 'put', el: sticky('s_mine') } as never])
    );
    await sleep(50);
    expect(r.hold.size()).toBe(2);
    const spec = createDiagnosticsRoutes({ control: () => null }).find(
      (x) => x.path === '/_api/diagnostics/save-hold-flush'
    ) as RouteSpec;
    const res = await spec.handle(
      new Request(`${ORIGIN}/_api/diagnostics/save-hold-flush`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', origin: ORIGIN },
        body: JSON.stringify({ files: ['ui/Home.meta.json', path.basename(r.board)] }),
      }),
      {}
    );
    expect(await res.json()).toEqual({ landed: 2 });
    expect((await board).ok).toBe(true);
    expect(r.readOr(r.meta)).toContain('"x": 300');
    expect(r.readOr(r.board)).toContain('s_mine');
    expect(r.hold.size()).toBe(0);
  });

  test('8. the shell’s notice: shown while held, taken down when it lands, the warning line at the cap', () => {
    resetSaveHoldNoticeForTest();
    const calls: Array<[string, unknown]> = [];
    const deps = {
      notify: (n: unknown) => void calls.push(['notify', n]),
      dismissNotice: (id: string) => void calls.push(['dismiss', id]),
      win: null,
    };
    noteSaveHold({ file: HOME, state: 'held', text: HOLD_NOTICE }, deps);
    noteSaveHold({ file: HOME, state: 'landed', text: '' }, deps);
    noteSaveHold({ file: HOME, state: 'held', text: HOLD_NOTICE }, deps);
    noteSaveHold({ file: HOME, state: 'landed', warning: 'cap', text: CAP_WARNING }, deps);
    expect(calls).toEqual([
      ['notify', expect.objectContaining({ id: `save-hold:${HOME}`, title: HOLD_NOTICE })],
      ['dismiss', `save-hold:${HOME}`],
      ['notify', expect.objectContaining({ id: `save-hold:${HOME}`, title: HOLD_NOTICE })],
      ['dismiss', `save-hold:${HOME}`],
      ['notify', expect.objectContaining({ kind: 'warning', title: CAP_WARNING })],
    ]);
  });

  test('8b. the page closing with a notice up beacons the held files; nothing held → nothing sent', async () => {
    resetSaveHoldNoticeForTest();
    let hide: (() => void) | null = null;
    const win = {
      addEventListener: (ev: string, fn: () => void) => {
        if (ev === 'pagehide') hide = fn;
      },
    };
    const deps = { notify: () => {}, dismissNotice: () => {}, win };
    const sent: Array<Promise<[string, string]>> = [];
    const nav = {
      sendBeacon: (url: string, b: Blob) => {
        sent.push(b.text().then((t) => [url, t] as [string, string]));
        return true;
      },
    };
    expect(flushHeldSaves(nav as never)).toBe(false);
    noteSaveHold({ file: HOME, state: 'held', text: HOLD_NOTICE }, deps);
    expect(hide).not.toBeNull();
    expect(flushHeldSaves(nav as never)).toBe(true);
    noteSaveHold({ file: HOME, state: 'landed', text: '' }, deps);
    expect(flushHeldSaves(nav as never)).toBe(false);
    expect(await Promise.all(sent)).toEqual([[FLUSH_ROUTE, JSON.stringify({ files: [HOME] })]]);
  });
});

// p8-sec2-attrib A2 / B2-2 — a held save lands as the PERSON's whatever request sets the landing off.
// AsyncLocalStorage carries into setTimeout, and `withWriteClaim(null, fn)` could not leave an outer
// claim: a flush POST carrying `X-Maude-Chat` (curl-local adds it to every `/_api/` write), or a window
// closed inside a claimed request, claimed the person's held bytes for the AI run (its Discard / Undo
// would then drop their edit).
describe('A2 — a held save never lands under the AI’s write claim', () => {
  const homeKinds = async (r: Rig) =>
    (await r.rows()).filter((x) => x.canvases.includes(HOME)).map((x) => x.kind);

  test('the closing page’s flush, sent with the chat’s header while its run is live, lands as the person’s', async () => {
    const r = await rig({ capMs: 5_000 });
    const { runId, end } = await pythonTurn(r);
    await r.save(HOME, 'footer', 'style.color=red');
    expect(r.read(HOME)).not.toContain(RED);
    const spec = createDiagnosticsRoutes({ control: () => null }).find(
      (x) => x.path === '/_api/diagnostics/save-hold-flush'
    ) as RouteSpec;
    const flush = claimingTableRoute(guardTableRoute(spec), r.reg);
    const res = await flush.handle(
      new Request(`${ORIGIN}/_api/diagnostics/save-hold-flush`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          host: '127.0.0.1:4399',
          'X-Maude-Chat': 'c1',
        },
        body: JSON.stringify({ files: [HOME] }),
      }),
      {}
    );
    expect(await res.json()).toEqual({ landed: 1 });
    expect(r.read(HOME)).toContain(RED);
    await r.deliver(HOME);
    end('completed');
    await r.publish(runId);
    await r.home.flush();
    expect(await homeKinds(r)).toEqual(['edit']);
  });

  test('a window closed inside a claimed request: the landing timer runs with no claim', async () => {
    const r = await rig({ capMs: 5_000 });
    const { runId, end } = await pythonTurn(r);
    await r.save(HOME, 'footer', 'style.color=red');
    expect(r.read(HOME)).not.toContain(RED);
    withWriteClaim({ runId, chatId: 'c1', label: 'Retitle' }, () => end('completed'));
    await sleep(SHELL_SETTLE_MS + 300);
    expect(r.read(HOME)).toContain(RED);
    await r.deliver(HOME);
    await r.publish(runId);
    await r.home.flush();
    expect(await homeKinds(r)).toEqual(['edit']);
  });

  test('`withWriteClaim(null)` and `noWriteClaim` leave an outer claim', () => {
    const run = { runId: 'R', chatId: 'c1', label: 'x' };
    withWriteClaim(run, () => {
      expect(currentWriteClaim()).toEqual(run);
      expect(withWriteClaim(null, () => currentWriteClaim())).toBeNull();
      expect(noWriteClaim(() => currentWriteClaim())).toBeNull();
    });
  });

  test('the hook routes and the flush never answer inside a chat’s claim', () => {
    const reg = { resolve: () => null } as never;
    for (const p of ['/_api/agent/bash/window', '/_api/diagnostics/save-hold-flush']) {
      const spec = { path: p, method: 'POST', origin: 'main', handle: () => new Response('') };
      expect(claimingTableRoute(spec as unknown as RouteSpec, reg)).toBe(spec as never);
    }
  });
});
