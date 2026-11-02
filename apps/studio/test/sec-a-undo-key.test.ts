// sec-a (wave-A attacker, low) — a canvas can no longer run the person's ⌘Z / ⇧⌘Z on its own say-so.
// The shell can't prove from the iframe that a key was pressed, so `undo-key` is honoured only while the
// active canvas frame holds focus in a focused window, and at most UNDO_KEY_BURST per second.

import { expect, test } from 'bun:test';
import { createUndoModeLane, UNDO_KEY_BURST } from '../client/v2/undo/use-undo-mode-lane.js';

const ORIGIN = 'http://127.0.0.1:5001';
const PATH = '.design/ui/a.tsx';
const win = { postMessage: () => {} };
const store = {
  mode: () => 'op-log',
  open: () => Promise.resolve(null),
  subscribe: () => () => {},
};

function lane(focused: () => boolean, now: () => number) {
  const ran: boolean[] = [];
  const l = createUndoModeLane({
    frames: () => new Map([[PATH, win as unknown as Window]]),
    activePath: () => PATH,
    canvasOrigin: () => ORIGIN,
    store: store as never,
    focused,
    now,
    runKey: ((_p: string, redo: boolean) => {
      ran.push(redo);
      return Promise.resolve({ handled: true });
    }) as never,
  });
  const key = (redo = false) =>
    l.onMessage({ origin: ORIGIN, source: win, data: { dgn: 'undo-key', redo } } as never);
  return { ran, key };
}

test('an undo-key while the canvas does not hold focus runs nothing', () => {
  const { ran, key } = lane(
    () => false,
    () => 0
  );
  key();
  key(true);
  expect(ran).toEqual([]);
});

test('without a focus probe the lane fails closed', () => {
  const ran: boolean[] = [];
  const l = createUndoModeLane({
    frames: () => new Map([[PATH, win as unknown as Window]]),
    activePath: () => PATH,
    canvasOrigin: () => ORIGIN,
    store: store as never,
    runKey: ((_p: string, redo: boolean) => {
      ran.push(redo);
      return Promise.resolve({ handled: true });
    }) as never,
  });
  l.onMessage({ origin: ORIGIN, source: win, data: { dgn: 'undo-key', redo: false } } as never);
  expect(ran).toEqual([]);
});

test('a focused canvas’s burst is capped per second, then the next second opens again', () => {
  let t = 1000;
  const { ran, key } = lane(
    () => true,
    () => t
  );
  for (let i = 0; i < 50; i++) key();
  expect(ran.length).toBe(UNDO_KEY_BURST);
  t += 1000;
  key(true);
  expect(ran.length).toBe(UNDO_KEY_BURST + 1);
  expect(ran.at(-1)).toBe(true);
});
