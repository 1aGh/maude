// r1 (Michal rc.1 item 14) — a picture dropped from Finder on bare canvas lands on the annotation layer (the board),
// and in Edit that layer is quiet by design (S4.9: faded, every click reaches the design under it). So the picture
// showed at 45 % and a click or a drag on it did nothing, with no word why. A press on bare canvas over a quiet
// annotation now shows the tip at the pointer, in the locked tip's voice: "Switch to Preview to move it · ⌥⌘P".
// A press on an artboard is the design's (no tip), and nothing under the pointer is nobody's.

import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { LOCKED_DRAG_TIP, QUIET_MOVE_TIP } from '../annotations/ui/locked.tsx';
import { quietStrokeAt } from '../annotations/ui/quiet-tip.ts';
import type { Stroke } from '../annotations-model.ts';

const picture = {
  id: 'img1',
  tool: 'image',
  x: 100,
  y: 100,
  w: 200,
  h: 120,
  href: '/assets/car.png',
} as unknown as Stroke;
const sticky = {
  id: 'st1',
  tool: 'sticky',
  x: 150,
  y: 150,
  w: 80,
  h: 80,
  text: 'hi',
} as unknown as Stroke;

function targets() {
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML =
    '<div class="dc-world"><div data-dc-screen="a"><h1 id="in">x</h1></div><div id="bare"></div></div>';
  return {
    bare: doc.getElementById('bare') as unknown as Element,
    inArtboard: doc.getElementById('in') as unknown as Element,
  };
}

describe('a press on a quiet annotation in Edit', () => {
  test('on bare canvas the top-most annotation under the pointer is named', () => {
    const { bare } = targets();
    expect(quietStrokeAt([picture], 120, 120, 2, bare)?.id).toBe('img1');
    // paint order: the later stroke is on top
    expect(quietStrokeAt([picture, sticky], 160, 160, 2, bare)?.id).toBe('st1');
  });

  test('a press on an artboard is the design’s, and empty canvas is nobody’s', () => {
    const { bare, inArtboard } = targets();
    expect(quietStrokeAt([picture], 120, 120, 2, inArtboard)).toBeNull();
    expect(quietStrokeAt([picture], 900, 900, 2, bare)).toBeNull();
    expect(quietStrokeAt([], 120, 120, 2, bare)).toBeNull();
  });

  test('the tip says how to move it, in the locked tip’s voice', () => {
    expect(QUIET_MOVE_TIP).toBe('Switch to Preview to move it · ⌥⌘P');
    expect(LOCKED_DRAG_TIP).toBe('Locked — unlock to move it');
  });
});
