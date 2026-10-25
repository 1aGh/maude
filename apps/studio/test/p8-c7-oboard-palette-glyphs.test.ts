// P8 round 7 (06 ad-search): the Advanced switches that used to fall back to the stand-in chevron each get the
// glyph of what they do - nothing in the ⌘K list is a chevron in a tile.
import { describe, expect, test } from 'bun:test';
import { glyphFor } from '../client/v2/search/palette-icons.js';

describe('⌘K glyphs for the Advanced switches', () => {
  const g = (name: string, where = 'Menu › View › Advanced') => glyphFor({ name, where }, 'actions', 'chevron');
  test('each says what it does', () => {
    expect(g('Allow longer videos', 'Timeline › Advanced')).toBe('clock');
    expect(g('Hidden files')).toBe('eye');
    expect(g('Keep timeline open')).toBe('pin');
    expect(g('Layers as a panel')).toBe('layers');
    expect(g('Open all Advanced sections', 'Once · every panel')).toBe('plus');
    expect(g('Close all Advanced sections', 'Settings › Advanced › Reset')).toBe('minus');
  });
  test('the rows that already had a glyph keep it', () => {
    expect(g('Copy code', 'Inspector › Advanced')).toBe('duplicate');
    expect(g('Copy file path', 'Canvases panel › Advanced')).toBe('folder');
  });
});
