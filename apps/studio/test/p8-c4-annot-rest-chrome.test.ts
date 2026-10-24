// V2-8.5 round 4 (c4-annot) — 14 Editing R3: the marks AT REST over a pointer selection.
//
// The board draws a frame's gap and padding as bands with a chip ("24"); the grips that scrub them are not drawn
// until the pointer is on one. The v1 grips (a magenta dot per gap, an azure square per padding side) sat over
// the chips of every selected row / column.

import { describe, expect, test } from 'bun:test';

const src = (rel: string): Promise<string> =>
  Bun.file(new URL(rel, import.meta.url).pathname).text() as Promise<string>;

const rule = (css: string, selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return '';
  return css.slice(at, css.indexOf('}', at));
};

describe('spacing grips are not drawn at rest', () => {
  test('a gap grip is a transparent hit zone; the ring shows on hover / drag only', async () => {
    const css = await src('../use-spacing-handles.tsx');
    const rest = rule(css, '.dc-spacing-handle--gap');
    expect(rest).toContain('background: transparent');
    expect(rest).not.toMatch(/#FF24BD/i);
    const hover = rule(
      css,
      '.dc-spacing-handle--gap:hover,\n.dc-spacing-handle--gap[data-dragging="true"]'
    );
    expect(hover).toContain('#FF24BD');
  });
  test('a padding grip is a transparent hit zone; its square shows on hover / drag only', async () => {
    const css = await src('../use-spacing-handles.tsx');
    const rest = rule(css, '.dc-spacing-handle--padding');
    expect(rest).toContain('background: transparent');
    expect(rest).not.toContain('var(--maude-hud-accent');
  });
});

describe('typing in place draws only the edit ring (14 ed-text-edit)', () => {
  test('no handles, size tag, bands or badges while a text is edited; the ring has its halo', async () => {
    const css = await src('../canvas-shell.tsx');
    const hide = css.match(
      /body:has\(\[contenteditable\]\.dc-text-editing\) :is\(([^)]*)\) \{\s*display: none !important;/
    );
    expect(hide?.[1]).toContain('.dc-el-resize-handle');
    expect(hide?.[1]).toContain('.ed-name-tag');
    expect(hide?.[1]).toContain('.ed-order');
    expect(rule(css, '[contenteditable].dc-text-editing')).toContain('box-shadow: 0 0 0 5px');
  });
});
