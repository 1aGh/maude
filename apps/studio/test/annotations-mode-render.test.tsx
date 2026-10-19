// S4.9 (an-visibility) - the annotation layer per mode: quiet in Edit (faded paper, words >= 4.5:1, clicks
// reach the design), hidden by ⇧P in any mode, never in Present. Inventory contradiction 19: v1 hid or
// showed the layer by one switch and ignored the mode; the what-shows table (bridge/mode-shows.ts) decides.

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  annotationPosture,
  contrast,
  postureTakesInput,
  QUIET_INK_OPACITY,
  quietPaper,
  STICKY_INK,
  TEXT_FLOOR,
} from '../annotations/ui/posture.ts';
import { AnnotationScene } from '../annotations/ui/scene.tsx';
import { STICKY_PALETTE } from '../annotations-model.ts';
import type { CanvasModeV2 } from '../bridge/canvas-modes.ts';
import { PRESENT_HIDES } from '../present/present-stage.tsx';

const ITEMS = [
  {
    el: {
      id: 's1',
      type: 'sticky',
      index: 'a0',
      x: 0,
      y: 0,
      w: 140,
      h: 100,
      fill: '#f7c5c0',
      text: 'Book a call in orange',
    },
  },
  { el: { id: 'r1', type: 'shape', kind: 'rect', index: 'a1', x: 200, y: 0, w: 80, h: 60 } },
];

const scene = (quiet: boolean) =>
  renderToStaticMarkup(
    createElement(AnnotationScene, {
      items: ITEMS as never,
      interactive: false,
      quiet,
      editingId: null,
      edit: null,
      pending: null,
      resolveAsset: (h: string) => h,
    })
  );

describe('the layer in each mode (the what-shows row)', () => {
  const MODES: Array<[CanvasModeV2, string]> = [
    ['edit', 'quiet'],
    ['preview', 'drawn'],
    ['viewing', 'read-only'],
    ['present', 'hidden'],
  ];
  test.each(MODES)('%s -> %s', (mode, posture) => {
    expect(annotationPosture(mode, true)).toBe(posture as never);
  });

  test('⇧P hides the layer in every mode, and the stored switch is what brings it back', () => {
    for (const [mode] of MODES) expect(annotationPosture(mode, false)).toBe('hidden');
    expect(annotationPosture('edit', true)).toBe('quiet');
  });

  test('Present never shows it, switch on or off, and the presenting root hides it too', () => {
    expect(annotationPosture('present', true)).toBe('hidden');
    expect(annotationPosture('preview', true, true)).toBe('hidden');
    for (const sel of ['.dc-annot-scene', '.dc-annot-lod', '.dc-annot-svg'])
      expect(PRESENT_HIDES).toContain(sel);
  });

  test('a canvas no shell governs keeps v1: drawn', () => {
    expect(annotationPosture(null, true)).toBe('drawn');
    expect(annotationPosture(undefined, true)).toBe('drawn');
  });

  test('only Preview takes input; Edit lets every click through', () => {
    expect(postureTakesInput('drawn')).toBe(true);
    for (const p of ['quiet', 'read-only', 'hidden'] as const)
      expect(postureTakesInput(p)).toBe(false);
  });
});

describe('quiet render', () => {
  test('the scene is marked quiet only in Edit', () => {
    expect(scene(true)).toContain('data-an-quiet="1"');
    expect(scene(false)).not.toContain('data-an-quiet');
  });

  test('a quiet sticky draws mixed paper; its words are still the sticky ink', () => {
    const q = scene(true);
    expect(q).toContain(`fill="${quietPaper('#f7c5c0')}"`);
    expect(q).not.toContain('fill="#f7c5c0"');
    expect(q).toContain('Book a call in orange');
    expect(scene(false)).toContain('fill="#f7c5c0"');
  });

  test('every sticky paper keeps its words at >= 4.5:1 once quiet', () => {
    for (const paper of STICKY_PALETTE) {
      expect(contrast(STICKY_INK, quietPaper(paper))).toBeGreaterThanOrEqual(TEXT_FLOOR);
    }
    // ... and against a dark artboard behind it the paper is opaque, so nothing shows through.
    expect(quietPaper('#ffffff')).toMatch(/^#[0-9a-f]{6}$/);
  });

  test('ink fades, not to nothing', () => {
    expect(QUIET_INK_OPACITY).toBeGreaterThan(0.3);
    expect(QUIET_INK_OPACITY).toBeLessThan(0.7);
  });

  test('a value that is not a hex colour passes through untouched', () => {
    expect(quietPaper('rgb(1,2,3)')).toBe('rgb(1,2,3)');
  });
});
