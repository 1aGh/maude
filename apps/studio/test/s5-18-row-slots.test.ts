// S5.18 G4 (03 `ai-needs-hidden`) — the Canvases panel's row says "Needs you" while a run on that canvas waits for a
// person, and "AI is working" otherwise. Red first: nothing called `setRowSlots('ai', …)`, so no row ever did.
import { afterEach, describe, expect, test } from 'bun:test';
import { OPEN_AI_EVENT, openAiChat } from '../client/v2/ai/needs-you-toast.js';
import { createRowSlotsLane, rowSlotsFor } from '../client/v2/ai/row-slots-lane.js';
import { normalizeRuns } from '../client/v2/ai/runs-model.js';
import {
  getRowSlots,
  registerRowSlot,
  resetRowSlots,
  resolveSlot,
} from '../client/v2/canvases/row-slots.js';

const run = (over: Record<string, unknown>) => ({
  runId: `r_${Math.random().toString(36).slice(2, 8)}`,
  state: 'running',
  scope: { canvas: 'ui/Site.tsx', artboards: ['landing'] },
  leases: [],
  waiting: [],
  ...over,
});

afterEach(() => resetRowSlots());

describe('rowSlotsFor', () => {
  test('a run waiting for a person → Needs you (azure); a going run → AI is working; one word per row', () => {
    const m = rowSlotsFor(
      normalizeRuns({
        mine: [
          run({ state: 'running' }),
          run({ state: 'needs-you' }),
          run({ state: 'running', scope: { canvas: 'ui/Other.tsx', artboards: '*' } }),
        ],
      })
    );
    expect(m.get('ui/Site.tsx')?.meta).toMatchObject({ word: 'Needs you', tone: 'azure' });
    expect(m.get('ui/Other.tsx')?.meta).toMatchObject({ word: 'AI is working' });
    expect(m.size).toBe(2);
  });

  test('Needs you wins whichever run comes first', () => {
    const m = rowSlotsFor(
      normalizeRuns({ mine: [run({ state: 'needs-you' }), run({ state: 'running' })] })
    );
    expect(m.get('ui/Site.tsx')?.meta?.word).toBe('Needs you');
  });

  test('an ended run, a lazy run (no canvas) and other people’s runs say nothing; the design-root prefix is dropped', () => {
    const m = rowSlotsFor(
      normalizeRuns({
        mine: [
          run({ state: 'ended' }),
          run({ scope: null }),
          run({ scope: { canvas: '.design/ui/Prefixed.tsx', artboards: '*' } }),
        ],
        others: [run({ state: 'needs-you', actor: 'tereza' })],
      })
    );
    expect([...m.keys()]).toEqual(['ui/Prefixed.tsx']);
  });

  test('in the panel: the ai word beats a sync word on the same row (S1 precedence)', () => {
    const lane = createRowSlotsLane({
      store: fakeStore({ mine: [run({ state: 'needs-you' })] }),
    });
    registerRowSlot('sync', 'ui/Site.tsx', { meta: { word: 'not sent' } });
    expect(getRowSlots().slotFor('ui/Site.tsx')?.meta?.word).toBe('Needs you');
    expect(resolveSlot({ ai: new Map(), sync: new Map() }, 'ui/Site.tsx')).toBeNull();
    lane(); // dispose: the word goes, the sync word shows again
    expect(getRowSlots().slotFor('ui/Site.tsx')?.meta?.word).toBe('not sent');
  });
});

function fakeStore(view: Record<string, unknown>) {
  let snap = { view: normalizeRuns(view), loaded: true, done: {} };
  const subs = new Set<() => void>();
  return {
    getSnapshot: () => snap,
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    set(next: Record<string, unknown>) {
      snap = { ...snap, view: normalizeRuns(next) };
      for (const fn of subs) fn();
    },
  };
}

describe('the lane follows the run list', () => {
  test('a run starting, needing you, then ending moves the row word and clears it', () => {
    const store = fakeStore({ mine: [] });
    const off = createRowSlotsLane({ store });
    expect(getRowSlots().slotFor('ui/Site.tsx')).toBeNull();
    store.set({ mine: [run({ state: 'running' })] });
    expect(getRowSlots().slotFor('ui/Site.tsx')?.meta?.word).toBe('AI is working');
    store.set({ mine: [run({ state: 'needs-you' })] });
    expect(getRowSlots().slotFor('ui/Site.tsx')?.meta?.word).toBe('Needs you');
    store.set({ mine: [run({ state: 'ended' })] });
    expect(getRowSlots().slotFor('ui/Site.tsx')).toBeNull();
    off();
  });
});

describe('the toast’s Open names the canvas', () => {
  test('openAiChat carries the canvas in the event detail (the shell opens it)', () => {
    let detail: unknown = null;
    const target = {
      dispatchEvent: (e: { type: string; detail: unknown }) => {
        expect(e.type).toBe(OPEN_AI_EVENT);
        detail = e.detail;
      },
    };
    (globalThis as { CustomEvent?: unknown }).CustomEvent ??= class {
      type: string;
      detail: unknown;
      constructor(type: string, init: { detail: unknown }) {
        this.type = type;
        this.detail = init.detail;
      }
    };
    openAiChat('c1', { canvas: '.design/ui/Site.tsx', target: target as never });
    expect(detail).toEqual({ chat: 'c1', canvas: '.design/ui/Site.tsx' });
    openAiChat('c1', { target: target as never });
    expect(detail).toEqual({ chat: 'c1', canvas: null });
  });
});
