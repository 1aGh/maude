// S2.8 — the canvas half: a selected artboard's eight handles and what a drag does (live reflow, the preset ruler,
// ONE `artboard.resize` write, the layout-lane position commit), the tall-page sticky name and the contextual
// minimap. Real markup in happy-dom with stubbed geometry (happy-dom does no layout); the studio's answer to
// `edit-op` is played by the test. The canvas iframe itself is unreachable by DOM selectors (memory), so the
// real-browser pass is the e2e step written next to this file, not run here.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});
const settle = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));

interface Geo {
  /** the design surface, world px */
  w: number;
  h: number;
  /** screen px per world px */
  zoom: number;
  left: number;
  top: number;
  frameLeft?: number;
  frameTop?: number;
  labelTop?: number;
}

/** An artboard frame with a label and a design surface; happy-dom gets the geometry we say. */
function artboard(id: string, label: string, g: Geo, children = ''): HTMLElement {
  const a = document.createElement('article');
  a.className = 'dc-artboard dc-positioned';
  a.setAttribute('data-dc-screen', id);
  a.style.left = `${g.frameLeft ?? 0}px`;
  a.style.top = `${g.frameTop ?? 0}px`;
  a.style.width = `${g.w + 2}px`;
  a.innerHTML = `<button class="dc-artboard-label sku">${label}</button><div class="dc-artboard-body">${children}</div>`;
  document.body.append(a);
  const body = a.querySelector('.dc-artboard-body') as HTMLElement;
  const labelEl = a.querySelector('.dc-artboard-label') as HTMLElement;
  const def = (el: HTMLElement, k: string, v: unknown) =>
    Object.defineProperty(el, k, { value: v, configurable: true });
  def(a, 'offsetWidth', g.w + 2);
  def(body, 'offsetWidth', g.w);
  def(body, 'offsetHeight', g.h);
  def(body, 'offsetTop', 24);
  def(a, 'clientTop', 1);
  const rect = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  });
  body.getBoundingClientRect = () => rect(g.left, g.top, g.w * g.zoom, g.h * g.zoom) as DOMRect;
  // the frame is the surface plus its label strip on top (a v1 overlay measures the FRAME, not the surface)
  a.getBoundingClientRect = () =>
    rect(g.left, g.labelTop ?? g.top - 24, g.w * g.zoom + 2, g.h * g.zoom + 24) as DOMRect;
  labelEl.getBoundingClientRect = () => rect(g.left, g.labelTop ?? g.top - 24, 90, 20) as DOMRect;
  return a;
}

// ── the helpers a drag is made of ─────────────────────────────────────────────────────────────

