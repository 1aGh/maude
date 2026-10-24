// P8 C5 (05 es-filter): a Layers row for an element nobody named says what it is — never the code's tag.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainLayerName } from '../layer-name.ts';

describe('plainLayerName', () => {
  test('tags become words', () => {
    expect(plainLayerName('div')).toBe('Frame');
    expect(plainLayerName('H1')).toBe('Heading');
    expect(plainLayerName('p')).toBe('Text');
    expect(plainLayerName('a')).toBe('Link');
    expect(plainLayerName('img')).toBe('Image');
    expect(plainLayerName('li')).toBe('List item');
    expect(plainLayerName('blink')).toBe('Frame');
  });

  test('a role says it better than the tag', () => {
    expect(plainLayerName('div', 'button')).toBe('Button');
    expect(plainLayerName('div', 'navigation')).toBe('Navigation');
    expect(plainLayerName('div', 'presentation')).toBe('Frame');
  });

  test('no word is a raw tag', () => {
    for (const t of ['div', 'h1', 'h2', 'p', 'span', 'section', 'svg', 'ul', 'li', 'nav', 'main']) {
      const w = plainLayerName(t);
      expect(w).not.toBe(t);
      expect(w).toMatch(/^[A-Z]/);
    }
  });

  test('the Layers tree uses it as its fallback — no `tag.class` label is built any more', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'canvas-shell.tsx'), 'utf8');
    const fn = /function layerLabel\(el: Element\): string \{[\s\S]*?\n\}\n/.exec(src)?.[0] ?? '';
    expect(fn).toContain('plainLayerName(');
    expect(fn).not.toContain('.toLowerCase()}.');
    expect(fn).not.toMatch(/\$\{tag\}\.\$\{cls\}/);
  });
});
