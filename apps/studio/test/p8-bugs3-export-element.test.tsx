// p8-bugs3 #1 — the Export sheet for ONE selected ELEMENT (09 ex-social, a post whose photo fills the page).
// Since the page root IS the artboard (decision v2-c3-page-root-is-the-artboard) a click on a post lands on the
// top object under the page — an element, not the artboard — so the sheet's estimate answers
// `boards: [{ id: <element id>, label: null, w: null, h: null }]`. The sheet used to print "Export 1 artboard",
// "1× 0 × 0" and a blank tile; it now names the object and shows its own size, from the selection.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { exportSelectionV2 } from '../client/selection-scope.js';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const FILE = '.design/ui/Matchday.tsx';
const photo = {
  file: FILE,
  id: 'c3703428',
  artboardId: 'post',
  selector: '[data-cd-id="c3703428"]',
  tag: 'img',
  worldW: 432,
  worldH: 540,
};

describe('exportSelectionV2 names one selected element', () => {
  test('an image is a "Photo", with the size it has on the canvas', () => {
    const r = exportSelectionV2(photo, FILE);
    expect(r.selectedElements).toEqual(['c3703428']);
    expect(r.selectionLabel).toBe('Photo');
    expect(r.selectionSize).toEqual({ w: 432, h: 540 });
  });
  test('a text object is named by its words; an unknown tag is "Object"', () => {
    const t = exportSelectionV2({ ...photo, tag: 'h1', text: '  DERBY   DNES ' }, FILE);
    expect(t.selectionLabel).toBe('DERBY DNES');
    expect(exportSelectionV2({ ...photo, tag: 'div' }, FILE).selectionLabel).toBe('Object');
  });
  test('an artboard carries its size too; several things have no single label or size', () => {
    const one = exportSelectionV2(
      { file: FILE, artboardId: 'post', selector: 's', worldW: 432, worldH: 540 },
      FILE
    );
    expect(one.selectionSize).toEqual({ w: 432, h: 540 });
    const two = exportSelectionV2([photo, { ...photo, id: 'x2' }], FILE);
    expect(two.selectionLabel).toBeNull();
    expect(two.selectionSize).toBeNull();
  });
});

let root: Root | null = null;
let host: HTMLElement | null = null;
const realFetch = globalThis.fetch;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  globalThis.fetch = realFetch;
});
const tick = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const text = (sel: string) =>
  document.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('the sheet for one element', () => {
  test('title, size chips and the size line come from the selection when the estimate has no size', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (v: unknown) =>
        new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/_api/export-history')) return json({ history: [] });
      if (url.endsWith('/_api/export-estimate'))
        return json({
          counts: { selection: 1, canvas: 6, folder: null, project: null },
          files: 1,
          bytes: 1_166_400,
          seconds: 3.7,
          lane: 'this-mac',
          byKind: { digital: { artboards: 1, files: 1, format: 'png' } },
          skipped: [],
          boards: [
            {
              canvas: 'ui/Matchday.tsx',
              id: 'c3703428',
              label: null,
              kind: null,
              w: null,
              h: null,
            },
          ],
        });
      return json({});
    }) as typeof fetch;
    const { ExportSheet } = await import('../client/v2/export/export-sheet.jsx');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <ExportSheet
          mode="export"
          activePath={FILE}
          designRel=".design"
          exportLane="local"
          {...exportSelectionV2(photo, FILE)}
          onClose={() => {}}
        />
      );
      await tick();
    });
    await act(async () => {
      await tick();
    });
    expect(text('[data-testid="export-sheet"] h2, [data-testid="export-title"]')).toContain(
      'Photo'
    );
    const sheet = text('[data-testid="export-sheet"]');
    expect(sheet).not.toContain('0 × 0');
    expect(sheet).not.toContain('Export 1 artboard');
    expect(text('[data-testid="export-size-1x"]')).toContain('432 × 540');
    expect(text('[data-testid="export-size-2x"]')).toContain('864 × 1080');
  });
});