describe('measuring and the live preview', () => {
  test('measureArtboard: world box from the frame, zoom from the surface, the surface on screen', async () => {
    const { measureArtboard } = await import('../editing/artboard-handles.tsx');
    artboard('desktop', 'Desktop', {
      w: 1440,
      h: 1573,
      zoom: 0.5,
      left: 100,
      top: 60,
      frameLeft: 40,
      frameTop: 20,
    });
    const m = measureArtboard(document, 'desktop');
    expect(m?.box).toEqual({ x: 40, y: 20, w: 1440, h: 1573 });
    expect(m?.zoom).toBe(0.5);
    expect(m?.rect).toEqual({ left: 100, top: 60, width: 720, height: 786.5 });
    expect(m?.extraW).toBe(2); // the frame's border
    expect(measureArtboard(document, 'nope')).toBeNull();
  });

  test('applyPreview reflows the frame (width incl. its border, origin, a touched height); restore gives it all back', async () => {
    const { measureArtboard, savePreview, applyPreview, restorePreview } = await import(
      '../editing/artboard-handles.tsx'
    );
    const a = artboard('desktop', 'Desktop', { w: 1440, h: 1573, zoom: 1, left: 0, top: 0 });
    const m = measureArtboard(document, 'desktop');
    if (!m) throw new Error('no artboard');
    const saved = savePreview(m);
    applyPreview(m, { x: 80, y: 0, w: 1280, h: 1200 }, true);
    expect(a.style.width).toBe('1282px');
    expect(a.style.left).toBe('80px');
    const body = a.querySelector('.dc-artboard-body') as HTMLElement;
    expect(body.style.height).toBe('1200px');
    expect(body.style.flex).toMatch(/^(none|0 0 auto)$/); // happy-dom spells `none` as 0 0 auto
    restorePreview(m, saved);
    expect(a.style.width).toBe('1442px');
    expect(a.style.left).toBe('0px');
    expect(body.style.height).toBe('');
  });

  test('a width-only preview leaves the height alone (the page keeps fitting its content)', async () => {
    const { measureArtboard, applyPreview } = await import('../editing/artboard-handles.tsx');
    const a = artboard('desktop', 'Desktop', { w: 1440, h: 1573, zoom: 1, left: 0, top: 0 });
    const m = measureArtboard(document, 'desktop');
    if (!m) throw new Error('no artboard');
    applyPreview(m, { x: 0, y: 0, w: 1280, h: 1573 }, false);
    expect((a.querySelector('.dc-artboard-body') as HTMLElement).style.height).toBe('');
  });

  test('resizeParams sends only what changed; a touched height also pins Fixed; no change sends nothing', async () => {
    const { resizeParams, movedOrigin } = await import('../editing/artboard-handles.tsx');
    const { computeArtboardResize } = await import('../editing/artboard-resize.ts');
    const start = { x: 0, y: 0, w: 1440, h: 1573 };
    expect(resizeParams('desktop', start, computeArtboardResize(start, 'e', -165, 0))).toEqual({
      artboard: 'desktop',
      width: 1280,
    });
    expect(resizeParams('desktop', start, computeArtboardResize(start, 's', 0, -373))).toEqual({
      artboard: 'desktop',
      height: 1200,
      fixed: true,
    });
    expect(resizeParams('desktop', start, computeArtboardResize(start, 'e', 0, 0))).toBeNull();
    expect(movedOrigin(start, { x: 80, y: 0, w: 1280, h: 1573 })).toEqual({ x: 80, y: 0 });
    expect(movedOrigin(start, start)).toBeNull();
  });
});

// ── the gesture, end to end ───────────────────────────────────────────────────────────────────

const posted: Array<Record<string, unknown>> = [];
const committed: Array<unknown[]> = [];

async function mountHandles() {
  const { ToolProvider } = await import('../use-tool-mode.tsx');
  const { SelectionSetProvider, useSelectionSet } = await import('../use-selection-set.tsx');
  const { ArtboardHandles } = await import('../editing/artboard-handles.tsx');
  function Pick() {
    const s = useSelectionSet();
    return (
      <button
        type="button"
        data-testid="pick"
        onClick={() =>
          s.replace({
            id: null,
            selector: '[data-dc-screen="desktop"]',
            artboardId: 'desktop',
            index: 0,
          } as never)
        }
      />
    );
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <ToolProvider>
        <SelectionSetProvider postTarget={{ postMessage: () => {} }}>
          <Pick />
          <ArtboardHandles />
        </SelectionSetProvider>
      </ToolProvider>
    )
  );
  await act(async () => {
    host.querySelector<HTMLElement>('[data-testid="pick"]')?.click();
  });
  await settle(60);
  return host;
}

const ptr = (type: string, x: number, y: number, mods: Record<string, boolean> = {}) =>
  new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, ...mods });

