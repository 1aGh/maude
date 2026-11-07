// #164 T5.1 — a call that cannot claim (python -c, sed -i, bash -c, a terminal-lane verb) is attributed by
// what it changed: its window PARKS unclaimed outside writes, and the call's settle (the design hook's
// post-call bytes, re-read and claimed by the studio) moves the parked writes whose bytes it claimed into
// the run as ONE write. Everything else — and every failure — lands as OUTSIDE, never as the AI's.
// Contract: apps/studio/client/v2/contracts/164-hash-diff-attribution.md (§3, §5, §6 S1–S8).
//
// The rig is p8-a1-save-hold.test.ts's: a real local home (bun:sqlite, temp project) on the same bus
// server.ts uses, the real run registry, the real hook routes (routes/agent.ts) over `hookClaims`, the
// ACP tracker for a Maude-chat window, the edit-op route behind the claim wrapper for a studio save. The
// oracle is the store's history rows (the run's one `ai` action vs `outside` / `edit`), its undo and the disk.

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { SessionUpdate } from '@agentclientprotocol/sdk';

import { createAgentActivityTracker } from '../acp/index.ts';
import { createAgentRuns } from '../agent-runs.ts';
import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry } from '../ai/runs.ts';
import { asPersonSave, createSaveHold, setSaveHoldForTest } from '../ai/save-hold.ts';
import { claimWrite, hookClaims } from '../ai/write-claim.ts';
import { applyEdit } from '../canvas-edit.ts';
import type { AiActivity } from '../collab/ai-activity.ts';
import type { Context } from '../context.ts';
import type { EditOp } from '../edit-ops/types.ts';
import { claimingTableRoute, guardTableRoute } from '../http.ts';
import { agentRouteSpecs, CLAIM_MAX_FILES } from '../routes/agent.ts';
import { createEditRoutes } from '../routes/edit.ts';
import { runStageHooks } from '../routes/project-undo.ts';
import type { RouteSpec } from '../routes/table.ts';
import {
  createActionStage,
  PARKED_MAX,
  SETTLE_WAIT_MS,
  SHELL_SETTLE_MS,
} from '../sync/action-stage.ts';
import { MAX_HTML_BYTES } from '../sync/limits.ts';
import { attachLocalHome, type LocalHome, OUTSIDE_KIND } from '../sync/local-kernel.ts';

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
const NEW = 'ui/New Board.tsx';
const repo = (rel: string) => `.design/${rel}`;
const ORIGIN = 'http://127.0.0.1:4399';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
// the design hook keeps its state outside the project: never under the real ~/.claude/maude-hook
process.env.MAUDE_HOOK_STATE_HOME = mkdtempSync(path.join(tmpdir(), 'maude-hook-state-'));

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

