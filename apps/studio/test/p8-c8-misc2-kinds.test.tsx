// V2-8.5 stage C round 8 (p8-c8-misc2) — 08 Artboard Kinds MUST rows.
//   ak-web-widths: "2185 now — the longest of the three." (the Height note compares the page with its other widths)
//   ak-mixed-fit : the dimmed line sits at the foot of the panel; only the matching artboards are listed.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

import { webHeightNote } from '../client/v2/inspector/kinds/artboard-kinds-model.js';
import { artboardFacts } from '../client/v2/inspector/kinds/artboard-model.js';
import { webLongestOf } from '../dom-selection.ts';

function board(id: string, w: number, h: number, extra: Record<string, string> = {}) {
  const el = document.createElement('article');
  el.setAttribute('data-dc-screen', id);
  el.setAttribute('data-dc-kind', 'web');
  for (const [k, v] of Object.entries(extra)) el.setAttribute(k, v);
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: w });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: h });
  return el;
}

function section(...boards: HTMLElement[]) {
  document.body.innerHTML = '';
  const s = document.createElement('section');
  s.setAttribute('data-dc-section', 'web');
  for (const b of boards) s.appendChild(b);
  document.body.appendChild(s);
}

describe('ak-web-widths — the Height note names the sibling compare', () => {
  test('the longest of three widths of one page says so', () => {
    const [d, t, m] = [board('d', 1440, 442), board('t', 834, 560), board('m', 390, 2185)];
    section(d, t, m);
    expect(webLongestOf(m)).toBe(3);
    expect(webLongestOf(t)).toBeNull();
    expect(webLongestOf(d)).toBeNull();
  });

  test('a page alone, a fixed board, or boards sharing a width have nothing to compare', () => {
    const solo = board('a', 1440, 900);
    section(solo);
    expect(webLongestOf(solo)).toBeNull();
    const fixed = board('f', 390, 5000, { 'data-dc-fixed': 'true' });
    const other = board('o', 1440, 800);
    section(fixed, other);
    expect(webLongestOf(fixed)).toBeNull();
    const same1 = board('s1', 1440, 2000);
    const same2 = board('s2', 1440, 800);
    section(same1, same2);
    expect(webLongestOf(same1)).toBeNull();
  });

  test('facts carry it and the note words it', () => {
    const el = {
      artboardId: 'm',
      worldW: 390,
      worldH: 2185,
      attrs: { 'data-dc-kind': 'web', 'data-dc-web-longest': '3' },
    };
    expect(artboardFacts(el).longestOf).toBe(3);
    expect(webHeightNote(2185, 3)).toBe('2185 now — the longest of the three.');
    expect(webHeightNote(2185, 2)).toBe('2185 now — the longer of the two.');
    expect(webHeightNote(1300)).toBe('1300 now — grows as you add.');
  });
});

// ── ak-mixed-fit ────────────────────────────────────────────────────────────────────────────────────
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

describe('ak-mixed-fit — the filtered Layers list', () => {
  const KAMPAN = [
    ...Array.from({ length: 19 }, (_, i) => ({
      id: `d${i + 1}`,
      kind: 'digital',
      label: `Post ${i + 1}`,
    })),
    { id: 'arch-1', kind: 'print', label: 'Arch 1' },
    { id: 'arch-2', kind: 'print', label: 'Arch 2' },
  ];

  test('Print lists only the two print artboards; the dimmed line is the last thing in the panel', async () => {
    const { ArtboardLayers } = await import('../client/v2/layers/artboard-layers.jsx');
    const { setKindFilter, clearKindFilter } = await import(
      '../client/v2/kinds/kind-filter-store.js'
    );
    setKindFilter('print');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        <ArtboardLayers boards={KAMPAN} canvasName="Combine-kampan" current="d1">
          <div data-testid="the-tree" />
        </ArtboardLayers>
      )
    );
    const rows = [...host.querySelectorAll('button.ly2-board')];
    expect(rows.map((r) => r.textContent)).toEqual(['Arch 1', 'Arch 2']);
    // the tree of the artboard outside the kind (the current one is fixed size) is not drawn
    expect(host.querySelector('[data-testid="the-tree"]')).toBeNull();
    const foot = host.querySelector('[data-testid="layers-kind-foot"]');
    expect(foot?.textContent).toContain('19 other artboards are dimmed.');
    expect(host.querySelector('.ly2')?.lastElementChild).toBe(foot);
    clearKindFilter();
  });
});

// ── 11 pn-tab-b20 / pn-relaunch-strip ───────────────────────────────────────────────────────────────
describe('11 tab strip — a tab at rest keeps ~7 characters for its name', () => {
  const html = readFileSync(
    join(import.meta.dir, '..', '..', 'desktop', 'src', 'strip.html'),
    'utf8'
  );
  const rule = (sel: string) => {
    const i = html.indexOf(`${sel} {`);
    return html.slice(i, html.indexOf('}', i));
  };

  test('the resting padding is the board dense space-2, the × room only on the active tab', () => {
    expect(rule('      .tab')).toMatch(/padding:\s*0 var\(--space-2, 8px\)/);
    expect(rule('      .tab[aria-selected="true"]')).toMatch(/padding:\s*0 var\(--space-2, 8px\) 0 28px/);
    // the × takes the square's place on hover/focus instead of padding every tab
    expect(html).toMatch(/\.tab:not\(\[aria-selected="true"\]\):hover \.sq/);
  });
});
