// S12.16 fix — an edit made in the AI chat panel ends as an `ai` entry in Version history, one per
// run (S5), never `outside`. The panel's studio side for real: the chat's activity tracker
// (acp/index.ts) begins the run's stage under its registry run id, the run registry's stage hooks
// publish it (routes/project-undo.ts runStageHooks), over a real local home (sync/local-kernel.ts).
//
// The updates are the shape the adapter really sends (S2 acp, live run 1): the call is announced
// with no input, its path arrives in a later update, and the `completed` update carries NO path.
// With two chats at once the store cannot guess whose write it saw: the tracker must claim the
// path it learned earlier in the call.

import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SessionUpdate } from '@agentclientprotocol/sdk';

import { createAgentActivityTracker } from '../acp/index.ts';
import type { AiActivity } from '../collab/ai-activity.ts';
import { type Context, createBus } from '../context.ts';
import { runStageHooks } from '../routes/project-undo.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';

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
  const root = mkdtempSync(path.join(tmpdir(), 'maude-acp-attr-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  for (const f of ['a', 'b']) writeFileSync(path.join(designRoot, 'ui', `${f}.tsx`), canvas(f));
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
const upd = (u: Record<string, unknown>) => u as unknown as SessionUpdate;

/** One Edit call as the adapter streams it: announce (no input) → input + path → completed (no path). */
function edit(
  t: ReturnType<typeof createAgentActivityTracker>,
  id: string,
  rel: string,
  write: () => void
) {
  t.onUpdate(
    upd({
      sessionUpdate: 'tool_call',
      toolCallId: id,
      kind: 'edit',
      status: 'pending',
      rawInput: {},
      locations: [],
    })
  );
  t.onUpdate(
    upd({
      sessionUpdate: 'tool_call_update',
      toolCallId: id,
      kind: 'edit',
      locations: [{ path: rel }],
      rawInput: { file_path: rel, old_string: 'x', new_string: 'y', replace_all: false },
    })
  );
  write();
  t.onUpdate(upd({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed' }));
}

test('two chats edit two canvases at once: each run lands as ONE ai version, never outside', async () => {
  const { h, ctx, stage, designRoot } = await rig();
  const t1 = createAgentActivityTracker(ctx, ai, 'c1');
  const t2 = createAgentActivityTracker(ctx, ai, 'c2');
  t1.beginTurn?.('Rename the a heading', 'r_attr1');
  t2.beginTurn?.('Rename the b heading', 'r_attr2');
  edit(t1, 'tc1', '.design/ui/a.tsx', () =>
    writeFileSync(path.join(designRoot, 'ui', 'a.tsx'), canvas('A by c1'))
  );
  edit(t2, 'tc2', '.design/ui/b.tsx', () =>
    writeFileSync(path.join(designRoot, 'ui', 'b.tsx'), canvas('B by c2'))
  );
  h.observe('ui/a.tsx');
  h.observe('ui/b.tsx');
  await h.flush();
  const fence = (runId: string) => ({ runId, leases: [] });
  expect(
    await stage.publish({ runId: 'r_attr1' }, { partial: false, fence: fence('r_attr1') })
  ).toMatchObject({
    status: 'accepted',
  });
  expect(
    await stage.publish({ runId: 'r_attr2' }, { partial: false, fence: fence('r_attr2') })
  ).toMatchObject({
    status: 'accepted',
  });
  const rows = (await h.runtime.acceptedHistory({ limit: 50 })).filter(
    (r) => r.kind !== 'migration.import'
  );
  expect(rows.map((r) => r.kind)).not.toContain('outside');
  expect(
    rows
      .map((r) => [r.kind, r.runId, r.chatId, r.canvases])
      .sort((x, y) => String(x[1]).localeCompare(String(y[1])))
  ).toEqual([
    ['ai', 'r_attr1', 'c1', ['ui/a.tsx']],
    ['ai', 'r_attr2', 'c2', ['ui/b.tsx']],
  ]);
});
