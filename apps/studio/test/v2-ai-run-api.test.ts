// S5.9 — the panel's doors to the run registry and to Undo (V2-1.5: one AI run = one version = one step).
import { describe, expect, test } from 'bun:test';
import {
  fetchChatRuns,
  keepGoingRun,
  redoRun,
  stopRun,
  undoNote,
  undoRun,
} from '../client/v2/ai/run-api.js';

type Call = { url: string; init?: RequestInit };
function fake(routes: Record<string, (init?: RequestInit) => Response>) {
  const calls: Call[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) throw new Error(`unexpected ${url}`);
    return routes[key](init);
  };
  return { impl: impl as unknown as typeof fetch, calls };
}
const ok = (body: unknown) => Response.json(body);
const run = { runId: 'r_aaaaaaaaaaaa', scope: { canvas: 'Combine.tsx', artboards: ['post'] } };

describe('Stop and Keep going go through the registry', () => {
  test('POST /_api/ai/runs/:id/stop', async () => {
    const f = fake({ '/_api/ai/runs/': () => ok({ run: {} }) });
    expect(await stopRun('r_aaaaaaaaaaaa', f.impl)).toEqual({ ok: true, status: 200 });
    expect(f.calls[0].url).toBe('/_api/ai/runs/r_aaaaaaaaaaaa/stop');
    expect(f.calls[0].init?.method).toBe('POST');
  });
  test('a run that is already over answers 409; the caller falls back to cancelling the thread', async () => {
    const f = fake({ '/_api/ai/runs/': () => new Response('{}', { status: 409 }) });
    expect((await stopRun('r_x', f.impl)).ok).toBe(false);
  });
  test('an unreachable server is a failed stop, not a throw', async () => {
    const impl = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await stopRun('r_x', impl)).toEqual({ ok: false, status: 0 });
    expect(await keepGoingRun('r_x', impl)).toEqual({ ok: false, status: 0 });
  });
  test('Keep going posts to keep-going', async () => {
    const f = fake({ '/_api/ai/runs/': () => ok({ run: {} }) });
    expect((await keepGoingRun('r_aaaaaaaaaaaa', f.impl)).ok).toBe(true);
    expect(f.calls[0].url).toBe('/_api/ai/runs/r_aaaaaaaaaaaa/keep-going');
  });
  test('the chat’s own runs only: this chat, from the Maude chat', async () => {
    const f = fake({
      '/_api/ai/runs': () =>
        ok({
          mine: [
            { runId: 'r_1', chatId: 'c1', origin: 'maude-chat' },
            { runId: 'r_2', chatId: 'c2', origin: 'maude-chat' },
            { runId: 'r_3', chatId: 'c1', origin: 'claude-code' },
          ],
        }),
    });
    expect((await fetchChatRuns('c1', f.impl)).map((r: { runId: string }) => r.runId)).toEqual([
      'r_1',
    ]);
  });
});

describe('Undo takes back the run’s own action', () => {
  test('reads the undo stack of the run’s canvas and posts the action carrying its runId', async () => {
    const f = fake({
      '/_api/project/undo-stack': () =>
        ok({
          ok: true,
          entries: [
            { actionId: 'a_me', runId: undefined, state: 'done' },
            { actionId: 'a_run', runId: 'r_aaaaaaaaaaaa', state: 'done' },
            { actionId: 'a_other', runId: 'r_other', state: 'done' },
          ],
          redo: [],
        }),
      '/_api/project/undo': () => ok({ ok: true, actionId: 'a_undo' }),
    });
    const out = await undoRun(run, { designRel: '.design' }, f.impl);
    expect(out.ok).toBe(true);
    expect(f.calls[0].url).toBe('/_api/project/undo-stack?canvas=.design%2FCombine.tsx');
    expect(JSON.parse(String(f.calls[1].init?.body))).toEqual({ actionId: 'a_run', via: 'panel' });
  });

  test('several actions from one run go as one undo (actionIds), never a sequence', async () => {
    const f = fake({
      '/_api/project/undo-stack': () =>
        ok({
          ok: true,
          entries: [
            { actionId: 'a1', runId: 'r_aaaaaaaaaaaa', state: 'done' },
            { actionId: 'a2', runId: 'r_aaaaaaaaaaaa', state: 'done' },
          ],
          redo: [],
        }),
      '/_api/project/undo': () => ok({ ok: true, actionId: 'a_undo' }),
    });
    await undoRun(run, {}, f.impl);
    expect(JSON.parse(String(f.calls[1].init?.body))).toEqual({
      actionIds: ['a1', 'a2'],
      via: 'panel',
    });
  });

  test('an entry that is not done (stale) is not undone again', async () => {
    const f = fake({
      '/_api/project/undo-stack': () =>
        ok({
          ok: true,
          entries: [{ actionId: 'a1', runId: 'r_aaaaaaaaaaaa', state: 'stale' }],
          redo: [],
        }),
    });
    expect(await undoRun(run, {}, f.impl)).toEqual({ ok: false, reason: 'not-found' });
    expect(f.calls).toHaveLength(1);
  });

  test('Redo reads the undone entries and says redo', async () => {
    const f = fake({
      '/_api/project/undo-stack': () =>
        ok({
          ok: true,
          entries: [],
          redo: [{ actionId: 'a_run', runId: 'r_aaaaaaaaaaaa', state: 'undone' }],
        }),
      '/_api/project/undo': () => ok({ ok: true, actionId: 'a_redo' }),
    });
    expect((await redoRun(run, {}, f.impl)).ok).toBe(true);
    expect(JSON.parse(String(f.calls[1].init?.body))).toEqual({
      actionId: 'a_run',
      redo: true,
      via: 'panel',
    });
  });

  test('a conflict (someone changed it since) is reported, not retried', async () => {
    const f = fake({
      '/_api/project/undo-stack': () =>
        ok({
          ok: true,
          entries: [{ actionId: 'a_run', runId: 'r_aaaaaaaaaaaa', state: 'done' }],
          redo: [],
        }),
      '/_api/project/undo': () =>
        Response.json({ ok: false, code: 'undo-conflict' }, { status: 409 }),
    });
    const out = await undoRun(run, {}, f.impl);
    expect(out).toMatchObject({ ok: false, reason: 'conflict' });
    expect(undoNote('conflict')).toBe('Someone changed this since, so nothing was undone.');
  });

  test('a project with no history home answers legacy; Undo says so and posts nothing', async () => {
    const f = fake({ '/_api/project/undo-stack': () => ok({ ok: false, reason: 'legacy' }) });
    expect(await undoRun(run, {}, f.impl)).toEqual({ ok: false, reason: 'legacy' });
    expect(f.calls).toHaveLength(1);
    expect(undoNote('legacy')).toBe("Undo isn't available in this project yet.");
  });

  test('an old team server refuses a multi-action undo with its own line', () => {
    expect(undoNote('needs-hub-update', 'Undo this chat needs the team server to be updated')).toBe(
      'Undo this chat needs the team server to be updated'
    );
  });

  test('a run with no canvas cannot be looked up', async () => {
    const f = fake({});
    expect(await undoRun({ runId: 'r_x', scope: null }, {}, f.impl)).toEqual({
      ok: false,
      reason: 'not-found',
    });
    expect(f.calls).toHaveLength(0);
  });
});
