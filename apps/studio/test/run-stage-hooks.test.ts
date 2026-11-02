// S5.5b — the run registry ends a run's stage BY ITS RUN ID (routes/project-undo.ts runStageHooks):
// a turn that ended publishes, Stop publishes partial with the fence, an error holds, and every
// published run is announced as `project:action` with the artboards it touched (V2-1.5 §5.3).

import { describe, expect, test } from 'bun:test';
import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry } from '../ai/runs.ts';
import { runStageHooks } from '../routes/project-undo.ts';

function rig(answer: { status: 'accepted' | 'rejected'; code?: string } = { status: 'accepted' }) {
  const ends: Array<{ key: string; outcome: string; fence?: unknown }> = [];
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const runtime = {
    async endAiAction(
      key: string,
      outcome: 'done' | 'failed' | 'stopped',
      o?: { fence?: unknown }
    ) {
      ends.push({ key, outcome, ...(o?.fence ? { fence: o.fence } : {}) });
      if (outcome === 'failed') return null;
      return {
        ...answer,
        ...(answer.status === 'accepted' ? { actionId: 'a_run1' } : {}),
        touched: { 'ui/k.tsx': ['p', 's'] },
      };
    },
    async acceptedHistory() {
      return [
        {
          revision: 7,
          actionId: 'a_run1',
          actor: 'you',
          mine: true,
          kind: 'ai',
          label: 'Restyle',
          committedAt: 10,
          madeAt: 9,
          undoes: null,
          canvases: ['ui/k.tsx'],
          runId: 'r_1',
          chatId: 'c1',
        },
      ];
    },
  };
  const hooks = runStageHooks({
    control: () => runtime,
    emit: (event, payload) => events.push({ event, payload: payload as Record<string, unknown> }),
  });
  return { hooks, ends, events };
}

const fence = { runId: 'r_1', leases: [{ entry: 'ui/k.tsx', artboard: 'p', token: 3 }] };

describe('runStageHooks', () => {
  test('a turn that ended publishes by run id and announces project:action with the touched artboards', async () => {
    const { hooks, ends, events } = rig();
    const r = await hooks.publish({ runId: 'r_1' }, { partial: false, fence });
    expect(r).toEqual({ status: 'accepted' });
    expect(ends).toEqual([{ key: 'r_1', outcome: 'done', fence }]);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('project:action');
    expect(events[0].payload).toMatchObject({
      actionId: 'a_run1',
      kind: 'ai',
      runId: 'r_1',
      chatId: 'c1',
      canvases: ['ui/k.tsx'],
      artboards: { 'ui/k.tsx': ['p', 's'] },
    });
  });

  test('Stop publishes partial (stopped); an error holds (failed) and announces nothing', async () => {
    const { hooks, ends, events } = rig();
    await hooks.publish({ runId: 'r_1' }, { partial: true, fence });
    await hooks.hold({ runId: 'r_1' });
    expect(ends.map((e) => e.outcome)).toEqual(['stopped', 'failed']);
    expect(events).toHaveLength(1);
  });

  test('a fenced publish answers its code to the registry (lease lost) and is not announced', async () => {
    const { hooks, events } = rig({ status: 'rejected', code: 'lease-fenced' });
    expect(await hooks.publish({ runId: 'r_1' }, { partial: false, fence })).toEqual({
      status: 'rejected',
      code: 'lease-fenced',
    });
    expect(events).toHaveLength(0);
  });

  test('the registry calls them: a hook run that ends publishes its stage by run id', async () => {
    const { hooks, ends } = rig();
    const reg = createRunRegistry({
      designRoot: null,
      home: createLocalLeaseHome({ actor: 'you' }),
      autoRenew: false,
      stage: hooks,
    });
    const { rec } = reg.open({ origin: 'claude-code', sessionId: 's1', label: 'x' });
    await reg.admit(rec, { lazy: true });
    reg.endNow(rec.runId, 'done');
    await new Promise((r) => setTimeout(r, 20));
    expect(ends.map((e) => [e.key, e.outcome])).toEqual([[rec.runId, 'done']]);
  });
});
