// P8 bug (board 01 cf-undo-ai) — ⌘Z right after an AI run says "Done" undoes THAT run, never the entry
// before it.
//
// The run's turn ends (the chat shows Done), then the registry publishes its stage: the local home
// waits for the watcher's last write (`aiSettleMs`) and drains (`settled()`) before the run becomes
// an action — 0.5–1.6 s on a quiet machine, more under load. A ⌘Z in that window read the undo
// stack without the run on it and undid the person's previous entry (the first draft), and the
// run's own publish was then rejected under it. The ⌘Z path's read (`GET /_api/project/undo-stack`)
// now waits for a run that is landing (V2-1.5 §5.4: "Your run lands → one new entry").
//
// Real parts: the local home (sync/local-kernel.ts), the run registry (ai/runs.ts) with its stage
// hooks (routes/project-undo.ts runStageHooks), the undo routes, and the shell's ⌘Z store
// (client/v2/undo/use-undo-projection.jsx) talking to those routes.

import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry } from '../ai/runs.ts';
import { createUndoProjection } from '../client/v2/undo/use-undo-projection.jsx';
import { createProjectUndoRoutes, runStageHooks, runsLanded } from '../routes/project-undo.ts';
import { hashBytes } from '../sync/echo-guard.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const canvas = (hero: string) => `import { DCArtboard } from '@maude/canvas-lib';

export default function K() {
  return (
    <div>
      <DCArtboard id="desktop" width={1440} height={900}>
        <div style={{ background: "${hero}" }}>
          <h1>Calm software</h1>
        </div>
      </DCArtboard>
    </div>
  );
}
`;
const BLANK = `import { DesignCanvas } from '@maude/canvas-lib';

export default function K() {
  return <DesignCanvas />;
}
`;
const REL = 'ui/landing.tsx';
const REPO_REL = `.design/${REL}`;

async function rig() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-ai-undo-landing-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  const file = path.join(designRoot, REL);
  writeFileSync(file, BLANK);
  const h = openLocalHome({
    designRoot,
    designRel: '.design',
    canvasGroups: () => [{ path: 'ui' }],
    machine: { id: 'm_mac_one', name: 'Mac one' },
    bootId: 'boot-1',
    lockRetryMs: 0,
    settleMs: 5,
    // the studio's default beat for the watcher's last write — the window this bug lived in
    aiSettleMs: 250,
    log: { warn() {}, error() {} },
  });
  homes.push(h);
  await h.ready();
  const runtime = h.runtime;
  const reg = createRunRegistry({
    designRoot: null,
    home: createLocalLeaseHome({ actor: 'you' }),
    autoRenew: false,
    stage: runStageHooks({ control: () => runtime as never }),
  });
  const specs = createProjectUndoRoutes({ control: () => runtime as never, designRel: '.design' });
  const request = async (method: string, url: string, body?: unknown) => {
    const u = new URL(url, 'http://studio.test');
    const spec = specs.find((s) => s.method === method && s.path === u.pathname);
    if (!spec) return { status: 404, body: null };
    const res = await spec.handle(
      new Request(u, {
        method,
        ...(body !== undefined
          ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
          : {}),
      }),
      {} as never
    );
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const toasts: string[] = [];
  const shell = createUndoProjection({ request, announce: (t: string) => toasts.push(t) });

  /** One chat run that writes `body` as its tool; `end` = the turn ending (the chat's Done). */
  async function aiRun(label: string, body: string) {
    const rec = await reg.ask({ origin: 'maude-chat', chatId: 'c1', label, lazy: true });
    await reg.started(rec.runId);
    runtime.beginAiAction?.(`acp:c1`, label, { runId: rec.runId, chatId: 'c1' });
    writeFileSync(file, body);
    h.observe(REL);
    runtime.claimAiWrite?.(rec.runId, REPO_REL, hashBytes(body));
    return {
      runId: rec.runId,
      /** the registry's turn-end: publishing starts, NOT awaited (as acp/index.ts runTurn) */
      end: () => reg.turnEnded(rec.runId, 'done'),
    };
  }
  return { h, reg, shell, toasts, file, aiRun };
}

test('⌘Z the moment an AI run says Done undoes that run as one step, not the first draft', async () => {
  const { reg, shell, toasts, file, aiRun } = await rig();
  // The person opened the canvas, then asked for the first draft; it landed.
  await shell.open(REPO_REL);
  const first = await aiRun('A calm landing page for Studio site', canvas('#fff'));
  await first.end();
  // "Try a dark hero": the agent writes, its turn ends (Done in the chat) — and ⌘Z right then.
  const dark = await aiRun('Try a dark hero', canvas('#14181d'));
  const ending = dark.end();
  const r = (await shell.undo(REPO_REL)) as { ok?: boolean };
  await ending;
  expect(r.ok).toBe(true);
  expect(toasts).toEqual(['Undo: Try a dark hero']);
  // the dark hero is gone; the first draft stays
  const disk = readFileSync(file, 'utf8');
  expect(disk).toContain('background: "#fff"');
  expect(disk).toContain('<DCArtboard id="desktop"');
  reg.close();
});

test('a run that never finishes publishing holds ⌘Z for at most the bound', async () => {
  const runtime = {
    endAiAction: () => new Promise<never>(() => {}), // a hung publish (an unreachable hub)
  };
  const hooks = runStageHooks({ control: () => runtime as never });
  void hooks.publish(
    { runId: 'r_hung' },
    { partial: false, fence: { runId: 'r_hung', leases: [] } }
  );
  const t0 = Date.now();
  await runsLanded(runtime, 60);
  expect(Date.now() - t0).toBeLessThan(1000);
  // nothing landing: no wait at all
  const t1 = Date.now();
  await runsLanded({}, 5_000);
  expect(Date.now() - t1).toBeLessThan(100);
});

test('the undo stack the ⌘Z path reads already lists a run whose turn has just ended', async () => {
  const { h, reg, aiRun } = await rig();
  const first = await aiRun('A calm landing page for Studio site', canvas('#fff'));
  await first.end();
  const dark = await aiRun('Try a dark hero', canvas('#14181d'));
  const ending = dark.end();
  const specs = createProjectUndoRoutes({
    control: () => h.runtime as never,
    designRel: '.design',
  });
  const spec = specs.find((s) => s.path === '/_api/project/undo-stack');
  const res = await spec!.handle(
    new Request(
      `http://studio.test/_api/project/undo-stack?canvas=${encodeURIComponent(REPO_REL)}`
    ),
    {} as never
  );
  const view = (await res.json()) as { entries: Array<{ label: string; who: string }> };
  await ending;
  // newest first (projection.js historyRows): the run that just ended, then the first draft
  expect(view.entries.map((e) => [e.who, e.label])).toEqual([
    ['ai', 'Try a dark hero'],
    ['ai', 'A calm landing page for Studio site'],
  ]);
  reg.close();
});
