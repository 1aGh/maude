// gate-a-polish2 — the sticky author line lives INSIDE the paper (canvas 15 `.an-st-who`): sans, extra-small,
// ink at 88%, never mono, never under the resize handles. Its contrast is checked against all ten papers.

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AI_PAPER } from '../annotations/ui/ai-marks.tsx';
import { contrast, whoInk } from '../annotations/ui/posture.ts';
import { AnnotationScene } from '../annotations/ui/scene.tsx';
import { UI_FONT } from '../annotations/ui/text-style.ts';
import { STICKY_PALETTE } from '../annotations-model.ts';

const NOW = Date.now();
const sticky = (fill: string, extra: Record<string, unknown> = {}) => ({
  el: {
    id: 's1',
    type: 'sticky',
    index: 'a0',
    x: 0,
    y: 0,
    w: 160,
    h: 110,
    fill,
    text: 'Book a call',
    at: new Date(NOW - 5_000).toISOString(),
    author: { kind: 'human', name: 'Michal' },
    ...extra,
  },
});

const scene = (items: unknown[], quiet = false) =>
  renderToStaticMarkup(
    createElement(AnnotationScene, {
      items: items as never,
      interactive: true,
      quiet,
      editingId: null,
      edit: null,
      pending: null,
      resolveAsset: (h: string) => h,
      selectedIds: new Set(['s1']),
      me: 'Michal',
    })
  );

describe('the author line inside the paper', () => {
  const html = scene([sticky(STICKY_PALETTE[0])]);
  test('says "You · just now" in an element inside the sticky', () => {
    expect(html).toContain('You · just now');
    expect(html).toContain('an-st-who');
    // not the old line hung below the paper (top:100%), where the resize handles sit
    expect(html).not.toContain('top:100%');
  });
  test('sans, not mono, in the extra-small size', () => {
    const who = html.slice(html.indexOf('an-st-who') - 80, html.indexOf('You · just now'));
    expect(who).toContain('--font-body');
    expect(who).not.toContain('font-mono');
    expect(who).not.toContain('ui-monospace');
    expect(UI_FONT).toContain('--font-body');
  });
  test('it is a child of the paper node', () => {
    const start = html.indexOf('dc-annot-el');
    const who = html.indexOf('an-st-who');
    const closing = html.indexOf('data-id', start + 10);
    // no second element node begins between the sticky and its line
    expect(closing === -1 || closing > who).toBe(true);
  });
});

describe('contrast of the author line on every paper', () => {
  for (const paper of [...STICKY_PALETTE, AI_PAPER])
    test(`>= 5.2:1 on ${paper}`, () => {
      expect(contrast(whoInk(paper), paper)).toBeGreaterThanOrEqual(5.2);
    });
  test('an AI sticky keeps its spark hue and still reads', () => {
    expect(contrast(whoInk(AI_PAPER, true), AI_PAPER)).toBeGreaterThanOrEqual(5.2);
    expect(whoInk(AI_PAPER, true)).not.toBe(whoInk(AI_PAPER, false));
  });
  test('rendered colour is the computed ink, per paper', () => {
    for (const paper of STICKY_PALETTE) {
      const out = scene([sticky(paper)]);
      expect(out).toContain(whoInk(paper));
    }
  });
});
