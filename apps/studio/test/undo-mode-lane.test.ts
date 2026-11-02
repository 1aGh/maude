// S2.20b — the shell half of the ⌘Z lane (client/v2/undo/use-undo-mode-lane.js): a `undo-key {redo}`
// from the ACTIVE canvas runs the projection (`runUndoKey`); a sibling's is ignored. Since p8-v1-drop
// the canvas keeps no stack: no frame is told `undo-mode {opLog}`, and an unhandled answer falls back to
// nothing (was: told the mode, then `run-action edit.undo` to the canvas stack).

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

test('the active canvas’s undo-key runs the projection; no frame is told a mode, nothing falls back', async () => {
  const a = frame('a');
  const b = frame('b');
  const store = fakeStore();
  const ran: Array<[string, boolean]> = [];
  const lane = createUndoModeLane({
    frames: () =>
      new Map([
        ['.design/ui/a.tsx', a as unknown as Window],
        ['.design/ui/b.tsx', b as unknown as Window],
      ]),
    activePath: () => '.design/ui/a.tsx',
    canvasOrigin: () => ORIGIN,
    store: store as never,
    focused: () => true, // sec-a: the canvas holds focus (the gate is pinned in sec-a-undo-key)
    runKey: ((path: string, redo: boolean) => {
      ran.push([path, redo]);
      return Promise.resolve({ handled: false });
    }) as never,
  });

  // p8-v1-drop: the canvas keeps no stack, so the shell never sends `undo-mode {opLog}` any more
  store.set('.design/ui/a.tsx', 'op-log');
  store.set('.design/ui/b.tsx', 'legacy');
  // a reloaded document has its projection opened, and is told nothing
  lane.onMessage({ origin: ORIGIN, source: a, data: { dgn: 'loaded', file: 'ui/a.tsx' } });
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
  // the projection answered unhandled (legacy): no `run-action edit.undo` bounces back to the canvas
  expect([...a.got, ...b.got]).toEqual([]);
  lane.dispose();
});
