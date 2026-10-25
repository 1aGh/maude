// V2-8.5 c7 (01 cf-duplicate-done) — after "Duplicate at another width" the board shows the gap between the
// source and its copy, and a dashed line down the shared left edge; the toast tells it with the copy glyph.
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtboardGapMark, gapGeometry, setGapMark } from '../artboard-gap-mark.tsx';

const source = { x: 296, y: 100, w: 1440, h: 900 };
const copy = { x: 296, y: 1080, w: 1280, h: 900 };

afterEach(() => setGapMark(null));

describe('gapGeometry', () => {
  test('the gap is the distance between the source bottom and the copy top', () => {
    const g = gapGeometry(source, copy);
    expect(g?.gap).toBe(80);
    expect(g?.gapTop).toBe(1000);
    expect(g?.shared).toBe(true);
    expect(g?.left).toBe(296);
  });

  test('a copy that is not under the source has no gap to measure', () => {
    expect(gapGeometry(source, { ...copy, y: 900 })).toBeNull();
  });

  test('left edges that differ draw no shared edge', () => {
    expect(gapGeometry(source, { ...copy, x: 400 })?.shared).toBe(false);
  });
});

describe('ArtboardGapMark', () => {
  const html = (id: string) => renderToStaticMarkup(<ArtboardGapMark id={id} />);

  test('nothing until the copy is made', () => {
    expect(html('laptop')).toBe('');
  });

  test('the copy draws the measured gap and the dashed shared edge; no other board does', () => {
    setGapMark({ copyId: 'laptop', source, copy });
    const out = html('laptop');
    expect(out).toContain('data-testid="artboard-gap-value"');
    expect(out).toContain('>80<');
    expect(out).toContain('artboard-gap-edge');
    expect(out).toContain('dc-artboard-guides'); // the class every exporter hides
    expect(out).toContain('aria-hidden="true"');
    expect(html('desktop')).toBe('');
  });

  test('sizes are counter-scaled by the canvas zoom (a pill is screen-sized at 28 %)', () => {
    setGapMark({ copyId: 'laptop', source, copy });
    expect(html('laptop')).toContain('var(--dc-zoom, 1)');
  });
});

describe('wiring', () => {
  const root = new URL('../', import.meta.url);
  const read = (p: string) => readFileSync(new URL(p, root), 'utf8');

  test('the menu duplicate sets the mark; canvas-lib mounts it on every board', () => {
    expect(read('editing/artboard-actions.ts')).toContain('setGapMark(');
    expect(read('canvas-lib.tsx')).toContain('<ArtboardGapMark id={id}');
  });

  test('the mark outlives the canvas reload the written copy causes (kept in the frame\'s sessionStorage)', () => {
    const src = read('artboard-gap-mark.tsx');
    expect(src).toContain('sessionStorage.setItem(storeKey()');
    expect(src).toContain('hydrate();');
  });

  test('the "copy made" toasts wear the copy glyph, not a success tick', () => {
    const src = read('client/hooks/use-canvas-bridge.jsx');
    expect(src).toContain("const DUPLICATE_TOAST = { kind: 'info', icon: 'duplicate' }");
    expect(src.match(/DUPLICATE_TOAST\)/g)?.length).toBe(2);
  });
});