describe('a selected artboard', () => {
  beforeEach(() => {
    posted.length = 0;
    committed.length = 0;
    // the shell: answer every edit-op with ok
    (window as unknown as { parent: unknown }).parent = window;
    const real = window.postMessage.bind(window);
    window.postMessage = ((msg: Record<string, unknown>, ...rest: unknown[]) => {
      if (msg?.dgn === 'edit-op') {
        posted.push(msg);
        queueMicrotask(() =>
          window.dispatchEvent(
            new window.MessageEvent('message', {
              source: window as never,
              data: {
                dgn: 'edit-op-result',
                requestId: msg.requestId,
                ok: true,
                actionId: null,
                writeId: 'w_1',
                rev: 'r1',
                refs: [],
              },
            })
          )
        );
        return;
      }
      (real as (...a: unknown[]) => void)(msg, ...rest);
    }) as typeof window.postMessage;
  });

  test('has eight handles; the frame follows it; the name carries the size', async () => {
    artboard('desktop', 'Desktop', { w: 1440, h: 1573, zoom: 0.5, left: 100, top: 60 });
    const host = await mountHandles();
    const hs = [...host.parentElement!.querySelectorAll('[data-testid^="ed-ab-handle-"]')].map(
      (n) => n.getAttribute('data-h')
    );
    expect(hs.sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
    const art = document.querySelector('[data-dc-screen="desktop"]');
    expect(art?.hasAttribute('data-ed-selected')).toBe(true);
    expect(art?.querySelector('.dc-artboard-label')?.getAttribute('data-ed-size')).toBe(
      '1440 × 1573'
    );
    const e = document.querySelector<HTMLElement>('[data-testid="ed-ab-handle-e"]');
    // the east handle sits on the east edge, mid-height: left 100 + 720, top 60 + 786.5 / 2
    expect(e?.style.left).toBe('820px');
    expect(e?.style.top).toBe('453px');
  });

  test('dragging the east edge near Laptop lights the ruler, names it, reflows the page, then writes ONE resize', async () => {
    const a = artboard('desktop', 'Desktop', { w: 1440, h: 1573, zoom: 0.5, left: 100, top: 60 });
    await mountHandles();
    const e = document.querySelector<HTMLElement>('[data-testid="ed-ab-handle-e"]') as HTMLElement;
    await act(async () => e.dispatchEvent(ptr('pointerdown', 820, 453)));
    // 165 world px left = 82.5 screen px at 0.5 zoom → 1275 → clicks onto Laptop 1280
    await act(async () => window.dispatchEvent(ptr('pointermove', 820 - 82.5, 453)));
    expect(document.querySelector('[data-testid="ed-ab-bubble"]')?.textContent).toBe(
      'Laptop · 1280 × 1573'
    );
    expect(document.querySelector('[data-testid="ed-ab-tick-1280"]')?.getAttribute('data-on')).toBe(
      'true'
    );
    expect(
      document.querySelector('[data-testid="ed-ab-tick-1440"]')?.getAttribute('data-on')
    ).toBeNull();
    expect(document.querySelector('[data-testid="ed-ab-ghost"]')).not.toBeNull();
    expect(a.style.width).toBe('1282px'); // the page reflows while you drag
    await act(async () => window.dispatchEvent(ptr('pointerup', 820 - 82.5, 453)));
    await settle();
    expect(posted.length).toBe(1);
    expect(posted[0]).toMatchObject({
      dgn: 'edit-op',
      op: 'artboard.resize',
      targets: [],
      params: { artboard: 'desktop', width: 1280 },
    });
    expect(document.querySelector('[data-testid="ed-ab-bubble"]')).toBeNull(); // the HUD goes with the drag
  });

  test('⌘ ignores presets: the bubble has no name and the width stays where the pointer put it', async () => {
    artboard('desktop', 'Desktop', { w: 1440, h: 1573, zoom: 0.5, left: 100, top: 60 });
    await mountHandles();
    const e = document.querySelector<HTMLElement>('[data-testid="ed-ab-handle-e"]') as HTMLElement;
    await act(async () => e.dispatchEvent(ptr('pointerdown', 820, 453)));
    await act(async () =>
      window.dispatchEvent(ptr('pointermove', 820 - 82.5, 453, { metaKey: true }))
    );
    expect(document.querySelector('[data-testid="ed-ab-bubble"]')?.textContent).toBe('1275 × 1573');
    await act(async () => window.dispatchEvent(ptr('pointerup', 820 - 82.5, 453)));
    await settle();
    expect(posted[0]).toMatchObject({ params: { artboard: 'desktop', width: 1275 } });
  });

  test('a bottom-edge drag writes the height and Fixed in the same request', async () => {
    artboard('desktop', 'Desktop', { w: 1440, h: 1573, zoom: 0.5, left: 100, top: 60 });
    await mountHandles();
    const s = document.querySelector<HTMLElement>('[data-testid="ed-ab-handle-s"]') as HTMLElement;
    await act(async () => s.dispatchEvent(ptr('pointerdown', 460, 846)));
    await act(async () => window.dispatchEvent(ptr('pointermove', 460, 846 - 186.5)));
    expect(document.querySelector('[data-testid="ed-ab-bubble"]')?.textContent).toBe('1440 × 1200');
    await act(async () => window.dispatchEvent(ptr('pointerup', 460, 846 - 186.5)));
    await settle();
    expect(posted[0]).toMatchObject({ params: { artboard: 'desktop', height: 1200, fixed: true } });
  });

  test('esc gives the drag back: the page returns to its size and nothing is written', async () => {
    const a = artboard('desktop', 'Desktop', { w: 1440, h: 1573, zoom: 0.5, left: 100, top: 60 });
    await mountHandles();
    const e = document.querySelector<HTMLElement>('[data-testid="ed-ab-handle-e"]') as HTMLElement;
    await act(async () => e.dispatchEvent(ptr('pointerdown', 820, 453)));
    await act(async () => window.dispatchEvent(ptr('pointermove', 700, 453)));
    expect(a.style.width).not.toBe('1442px');
    await act(async () =>
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    );
    expect(a.style.width).toBe('1442px');
    await settle();
    expect(posted).toEqual([]);
    expect(document.querySelector('[data-testid="ed-ab-bubble"]')).toBeNull();
  });

  test('a click on a handle with no travel writes nothing', async () => {
    artboard('desktop', 'Desktop', { w: 1440, h: 1573, zoom: 0.5, left: 100, top: 60 });
    await mountHandles();
    const e = document.querySelector<HTMLElement>('[data-testid="ed-ab-handle-e"]') as HTMLElement;
    await act(async () => e.dispatchEvent(ptr('pointerdown', 820, 453)));
    await act(async () => window.dispatchEvent(ptr('pointerup', 820, 453)));
    await settle();
    expect(posted).toEqual([]);
  });

  test('v1 draws no second set: ElementResizeOverlay stands down for an artboard selection', async () => {
    artboard('desktop', 'Desktop', { w: 1440, h: 1573, zoom: 0.5, left: 100, top: 60 });
    const { ToolProvider } = await import('../use-tool-mode.tsx');
    const { SelectionSetProvider, useSelectionSet } = await import('../use-selection-set.tsx');
    const { ElementResizeOverlay } = await import('../use-element-resize.tsx');
    function Pick() {
      const s = useSelectionSet();
      return (
        <button
          type="button"
          data-testid="pick"
          onClick={() =>
            s.replace({
              id: null,
              selector: '[data-dc-screen="desktop"]',
              artboardId: 'desktop',
              index: 0,
            } as never)
          }
        />
      );
    }
    function PickEl() {
      const s = useSelectionSet();
      return (
        <button
          type="button"
          data-testid="pick-el"
          onClick={() =>
            s.replace({
              id: 'hero',
              selector: '[data-dc-screen="desktop"] [data-cd-id="hero"]',
              artboardId: 'desktop',
              index: 0,
            } as never)
          }
        />
      );
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        <ToolProvider>
          <SelectionSetProvider postTarget={{ postMessage: () => {} }}>
            <Pick />
            <PickEl />
            <ElementResizeOverlay />
          </SelectionSetProvider>
        </ToolProvider>
      )
    );
    await act(async () => {
      host.querySelector<HTMLElement>('[data-testid="pick"]')?.click();
    });
    await settle(60);
    const live = () =>
      [...document.querySelectorAll<HTMLElement>('.dc-el-resize-handle')].filter(
        (h) => h.style.pointerEvents !== 'none' && h.style.opacity !== '0'
      );
    expect(live()).toEqual([]);
    // ... and the probe can see v1's handles when they ARE drawn (an ELEMENT selection), so the empty list above means something
    const el = document.createElement('div');
    el.setAttribute('data-cd-id', 'hero');
    document.querySelector('.dc-artboard-body')?.append(el);
    el.getBoundingClientRect = () =>
      ({ left: 120, top: 100, width: 200, height: 100, right: 320, bottom: 200 }) as DOMRect;
    await act(async () => {
      host.querySelector<HTMLElement>('[data-testid="pick-el"]')?.click();
    });
    await settle(60);
    expect(live().length).toBeGreaterThan(0);
  });
});

