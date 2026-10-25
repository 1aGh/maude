// P8 stage C round 10 (14 ed-lay-free): an object that sits straight on the artboard's page is placed BY the artboard —
// placementOf names it, so the free-placement card has a frame to say ("<frame> places things freely …").
import { describe, expect, test } from 'bun:test';

import { placementOf } from '../client/v2/inspector/model.js';
import { freeLine } from '../client/v2/inspector/sections/position.jsx';

const tree = {
  artboardId: 'Post 1:1 · Combine 2026',
  nodes: [
    { id: 'title', index: 0, tag: 'h1', label: 'Titulek', children: [] },
    { id: 'datum', index: 0, tag: 'div', label: 'Datum', children: [{ id: 'datum-text', index: 0, tag: 'span', label: 'SO 14/3' }] },
    {
      id: 'svc', index: 0, tag: 'div', label: 'Services',
      children: [{ id: 'a', index: 0, tag: 'div', label: 'Small apps' }, { id: 'b', index: 0, tag: 'div', label: 'Brand' }],
    },
  ],
};

describe('14 ed-lay-free: placementOf for a top-level object', () => {
  test('a node straight under the artboard is placed by the artboard, with its place among the page', () => {
    const p = placementOf(tree, { id: 'datum', index: 0 });
    expect(p.parent).toBe('Post 1:1 · Combine 2026');
    expect(p.index).toBe(2);
    expect(p.count).toBe(3);
  });
  test('the artboard is named as the canvas’s crumbs name it (its label, not its id)', () => {
    const p = placementOf(
      { artboardId: 'p1', nodes: tree.nodes },
      { id: 'datum', index: 0, crumbs: [{ label: 'Post 1:1 · Combine 2026' }, { label: 'Frame' }, { label: 'Datum' }] }
    );
    expect(p.parent).toBe('Post 1:1 · Combine 2026');
    expect(placementOf({ artboardId: 'p1', nodes: tree.nodes }, { id: 'datum', index: 0 }).parent).toBe('p1');
  });
  test('an object inside a frame still names the frame', () => {
    expect(placementOf(tree, { id: 'b', index: 0 })).toEqual({ parent: 'Services', index: 2, count: 2 });
  });
  test('the card then has a sentence', () => {
    const p = placementOf(tree, { id: 'datum', index: 0 });
    expect(
      freeLine(p.parent, 'Datum', { left: false, right: true, top: true, bottom: false }, { right: '64px', top: '64px' })
    ).toBe(
      'Post 1:1 · Combine 2026 places things freely — no auto layout. Constraints keep Datum 64 from the top-right corner.'
    );
  });
  test('an id the tree does not know is never invented', () => {
    expect(placementOf(tree, { id: 'ghost', index: 0 }).parent).toBeNull();
    expect(placementOf({ nodes: tree.nodes }, { id: 'datum', index: 0 }).parent).toBeNull();
  });
});
