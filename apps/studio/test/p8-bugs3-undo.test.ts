// p8-bugs3 #4 and #5 — the shell's ⌘Z, two words and one refusal (board 01 cf-undo-ai).
//   #4 decision v2-p8-undo-while-ai-runs-refuses: ⌘Z while YOUR AI run is still working on this canvas says
//      "AI is still working — Stop is in the AI chat" and changes nothing (no request, no entry moves).
//   #5 the toast reads "Undone — <label>" with Redo as its action (not "Undo: <label>" and a bare ×).
import { describe, expect, test } from 'bun:test';

import { ownRunWorkingOn } from '../client/v2/ai/runs-model.js';
import { createUndoProjection, undoWords } from '../client/v2/undo/use-undo-projection.jsx';

const REPO = '.design/ui/Combine.tsx';
const ENTRY = {
  actionId: 'a_run',
  kind: 'ai',
  state: 'done',
  label: 'Try a dark hero',
  mine: true,
  who: 'ai',
  madeAt: 200,
  revision: 3,
  canvases: ['ui/Combine.tsx'],
};

function rig(over: { ownRunOn?: (repoRel: string) => boolean } = {}) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const toasts: Array<{ text: string; action?: { label: string; onClick: () => void } }> = [];
  let undone = false;
  const request = async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body });
    if (method === 'GET')
      return {
        status: 200,
        body: { ok: true, entries: [{ ...ENTRY, state: undone ? 'undone' : 'done' }], redo: [] },
      };
    undone = !(body as { redo?: boolean })?.redo;
    return { status: 200, body: { ok: true, actionId: 'a_undo' } };
  };
  const store = createUndoProjection({
    request,
    now: () => 100,
    announce: (text: string, action?: { label: string; onClick: () => void }) =>
      toasts.push({ text, action }),
    ...over,
  } as never);
  return { store, calls, toasts };
}

describe('#5 the undo toast', () => {
  test('"Undone — <label>" with Redo as its action; "Redone — <label>" with Undo', () => {
    expect(undoWords.undone('Try a dark hero')).toBe('Undone — Try a dark hero');
    expect(undoWords.redone('Try a dark hero')).toBe('Redone — Try a dark hero');
  });

  test('⌘Z toasts the words and hands over a Redo that redoes it', async () => {
    const { store, calls, toasts } = rig();
    const r = await store.undo(REPO);
    expect(r).toMatchObject({ handled: true, ok: true });
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.text).toBe('Undone — Try a dark hero');
    expect(toasts[0]?.action?.label).toBe('Redo');
    // the action is the real ⇧⌘Z: it posts the redo of the undo the server answered with
    await toasts[0]?.action?.onClick();
    const post = calls.filter((c) => c.method === 'POST').at(-1);
    expect(post?.body).toMatchObject({ actionId: 'a_undo', redo: true });
  });
});

describe('#4 ⌘Z while your own AI run is still working on this canvas', () => {
  test('it is refused with the toast, and nothing is read or sent', async () => {
    const { store, calls, toasts } = rig({ ownRunOn: (p) => p === REPO });
    const r = await store.undo(REPO);
    expect(r).toMatchObject({ handled: true, ok: false, reason: 'ai-working' });
    expect(toasts.map((t) => t.text)).toEqual(['AI is still working — Stop is in the AI chat']);
    expect(toasts[0]?.action).toBeUndefined();
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  test('another canvas, or no run, is not blocked', async () => {
    const { store, calls } = rig({ ownRunOn: (p) => p === '.design/ui/Other.tsx' });
    const r = await store.undo(REPO);
    expect(r).toMatchObject({ handled: true, ok: true });
    expect(calls.some((c) => c.method === 'POST')).toBe(true);
  });

  test('⇧⌘Z (redo) is not refused: only ⌘Z builds on the entry the run is working from', async () => {
    const { store } = rig({ ownRunOn: () => true });
    const r = await store.redo(REPO);
    expect(r.reason).not.toBe('ai-working');
  });
});

describe('ownRunWorkingOn — which runs count', () => {
  const run = (state: string, canvas = REPO, artboard = 'desktop') => ({
    state,
    leases: [{ canvas: `path:${canvas}`, artboard, token: 1 }],
    waiting: [],
  });
  const view = (mine: unknown[], others: unknown[] = []) => ({ seq: 1, mine, others });

  test('running, starting and needs-you on this canvas are working', () => {
    for (const s of ['running', 'starting', 'needs-you'])
      expect(ownRunWorkingOn(view([run(s)]), REPO)).toBe(true);
  });
  test('waiting in line, ended, another canvas and someone else’s run are not', () => {
    expect(ownRunWorkingOn(view([run('waiting')]), REPO)).toBe(false);
    expect(ownRunWorkingOn(view([run('done')]), REPO)).toBe(false);
    expect(ownRunWorkingOn(view([run('running', '.design/ui/Other.tsx')]), REPO)).toBe(false);
    expect(ownRunWorkingOn(view([], [run('running')]), REPO)).toBe(false);
    expect(ownRunWorkingOn(null, REPO)).toBe(false);
  });
  test('a run scoped to the whole canvas without a lease yet still counts', () => {
    const r = { state: 'running', leases: [], scope: { canvas: 'ui/Combine.tsx', artboards: '*' } };
    expect(ownRunWorkingOn(view([r]), REPO, '.design')).toBe(true);
  });
});
