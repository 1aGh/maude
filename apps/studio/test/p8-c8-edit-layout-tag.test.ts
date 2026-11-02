// P8 stage C round 8 (14 ed-lay-auto): while a gap is dragged the name tag reads "Services → Auto layout" — the name in
// the tag's semibold, the "→ Auto layout" after it regular (the board's .ed-tag-q) — and the size is back after the drag.
import { describe, expect, test } from 'bun:test';

import { layoutTag, nameTag, tagParts } from '../editing/crumbs.ts';

describe('14 ed-lay-auto name tag', () => {
  test('a gap drag names the layout, not the size', () => {
    expect(layoutTag('Services')).toBe('Services → Auto layout');
  });
  test('tagParts splits the name from its regular-weight tail', () => {
    expect(tagParts('Services → Auto layout')).toEqual(['Services', ' → Auto layout']);
    expect(tagParts(nameTag('Brand systems', 400, 232))).toEqual(['Brand systems', ' · 400 × 232']);
    expect(tagParts('Rectangle')).toEqual(['Rectangle', '']);
  });
});
