// gate-b-c4b — the canvas bridge's export scope (client/export-bridge-scope.js): a frame exports
// its own canvas only; Folder / Whole project stay the shell's Export sheet's.

import { describe, expect, test } from 'bun:test';
import { bridgedExportPayload, bridgedHistory } from '../client/export-bridge-scope.js';

const A = '.design/ui/a.tsx';

describe('bridgedExportPayload', () => {
  test('v2 This canvas / Selection: the canvas is pinned to the active one', () => {
    for (const scope of ['canvas', 'selection']) {
      const r = bridgedExportPayload(
        { v: 2, spec: { v: 2, scope, format: 'png', canvas: 'ui/b.tsx' } },
        A,
        '.design'
      );
      expect(r).toEqual({
        ok: true,
        payload: { v: 2, spec: { v: 2, scope, format: 'png', canvas: 'ui/a.tsx' } },
      });
    }
  });
  test('v2 Folder / Whole project, or a folder smuggled into a canvas scope, are refused', () => {
    for (const spec of [
      { v: 2, scope: 'project', format: 'zip' },
      { v: 2, scope: 'folder', folder: 'ui', format: 'zip' },
      { v: 2, scope: 'canvas', folder: 'ui', format: 'zip' },
      { v: 2, scope: 'bogus', format: 'zip' },
    ])
      expect(bridgedExportPayload({ v: 2, spec }, A, '.design').ok).toBe(false);
  });
  test('v1: project-raw refused; canvas scopes pinned, a folder option dropped', () => {
    expect(bridgedExportPayload({ format: 'zip', scope: 'project-raw' }, A, '.design').ok).toBe(
      false
    );
    expect(bridgedExportPayload({ format: 'png' }, A, '.design').ok).toBe(false);
    const r = bridgedExportPayload(
      {
        format: 'png',
        scope: 'artboard',
        options: { canvasFile: '.design/ui/b.tsx', folder: 'ui' },
      },
      A,
      '.design'
    );
    expect(r).toEqual({
      ok: true,
      payload: { format: 'png', scope: 'artboard', options: { canvasFile: A } },
    });
  });
  test('the asked payload is never mutated; no active canvas = refused', () => {
    const asked = { format: 'png', scope: 'artboard', options: { canvasFile: 'x' } };
    bridgedExportPayload(asked, A, '.design');
    expect(asked.options.canvasFile).toBe('x');
    expect(bridgedExportPayload(asked, '', '.design').ok).toBe(false);
    expect(bridgedExportPayload(null, A, '.design').ok).toBe(false);
  });
});

describe('bridgedHistory', () => {
  test("only the active canvas's own exports", () => {
    const h = [
      { filename: 'a1', options: { canvasFile: A } },
      { filename: 'a2', options: { spec: { canvas: 'ui/a.tsx' } } },
      { filename: 'b', options: { canvasFile: '.design/ui/b.tsx' } },
      { filename: 'all', options: {} },
      { filename: 'none' },
    ];
    expect(bridgedHistory(h, A, '.design').map((e) => e.filename)).toEqual(['a1', 'a2']);
    expect(bridgedHistory(h, '', '.design')).toEqual([]);
  });
});
