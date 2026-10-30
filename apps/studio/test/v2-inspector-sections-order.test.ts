// S2.22 G1 / V2-8.5 c7 — an artboard keeps the table's order (08 ak-web-hug: Width · Height · Layout · Fill · Other widths).
import { describe, expect, test } from 'bun:test';
import { SECTIONS, sectionsFor } from '../client/v2/inspector/sections.js';

describe('sectionsFor', () => {
  test('an artboard: Layout sits before Fill (08 owns the card), nothing else moves or goes', () => {
    const ids = sectionsFor('artboard').map((s: { id: string }) => s.id);
    expect(ids.indexOf('layout')).toBeLessThan(ids.indexOf('fill'));
    expect([...ids].sort()).toEqual(SECTIONS.map((s: { id: string }) => s.id).sort());
  });

  test('a frame, a button and a mixed selection keep the table order', () => {
    for (const k of ['frame', 'button', 'multi']) expect(sectionsFor(k)).toBe(SECTIONS);
  });

  const ids = (k: string) => sectionsFor(k).map((s: { id: string }) => s.id);

  // 14 Editing R5 — each kind opens on its own thing, and draws only what its board draws
  test('a text opens on Type, then Fill; no Corners, Border or Effects', () => {
    expect(ids('text').slice(0, 2)).toEqual(['type', 'fill']);
    for (const gone of ['corners', 'border', 'effects', 'layout'])
      expect(ids('text')).not.toContain(gone);
  });
  test('a picture opens on Image and Adjust', () => {
    expect(ids('image').slice(0, 2)).toEqual(['image', 'adjust']);
    for (const gone of ['corners', 'border', 'effects', 'layout'])
      expect(ids('image')).not.toContain(gone);
  });
  test('a shape: Shape · Corners · Fill · Border · Effects', () => {
    expect(ids('shape').slice(0, 5)).toEqual(['size', 'corners', 'fill', 'border', 'effects']);
  });
  test('an instance draws no object sections (its blocks are Component and Content)', () => {
    expect(ids('instance')).toEqual([]);
  });
  test('several boards get no Interaction, Position, Corners or Type', () => {
    for (const gone of ['interaction', 'position', 'corners', 'type'])
      expect(ids('multi-artboard')).not.toContain(gone);
  });
});
