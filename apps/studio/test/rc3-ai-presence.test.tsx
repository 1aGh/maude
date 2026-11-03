// rc3-h (issue #182) — the canvas reacts the moment a run starts on it, before the first write:
//   · an EMPTY canvas shows a dashed spark ghost where the first artboard lands, "AI is drafting…", and the AI
//     cursor on it — instead of the "Ask AI for a first draft" card (shell-side, over the canvas pane);
//   · a canvas WITH artboards gets a ring on the artboard an in-flight edit names, before its write lands
//     (`ai-runs` via the ring relay — no new message, no new route);
//   · both go when the run ends, fails, is stopped, or the real artboard lands.

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { targetRings } from '../client/v2/ai/activity-line.js';
import { createActivityStore } from '../client/v2/ai/activity-store.js';
import { createRingsLane } from '../client/v2/ai/ring-relay.js';
import { AiDrafting, draftingPresence } from '../client/v2/empty/ai-drafting.jsx';

const FILE = '.design/ui/Kanban.tsx';
const run = (state: string, extra: Record<string, unknown> = {}) => ({
  runId: 'r1',
  state,
  scope: { canvas: 'ui/Kanban.tsx', artboards: '*' },
  leases: [],
  ...extra,
});
const view = (...mine: unknown[]) => ({ seq: 1, mine, others: [], needsYou: 0, live: mine.length });
const facts = (v: unknown, extra: Record<string, unknown> = {}) => ({
  view: v,
  activePath: FILE,
  designRel: '.design',
  count: 0,
  target: null,
  ...extra,
});

describe('draftingPresence - the empty canvas while a run of yours works on it', () => {
  test('appears as soon as the run starts (starting / running), before any write', () => {
    expect(draftingPresence(facts(view(run('starting'))))?.label).toBe('AI is drafting…');
    expect(draftingPresence(facts(view(run('running'))))?.label).toBe('AI is drafting…');
  });
  test('a question for you keeps the spot, and says it waits for you', () => {
    const p = draftingPresence(facts(view(run('needs-you'))));
    expect(p?.label).toBe('Waiting for you');
    expect(p?.waiting).toBe(true);
  });
  test('clears when the run ends, fails or is stopped (ended), or only waits in line', () => {
    expect(draftingPresence(facts(view(run('ended', { outcome: 'done' }))))).toBeNull();
    expect(draftingPresence(facts(view(run('ended', { outcome: 'failed' }))))).toBeNull();
    expect(draftingPresence(facts(view(run('ended', { outcome: 'stopped' }))))).toBeNull();
    expect(draftingPresence(facts(view(run('waiting'))))).toBeNull();
    expect(draftingPresence(facts(view()))).toBeNull();
  });
  test('clears when the real artboard lands (the canvas counts one), and waits while the count is unknown', () => {
    expect(draftingPresence(facts(view(run('running')), { count: 1 }))).toBeNull();
    expect(draftingPresence(facts(view(run('running')), { count: null }))).toBeNull();
  });
  test("another canvas's run, or another person's, draws nothing here", () => {
    expect(
      draftingPresence(facts(view(run('running', { scope: { canvas: 'ui/Other.tsx' } }))))
    ).toBeNull();
    expect(
      draftingPresence(
        facts({
          seq: 1,
          mine: [],
          others: [{ state: 'running', canvas: FILE }],
          needsYou: 0,
          live: 1,
        })
      )
    ).toBeNull();
  });
  test('the artboard being added names the ghost ("AI is drawing Kanban")', () => {
    const p = draftingPresence(
      facts(view(run('running')), {
        target: { file: FILE, artboard: 'kanban', label: 'Kanban', adding: true },
      })
    );
    expect(p?.label).toBe('AI is drawing Kanban');
  });
  test('a lazy run with no scope counts once its edit names this canvas', () => {
    const lazy = run('running', { scope: null });
    expect(draftingPresence(facts(view(lazy)))).toBeNull();
    expect(
      draftingPresence(
        facts(view(lazy), { target: { file: FILE, artboard: 'k', label: 'K', adding: true } })
      )?.label
    ).toBe('AI is drawing K');
  });
});

describe('<AiDrafting> - the ghost + the AI cursor', () => {
  test('a dashed spark ghost at the free centre, its label, the AI cursor; decorative for AT', () => {
    const html = renderToStaticMarkup(<AiDrafting label="AI is drafting…" centre={600} />);
    expect(html).toContain('data-testid="ai-drafting"');
    expect(html).toContain('data-testid="ai-drafting-ghost"');
    expect(html).toContain('data-testid="ai-drafting-cursor"');
    expect(html).toContain('AI is drafting…');
    expect(html).toContain('--es-cx:600px');
    expect(html).toContain('aria-hidden="true"');
  });
  test('waiting: the cursor rests (no motion class)', () => {
    const html = renderToStaticMarkup(<AiDrafting label="Waiting for you" centre={600} waiting />);
    expect(html).toContain('data-waiting="true"');
  });
});

describe('the ring on the artboard an edit names, before the write lands', () => {
  test('targetRings: a known artboard of THIS canvas; never one being added, never another file', () => {
    const t = { file: FILE, artboard: 'mobile', label: 'Mobile' };
    expect(targetRings(t, FILE)).toEqual({
      mobile: { state: 'running', who: 'you', tag: 'AI is editing Mobile', waiting: 0 },
    });
    expect(targetRings({ ...t, adding: true }, FILE)).toEqual({});
    expect(targetRings(t, '.design/ui/Other.tsx')).toEqual({});
    expect(targetRings(null, FILE)).toEqual({});
  });

  test('the relay tells the canvas frame the moment the target is set, and again when it lets go', () => {
    const posted: unknown[] = [];
    const frame = {
      getAttribute: (k: string) =>
        k === 'data-path' ? FILE : k === 'src' ? 'http://127.0.0.1:5555/x' : null,
      dataset: { path: FILE },
      src: 'http://127.0.0.1:5555/_canvas-shell.html',
      contentWindow: {
        postMessage: (m: { dgn: string }) => {
          if (m.dgn === 'ai-runs') posted.push(m);
        },
      },
    };
    const doc = { querySelectorAll: () => [frame] };
    const runsStore = {
      getSnapshot: () => ({ view: view(run('running')), done: {} }),
      subscribe: () => () => {},
    };
    const activity = createActivityStore();
    const stop = createRingsLane({
      store: runsStore,
      madeByAi: null,
      activity,
      doc,
      win: { addEventListener() {}, removeEventListener() {} },
    });
    expect(posted.length).toBe(0); // nothing to say yet
    activity.set({ file: FILE, artboard: 'mobile', label: 'Mobile' });
    expect(posted.at(-1)).toEqual({
      dgn: 'ai-runs',
      artboards: {
        mobile: { state: 'running', who: 'you', tag: 'AI is editing Mobile', waiting: 0 },
      },
    });
    activity.set(null);
    expect(posted.at(-1)).toEqual({ dgn: 'ai-runs', artboards: {} });
    stop();
  });
});
