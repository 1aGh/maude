// #169 item 4 — the canvas iframe's first frame measured 304x154 (the browser default 300x150 + a 2px border)
// in desktop e2e evidence: the shell rule `.viewport > iframe { width/height 100%; border 0 }` (a rule in
// `@layer shell`) had not applied to that frame yet. The frame must therefore carry its own size, so the
// stage size does not depend on when/whether the stylesheet applies.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const D = '.design';
const A = `${D}/ui/A.tsx`;
const B = `${D}/ui/B.tsx`;
let realFetch: typeof fetch;

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ canvas: { path: 'ui/A.tsx', state: 'present' } }),
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

describe('the canvas iframe carries its own size (no stylesheet needed)', () => {
  test('active and kept-alive frames: 100% x 100%, no border, absolutely filling the stage', async () => {
    const { Viewport } = await import('../client/shell/viewport.jsx');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const props = {
      tabs: [{ path: A }, { path: B }],
      registerIframe: () => {},
      cfg: { designRel: D },
      canvasReloadNonce: 0,
      renderSignal: {},
    };
    await act(async () => root.render(<Viewport {...props} activePath={A} />));
    await act(async () => root.render(<Viewport {...props} activePath={B} />));
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    const frames = [...host.querySelectorAll('iframe')] as HTMLIFrameElement[];
    expect(frames.length).toBeGreaterThanOrEqual(1);
    for (const f of frames) {
      // The stylesheet is not loaded in this document: everything below must come from the element itself.
      expect(f.getAttribute('width')).toBe('100%');
      expect(f.getAttribute('height')).toBe('100%');
      expect(f.style.borderWidth || f.style.border).toMatch(/^0/);
      expect(f.style.position).toBe('absolute');
      expect(f.style.width).toBe('100%');
      expect(f.style.height).toBe('100%');
    }
  });
});
