// Issue #177 — the AI chat says several agents are working, and nothing in the chat shows it.
// Claude Code's live set of background tasks (`background_tasks_changed`) reaches us only as the
// adapter's `Unexpected case:` stderr line. These pin: the line becomes a task list (a subagent and a
// background command each a row, ended ones gone, ambient ones hidden), `command_lifecycle` is quiet,
// garbage never throws, a snapshot split across stderr chunks still parses, and — end to end through
// the ACP manager — the chat gets `{t:'background'}` frames and counts as running until the work ends.

import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import type { ServerWebSocket } from 'bun';

import { relayAdapterLine, relayAdapterStderr } from '../acp/adapter-stderr.ts';
import {
  type BackgroundTask,
  createLineSplitter,
  foldSnapshot,
  isCommandLifecycleLine,
  MAX_TASKS,
  parseBackgroundLine,
} from '../acp/background-tasks.ts';
import { createAcp } from '../acp/index.ts';
import { activitySnapshot, registerActivityProbe } from '../acp/running.ts';
import type { Context } from '../context.ts';
import type { WsData } from '../ws.ts';

const line = (tasks: unknown[], extra: Record<string, unknown> = {}) =>
  `Unexpected case: ${JSON.stringify({ type: 'system', subtype: 'background_tasks_changed', tasks, uuid: 'u', session_id: 's', ...extra })}`;
function snapOf(l: string) {
  const snap = parseBackgroundLine(l);
  if (!snap) throw new Error('no snapshot in line');
  return snap;
}
const AGENT = { task_id: 'a1', task_type: 'local_agent', description: 'Review the Pricing canvas' };
const SHELL = { task_id: 'b1', task_type: 'local_bash', description: 'Export the reel' };

describe('background_tasks_changed → task list', () => {
  test('a subagent and a background command each become a row with a kind', () => {
    const snap = parseBackgroundLine(line([AGENT, SHELL]));
    expect(snap?.sessionId).toBe('s');
    const tasks = foldSnapshot([], snapOf(line([AGENT, SHELL])), 1000);
    expect(tasks).toEqual([
      { id: 'a1', kind: 'agent', label: 'Review the Pricing canvas', since: 1000 },
      { id: 'b1', kind: 'command', label: 'Export the reel', since: 1000 },
    ]);
  });

  test('replace semantics: an ended task is gone, a running one keeps its start time', () => {
    const first = foldSnapshot([], snapOf(line([AGENT, SHELL])), 1000);
    const second = foldSnapshot(first, snapOf(line([SHELL])), 5000);
    expect(second).toEqual([{ id: 'b1', kind: 'command', label: 'Export the reel', since: 1000 }]);
    expect(foldSnapshot(second, snapOf(line([])), 9000)).toEqual([]);
  });

  test('ambient and awaited tasks are not background activity', () => {
    const snap = snapOf(
      line([
        { task_id: 'w', task_type: 'monitor', description: 'watch', ambient: true },
        { task_id: 'r', task_type: 'local_agent', description: 'resumed', awaited: true },
        AGENT,
      ])
    );
    expect(foldSnapshot([], snap).map((t) => t.id)).toEqual(['a1']);
  });

  test('a label is one capped line; a bad id or a flood is cut', () => {
    const snap = snapOf(
      line([
        { task_id: 'x', task_type: 'local_agent', description: `a\nb‮${'c'.repeat(200)}` },
        { task_id: '../../etc', task_type: 'local_bash', description: 'nope' },
        { task_id: 'y', task_type: 'local_agent', description: '', subagent_type: 'critic' },
      ])
    );
    const tasks = foldSnapshot([], snap);
    expect(tasks.map((t) => t.id)).toEqual(['x', 'y']);
    expect(tasks[0].label.length).toBeLessThanOrEqual(80);
    expect(tasks[0].label).not.toMatch(/[\n‮]/);
    expect(tasks[1].label).toBe('critic');
    const many = Array.from({ length: 80 }, (_, i) => ({
      task_id: `t${i}`,
      task_type: 'local_bash',
      description: 'x',
    }));
    expect(foldSnapshot([], snapOf(line(many)))).toHaveLength(MAX_TASKS);
  });

  test('anything else is ignored without throwing', () => {
    for (const l of [
      'adapter ready',
      'Unexpected case: {"type":"system","subtype":"background_tasks_changed"',
      'Unexpected case: {"type":"system","subtype":"background_tasks_changed","tasks":"no"}',
      'Unexpected case: {"type":"system","subtype":"something_new"}',
      'debug: background_tasks_changed seen',
    ]) {
      expect(parseBackgroundLine(l)).toBeNull();
    }
  });
});

