// #224 — "can't scroll in the left panel when the design system is open". The pinned Design system row opens into
// its Design system canvas's artboards (2.0.7 B3, `DsBoardList` in canvases-pinned.jsx), and those rows live in
// `.lp-pinned`, ABOVE the windowed canvas list. `.lp-pinned` was `flex: none` with no overflow of its own: a big
// system (studyfi-v3 lists 65 artboards) grew it to ~1400 px inside a ~540 px panel, `.sh-sidebar` clips (#170 F35,
// not a scroll container), and the canvas list — the panel's only scroller — was squeezed to 12 px below the fold.
// Nothing under the pointer could scroll. Measured headless (WebKit + Chromium) on an unlinked copy of the system:
// .sh-sidebar scrollHeight 1534 / clientHeight 540, canvas-list clientHeight 12, a wheel moved nothing.
//
// The pinned strip is now a bounded scroller of its own: it may take part of the panel and scrolls inside it, so
// the canvas list below always keeps the rest. The real-layout check is test/e2e/ds-pinned-scroll.e2e.mjs.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(
  join(import.meta.dir, '..', 'client/v2/left-panel/left-panel.css'),
  'utf8'
);

/** The declarations of the first top-level-in-layer `.lp-pinned { … }` rule. */
function pinnedRule(): Record<string, string> {
  const body = css.match(/\n {2}\.lp-pinned \{([^}]*)\}/)?.[1] ?? '';
  const out: Record<string, string> = {};
  for (const decl of body.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const at = decl.indexOf(':');
    if (at < 0) continue;
    out[decl.slice(0, at).trim()] = decl.slice(at + 1).trim();
  }
  return out;
}

describe('#224 — the pinned Design system strip never pushes the canvas list out of the panel', () => {
  test('.lp-pinned is a bounded scroll container that may shrink', () => {
    const r = pinnedRule();
    expect(Object.keys(r).length).toBeGreaterThan(0);
    // it scrolls itself …
    expect(r['overflow-y']).toBe('auto');
    // … within a cap, so the list below keeps the rest of the panel
    expect(r['max-height']).toMatch(/^\d+%$/);
    expect(Number.parseInt(r['max-height'], 10)).toBeLessThanOrEqual(50);
    // it is never squeezed below its own rows by the list beside it (a shrinkable strip cut the system row to
    // 26 of its 61 px): its height is its content, up to the cap
    expect(r.flex).toBe('none');
    // its wheel stays in it at either end instead of chaining to nothing (the sidebar is not a scroller)
    expect(r['overscroll-behavior']).toBe('contain');
  });

  test('the canvas list below stays a flexible scroller', () => {
    const fp = readFileSync(
      join(import.meta.dir, '..', 'client/v2/shell/floating-panels.css'),
      'utf8'
    );
    const tree = fp.match(/\n {2}\.sh-tree \{([^}]*)\}/)?.[1] ?? '';
    expect(tree).toContain('flex: 1;');
    expect(tree).toContain('overflow-y: auto;');
  });
});
