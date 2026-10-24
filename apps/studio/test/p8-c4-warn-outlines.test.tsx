// Phase 8 C4 (08 ak-warnings) — the layer a "crosses the cut" warning is about is outlined on the artboard (a dashed
// warn border + a small "Crosses the cut" tag), over the design surface, as a guides-class aid that no export draws.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let Outlines: typeof import('../artboard-warn-mark.tsx').ArtboardWarnOutlines;
let outlineTargets: typeof import('../artboard-warn-mark.tsx').outlineTargets;
let root: Root | null = null;

beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ({ ArtboardWarnOutlines: Outlines, outlineTargets } = await import('../artboard-warn-mark.tsx'));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});
afterAll(() => GlobalRegistrator.unregister());

const CUT = {
  id: 'crosses-cut:qr',
  code: 'crosses-cut',
  text: 'The QR code crosses the cut — its corner would be trimmed.',
  verb: 'Move inside',
  fix: { kind: 'move-inside', element: 'qr', dx: -4, dy: -4 },
} as never;
const SOFT = {
  id: 'soft-image:photo',
  code: 'soft-image',
  text: 'x',
  verb: 'Replace…',
  fix: { kind: 'replace', element: 'photo' },
} as never;

function box(el: HTMLElement, x: number, y: number, w: number, h: number) {
  el.getBoundingClientRect = () =>
    ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y }) as DOMRect;
}

async function mount(warnings: unknown[], show = true) {
  const host = document.createElement('div');
  const body = document.createElement('div');
  body.innerHTML = '<span data-cd-id="qr"></span><span data-cd-id="photo"></span>';
  Object.defineProperty(body, 'offsetWidth', { value: 200 });
  box(body, 100, 50, 200, 300);
  box(body.querySelector('[data-cd-id="qr"]') as HTMLElement, 170, 290, 70, 72);
  box(body.querySelector('[data-cd-id="photo"]') as HTMLElement, 110, 60, 50, 50);
  document.body.append(host, body);
  const ref = createRef<HTMLElement>();
  (ref as { current: HTMLElement | null }).current = body;
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <Outlines
        warnings={warnings as never}
        bodyRef={ref}
        rect={{ x: 10, y: 20, w: 200, h: 300 }}
        show={show}
      />
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return host;
}

describe('the outline on a layer that crosses the cut', () => {
  test('only the cut warnings name a layer to outline', () => {
    expect(outlineTargets([CUT, SOFT])).toEqual([{ cdId: 'qr', word: 'Crosses the cut' }]);
    expect(
      outlineTargets([
        { code: 'layers-at-cut', fix: { kind: 'show', elements: ['a', 'b'] } } as never,
      ])
    ).toHaveLength(2);
  });

  test('a dashed outline at the layer\'s own px, carrying the words "Crosses the cut"', async () => {
    const host = await mount([CUT, SOFT]);
    const outs = host.querySelectorAll('[data-testid="artboard-warn-outline"]');
    expect(outs).toHaveLength(1);
    const o = outs[0] as HTMLElement;
    expect([o.style.left, o.style.top, o.style.width, o.style.height]).toEqual([
      '70px',
      '240px',
      '70px',
      '72px',
    ]);
    expect(o.style.border).toContain('dashed');
    expect(o.textContent).toBe('Crosses the cut');
    // a guides-class aid: hidden from exports, never a pointer target
    const layer = host.querySelector('[data-testid="artboard-warn-outlines"]') as HTMLElement;
    expect(layer.className).toContain('dc-artboard-guides');
    expect(layer.style.pointerEvents).toBe('none');
  });

  test('nothing is drawn outside edit chrome, or with no cut warning', async () => {
    expect(
      (await mount([CUT], false)).querySelector('[data-testid="artboard-warn-outlines"]')
    ).toBeNull();
    await act(async () => root?.unmount());
    expect(
      (await mount([SOFT])).querySelector('[data-testid="artboard-warn-outlines"]')
    ).toBeNull();
  });
});