// ── a 6000 px page ────────────────────────────────────────────────────────────────────────────

const CLUB = `
  <section data-dc-element="Hero" style="height:900px"></section>
  <section aria-label="O nás" style="height:1000px"></section>
  <section style="height:1200px"><h2>Tým</h2></section>
  <section data-dc-element="Kontakt" style="height:2900px"></section>`;

/** stub each section's rect from the heights above, so pageSections measures a real tall page */
function stubSections(a: HTMLElement, top: number, zoom: number) {
  const heights = [900, 1000, 1200, 2900];
  let y = 0;
  [...(a.querySelector('.dc-artboard-body') as HTMLElement).children].forEach((c, i) => {
    const h = heights[i] as number;
    const t = top + y * zoom;
    c.getBoundingClientRect = () =>
      ({
        left: 0,
        top: t,
        width: 1440 * zoom,
        height: h * zoom,
        right: 1440 * zoom,
        bottom: t + h * zoom,
      }) as DOMRect;
    y += h;
  });
}

describe('a long page (ed-edge-huge)', () => {
  const WIN = 1000;
  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: WIN, configurable: true });
  });

  test('measureLongPages finds only pages of 3000 px and up', async () => {
    const { measureLongPages } = await import('../editing/long-page.ts');
    artboard('home', 'Homepage', { w: 1440, h: 1573, zoom: 0.4, left: 100, top: 100 });
    artboard('club', 'Domů · Desktop', { w: 1440, h: 6000, zoom: 0.4, left: 600, top: -800 }, CLUB);
    const pages = measureLongPages(document);
    expect(pages.map((p) => p.id)).toEqual(['club']);
    expect(pages[0]?.name).toBe('Domů · Desktop');
    expect(pages[0]?.visible).toEqual({ from: 2000, to: 4500 });
  });

  test('sections are the top-level children, named: design name · aria-label · first heading', async () => {
    const { pageSections } = await import('../editing/long-page.ts');
    const a = artboard('club', 'Domů', { w: 1440, h: 6000, zoom: 0.4, left: 600, top: -800 }, CLUB);
    stubSections(a, -800, 0.4);
    expect(pageSections(document, 'club').map((s) => `${s.name} ${s.y}+${s.h}`)).toEqual([
      'Hero 0+900',
      'O nás 900+1000',
      'Tým 1900+1200',
      'Kontakt 3100+2900',
    ]);
  });

  test('the sticky name appears only once the label has scrolled off, and says the size', async () => {
    const { measureLongPages } = await import('../editing/long-page.ts');
    const { planStickyChips } = await import('../editing/sticky-name.tsx');
    artboard(
      'club',
      'Domů · Desktop',
      { w: 1440, h: 6000, zoom: 0.4, left: 600, top: -800, labelTop: -824 },
      CLUB
    );
    const chips = planStickyChips(measureLongPages(document));
    expect(chips).toEqual([
      { id: 'club', name: 'Domů · Desktop', size: '1440 × 6000', left: 600, top: 8 },
    ]);
    // label on screen again: the real label is enough
    document.body.innerHTML = '';
    artboard(
      'club',
      'Domů · Desktop',
      { w: 1440, h: 6000, zoom: 0.4, left: 600, top: 100, labelTop: 76 },
      CLUB
    );
    expect(planStickyChips(measureLongPages(document))).toEqual([]);
  });

  test('the minimap says where you are and lists the sections; none for a normal canvas', async () => {
    const { measureLongPages, pageSections } = await import('../editing/long-page.ts');
    const { planMinimap } = await import('../editing/minimap-context.tsx');
    const a = artboard(
      'club',
      'Domů · Desktop',
      { w: 1440, h: 6000, zoom: 0.4, left: 600, top: -800 },
      CLUB
    );
    stubSections(a, -800, 0.4);
    const m = planMinimap(measureLongPages(document), (id) => pageSections(document, id));
    expect(m).toMatchObject({ id: 'club', total: 6000, from: 2000, to: 4500, lit: 'Kontakt' });
    expect(m?.sections.map((s) => s.name)).toEqual(['Hero', 'O nás', 'Tým', 'Kontakt']);
    document.body.innerHTML = '';
    artboard('home', 'Homepage', { w: 1440, h: 1573, zoom: 0.4, left: 100, top: 100 });
    expect(planMinimap(measureLongPages(document), () => [])).toBeNull();
  });

  test('the whole page in view: no minimap', async () => {
    const { measureLongPages } = await import('../editing/long-page.ts');
    const { planMinimap } = await import('../editing/minimap-context.tsx');
    artboard('club', 'Domů', { w: 1440, h: 6000, zoom: 0.1, left: 100, top: 100 }, CLUB);
    expect(planMinimap(measureLongPages(document), () => [])).toBeNull();
  });

  test('the island renders the sentence, the band and the sections; a click jumps to the section', async () => {
    const { MinimapContext } = await import('../editing/minimap-context.tsx');
    const a = artboard(
      'club',
      'Domů · Desktop',
      { w: 1440, h: 6000, zoom: 0.4, left: 600, top: -800 },
      CLUB
    );
    stubSections(a, -800, 0.4);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<MinimapContext pollMs={20} />));
    await settle(80);
    expect(host.querySelector('[data-testid="ed-minimap-sentence"]')?.textContent).toBe(
      "You're looking at 2000–4500 of 6000."
    );
    const names = [...host.querySelectorAll('[data-testid="ed-minimap-section"]')].map(
      (n) => n.textContent
    );
    expect(names).toEqual(['Hero', 'O nás', 'Tým', 'Kontakt']);
    const band = host.querySelector<HTMLElement>('[data-testid="ed-minimap-band"]');
    expect(band?.style.top).toBe(`${2000 * (240 / 6000)}px`);
  });
});

