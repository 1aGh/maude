// 2.0.7 — an artboard that is not mounted (not near yet, or released because it is far) shows a same-size
// placeholder in its OWN colours — a still of what it looked like when it has rendered before, a skeleton in its
// background otherwise — never the bare frame (a black box on a dark design system). Captures show none.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

class FakeIO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('artboard placeholder', () => {
  let lib: typeof import('../canvas-lib.tsx');
  let gate: typeof import('../artboard-live-gate.tsx');
  let ph: typeof import('../artboard-placeholder.ts');

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;
    lib = await import('../canvas-lib.tsx');
    gate = await import('../artboard-live-gate.tsx');
    ph = await import('../artboard-placeholder.ts');
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });
  beforeEach(() => {
    gate.resetArtboardLive();
    ph.resetPictures();
  });

  async function mount(search: string, boards: Array<{ id: string; background?: string }>) {
    window.happyDOM.setURL(`http://localhost/${search}`);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <lib.DesignCanvas>
          <lib.DCSection id="s" title="S">
            {boards.map((b) => (
              <lib.DCArtboard
                key={b.id}
                id={b.id}
                label={b.id}
                width={200}
                height={150}
                background={b.background}
              >
                <p data-body={b.id}>content</p>
              </lib.DCArtboard>
            ))}
          </lib.DCSection>
        </lib.DesignCanvas>
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    const done = async () => {
      await act(async () => root.unmount());
      host.remove();
    };
    return { host, done };
  }

  describe('choosePlaceholder', () => {
    test('never rendered: a skeleton in its own background prop', () => {
      expect(ph.choosePlaceholder('a', 'var(--bg-1)')).toEqual({
        kind: 'skeleton',
        bg: 'var(--bg-1)',
      });
    });
    test('never rendered, no prop: the background the canvas’s other artboards turned out to have', () => {
      ph.rememberPicture('other', { bg: 'rgb(253, 246, 227)', blocks: [], h: 100 });
      expect(ph.choosePlaceholder('a')).toEqual({ kind: 'skeleton', bg: 'rgb(253, 246, 227)' });
    });
    test('rendered before: its picture wins over the prop (it is what it looked like)', () => {
      const pic = { bg: 'rgb(1, 2, 3)', blocks: [{ x: 0, y: 0, w: 0.5, h: 0.5, c: 'red' }], h: 80 };
      ph.rememberPicture('a', pic);
      expect(ph.choosePlaceholder('a', '#fff')).toEqual({
        kind: 'picture',
        bg: 'rgb(1, 2, 3)',
        picture: pic,
      });
    });
    test('nothing known yet: a soft mid tone over the frame colour, never the bare (black) frame', () => {
      expect(ph.choosePlaceholder('a')).toEqual({ kind: 'skeleton', bg: ph.UNKNOWN_BG });
      expect(ph.UNKNOWN_BG).toContain('color-mix');
      // its own colour, remembered the moment it mounted, wins over the canvas guess
      ph.rememberBackground('b', 'rgb(9, 9, 9)');
      ph.rememberBackground('a', 'rgb(253, 246, 227)');
      expect(ph.choosePlaceholder('b').bg).toBe('rgb(9, 9, 9)');
      expect(ph.choosePlaceholder('c').bg).toBe('rgb(253, 246, 227)');
    });
    test('isClear: transparent colours are not a background', () => {
      for (const c of ['transparent', 'rgba(0, 0, 0, 0)', 'rgb(0 0 0 / 0)', '', null])
        expect(ph.isClear(c)).toBe(true);
      for (const c of ['rgb(0, 0, 0)', 'rgba(10, 10, 10, 0.5)', '#000'])
        expect(ph.isClear(c)).toBe(false);
    });
  });

  test('takePicture: the body’s background (else a full-size child’s) and its biggest coloured blocks', () => {
    const body = document.createElement('div');
    const wrap = document.createElement('div');
    const card = document.createElement('div');
    const img = document.createElement('img');
    wrap.style.backgroundColor = 'rgb(253, 246, 227)';
    card.style.backgroundColor = 'rgb(120, 80, 220)';
    wrap.append(card, img);
    body.append(wrap);
    document.body.append(body);
    const rect = (l: number, t: number, w: number, h: number) => () =>
      ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h }) as DOMRect;
    body.getBoundingClientRect = rect(0, 0, 200, 100);
    wrap.getBoundingClientRect = rect(0, 0, 200, 100);
    card.getBoundingClientRect = rect(20, 10, 100, 50);
    img.getBoundingClientRect = rect(150, 60, 40, 30);
    const pic = ph.takePicture(body);
    expect(pic?.bg).toBe('rgb(253, 246, 227)');
    expect(pic?.blocks).toEqual([
      { x: 0.1, y: 0.1, w: 0.5, h: 0.5, c: 'rgb(120, 80, 220)' },
      { x: 0.75, y: 0.6, w: 0.2, h: 0.3, c: '' },
    ]);
    body.remove();
  });

  test('an artboard not near yet shows a skeleton in its own background, never the bare frame', async () => {
    const m = await mount('?artboard-live=sleep', [{ id: 'a0', background: 'rgb(253, 246, 227)' }]);
    expect(m.host.querySelector('[data-body]')).toBeNull();
    const el = m.host.querySelector('[data-dc-placeholder]') as HTMLElement;
    expect(el.getAttribute('data-dc-placeholder')).toBe('skeleton');
    expect(el.style.backgroundColor).toBe('rgb(253, 246, 227)');
    expect(Number.parseFloat(el.style.minHeight)).toBeGreaterThanOrEqual(150);
    await m.done();
  });

  test('a skeleton drawn before anything rendered takes the canvas colour once one artboard reveals it', async () => {
    const m = await mount('?artboard-live=sleep', [{ id: 'a0' }, { id: 'a1' }]);
    const phs = () => [...m.host.querySelectorAll('[data-dc-placeholder]')] as HTMLElement[];
    expect(phs()).toHaveLength(2);
    // nothing known yet: the mid tone (never the bare frame)
    for (const el of phs()) expect(el.style.backgroundColor).not.toBe('rgb(9, 9, 9)');
    // another artboard of this canvas mounts and turns out dark: the waiting skeletons follow, without a mount
    await act(async () => {
      ph.rememberBackground('elsewhere', 'rgb(9, 9, 9)');
    });
    for (const el of phs()) expect(el.style.backgroundColor).toBe('rgb(9, 9, 9)');
    // a later, different colour does not repaint every placeholder again (the first known colour stays)
    await act(async () => {
      ph.rememberBackground('third', 'rgb(250, 250, 250)');
    });
    for (const el of phs()) expect(el.style.backgroundColor).toBe('rgb(9, 9, 9)');
    await m.done();
  });

  test('one that has rendered before shows its picture (its blocks), at the height it had', async () => {
    ph.rememberPicture('a0', {
      bg: 'rgb(253, 246, 227)',
      blocks: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.25, c: 'rgb(120, 80, 220)' }],
      h: 420,
    });
    const m = await mount('?artboard-live=sleep', [{ id: 'a0' }]);
    const el = m.host.querySelector('[data-dc-placeholder]') as HTMLElement;
    expect(el.getAttribute('data-dc-placeholder')).toBe('picture');
    expect(el.style.backgroundColor).toBe('rgb(253, 246, 227)');
    expect(el.style.minHeight).toBe('420px');
    const block = el.querySelector('i') as HTMLElement;
    expect(block.style.left).toBe('10%');
    expect(block.style.width).toBe('50%');
    await m.done();
  });

  test('a capture (and a top-level headless page) shows no placeholder at all', async () => {
    for (const q of ['?hide-chrome=1&artboard-live=sleep', '?canvas=x.tsx', '?thumb-only=a0']) {
      gate.resetArtboardLive();
      const m = await mount(q, [{ id: 'a0' }, { id: 'a1' }]);
      expect(m.host.querySelectorAll('[data-dc-placeholder]')).toHaveLength(0);
      // a thumbnail render draws its one artboard
      expect(m.host.querySelectorAll('[data-body]')).toHaveLength(q.includes('thumb-only') ? 1 : 2);
      await m.done();
    }
  });
});
