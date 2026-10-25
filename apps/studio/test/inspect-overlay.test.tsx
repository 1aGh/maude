// S3.11 — the canvas half of Inspect, mounted: the size tag, no handles, ↵ asks for Edit, and measure is off
// in Present. Real overlays and stores; only the parent window is faked.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof document === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { askEditFromInspect, InspectOverlay, measureNeighbour } from '../inspect-overlay.tsx';
import { MeasureOverlay } from '../measure-overlay.tsx';
import { type Selection, SelectionSetProvider, useSelectionSet } from '../use-selection-set.tsx';

const posts: Array<Record<string, unknown>> = [];
const fakeParent = { postMessage: (m: Record<string, unknown>) => posts.push(m) };
let realParent: PropertyDescriptor | undefined;
const EDITOR = { edit: true, annotate: true, comment: true };
const COMMENTER = { edit: false, annotate: false, comment: true };
let seq = 0;

const setMode = (mode: string, caps = EDITOR, present: unknown = null) =>
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        source: fakeParent as unknown as Window,
        data: { dgn: 'set-mode', v: 2, seq: ++seq + 1000, mode, present, caps },
      })
    );
  });

let roots: Root[] = [];
let setSel: ((s: Selection | null) => void) | null = null;
function Seed() {
  const s = useSelectionSet();
  setSel = (x) => (x ? s.replace(x) : s.clear());
  return null;
}
function mount(ui: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const r = createRoot(host);
  roots.push(r);
  act(() =>
    r.render(
      <SelectionSetProvider postTarget={null}>
        {ui}
        <Seed />
      </SelectionSetProvider>
    )
  );
}
const rect = (x: number, y: number, w: number, h: number) =>
  ({
    left: x,
    top: y,
    right: x + w,
    bottom: y + h,
    width: w,
    height: h,
    x,
    y,
    toJSON() {},
  }) as DOMRect;
function design() {
  document.body.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.innerHTML =
    '<nav><a data-cd-id="about">About</a><button data-cd-id="book">Book a call</button></nav>';
  document.body.append(wrap);
  const about = wrap.querySelector('[data-cd-id="about"]') as HTMLElement;
  const book = wrap.querySelector('[data-cd-id="book"]') as HTMLElement;
  about.getBoundingClientRect = () => rect(6, 30, 46, 28);
  book.getBoundingClientRect = () => rect(100, 20, 150, 48);
  return { about, book };
}
const sel = (id: string): Selection =>
  ({ id, selector: `[data-cd-id="${id}"]`, index: 0 }) as Selection;
const frames = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));
const tag = () => document.querySelector('.dc-cv-inspect-tag') as HTMLElement | null;
const enter = () =>
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
    );
  });
const requests = () => posts.filter((m) => m.dgn === 'mode-request');

describe('Inspect on the canvas', () => {
  beforeAll(() => {
    realParent = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { configurable: true, get: () => fakeParent });
  });
  afterAll(() => {
    if (realParent) Object.defineProperty(window, 'parent', realParent);
  });
  afterEach(() => {
    act(() => {
      for (const r of roots) r.unmount();
    });
    roots = [];
    posts.length = 0;
    document.body.removeAttribute('data-maude-inspect');
  });

  test('Preview: a selection shows the size tag in world px and drops the outline’s corner ticks', async () => {
    design();
    mount(<InspectOverlay />);
    setMode('preview');
    act(() => setSel?.(sel('book')));
    await frames();
    expect(tag()?.dataset.on).toBe('true');
    expect(tag()?.textContent).toBe('150 × 48');
    expect(document.body.getAttribute('data-maude-inspect')).toBe('true');
  });

  test('Edit: no tag, no ticks removed — the Inspector has its own handles', async () => {
    design();
    mount(<InspectOverlay />);
    setMode('edit');
    act(() => setSel?.(sel('book')));
    await frames();
    expect(tag()?.dataset.on).toBe('false');
    expect(document.body.hasAttribute('data-maude-inspect')).toBe(false);
  });

  test('↵ in Preview asks the shell for Edit, cause inspect — the same element stays selected', async () => {
    design();
    mount(<InspectOverlay />);
    setMode('preview');
    act(() => setSel?.(sel('book')));
    await frames();
    enter();
    expect(requests()).toEqual([{ dgn: 'mode-request', mode: 'edit', cause: 'inspect' }]);
  });

  test('↵ with nothing inspected, in Edit, or in Viewing (no Edit to go to) asks for nothing', async () => {
    design();
    mount(<InspectOverlay />);
    setMode('preview');
    await frames();
    enter(); // nothing selected
    setMode('edit');
    act(() => setSel?.(sel('book')));
    await frames();
    enter();
    setMode('viewing', COMMENTER);
    await frames();
    enter();
    expect(requests()).toEqual([]);
    expect(askEditFromInspect()).toBe(false);
  });

  test('a focused control inside the design keeps its own ↵', async () => {
    const { book } = design();
    mount(<InspectOverlay />);
    setMode('preview');
    act(() => setSel?.(sel('book')));
    await frames();
    act(() => {
      book.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(requests()).toEqual([]);
  });

  test('measureNeighbour names the sibling and the gap in world px', () => {
    const { book } = design();
    expect(measureNeighbour(book)).toEqual({ name: 'About', gap: 48, side: 'left' });
  });
});

describe('measure follows modeShows', () => {
  beforeAll(() => {
    realParent = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { configurable: true, get: () => fakeParent });
  });
  afterAll(() => {
    if (realParent) Object.defineProperty(window, 'parent', realParent);
  });
  afterEach(() => {
    act(() => {
      for (const r of roots) r.unmount();
    });
    roots = [];
  });

  const countPointerListeners = (fn: () => void): number => {
    const real = document.addEventListener.bind(document);
    let n = 0;
    document.addEventListener = ((t: string, ...rest: unknown[]) => {
      if (t === 'pointermove') n++;
      return (real as (...a: unknown[]) => void)(t, ...rest);
    }) as typeof document.addEventListener;
    try {
      fn();
    } finally {
      document.addEventListener = real;
    }
    return n;
  };

  test('on in Edit, Preview and Viewing; off in Present (no Alt tracking at all)', () => {
    design();
    const seen: Record<string, number> = {};
    for (const [mode, caps, present] of [
      ['edit', EDITOR, null],
      ['preview', EDITOR, null],
      ['viewing', COMMENTER, null],
      ['present', EDITOR, { kind: 'canvas' }],
    ] as const) {
      setMode(mode, caps, present);
      seen[mode] = countPointerListeners(() => mount(<MeasureOverlay />));
      act(() => {
        for (const r of roots) r.unmount();
      });
      roots = [];
    }
    expect(seen).toEqual({ edit: 1, preview: 1, viewing: 1, present: 0 });
  });
});

describe('P8 c7 (10 co-comment-print): the size tag is AA, not white on a hard-coded light blue', () => {
  test('the tag draws from the HUD tokens; its fallback is a blue that white text reads on', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../inspect-overlay.tsx', import.meta.url), 'utf8');
    const css = src.slice(src.indexOf('.dc-cv-inspect-tag {'), src.indexOf('.dc-cv-inspect-tag[data-on'));
    expect(css).not.toContain('#0d99ff');
    expect(css).toContain('var(--maude-hud-accent-fg');
  });
});
