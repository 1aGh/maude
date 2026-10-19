// S2.22 G1 — an artboard draws Fill before Layout; every other kind keeps the table's order.
import { describe, expect, test } from 'bun:test';
import { SECTIONS, sectionsFor } from '../client/v2/inspector/sections.js';

describe('sectionsFor', () => {
  test('an artboard: Fill sits before Layout, nothing else moves or goes', () => {
    const ids = sectionsFor('artboard').map((s: { id: string }) => s.id);
    expect(ids.indexOf('fill')).toBeLessThan(ids.indexOf('layout'));
    expect([...ids].sort()).toEqual(SECTIONS.map((s: { id: string }) => s.id).sort());
  });

  test('every other kind keeps the table order', () => {
    for (const k of ['frame', 'text', 'shape', 'image', 'multi'])
      expect(sectionsFor(k)).toBe(SECTIONS);
  });
});
