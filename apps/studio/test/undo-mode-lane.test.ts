// S2.20b — the shell half of the ⌘Z lane (client/v2/undo/use-undo-mode-lane.js): each canvas frame is
// told `undo-mode {opLog}` when its projection's mode is known (and again after it reloads), and a
// `undo-key {redo}` from the ACTIVE canvas runs the projection (`runUndoKey`); a sibling's is ignored.
// When the projection answers legacy, the frame hears `opLog: false` BEFORE the fallback
// `run-action edit.undo`, so a canvas never bounces the key back.

import { expect, test } from 'bun:test';

import { createUndoModeLane } from '../client/v2/undo/use-undo-mode-lane.js';

const ORIGIN = 'http://127.0.0.1:5001';

function frame(name: string) {
  const got: Array<Record<string, unknown>> = [];
  return {
    name,
    got,
    postMessage(m: Record<string, unknown>) {
      got.push(m);
    },
  };
}

function fakeStore() {
  const modes = new Map<string, string>();
  const subs = new Set<() => void>();
  const opened: string[] = [];
  return {
    opened,
    set(path: string, mode: string) {
      modes.set(path, mode);
      for (const fn of subs) fn();
    },
    mode: (path: string) => modes.get(path) ?? 'unknown',
    open(path: string) {
      opened.push(path);
      return Promise.resolve(null);
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

test('frames hear their mode; the active canvas’s undo-key runs the projection', async () => {
  const a = frame('a');
  const b = frame('b');
  const store = fakeStore();
  const ran: Array<[string, boolean]> = [];
  let fallbackOf: (() => void) | null = null;
  const lane = createUndoModeLane({
    frames: () =>
      new Map([
        ['.design/ui/a.tsx', a as unknown as Window],
        ['.design/ui/b.tsx', b as unknown as Window],
      ]),
    activePath: () => '.design/ui/a.tsx',
    canvasOrigin: () => ORIGIN,
    store: store as never,
    runKey: ((path: string, redo: boolean, fallback: () => void) => {
      ran.push([path, redo]);
      fallbackOf = fallback;
      return Promise.resolve({ handled: true });
    }) as never,
  });
  const modeOf = (f: ReturnType<typeof frame>) =>
    f.got.filter((m) => m.dgn === 'undo-mode').map((m) => m.opLog);

  store.set('.design/ui/a.tsx', 'op-log');
  expect(modeOf(a)).toEqual([true]);
  expect(modeOf(b)).toEqual([]); // unknown → never told: the canvas stays on its own stack
  store.set('.design/ui/a.tsx', 'op-log'); // no change, no repeat
  expect(modeOf(a)).toEqual([true]);

  // a reloaded document starts legacy again: it is told again and its projection opened
  lane.onMessage({ origin: ORIGIN, source: a, data: { dgn: 'loaded', file: 'ui/a.tsx' } });
  expect(modeOf(a)).toEqual([true, true]);
  expect(store.opened).toEqual(['.design/ui/a.tsx']);

  // the active canvas's keys run the projection; a sibling's and a foreign origin's never do
  await lane.onMessage({ origin: ORIGIN, source: a, data: { dgn: 'undo-key', redo: false } });
  await lane.onMessage({ origin: ORIGIN, source: a, data: { dgn: 'undo-key', redo: true } });
  await lane.onMessage({ origin: ORIGIN, source: b, data: { dgn: 'undo-key', redo: false } });
  await lane.onMessage({
    origin: 'http://evil',
    source: a,
    data: { dgn: 'undo-key', redo: false },
  });
  expect(ran).toEqual([
    ['.design/ui/a.tsx', false],
    ['.design/ui/a.tsx', true],
  ]);

  // legacy after all: the store flips the mode (the frame hears false) before the fallback runs
  store.set('.design/ui/a.tsx', 'legacy');
  (fallbackOf as unknown as () => void)();
  const tail = a.got.slice(-2).map((m) => m.dgn);
  expect(tail).toEqual(['undo-mode', 'run-action']);
  expect(a.got.at(-2)?.opLog).toBe(false);
  expect(a.got.at(-1)?.id).toBe('edit.redo');
  lane.dispose();
});
