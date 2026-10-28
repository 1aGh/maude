// p8-t-video-3 — a shell write verb opens the run's stage the way an edit tool does.
//
// The Maude chat's AI cut places each shot with `maude design reel-place …` — a Bash tool call (ACP kind
// `execute`), never an edit tool. The stage used to open only on an edit-kind call, so every shot the verb wrote
// landed as its own "changed outside the app" action: the run published nothing, the finished cut was never
// "Made by AI" and had no one-step Undo. (Found by the video-ai-chat desktop e2e: the history held 14 `outside`
// rows and no `ai` row.)

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SessionUpdate } from '@agentclientprotocol/sdk';

import { runsDesignWriteVerb } from '../acp/design-write-verb.ts';
import { createAgentActivityTracker } from '../acp/index.ts';
import type { AiActivity } from '../collab/ai-activity.ts';
import { type Context, createBus } from '../context.ts';

const ROOT = mkdtempSync(join(tmpdir(), 'acp-shell-stage-'));
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

const shell = (t: ReturnType<typeof createAgentActivityTracker>, command: string, id: string) =>
  t.onUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: id,
    kind: 'execute',
    status: 'in_progress',
    rawInput: { command },
  } as unknown as SessionUpdate);

describe('acp / a shell write verb opens the run stage', () => {
  test('`maude design reel-place …` begins the stage under the run id, once; the registry ends it', () => {
    const calls: Call[] = [];
    const t = createAgentActivityTracker(mkCtx(calls), ai, 'c3');
    t.beginTurn?.('make a recap', 'r_cut');
    shell(t, 'maude design reel-place recap --next --canvas ui/V.tsx#recap', 'b1');
    shell(t, 'cd /tmp && maude design reel-place recap --next --canvas ui/V.tsx#recap', 'b2');
    t.endTurn('done');
    expect(calls).toEqual([['begin', 'acp:c3', 'make a recap', { runId: 'r_cut', chatId: 'c3' }]]);
  });

  test('a read verb, a plain shell command and a look-alike open nothing', () => {
    const calls: Call[] = [];
    const t = createAgentActivityTracker(mkCtx(calls), ai, 'c4');
    t.beginTurn?.('look', 'r_look');
    shell(t, 'maude design screenshot --full', 'b1');
    shell(t, 'ls -la .design', 'b2');
    shell(t, 'echo "run maude design-reel-place later"', 'b3');
    shell(t, 'maude design not-a-verb', 'b4');
    t.endTurn('done');
    expect(calls).toEqual([]);
  });
});

describe('acp / runsDesignWriteVerb', () => {
  test('write verbs, in a pipeline or after a cd', () => {
    expect(runsDesignWriteVerb('maude design reel-place recap --next')).toBe(true);
    expect(runsDesignWriteVerb('cd x && maude design annotate --in a')).toBe(true);
    expect(runsDesignWriteVerb('(maude design reel-place a); echo')).toBe(true);
  });
  test('reads and non-verbs', () => {
    expect(runsDesignWriteVerb('maude design canvas-rects')).toBe(false);
    expect(runsDesignWriteVerb('maude config show')).toBe(false);
    expect(runsDesignWriteVerb(undefined)).toBe(false);
    expect(runsDesignWriteVerb(42)).toBe(false);
  });
});