describe('Edit chrome only', () => {
  test('Preview shows the page without its minimap or sticky name; Edit shows both', async () => {
    const { EditingLayer } = await import('../editing/index.tsx');
    const { ToolProvider } = await import('../use-tool-mode.tsx');
    const { SelectionSetProvider } = await import('../use-selection-set.tsx');
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
    const a = artboard(
      'club',
      'Domů · Desktop',
      { w: 1440, h: 6000, zoom: 0.4, left: 600, top: -800, labelTop: -824 },
      CLUB
    );
    stubSections(a, -800, 0.4);
    const render = async (mode: 'edit' | 'preview') => {
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      roots.push(root);
      await act(async () =>
        root.render(
          <ToolProvider initialMode={mode}>
            <SelectionSetProvider postTarget={{ postMessage: () => {} }}>
              <EditingLayer />
            </SelectionSetProvider>
          </ToolProvider>
        )
      );
      await settle(250);
      return host;
    };
    await render('preview');
    expect(document.querySelector('[data-testid="ed-minimap"]')).toBeNull();
    expect(document.querySelector('[data-testid="ed-sticky-name"]')).toBeNull();
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    await render('edit');
    expect(document.querySelector('[data-testid="ed-minimap"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="ed-sticky-name"]')).not.toBeNull();
  });
});
