// gate-b-c4j — the shell's half of "a frame never inlines a canvas outside its own grant":
//
//  · a canvas that imports another canvas is framed like any other (no `ro=1`: c4h's read-only frame is
//    gone — the server refuses the module instead);
//  · when that frame fails, the stage says why — "This canvas imports another canvas (<path>). Move the
//    shared part into a component file (e.g. <newComponentDir>/…) to render it here." — instead of the
//    generic "can't be drawn" card; a canvas the index does not name keeps that generic card.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { canvasImportsOf, canvasUrl } from '../client/canvas-url.js';
import { canvasImportsText } from '../client/v2/code/canvas-imports-card.jsx';

const D = '.design';
const A = `${D}/ui/imp-b.tsx`;
const H = `${D}/ui/uses-helper.tsx`;
const cfg = {
  designRel: D,
  newComponentDir: 'ui/components',
  canvasImportsCanvases: { [A]: ['ui/canary-b-zx.tsx'] },
};
const params = (url: string) => new URL(url, 'http://x').searchParams;

let realFetch: typeof fetch;
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ canvas: { path: 'ui/imp-b.tsx', state: 'present' } }),
    }) as Response) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

describe('the frame URL', () => {
  test('a canvas importing another canvas is not framed read-only any more', () => {
    expect(params(canvasUrl(A, cfg)).get('ro')).toBeNull();
    expect(params(canvasUrl(A, { ...cfg, readOnly: true, canComment: true })).get('cm')).toBe('1');
  });
  test('canvasImportsOf: the names, [] when every name is hidden, null when none', () => {
    expect(canvasImportsOf(cfg, A)).toEqual(['ui/canary-b-zx.tsx']);
    expect(canvasImportsOf({ canvasImportsCanvases: { [A]: [] } }, A)).toEqual([]);
    expect(canvasImportsOf(cfg, H)).toBeNull();
    expect(canvasImportsOf({ canvasImportsCanvases: { [A]: 'x' } }, A)).toBeNull();
  });
});

describe('the card text', () => {
  test('names the import and the component dir', () => {
    expect(canvasImportsText(['ui/canary-b-zx.tsx'], 'ui/components')).toEqual({
      title: 'This canvas imports another canvas (ui/canary-b-zx.tsx).',
      body: 'Move the shared part into a component file (e.g. ui/components/…) to render it here.',
    });
  });
  test('a hidden name and no configured dir still read', () => {
    // b6cc0b3d6 — no configured dir names the default newComponentDir
    expect(canvasImportsText([], undefined)).toEqual({
      title: 'This canvas imports another canvas.',
      body: 'Move the shared part into a component file (e.g. ui/components/…) to render it here.',
    });
  });
});

async function mountViewport(path: string) {
  const { Viewport } = await import('../client/shell/viewport.jsx');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <Viewport
        tabs={[{ path }]}
        activePath={path}
        registerIframe={() => {}}
        cfg={cfg}
        canvasReloadNonce={0}
        renderSignal={{}}
        canvasError={{ path, kind: 'compile' }}
      />
    );
  });
  return host;
}

describe('the stage', () => {
  test("A's failed frame shows the imports card, not the generic one", async () => {
    const host = await mountViewport(A);
    const card = host.querySelector('[data-testid="canvas-imports-card"]');
    expect(card?.textContent).toContain('This canvas imports another canvas (ui/canary-b-zx.tsx).');
    expect(card?.textContent).toContain('e.g. ui/components/…');
  });
  test('a canvas the index does not name keeps the generic card', async () => {
    const host = await mountViewport(H);
    expect(host.querySelector('[data-testid="canvas-imports-card"]')).toBeNull();
    expect(host.querySelector('[data-testid="canvas-load-error"]')).not.toBeNull();
  });
});
