// S4.18 (an-follow) — while an artboard is dragged its members ride ABOVE it. canvas-lib raises the
// dragged artboard to `z-index: 5` (`.dc-artboard.dc-dragging`); the annotation scene has no stacking
// context of its own, so a translated sticky (and the live re-route overlay at z 3) drew under the
// artboard it rides with. The ride sink lifts what it moves for the gesture and gives it back on clear.

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { createDomRideSink } from '../annotations/ui/ride.ts';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

/** canvas-lib.tsx `.dc-canvas .dc-artboard.dc-dragging { z-index: 5 }`. */
const DRAGGED_ARTBOARD_Z = 5;

test('a riding sticky and the re-route overlay sit above the dragged artboard, and come back down', () => {
  const world = document.createElement('div');
  world.innerHTML =
    '<div class="dc-annot-scene"><div class="dc-annot-el" data-id="stk1"></div><div class="dc-annot-el" data-id="arw"></div></div>';
  document.body.appendChild(world);
  const sink = createDomRideSink(
    () => world,
    () => false
  );
  sink.translate('stk1', 40, 10);
  sink.arrow(
    {
      id: 'arw',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      prims: [],
      color: '#1a1a1a',
      width: 2,
      tag: null,
    },
    'drag'
  );
  const stk = world.querySelector('[data-id="stk1"]') as HTMLElement;
  expect(Number(stk.style.zIndex)).toBeGreaterThan(DRAGGED_ARTBOARD_Z);
  const ride = world.querySelector('[data-testid="annot-ride"]') as HTMLElement;
  expect(Number(ride.style.zIndex)).toBeGreaterThan(DRAGGED_ARTBOARD_Z);
  sink.clear();
  expect(stk.style.zIndex).toBe('');
});
