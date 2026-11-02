// S4.V4 G1 - a sticky grows when its text outgrows it, on the commit that follows idle-typing drafts too.
// The live edit path (annotations-layer commitStickyText) delegates to stickyEditNext, so this pins the
// decision the layer makes; the pure fit itself is pinned in annotations-sticky-layout.test.ts.

import { describe, expect, test } from 'bun:test';
import { type StickyStroke, stickyEditNext } from '../annotations-model.ts';

const sticky = (over: Partial<StickyStroke> = {}): StickyStroke =>
  ({
    id: 's1',
    tool: 'sticky',
    color: '#ffe24d',
    x: 40,
    y: 60,
    w: 200,
    h: 200,
    text: '',
    fontSize: 14,
    cornerRadius: 8,
    ...over,
  }) as StickyStroke;

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

describe('stickyEditNext', () => {
  test('207 characters: the card grows wider than 200 instead of clipping at five lines', () => {
    const text = `${'lorem ipsum dolor '.repeat(12)}`.slice(0, 207);
    const next = stickyEditNext(sticky(), text, undefined, undefined, '');
    expect(next).not.toBeNull();
    expect(next?.text).toBe(text);
    expect(next?.w).toBeGreaterThan(200);
  });

  test('150 words: wider and the type steps down; nothing is clipped', () => {
    const next = stickyEditNext(sticky(), words(150), undefined, undefined, '');
    expect(next?.w).toBeGreaterThan(200);
    expect(next?.fontSize).toBeLessThan(14);
  });

  test('a draft already put the same text on the board: the commit still persists the fit', () => {
    const text = words(150);
    const drafted = sticky({ text });
    const next = stickyEditNext(drafted, text, undefined, undefined, '');
    expect(next).not.toBeNull();
    expect(next?.w).toBeGreaterThan(200);
  });

  test('nothing typed: an already-overflowing note is not rewritten (no undo step, no PUT)', () => {
    const text = words(150);
    expect(stickyEditNext(sticky({ text }), text, undefined, undefined, text)).toBeNull();
  });

  test('short text on a roomy card changes the text only', () => {
    const roomy = sticky({ w: 400, h: 400 });
    const next = stickyEditNext(roomy, 'ok', undefined, undefined, '');
    expect(next).toMatchObject({ text: 'ok', w: 400, h: 400 });
  });
});
