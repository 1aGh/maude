// S5.5b — one ACP turn is ONE stage. A registry run's turn begins its stage under the run's id
// (`beginAiAction(key, label, { runId, chatId })`), claims each completed edit by the content's
// sha256, and never ends the stage itself: the registry does (publish / partial / hold), so Stop
// publishes a partial version instead of the tracker's "failed" holding it first.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SessionUpdate } from '@agentclientprotocol/sdk';

import { createAgentActivityTracker } from '../acp/index.ts';
import type { AiActivity } from '../collab/ai-activity.ts';
import { type Context, createBus } from '../context.ts';
import { hashBytes } from '../sync/echo-guard.ts';

const ROOT = mkdtempSync(join(tmpdir(), 'acp-run-stage-'));
const DESIGN = join(ROOT, '.design');
mkdirSync(join(DESIGN, 'ui'), { recursive: true });
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

type Call = [string, ...unknown[]];

function mkCtx(calls: Call[]): Context {
  const runtime = {
    beginAiAction: (...a: unknown[]) => void calls.push(['begin', ...a]),
    claimAiWrite: (...a: unknown[]) => void calls.push(['claim', ...a]),
    endAiAction: async (...a: unknown[]) => {
      calls.push(['end', ...a]);
      return null;
    },
  };
  return {
    cfg: {} as Context['cfg'],
    projectLabel: 'test',
    bus: createBus(),
    paths: {
      repoRoot: ROOT,
      designRel: '.design',
      designRoot: DESIGN,
      serverInfoFile: join(DESIGN, '_server.json'),
      activeFile: join(DESIGN, '_active.json'),
      commentsDir: join(DESIGN, '_comments'),
      canvasStateDir: join(DESIGN, '_canvas-state'),
      historyDir: join(DESIGN, '_history'),
      tokensUrlRel: '',
      systemDirRel: 'system',
    },
    syncControl: { current: () => runtime },
  } as unknown as Context;
}

const ai: AiActivity = {
  start: (file) => ({ file, author: 'x', startedAt: 0, lastHeartbeat: 0 }),
  heartbeat: (file) => ({ file, author: 'x', startedAt: 0, lastHeartbeat: 0 }),
  end: () => true,
  list: () => [],
  get: () => null,
  stop: () => {},
};
const upd = (u: Record<string, unknown>): SessionUpdate => u as unknown as SessionUpdate;
const FILE = join(DESIGN, 'ui', 'k.tsx');

function editTurn(t: ReturnType<typeof createAgentActivityTracker>, body: string) {
  t.onUpdate(
    upd({ sessionUpdate: 'tool_call', toolCallId: 't1', kind: 'edit', locations: [{ path: FILE }] })
  );
  writeFileSync(FILE, body);
  t.onUpdate(
    upd({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed',
      locations: [{ path: FILE }],
    })
  );
}

describe('acp / a registry run is one stage, ended by the registry', () => {
  test('begin carries the run id + chat; a completed edit claims its content hash; endTurn ends nothing', () => {
    const calls: Call[] = [];
    const t = createAgentActivityTracker(mkCtx(calls), ai, 'c1');
    t.beginTurn?.('restyle the footer', 'r_abc');
    editTurn(t, 'export default () => <p>x</p>;\n');
    t.endTurn('failed');
    expect(calls).toEqual([
      ['begin', 'acp:c1', 'restyle the footer', { runId: 'r_abc', chatId: 'c1' }],
      ['claim', 'r_abc', '.design/ui/k.tsx', hashBytes('export default () => <p>x</p>;\n')],
    ]);
  });

  test('a pre-S5.6 direct turn (no run) still opens and ends its own stage', () => {
    const calls: Call[] = [];
    const t = createAgentActivityTracker(mkCtx(calls), ai, 'c2');
    t.beginTurn?.('plain');
    editTurn(t, 'export default () => <p>y</p>;\n');
    t.endTurn('done');
    expect(calls.map((c) => c[0])).toEqual(['begin', 'claim', 'end']);
    expect(calls[0][3]).toEqual({ chatId: 'c2' });
    expect(calls[2]).toEqual(['end', 'acp:c2', 'done']);
  });
});