const dirs: string[] = [];
const closers: Array<() => void> = [];
afterAll(() => {
  for (const c of closers) c();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
afterEach(() => setSaveHoldForTest(null));

async function rig() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-164-'));
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
  const hold = createSaveHold({});
  setSaveHoldForTest(hold);
  hold.attach({ emit: (ev, p) => bus.emit(ev, p), on: (ev, fn) => bus.on(ev, fn), designRoot });
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
  const bracket = {
    begin: (run: { actor: string; session: string; label: string | null; run: string }) => {
      if (run.actor === 'maude-chat') return;
      home.runtime.beginAiAction(`agent:${run.session}`, run.label || 'Claude Code', {
        runId: run.run,
      });
    },
    ...hookClaims(() => home.runtime, '.design'),
  };
  const specs = agentRouteSpecs({
    repoRoot: root,
    designRel: '.design',
    shells: () => 0,
    emit: () => {},
    bracket,
    runs: createAgentRuns(bracket, undefined, reg),
  });
  /** A hook route, as the design hook posts it (headers override: a browser / canvas origin). */
  const hook = (p: string, body: unknown, headers: Record<string, string> = {}) =>
    (specs.find((s) => s.path === p) as RouteSpec).handle(
      new Request(`${ORIGIN}${p}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: '127.0.0.1:4399', ...headers },
        body: JSON.stringify(body),
      }),
      {}
    );
  const abs = (rel: string) => path.join(designRoot, rel);
  const read = (rel: string) => readFileSync(abs(rel), 'utf8');
  /** An outside process (another editor, a python call) writes `rel`; the watcher delivers it. */
  const write = async (rel: string, text: string) => {
    writeFileSync(abs(rel), text);
    bus.emit('fs:any', rel);
    await home.flush();
  };
  const publish = (runId: string) =>
    stage.publish({ runId }, { partial: false, fence: { runId, leases: [] } });
  const rows = async () =>
    (await home.runtime.acceptedHistory({ limit: 50 })).filter(
      (r) => r.kind !== 'migration.import'
    );
  const kindsOf = async (rel: string) =>
    (await rows()).filter((x) => x.canvases.includes(rel)).map((x) => x.kind);
  const aiCanvases = async () =>
    (await rows()).filter((x) => x.kind === 'ai').map((x) => [...x.canvases].sort());
  return {
    root,
    designRoot,
    home,
    reg,
    ctx,
    save,
    hook,
    abs,
    read,
    write,
    publish,
    rows,
    kindsOf,
    aiCanvases,
  };
}
type Rig = Awaited<ReturnType<typeof rig>>;

/** A terminal Claude Code run (the design hook's lane): its run, one call's window and its settle. */
async function terminal(r: Rig, call = 'b1') {
  const begun = await r.hook('/_api/agent/run/begin', { session: 't1', actor: 'claude-code' });
  expect(begun.status).toBe(200);
  const runId = ((await begun.json()) as { run: string }).run;
  const window = async (open: boolean, body: Record<string, unknown> = {}) => {
    const res = await r.hook('/_api/agent/bash/window', {
      session: 't1',
      toolUseId: call,
      open,
      ...body,
    });
    expect(res.status).toBe(200);
  };
  const settle = async (changed: unknown[], body: Record<string, unknown> = {}) => {
    const res = await r.hook('/_api/agent/bash/settle', {
      session: 't1',
      toolUseId: call,
      changed,
      ...body,
    });
    expect(res.status).toBe(200);
    await r.home.flush();
    return (await res.json()) as { bound: string[]; person: string[] };
  };
  /** What the hook sends for `rel` after the call: its post-call bytes' sha. */
  const changedOf = (rel: string) => ({ path: rel, sha: sha(r.read(rel)) });
  return { runId, window, settle, changedOf };
}

const shorten = (s: string) => s.replace('Footer', 'Short footer');

describe('S1–S3 — parked during the call, claimed by the settle, otherwise outside', () => {
  test('S1 a parked write the settle claims is in the run, as ONE write (its undo takes back both edits)', async () => {
    const r = await rig();
    const t = await terminal(r);
    await t.window(true, { files: [HOME] });
    // `sed -i a F && sed -i b F` — two writes the watcher delivers apart
    await r.write(HOME, shorten(r.read(HOME)));
    await r.write(HOME, r.read(HOME).replace('Body copy', 'Body short'));
    // parked: neither staged into the run nor recorded yet
    expect(await r.kindsOf(HOME)).toEqual([]);
    expect(await t.settle([t.changedOf(HOME)])).toMatchObject({ bound: [HOME], person: [] });
    expect(await r.publish(t.runId)).toMatchObject({ status: 'accepted' });
    expect(await r.kindsOf(HOME)).toEqual(['ai']);
    const [row] = (await r.rows()).filter((x) => x.kind === 'ai');
    const undo = await r.home.runtime.acceptedUndo(row.actionId, false, { via: 'keys' });
    expect(undo.status).toBe('accepted');
    await r.home.flush();
    expect(r.read(HOME)).toBe(canvas('Home'));
  });

  test('S2 an outside write to G during an `all` window, while the settle claims only F: G is outside', async () => {
    const r = await rig();
    const t = await terminal(r);
    await t.window(true, { all: true });
    await r.write(HOME, shorten(r.read(HOME)));
    await r.write(OTHER, canvas('Other — from another editor'));
    expect(await r.kindsOf(OTHER)).toEqual([]); // parked too: the window covers every canvas
    await t.settle([t.changedOf(HOME)]);
    expect(await r.kindsOf(OTHER)).toEqual([OUTSIDE_KIND]);
    expect(await r.publish(t.runId)).toMatchObject({ status: 'accepted' });
    expect(await r.aiCanvases()).toEqual([[HOME]]);
    expect(r.read(OTHER)).toBe(canvas('Other — from another editor'));
  });

  test('S3 no settle (the hook failed): released as outside at close + SETTLE_WAIT_MS, never in the run', async () => {
    const r = await rig();
    const t = await terminal(r);
    await t.window(true, { files: [HOME] });
    await r.write(HOME, shorten(r.read(HOME)));
    await t.window(false);
    await sleep(SETTLE_WAIT_MS / 2);
    await r.home.flush();
    expect(await r.kindsOf(HOME)).toEqual([]); // still waiting for its settle
    await sleep(SETTLE_WAIT_MS / 2 + 400);
    await r.home.flush();
    expect(await r.kindsOf(HOME)).toEqual([OUTSIDE_KIND]);
    await r.publish(t.runId);
    expect(await r.aiCanvases()).toEqual([]);
    expect(r.read(HOME)).toBe(shorten(canvas('Home')));
  });

  test('S3 the run ends with the window still open (a killed call, no PostToolUse): outside', async () => {
    const r = await rig();
    const t = await terminal(r);
    await t.window(true, { files: [HOME] });
    await r.write(HOME, shorten(r.read(HOME)));
    await r.publish(t.runId);
    await r.home.flush();
    expect(await r.kindsOf(HOME)).toEqual([OUTSIDE_KIND]);
    expect(await r.aiCanvases()).toEqual([]);
  });

  test('S3 a stage releases a window that never closes at stale, and a settle that claims nothing releases at once', async () => {
    // the stage alone (its timers are real; stale is driven through releaseShellCall)
    const sent: Array<{ slug: string; kind: 'release' | 'run' }> = [];
    const stage = createActionStage({
      designRoot: mkdtempSync(path.join(tmpdir(), 'maude-164-stage-')),
      propose: async (a) => {
        sent.push({ slug: a.label, kind: 'run' });
        return { protocol: 1, status: 'accepted', transactionId: a.transactionId };
      },
      newTransactionId: () => `tx_${Math.random().toString(36).slice(2)}`,
      release: async (w) => {
        sent.push({ slug: w.slug, kind: 'release' });
        return { status: 'accepted' };
      },
      log: { log() {}, warn() {} },
    });
    stage.begin('run:r1', 'Fix', { runId: 'r1', shell: { call: 'c1', open: true, all: true } });
    const p = { lane: 'html' as const, baseContent: 'a', stageable: true };
    const w1 = stage.capture('ui/A.tsx', 'a', { ...p, content: 'b', transactionId: 'x1' });
    expect(stage.parked()).toEqual([{ slug: 'ui/A.tsx', lane: 'html' }]);
    stage.releaseShellCall('r1', 'c1', 'stale');
    expect(await w1).toMatchObject({ status: 'accepted' });
    expect(sent).toEqual([{ slug: 'ui/A.tsx', kind: 'release' }]);
    stage.begin('run:r1', 'Fix', { runId: 'r1', shell: { call: 'c2', open: true, all: true } });
    void stage.capture('ui/B.tsx', 'b', { ...p, content: 'c', transactionId: 'x2' });
    stage.settleShellCall('r1', 'c2', []);
    expect(stage.parked()).toEqual([]);
    expect(sent.at(-1)).toEqual({ slug: 'ui/B.tsx', kind: 'release' });
    expect(stage.summaryOf('r1')?.canvases).toEqual([]);
  });
});

describe('S4 — a person’s studio save is never parked', () => {
  test('a studio save during an `all` window lands at once as the person’s edit (pin)', async () => {
    const r = await rig();
    const t = await terminal(r);
    await t.window(true, { all: true });
    await r.save(OTHER, 'title', 'data-x=mine');
    await r.write(OTHER, r.read(OTHER)); // the watcher delivers the studio's own write
    expect(r.home.aiRuns().length).toBeGreaterThan(0);
    expect(await r.kindsOf(OTHER)).toEqual(['edit']);
    await t.settle([]);
    await r.publish(t.runId);
    expect(await r.aiCanvases()).toEqual([]);
  });

  test('a studio save to a file the call names is held, then lands as the person’s; the settle binds the AI’s bytes only', async () => {
    const r = await rig();
    const t = await terminal(r);
    await t.window(true, { files: [HOME] });
    await r.write(HOME, shorten(r.read(HOME))); // the call's write: parked
    await r.save(HOME, 'title', 'data-x=mine'); // held while the window is open
    expect(r.read(HOME)).not.toContain('data-x');
    const res = await t.settle([t.changedOf(HOME)]);
    expect(res.bound).toEqual([HOME]);
    await sleep(SHELL_SETTLE_MS + 300); // the held save lands after the call's own bytes
    expect(r.read(HOME)).toContain('data-x');
    await r.write(HOME, r.read(HOME));
    await r.publish(t.runId);
    await r.home.flush();
    const kinds = await r.kindsOf(HOME);
    expect(kinds).toContain('ai');
    expect(kinds).toContain('edit');
    expect(await r.aiCanvases()).toEqual([[HOME]]);
  });
});

describe('S5–S7 — creates, after the settle, and the ACP window alone', () => {
  test('S5 an interpreter creates a canvas: the parked create + the settle claim are the run’s doc.create', async () => {
    const r = await rig();
    const t = await terminal(r);
    // `python3 -c "open('.design/ui/New Board.tsx','w')…"` — coverage names a lane path that does not exist yet
    await t.window(true, { files: [NEW] });
    await r.write(NEW, canvas('New board'));
    expect(await r.kindsOf(NEW)).toEqual([]);
    await t.settle([{ ...t.changedOf(NEW), created: true }]);
    expect(await r.publish(t.runId)).toMatchObject({ status: 'accepted' });
    expect(await r.aiCanvases()).toEqual([[NEW]]);
    expect(await r.kindsOf(NEW)).toEqual(['ai']);
  });

  test('S6 an outside write 0.5 s after the settle, with other bytes, is outside', async () => {
    const r = await rig();
    const t = await terminal(r);
    await t.window(true, { files: [HOME] });
    await r.write(HOME, shorten(r.read(HOME)));
    await t.settle([t.changedOf(HOME)]);
    await sleep(500);
    // another editor, a different part of the canvas (an overlap would be a conflict, not this case)
    await r.write(HOME, r.read(HOME).replace('>Home</h1>', '>Mine</h1>'));
    expect(await r.kindsOf(HOME)).toEqual([OUTSIDE_KIND]);
    expect(await r.publish(t.runId)).toMatchObject({ status: 'accepted' });
    expect((await r.kindsOf(HOME)).sort()).toEqual(['ai', OUTSIDE_KIND].sort());
    const [row] = (await r.rows()).filter((x) => x.kind === 'ai');
    expect((await r.home.runtime.acceptedUndo(row.actionId, false, { via: 'keys' })).status).toBe(
      'accepted'
    );
    await r.home.flush();
    expect(r.read(HOME)).toContain('>Mine</h1>');
    expect(r.read(HOME)).toContain('>Footer<');
  });

  test('S7 a window ACP opened alone, with no hook settle, parks and then releases as outside', async () => {
    const r = await rig();
    const runId = (
      await r.reg.ask({ origin: 'maude-chat', chatId: 'c1', label: 'Shorten', lazy: true })
    ).runId as string;
    const tr = createAgentActivityTracker(r.ctx, ai, 'c1');
    tr.beginTurn?.('Shorten', runId);
    const py =
      `cd "${r.designRoot}/ui" && python3 - <<'EOF'\np='Home.tsx'\ns=open(p).read()\n` +
      `open(p,'w').write(s.replace('Footer','Short footer'))\nEOF`;
    tr.onUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'p1',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: py },
    } as unknown as SessionUpdate);
    await r.write(HOME, shorten(r.read(HOME)));
    tr.onUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'p1',
      status: 'completed',
    } as unknown as SessionUpdate);
    expect(await r.kindsOf(HOME)).toEqual([]);
    await sleep(SETTLE_WAIT_MS + 400);
    await r.home.flush();
    expect(await r.kindsOf(HOME)).toEqual([OUTSIDE_KIND]);
    await r.publish(runId);
    expect(await r.aiCanvases()).toEqual([]);
  });

  test('S7 the same ACP window settled by the hook (ACP toolCallId = the hook’s tool_use_id) is the run’s', async () => {
    const r = await rig();
    const runId = (
      await r.reg.ask({ origin: 'maude-chat', chatId: 'c1', label: 'Shorten', lazy: true })
    ).runId as string;
    const tr = createAgentActivityTracker(r.ctx, ai, 'c1');
    tr.beginTurn?.('Shorten', runId);
    const begun = await r.hook('/_api/agent/run/begin', {
      session: 's1',
      actor: 'maude-chat',
      chat: 'c1',
    });
    expect(begun.status).toBe(200);
    tr.onUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'p1',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: `sed -i s/Footer/Short/ "${r.abs(HOME)}"` },
    } as unknown as SessionUpdate);
    await r.write(HOME, shorten(r.read(HOME)));
    tr.onUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'p1',
      status: 'completed',
    } as unknown as SessionUpdate);
    const res = await r.hook('/_api/agent/bash/settle', {
      session: 's1',
      chat: 'c1',
      toolUseId: 'p1',
      changed: [{ path: HOME, sha: sha(r.read(HOME)) }],
    });
    expect(((await res.json()) as { bound: string[] }).bound).toEqual([HOME]);
    await r.home.flush();
    expect(await r.publish(runId)).toMatchObject({ status: 'accepted' });
    expect(await r.aiCanvases()).toEqual([[HOME]]);
  });
});

describe('S8 — the settle route', () => {
  test('a browser Origin, the canvas origin or Sec-Fetch-Site is refused', async () => {
    const r = await rig();
    await terminal(r);
    const body = { session: 't1', toolUseId: 'b1', changed: [] };
    for (const headers of [
      { origin: 'http://127.0.0.1:4400' }, // the canvas origin's frame
      { origin: ORIGIN }, // even the trusted shell page: hook routes are non-browser
      { 'sec-fetch-site': 'same-origin' },
    ])
      expect((await r.hook('/_api/agent/bash/settle', body, headers)).status).toBe(403);
  });

  test('a bad path, a runtime file, a non-lane file, a bad sha or more than 32 entries is 400', async () => {
    const r = await rig();
    const t = await terminal(r);
    await t.window(true, { all: true });
    const post = (changed: unknown, more = false) =>
      r.hook('/_api/agent/bash/settle', {
        session: 't1',
        toolUseId: 'b1',
        changed,
        ...(more ? { more: true } : {}),
      });
    for (const path of ['../x.tsx', '/abs/x.tsx', '_state/x.tsx', 'ui/.hidden.tsx', 'assets/a.png'])
      expect((await post([{ path, sha: sha('x') }])).status).toBe(400);
    expect((await post([{ path: HOME, sha: 'not-a-sha' }])).status).toBe(400);
    expect((await post([{ path: HOME, sha: sha('x'), deleted: 'yes' }])).status).toBe(400);
    expect((await post('nope')).status).toBe(400);
    const many = Array.from({ length: CLAIM_MAX_FILES + 1 }, (_, i) => ({
      path: `ui/C${i}.tsx`,
      sha: null,
    }));
    expect((await post(many)).status).toBe(400);
    expect((await post(many.slice(0, CLAIM_MAX_FILES), true)).status).toBe(200);
    // `.jsx` is a lane now
    expect((await post([{ path: 'ui/Legacy.jsx', sha: null }])).status).toBe(200);
  });

  test('a disk sha mismatch (a later save) or `sha: null` (past the budget) claims nothing: outside', async () => {
    const r = await rig();
    const t = await terminal(r);
    await t.window(true, { files: [HOME, OTHER] });
    await r.write(HOME, shorten(r.read(HOME)));
    await r.write(OTHER, shorten(r.read(OTHER)));
    const res = await t.settle([
      { path: HOME, sha: sha('the bytes the hook saw, since overwritten') },
      { path: OTHER, sha: null },
    ]);
    expect(res).toMatchObject({ bound: [], person: [] });
    expect(await r.kindsOf(HOME)).toEqual([OUTSIDE_KIND]);
    expect(await r.kindsOf(OTHER)).toEqual([OUTSIDE_KIND]);
    await r.publish(t.runId);
    expect(await r.aiCanvases()).toEqual([]);
  });

  test('a missing or corrupt manifest (the hook settles `changed: []`) claims nothing: outside', async () => {
    const r = await rig();
    const t = await terminal(r);
    await t.window(true, { all: true });
    await r.write(HOME, shorten(r.read(HOME)));
    expect(await t.settle([])).toMatchObject({ bound: [], person: [] });
    expect(await r.kindsOf(HOME)).toEqual([OUTSIDE_KIND]);
    await r.publish(t.runId);
    expect(await r.aiCanvases()).toEqual([]);
  });

  test('a foreign chat or a session with no live run binds nothing; the run’s end releases as outside', async () => {
    const r = await rig();
    // chat c1's run, its hook session s1 and one call's window
    const runId = (
      await r.reg.ask({ origin: 'maude-chat', chatId: 'c1', label: 'Shorten', lazy: true })
    ).runId as string;
    const begin = { actor: 'maude-chat', chat: 'c1', session: 's1' };
    expect((await r.hook('/_api/agent/run/begin', begin)).status).toBe(200);
    const win = { session: 's1', chat: 'c1', toolUseId: 'b1', open: true, files: [HOME] };
    expect((await r.hook('/_api/agent/bash/window', win)).status).toBe(200);
    await r.write(HOME, shorten(r.read(HOME)));
    const changed = [{ path: HOME, sha: sha(r.read(HOME)) }];
    for (const who of [
      { session: 's2', chat: 'c2' }, // another chat (no live run of its own)
      { session: 'nobody' }, // a session with no run at all
    ]) {
      const res = await r.hook('/_api/agent/bash/settle', { ...who, toolUseId: 'b1', changed });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { bound: string[] }).bound).toEqual([]);
    }
    await r.home.flush();
    expect(await r.kindsOf(HOME)).toEqual([]); // still parked: the call's own window stays
    await r.publish(runId);
    await r.home.flush();
    expect(await r.kindsOf(HOME)).toEqual([OUTSIDE_KIND]);
    expect(await r.aiCanvases()).toEqual([]);
  });

  test('batches (`more: true`) accumulate: the call settles — and its window closes — on the last one', async () => {
    const r = await rig();
    const t = await terminal(r);
    await t.window(true, { all: true });
    await r.write(HOME, shorten(r.read(HOME)));
    await r.write(OTHER, shorten(r.read(OTHER)));
    expect((await t.settle([t.changedOf(HOME)], { more: true })).bound).toEqual([HOME]);
    expect(await r.kindsOf(HOME)).toEqual([]); // still parked: more is coming
    // `more` is a boolean
    expect(
      (
        await r.hook('/_api/agent/bash/settle', {
          session: 't1',
          toolUseId: 'b1',
          changed: [],
          more: 'x',
        })
      ).status
    ).toBe(400);
    await t.settle([t.changedOf(OTHER)]);
    expect(await r.publish(t.runId)).toMatchObject({ status: 'accepted' });
    expect(await r.aiCanvases()).toEqual([[HOME, OTHER].sort()]);
  });

  test('a cut-short batch run (no last batch) claims nothing: the run’s end releases as outside', async () => {
    const r = await rig();
    const t = await terminal(r);
    await t.window(true, { files: [HOME] });
    await r.write(HOME, shorten(r.read(HOME)));
    await t.settle([t.changedOf(HOME)], { more: true });
    await r.publish(t.runId);
    await r.home.flush();
    expect(await r.kindsOf(HOME)).toEqual([OUTSIDE_KIND]);
    expect(await r.aiCanvases()).toEqual([]);
  });

  test('a deleted file the disk no longer holds is bound only if seen leaving; one still on disk is not', async () => {
    const r = await rig();
    const t = await terminal(r);
    await t.window(true, { all: true });
    const post = (changed: unknown, more = true) =>
      r.hook('/_api/agent/bash/settle', {
        session: 't1',
        toolUseId: 'b1',
        changed,
        ...(more ? { more: true } : {}),
      });
    const gone = await post([{ path: 'ui/Gone.tsx', sha: null, deleted: true }]);
    expect(((await gone.json()) as { bound: string[] }).bound).toEqual([]); // D4: never seen leaving
    expect(existsSync(r.abs(HOME))).toBe(true);
    const still = await post([{ path: HOME, sha: null, deleted: true }], false);
    expect(((await still.json()) as { bound: string[] }).bound).toEqual([]);
  });
});

// ── #164 security pair (F1, F4–F6, D1, D3, D4, D6) ────────────────────────────────────────────────────

/** A bare stage whose releases and run proposals are recorded (no store). */
function bareStage() {
  const released: Array<{ slug: string; writes: Array<{ base: string; content: string }> }> = [];
  const proposed: Array<{ label: string; operations: unknown[] }> = [];
  const warned: string[] = [];
  const stage = createActionStage({
    designRoot: mkdtempSync(path.join(tmpdir(), 'maude-164-sec-')),
    propose: async (a) => {
      proposed.push({ label: a.label, operations: a.operations });
      return { protocol: 1, status: 'accepted', transactionId: a.transactionId };
    },
    newTransactionId: () => `tx_${Math.random().toString(36).slice(2)}`,
    release: async (w) => {
      released.push({
        slug: w.slug,
        writes: w.writes.map((x) => ({ base: x.baseContent, content: x.content })),
      });
      return { status: 'accepted' };
    },
    log: { log() {}, warn: (m: string) => warned.push(String(m)) },
    mergeParked: true,
  });
  let n = 0;
  const lane = (slug: string, base: string, content: string) =>
    stage.capture(slug, slug, {
      lane: 'html',
      baseContent: base,
      content,
      stageable: true,
      transactionId: `x${++n}`,
    });
  return { stage, released, proposed, warned, lane };
}

describe('#164 F1 — claimed bytes take along only their own call’s parked writes', () => {
  test('chain: a background `all` window parks a person’s save, then a claiming verb lands — the save stays outside', async () => {
    const r = await rig();
    const t = await terminal(r, 'bg1');
    await t.window(true, { all: true }); // a background call that names no canvas
    const person = shorten(r.read(HOME));
    await r.write(HOME, person); // the person, in another editor: parked under the window
    expect(await r.kindsOf(HOME)).toEqual([]);
    // `maude design canvas-edit` claims its bytes for the run, then writes them
    const ai = person.replace('Body copy', 'Body by AI');
    claimWrite(r.home.runtime, { runId: t.runId, chatId: '', label: 'Fix' }, repo(HOME), ai);
    await r.write(HOME, ai);
    expect(await r.kindsOf(HOME)).toEqual([OUTSIDE_KIND]); // released as outside FIRST
    expect(await r.publish(t.runId)).toMatchObject({ status: 'accepted' });
    const [row] = (await r.rows()).filter((x) => x.kind === 'ai');
    expect((await r.home.runtime.acceptedUndo(row.actionId, false, { via: 'keys' })).status).toBe(
      'accepted'
    );
    await r.home.flush();
    // the run's undo takes back only the AI's words: the person's save stays
    expect(r.read(HOME)).toBe(person);
  });

  test('a settle joins only what ITS call’s window parked: an earlier window’s write goes out first', async () => {
    const { stage, released, lane } = bareStage();
    stage.begin('run:r1', 'Fix', { runId: 'r1', shell: { call: 'c0', open: true, all: true } });
    const w1 = lane('ui/A.tsx', 'a', 'b'); // someone else's write, under c0 only
    stage.begin('run:r1', 'Fix', {
      runId: 'r1',
      shell: { call: 'c1', open: true, slugs: ['ui/A.tsx'] },
    });
    void lane('ui/A.tsx', 'b', 'c'); // the call's own write
    stage.claim('r1', 'ui/A.tsx', sha('c'));
    expect(stage.settleShellCall('r1', 'c1', ['ui/A.tsx'])).toBe(true);
    expect(await w1).toMatchObject({ status: 'accepted' });
    expect(released).toEqual([{ slug: 'ui/A.tsx', writes: [{ base: 'a', content: 'b' }] }]);
    const [l] = stage.lanesOf('r1');
    expect(l).toMatchObject({ slug: 'ui/A.tsx', base: 'b', mine: 'c' });
  });

  test('another run’s settle of the same bytes never takes a write parked under a different run', async () => {
    const { stage, released, lane } = bareStage();
    stage.begin('run:r1', 'One', {
      runId: 'r1',
      shell: { call: 'c1', open: true, slugs: ['ui/A.tsx'] },
    });
    stage.begin('run:r2', 'Two', {
      runId: 'r2',
      shell: { call: 'c2', open: true, slugs: ['ui/B.tsx'] },
    });
    void lane('ui/A.tsx', 'a', 'b'); // parked under r1's window only
    stage.claim('r2', 'ui/A.tsx', sha('b'));
    stage.settleShellCall('r2', 'c2', ['ui/A.tsx']);
    expect(stage.lanesOf('r2')).toEqual([]);
    stage.releaseShellCall('r1', 'c1', 'no-settle');
    expect(released.map((x) => x.slug)).toEqual(['ui/A.tsx']);
    expect(stage.lanesOf('r1')).toEqual([]);
  });
});

describe('#164 F5 — a settle resolves only the caller’s own call', () => {
  test('two runs with the same call id: one’s settle leaves the other’s window parking', () => {
    const { stage } = bareStage();
    stage.begin('run:r1', 'One', { runId: 'r1', shell: { call: 'c', open: true, all: true } });
    stage.begin('run:r2', 'Two', { runId: 'r2', shell: { call: 'c', open: true, all: true } });
    expect(stage.settleShellCall('r2', 'c', [])).toBe(true);
    expect(stage.shellCall('r2', 'c')).toBeNull();
    expect(stage.shellCall('r1', 'c')).not.toBeNull();
    // no window (already settled, or never opened): refused, nothing resolved
    expect(stage.settleShellCall('r2', 'c', [])).toBe(false);
    expect(stage.settleShellCall('r1', 'nope', [])).toBe(false);
  });

  test('the route refuses a settle for a call with no window: nothing is claimed', async () => {
    const r = await rig();
    const t = await terminal(r);
    await r.write(HOME, shorten(r.read(HOME))); // lands at once: no window parks it
    const res = await r.hook('/_api/agent/bash/settle', {
      session: 't1',
      toolUseId: 'never-opened',
      changed: [t.changedOf(HOME)],
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('no-window');
    await r.publish(t.runId);
    expect(await r.aiCanvases()).toEqual([]);
  });

  test('a close that names its owner ends only that owner’s hold', () => {
    const hold = createSaveHold({ settleMs: 0 });
    const f = path.join(tmpdir(), 'maude-164-hold.tsx');
    hold.window('c', true, [f], 'run:a');
    hold.window('c', false, [], 'run:b'); // another run's close: the hold stays
    expect(asPersonSave(() => hold.holds(f))).toBe(true);
    hold.window('c', false, [], 'run:a');
    expect(asPersonSave(() => hold.holds(f))).toBe(false);
    hold.close();
  });
});

describe('#164 F6 — a `named` settle claims only the files the window covered', () => {
  test('a changed file outside the named cover is not bound', async () => {
    const r = await rig();
    const t = await terminal(r);
    await t.window(true, { files: [HOME] });
    await r.write(HOME, shorten(r.read(HOME)));
    await r.write(OTHER, shorten(r.read(OTHER))); // not covered: lands at once as outside
    const res = await t.settle([t.changedOf(HOME), t.changedOf(OTHER)]);
    expect(res.bound).toEqual([HOME]);
    await r.publish(t.runId);
    expect(await r.aiCanvases()).toEqual([[HOME]]);
  });
});

describe('#164 F4 / D3 — pending settle batches', () => {
  /** hookClaims over a fake runtime: every call has an `all` window until it settles. */
  function fakeClaims() {
    const claimed: Array<{ key: string; rel: string }> = [];
    const settled: Array<{ key: string; call: string; claimed: readonly string[] }> = [];
    const open = new Set<string>();
    const warned: string[] = [];
    const control = {
      beginAiAction() {},
      claimAiWrite: (key: string, rel: string) => claimed.push({ key, rel }),
      shellCall: (key: string, call: string) =>
        open.has(`${key}|${call}`) ? { all: true, covers: () => true, left: () => false } : null,
      settleShellCall: (key: string, call: string, c?: readonly string[]) => {
        settled.push({ key, call, claimed: c ?? [] });
        return open.delete(`${key}|${call}`);
      },
    };
    const hc = hookClaims(() => control, '.design', {
      log: { warn: (m: string) => warned.push(m) },
    });
    return { hc, claimed, settled, open, warned };
  }
  const run = (id: string) => ({ run: id, label: 'x' });

  test('keyed by run + call: another run’s last batch never claims this run’s pending files', () => {
    const f = fakeClaims();
    f.open.add('r1|b1');
    f.open.add('r2|b1');
    expect(f.hc.settle(run('r1'), 'b1', [{ rel: HOME, text: 'a' }], false)).toEqual({ ok: true });
    expect(f.hc.settle(run('r2'), 'b1', [{ rel: OTHER, text: 'b' }], true)).toEqual({ ok: true });
    expect(f.claimed).toEqual([{ key: 'r2', rel: repo(OTHER) }]);
    f.hc.settle(run('r1'), 'b1', [], true);
    expect(f.claimed.at(-1)).toEqual({ key: 'r1', rel: repo(HOME) });
  });

  test('paths dedupe across batches; a call past its file cap fails to outside and its last batch claims nothing', () => {
    const f = fakeClaims();
    f.open.add('r1|b1');
    f.hc.settle(run('r1'), 'b1', [{ rel: HOME, text: 'a' }], false);
    f.hc.settle(run('r1'), 'b1', [{ rel: HOME, text: 'b' }], true);
    expect(f.claimed).toEqual([{ key: 'r1', rel: repo(HOME) }]);
    f.open.add('r1|b2');
    let last: { ok: boolean; code?: string } = { ok: true };
    for (let i = 0; i < 40 && last.ok; i++)
      last = f.hc.settle(
        run('r1'),
        'b2',
        Array.from({ length: 32 }, (_, j) => ({ rel: `ui/C${i}_${j}.tsx`, text: 'x' })),
        false
      );
    expect(last).toEqual({ ok: false, code: 'settle-failed' });
    expect(f.settled.at(-1)).toEqual({ key: 'r1', call: 'b2', claimed: [] }); // released at once
    expect(f.warned.length).toBe(1);
    expect(f.hc.settle(run('r1'), 'b2', [{ rel: HOME, text: 'z' }], true).ok).toBe(false);
    expect(f.claimed.length).toBe(1);
  });

  test('a call over the byte cap fails; the 65th call at once fails instead of evicting a live one', () => {
    const f = fakeClaims();
    f.open.add('r1|big');
    const big = 'x'.repeat(9 * 1024 * 1024);
    f.hc.settle(run('r1'), 'big', [{ rel: HOME, text: big }], false);
    expect(f.hc.settle(run('r1'), 'big', [{ rel: OTHER, text: big }], false).ok).toBe(false);
    for (let i = 0; i < 65; i++) f.open.add(`r1|c${i}`);
    for (let i = 0; i < 64; i++)
      expect(f.hc.settle(run('r1'), `c${i}`, [{ rel: HOME, text: 'a' }], false).ok).toBe(true);
    expect(f.hc.settle(run('r1'), 'c64', [{ rel: HOME, text: 'a' }], false).ok).toBe(false);
    // the first call's batches are intact: its last batch claims them
    expect(f.hc.settle(run('r1'), 'c0', [], true)).toEqual({ ok: true });
    expect(f.claimed.at(-1)).toEqual({ key: 'r1', rel: repo(HOME) });
  });

  test('a pending call whose last batch never comes expires after SETTLE_WAIT_MS: outside, logged', async () => {
    const f = fakeClaims();
    f.open.add('r1|b1');
    f.hc.settle(run('r1'), 'b1', [{ rel: HOME, text: 'a' }], false);
    await sleep(SETTLE_WAIT_MS + 200);
    expect(f.settled).toEqual([{ key: 'r1', call: 'b1', claimed: [] }]);
    expect(f.warned.length).toBe(1);
    expect(f.hc.settle(run('r1'), 'b1', [], true).ok).toBe(false);
    expect(f.claimed).toEqual([]);
  });

  test('a call with no window is refused before anything is claimed', () => {
    const f = fakeClaims();
    expect(f.hc.settle(run('r1'), 'b1', [{ rel: HOME, text: 'a' }], true)).toEqual({
      ok: false,
      code: 'no-window',
    });
    expect(f.claimed).toEqual([]);
  });
});

describe('#164 D1 — parked writes are merged and capped', () => {
  test('three writes to one lane under one window are ONE parked entry: first base, last bytes', async () => {
    const { stage, released, lane } = bareStage();
    stage.begin('run:r1', 'Fix', { runId: 'r1', shell: { call: 'c1', open: true, all: true } });
    const outs = [
      lane('ui/A.tsx', 'a', 'b'),
      lane('ui/A.tsx', 'b', 'c'),
      lane('ui/A.tsx', 'c', 'd'),
    ];
    expect(stage.parked()).toEqual([{ slug: 'ui/A.tsx', lane: 'html' }]);
    stage.releaseShellCall('r1', 'c1', 'no-settle');
    for (const o of outs) expect(await o).toMatchObject({ status: 'accepted' });
    expect(released).toEqual([{ slug: 'ui/A.tsx', writes: [{ base: 'a', content: 'd' }] }]);
  });

  test('past PARKED_MAX the oldest canvas goes out as outside, logged', () => {
    const { stage, released, warned, lane } = bareStage();
    stage.begin('run:r1', 'Fix', { runId: 'r1', shell: { call: 'c1', open: true, all: true } });
    for (let i = 0; i <= PARKED_MAX; i++) void lane(`ui/C${i}.tsx`, 'a', 'b');
    expect(stage.parked().length).toBe(PARKED_MAX);
    expect(released.map((x) => x.slug)).toEqual(['ui/C0.tsx']);
    expect(warned.length).toBe(1);
  });
});

describe('#164 D4 / D6 — what a settle may bind', () => {
  test('a delete is bound only when the stage saw the canvas leave during the window; nothing else', async () => {
    const r = await rig();
    const t = await terminal(r);
    await t.window(true, { all: true });
    unlinkSync(r.abs(OTHER));
    r.home.observe(OTHER); // the watcher sees it leave
    await r.home.flush();
    const res = await t.settle([
      { path: OTHER, sha: null, deleted: true },
      { path: 'ui/Gone.tsx', sha: null, deleted: true }, // never there: never seen leaving
    ]);
    expect(res.bound).toEqual([OTHER]);
  });

  test('a file past its lane cap is never read nor claimed', async () => {
    const r = await rig();
    const t = await terminal(r);
    await t.window(true, { all: true });
    const huge = canvas('Huge').replace('Body copy', 'x'.repeat(MAX_HTML_BYTES + 10));
    writeFileSync(r.abs(OTHER), huge); // not delivered to the watcher: only the settle sees it
    const res = await t.settle([{ path: OTHER, sha: sha(huge) }]);
    expect(res.bound).toEqual([]);
  });
});
