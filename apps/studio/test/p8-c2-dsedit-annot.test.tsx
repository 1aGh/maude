// P8-C2 dsedit — 15 Annotations: the paper is the DS `.sticky` (rounded semibold in the object ink, 12 px, the
// kit's corner on all four sides, full ink when resolved), the section title is a solid object-colour chip, and
// the toolbar's "front five" is the dock's: yellow · coral · green · sky · lilac.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { stickyBoxPath } from '../annotations/ui/element-node.tsx';
import { AnnotationScene } from '../annotations/ui/scene.tsx';
import { STICKY_FRONT, STICKY_MORE } from '../annotations/ui/tool-prefs.ts';

const scene = (el: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(AnnotationScene, {
      items: [{ el: { index: 'a0', x: 0, y: 0, w: 160, h: 110, ...el } }] as never,
      interactive: true,
      quiet: false,
      editingId: null,
      edit: null,
      pending: null,
      resolveAsset: (h: string) => h,
      selectedIds: new Set(),
      me: 'Michal',
    })
  );

const STICKY = {
  id: 's1',
  type: 'sticky',
  fill: '#fce8a6',
  text: 'Book a call',
  author: { kind: 'human', name: 'Michal' },
};

describe('a sticky is the DS paper', () => {
  test('words in rounded semibold, object ink, 12 px padding', () => {
    const html = scene(STICKY);
    const words = /<div class="dc-annot-text"[^>]*>/.exec(html)?.[0] ?? '';
    expect(words).toContain('font-weight:600');
    expect(words).toContain('--maude-hud-object-ink');
    expect(words).toContain('padding:12px');
    expect(words).not.toContain('#2a2a28;');
  });

  test('a resolved sticky keeps its words in full ink — the strike and the tick say it is done', () => {
    const html = scene({ ...STICKY, resolved: { by: 'Tereza', at: new Date().toISOString() } });
    const words = /<div class="dc-annot-text"[^>]*>/.exec(html)?.[0] ?? '';
    expect(words).toContain('line-through');
    expect(words).not.toContain('opacity');
  });

  test('the paper outline rounds all four corners (no dog-ear)', () => {
    const d = stickyBoxPath(0, 0, 100, 80, 4);
    // every corner is a quadratic curve: four of them
    expect(d.match(/Q/g)?.length).toBe(4);
    expect(d).toContain('Q100 80 96 80');
  });
});

describe('the section title is a solid chip', () => {
  test('object colour fill, object-ink title in semibold', () => {
    const html = scene({
      id: 'sec1',
      type: 'section',
      label: 'Feedback',
      color: '#a9dbdb',
      w: 400,
      h: 300,
    });
    const chip = /<div class="dc-annot-chip"[^>]*>/.exec(html)?.[0] ?? '';
    expect(chip).toContain('background-color:#a9dbdb');
    expect(chip).not.toContain('color-mix');
    const title = /<div class="dc-annot-text dc-annot-text--nowrap"[^>]*>/.exec(html)?.[0] ?? '';
    expect(title).toContain('font-weight:600');
    expect(title).toContain('--maude-hud-object-ink');
  });
});

describe('one front five', () => {
  test('the dock and the context toolbar both lead with yellow · coral · green · sky · lilac, "+5" holds the rest', () => {
    expect(STICKY_FRONT.map((s) => s.name)).toEqual(['Yellow', 'Coral', 'Green', 'Sky', 'Lilac']);
    expect(STICKY_MORE).toHaveLength(5);
  });
});

describe('no v1 vermilion behind the annotation layer', () => {
  test('the layer and its parts fall back to the maude-v2 azure, and read the HUD accent (never the shell --accent)', () => {
    const root = join(import.meta.dir, '..');
    const files = [
      join(root, 'annotations-layer.tsx'),
      ...readdirSync(join(root, 'annotations/ui'))
        .filter((f) => f.endsWith('.tsx'))
        .map((f) => join(root, 'annotations/ui', f)),
    ];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect({ f, v1: src.includes('#d63b1f') }).toEqual({ f, v1: false });
      expect({ f, shellAccent: /var\(--accent,/.test(src) }).toEqual({ f, shellAccent: false });
    }
  });

  test('a sticky or sticker carries four corner squares only — no edge pills, no rotate zones', () => {
    const src = readFileSync(join(import.meta.dir, '../use-annotation-resize.tsx'), 'utf8');
    expect(src).toContain("const cornersOnly = s.tool === 'sticky' || isStickerStroke(s);");
    expect(src).toContain('canRotate(s) && !cornersOnly');
    // the board's .ed-h square: bg-2 with a 1.5px accent ring inset, no radius
    expect(src).toContain('inset 0 0 0 1.5px var(--maude-hud-accent');
  });
});
