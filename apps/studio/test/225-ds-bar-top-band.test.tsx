// #225 — "top bar je na jinem miste v design system nez u canvases" (2.2.0 native, report r-f6c67908): #217 put the
// canvas pill in the shell's free top band (a column, the path above the controls), but the Design system canvas drew
// its own bar (ds/board/ds-bar.tsx) still centred on the FRAME in the old one-row form — so on that screen the bar sat
// somewhere else and ran under the Share cluster. Now both draw one island (`CanvasTopIsland`): the same placement in
// the band, the same top and height rules, the path line above the controls.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { BoardModel } from '../ds/board/types.ts';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

const model = {
  label: 'alligators',
  library: null,
  pendingCount: 1,
  tokens: [],
  themes: { all: ['light', 'dark'], default: 'light', light: 'light', dark: 'dark' },
} as unknown as BoardModel;

const roots: Array<{ unmount(): void }> = [];
let seq = 0;

afterEach(async () => {
  const { act } = await import('react');
  await act(async () => {
    for (const r of roots.splice(0)) r.unmount();
  });
  document.body.innerHTML = '';
  const { __resetCanvasTheme } = await import('../canvas-theme.ts');
  __resetCanvasTheme();
});

async function render(node: React.ReactNode) {
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const r = createRoot(host);
  roots.push(r);
  await act(async () => r.render(node));
}

async function mountBoth() {
  const { CanvasThemePill } = await import('../canvas-theme-pill.tsx');
  const { DsBarView } = await import('../ds/board/ds-bar.tsx');
  await render(<CanvasThemePill bothThemes={() => true} />);
  await render(<DsBarView model={model} mode="light" onMode={() => {}} onReview={() => {}} />);
  const pill = document.querySelector<HTMLElement>('[data-testid="canvas-theme-pill"]');
  const bar = document.querySelector<HTMLElement>('[data-testid="ds-bar"]');
  if (!pill || !bar) throw new Error('missing pill or bar');
  return { pill, bar };
}

async function sendBand(band: { left: number; right: number } | null) {
  const { act } = await import('react');
  const { canvasModeStore } = await import('../bridge/canvas-mode-store.ts');
  seq = Math.max(seq, canvasModeStore(window).get().insetsSeq) + 1;
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: {
          dgn: 'occluded-insets',
          seq,
          insets: { top: 68, right: 0, bottom: 0, left: 0 },
          ...(band ? { topBand: band } : {}),
        },
      })
    );
  });
}

const setWidth = (w: number) =>
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });

// the shell's top row as #217 measured it: the project pill ends at 264, a local project's Share cluster is ~380 wide
const CASES = [
  { width: 1280, band: { left: 264, right: 1280 - 16 - 380 } },
  { width: 1100, band: { left: 264, right: 1100 - 16 - 380 } },
];

describe('#225 — the Design system bar sits where the canvas pill sits', () => {
  for (const c of CASES)
    test(`${c.width} px: the same left, top, max width and column as the canvas pill`, async () => {
      setWidth(c.width);
      (window as unknown as { __canvas_meta_file__: string }).__canvas_meta_file__ =
        '.design/system/alligators/design-system.tsx';
      const { pill, bar } = await mountBoth();
      await sendBand(c.band);
      expect(bar.getAttribute('data-band')).toBe('band');
      expect(bar.getAttribute('data-band')).toBe(pill.getAttribute('data-band'));
      expect(bar.style.left).toBe(`${Math.round((c.band.left + c.band.right) / 2)}px`);
      expect(bar.style.left).toBe(pill.style.left);
      expect(bar.style.maxWidth).toBe(pill.style.maxWidth);
      // one island: the same class, so the same top, height, padding and centring rules
      expect(bar.classList.contains('dc-theme-pill')).toBe(true);
      expect(getComputedStyle(pill).top).toBe('16px');
      expect(getComputedStyle(bar).top).toBe(getComputedStyle(pill).top);
      expect(getComputedStyle(bar).minHeight).toBe(getComputedStyle(pill).minHeight);
      // the same column: the path line above the controls
      const shape = (el: HTMLElement) => [...el.children].map((ch) => ch.className);
      expect(shape(bar)).toEqual(['dc-theme-pill-path', 'dc-theme-pill-row']);
      expect(shape(bar)).toEqual(shape(pill));
      expect([...bar.children].map((ch) => ch.getAttribute('data-testid'))).toEqual([
        'ds-bar-path',
        'ds-bar-row',
      ]);
      expect(bar.getAttribute('data-path')).toBe(pill.getAttribute('data-path'));
      // every control of the bar is still there, on the row under the path
      const row = bar.children[1] as HTMLElement;
      for (const id of ['ds-bar-mode-light', 'ds-bar-mode-dark', 'ds-bar-pending', 'ds-bar-review'])
        expect(row.querySelector(`[data-testid="${id}"]`), id).not.toBeNull();
      expect(row.textContent).toContain('alligators');
    });

  test('with a band, the bar no longer centres on the frame; without one (an older shell) it does, like the pill', async () => {
    setWidth(1100);
    const { pill, bar } = await mountBoth();
    await sendBand({ left: 264, right: 704 });
    expect(bar.style.left).toBe('484px');
    expect(bar.style.left).not.toBe('550px');
    expect(bar.style.maxWidth).toBe(`${704 - 264 - 24}px`);
    // the bar's own stylesheet no longer centres it on the frame (left: 50%)
    const css = readFileSync(join(import.meta.dir, '../ds/board/board.css'), 'utf8');
    expect(css).not.toMatch(/\n\.ds-bar \{[^}]*left: 50%/);
    await sendBand(null);
    expect(bar.getAttribute('data-band')).toBe('frame');
    expect(bar.style.left).toBe('550px');
    expect(bar.style.left).toBe(pill.style.left);
  });
});