describe('the adapter stderr relay', () => {
  test('a snapshot goes to onBackground, not the log; command_lifecycle is quiet', () => {
    const logged: string[] = [];
    const snaps: BackgroundTask[][] = [];
    const lifecycle =
      'Unexpected case: {"type":"command_lifecycle","command_uuid":"c","state":"queued","uuid":"u","session_id":"s"}';
    expect(isCommandLifecycleLine(lifecycle)).toBe(true);
    relayAdapterStderr(
      [
        line([AGENT]),
        lifecycle,
        'Unexpected case: {"type":"system","subtype":"brand_new"}',
        '',
      ].join('\n'),
      (l) => logged.push(l),
      (snap) => snaps.push(foldSnapshot([], snap, 1))
    );
    expect(snaps).toEqual([
      [{ id: 'a1', kind: 'agent', label: 'Review the Pricing canvas', since: 1 }],
    ]);
    expect(logged).toEqual(['Unexpected case: {"type":"system","subtype":"brand_new"}']);
  });

  test('a snapshot split across stderr chunks is read whole', () => {
    const got: string[] = [];
    const split = createLineSplitter((l) =>
      relayAdapterLine(
        l,
        () => {},
        (snap) => got.push(snap.tasks.map((t) => String(t.task_id)).join())
      )
    );
    const whole = `${line([AGENT, SHELL])}\n`;
    split.push(whole.slice(0, 40));
    split.push(whole.slice(40, 90));
    expect(got).toEqual([]);
    split.push(whole.slice(90));
    expect(got).toEqual(['a1,b1']);
  });
});

// ── end to end: the ACP manager, a scripted adapter (fixtures/mock-acp-agent-background.mjs) ──

const FIXTURE = join(import.meta.dir, 'fixtures', 'mock-acp-agent-background.mjs');
const ENV_KEYS = [
  'MAUDE_ACP_ADAPTER_ENTRY',
  'MAUDE_ACP_RUNTIME',
  'MAUDE_CLAUDE_BIN',
  'MOCK_BG_STEP_MS',
];

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  registerActivityProbe(() => []);
});

async function until<T>(fn: () => T | undefined, timeoutMs = 12000): Promise<T> {
  const start = performance.now();
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (performance.now() - start > timeoutMs) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('the chat hears about background work (createAcp + scripted adapter)', () => {
  test('frames name the tasks, the chat stays running after turn-end until they end', async () => {
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_ACP_RUNTIME = process.execPath;
    process.env.MAUDE_CLAUDE_BIN = process.execPath;
    process.env.MOCK_BG_STEP_MS = '600';
    const ctx = {
      paths: { repoRoot: process.cwd(), designRoot: '/tmp/does-not-matter-bg-177' },
    } as unknown as Context;
    const acp = createAcp(ctx);
    const frames: Array<Record<string, unknown>> = [];
    const ws = {
      data: { id: 'bg-ws' } as WsData,
      send: (raw: string) => frames.push(JSON.parse(raw)),
    } as unknown as ServerWebSocket<WsData>;
    const bgFrames = () =>
      frames.filter((f) => f.t === 'background') as Array<{ tasks: BackgroundTask[] }>;
    try {
      acp.onOpen(ws);
      acp.onMessage(ws, JSON.stringify({ t: 'prompt', text: 'review it', chat: 'bg-chat' }));
      const two = await until(() => bgFrames().find((f) => f.tasks.length === 2));
      expect(two.tasks.map((t) => [t.kind, t.label])).toEqual([
        ['agent', 'Review the Pricing canvas'],
        ['command', 'Export the reel to mp4'],
      ]);
      await until(() => frames.find((f) => f.t === 'turn-end'));
      // the turn has settled, the work has not: the tab must not rest
      expect(activitySnapshot().chats).toContainEqual({ chatId: 'bg-chat', state: 'running' });
      const one = await until(() => bgFrames().find((f) => f.tasks.length === 1));
      expect(one.tasks[0].id).toBe('bxk9q1');
      await until(() => bgFrames().find((f) => f.tasks.length === 0));
      expect(activitySnapshot().chats).toContainEqual({ chatId: 'bg-chat', state: 'idle' });
    } finally {
      acp.onClose(ws);
      acp.stopAll();
      await new Promise((r) => setTimeout(r, 50));
    }
  }, 20000);
});
