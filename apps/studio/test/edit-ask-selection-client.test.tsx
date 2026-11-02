// S2.19 — the canvas half of ⌘/ on a selection (14 `ed-edge-ask`): what the canvas measures and posts, the
// chord, and the ONE outline an ask wears. The shell half is test/v2-ask-selection.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

let registeredHere = false;
beforeAll(async () => {
  if (typeof document === 'undefined') {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    GlobalRegistrator.register();
    registeredHere = true;
  }
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (registeredHere && GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { canvasKeyIndex, resolveCanvasKey } from '../actions/canvas-keys.ts';
import { AiScopeOutline, scopeRowsOf } from '../editing/ai-scope-outline.tsx';
import { ASK_SELECTION_ACTION, askPayload, locatorsOf, unionRect } from '../editing/ask-bubble.tsx';
import { HoldRings } from '../editing/hold-rings.tsx';
import { EDITING_ACTIONS } from '../editing/index.tsx';
import { SelectionSetProvider } from '../use-selection-set.tsx';

const box = (left: number, top: number, w: number, h: number) =>
  ({ left, top, right: left + w, bottom: top + h, width: w, height: h }) as DOMRect;

describe('unionRect / locatorsOf', () => {
  test('the box that holds every visible rect, whole numbers; none visible is null', () => {
    expect(unionRect([box(10.4, 20, 100, 50), box(200, 90, 40, 40)])).toEqual({
      x: 10,
      y: 20,
      w: 230,
      h: 110,
    });
    expect(unionRect([box(0, 0, 0, 0)])).toBeNull();
    expect(unionRect([])).toBeNull();
  });

  test('locators are short and carry no markup', () => {
    const l = locatorsOf([
      {
        id: 'card-a',
        tag: 'div',
        text: 'x'.repeat(500),
        selector: 's'.repeat(500),
        index: 2,
        html: '<script>',
      } as never,
    ]);
    expect(l[0].text?.length).toBe(120);
    expect(l[0].selector?.length).toBe(200);
    expect(Object.keys(l[0]).sort()).toEqual(['id', 'index', 'selector', 'tag', 'text']);
  });
});

describe('askPayload — what the canvas says on ⌘/', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div data-dc-screen="desktop">
      <div data-cd-id="card-a"></div><div data-cd-id="card-b"></div><div data-cd-id="card-c"></div></div>`;
    const rects: Record<string, DOMRect> = {
      'card-a': box(96, 644, 400, 232),
      'card-b': box(520, 644, 400, 232),
      'card-c': box(944, 644, 400, 232),
    };
    for (const el of document.querySelectorAll('[data-cd-id]'))
      (el as HTMLElement).getBoundingClientRect = () => rects[el.getAttribute('data-cd-id') ?? ''];
  });
  const sel = (id: string) =>
    ({ id, selector: `[data-cd-id="${id}"]`, artboardId: 'desktop', tag: 'div' }) as never;

  test('3 cards: their refs, their locators, and the box around all three', () => {
    const p = askPayload([sel('card-a'), sel('card-b'), sel('card-c')], document);
    expect(p?.refs).toEqual([
      { artboard: 'desktop', element: 'card-a' },
      { artboard: 'desktop', element: 'card-b' },
      { artboard: 'desktop', element: 'card-c' },
    ]);
    expect(p?.rect).toEqual({ x: 96, y: 644, w: 1248, h: 232 });
    expect(p?.selection.map((s) => s.id)).toEqual(['card-a', 'card-b', 'card-c']);
    // never a field the shell could mistake for words
    expect(Object.keys(p ?? {}).sort()).toEqual(['rect', 'refs', 'selection']);
  });

  test('nothing stamped selected (or nothing on screen) says nothing', () => {
    expect(askPayload([], document)).toBeNull();
    expect(askPayload([{ selector: 'div' } as never], document)).toBeNull();
    document.body.innerHTML = '';
    expect(askPayload([sel('card-a')], document)).toBeNull();
  });
});

describe('the chord — registry ai.ask-selection', () => {
  const KEYS = canvasKeyIndex([ASK_SELECTION_ACTION]);
  const slash = { key: '/', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };
  test('⌘/ with an object selected in Edit mode', () => {
    expect(resolveCanvasKey(KEYS, slash, false, 'edit', true, 'object')).toBe(ASK_SELECTION_ACTION);
  });
  test('not with nothing selected, in Preview, or typing in a field', () => {
    expect(resolveCanvasKey(KEYS, slash, false, 'edit', true, 'none')).toBeNull();
    expect(resolveCanvasKey(KEYS, slash, false, 'preview', true, 'object')).toBeNull();
    expect(resolveCanvasKey(KEYS, slash, true, 'edit', true, 'object')).toBeNull();
  });
  test('the editing layer runs it from ⌘K and the menu too', () => {
    expect((EDITING_ACTIONS as readonly string[]).includes(ASK_SELECTION_ACTION)).toBe(true);
  });
});

describe('scopeRowsOf', () => {
  test('the ask’s rows and the one tag they share', () => {
    const rows = [
      { artboard: 'a', element: 'x', tag: 'AI is working on 2 elements', mine: true, scope: true },
      { artboard: 'a', element: 'y', tag: 'AI is working on 2 elements', mine: true, scope: true },
      { artboard: 'a', element: 'z', tag: 'AI is working', mine: true },
    ];
    const r = scopeRowsOf(rows);
    expect(r.rows.map((x) => x.element)).toEqual(['x', 'y']);
    expect(r.tag).toBe('AI is working on 2 elements');
    expect(scopeRowsOf([rows[2]])).toEqual({ rows: [], tag: '' });
  });
});

describe('the outline an ask wears', () => {
  const sent: Array<Record<string, unknown>> = [];
  const parent = { postMessage: (m: Record<string, unknown>) => sent.push(m) };
  let realParent: PropertyDescriptor | undefined;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

  beforeEach(() => {
    sent.length = 0;
    realParent ??= Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { value: parent, configurable: true });
    document.body.innerHTML = `<div id="root"></div><div data-dc-screen="desktop">
      <div data-cd-id="card-a"></div><div data-cd-id="card-b"></div><div data-cd-id="lead"></div></div>`;
    const rects: Record<string, DOMRect> = {
      'card-a': box(100, 300, 200, 120),
      'card-b': box(320, 300, 200, 120),
      lead: box(100, 100, 400, 40),
    };
    for (const el of document.querySelectorAll('[data-cd-id]'))
      (el as HTMLElement).getBoundingClientRect = () => rects[el.getAttribute('data-cd-id') ?? ''];
  });

  const say = (holds: unknown[]) => {
    const ev = new MessageEvent('message', { data: { dgn: 'ai-holds', holds } });
    Object.defineProperty(ev, 'source', { value: parent });
    window.dispatchEvent(ev);
  };
  const rows = [
    {
      artboard: 'desktop',
      element: 'card-a',
      tag: 'AI is working on 2 elements',
      mine: true,
      scope: true,
    },
    {
      artboard: 'desktop',
      element: 'card-b',
      tag: 'AI is working on 2 elements',
      mine: true,
      scope: true,
    },
  ];

  test('one outline around the selection only, with its neutral tag, a skeleton each; the shell hears where', async () => {
    const root = createRoot(document.getElementById('root') as HTMLElement);
    await act(async () => {
      root.render(<AiScopeOutline />);
    });
    expect(document.querySelector('[data-testid="edit-ai-scope"]')).toBeNull();
    await act(async () => {
      say(rows);
    });
    await act(async () => {
      await frame();
      await frame();
    });
    const out = document.querySelector('[data-testid="edit-ai-scope"]') as HTMLElement;
    expect(out).not.toBeNull();
    expect(out.textContent).toBe('AI is working on 2 elements');
    // the union of the two cards, padded 8 — the lead line above them is outside it
    expect(out.style.left).toBe('92px');
    expect(out.style.top).toBe('292px');
    expect(out.style.width).toBe('436px');
    expect(out.style.height).toBe('136px');
    expect(document.querySelectorAll('[data-testid="edit-ai-scope-skeleton"]').length).toBe(2);
    const told = sent.filter((m) => m.dgn === 'ask-selection-rect');
    expect(told.at(-1)).toEqual({
      dgn: 'ask-selection-rect',
      rect: { x: 100, y: 300, w: 420, h: 120 },
    });
    // gone: the outline leaves and says so once
    await act(async () => {
      say([]);
    });
    await act(async () => {
      await frame();
    });
    expect(document.querySelector('[data-testid="edit-ai-scope"]')).toBeNull();
    expect(sent.filter((m) => m.dgn === 'ask-selection-rect').at(-1)).toEqual({
      dgn: 'ask-selection-rect',
      rect: null,
    });
    await act(async () => {
      root.unmount();
    });
  });

  test('the per-object rings skip the asked rows (one outline, not three rings) and keep the rest', async () => {
    const root = createRoot(document.getElementById('root') as HTMLElement);
    await act(async () => {
      root.render(
        <SelectionSetProvider postTarget={null}>
          <HoldRings />
        </SelectionSetProvider>
      );
    });
    await act(async () => {
      say([...rows, { artboard: 'desktop', element: 'lead', tag: 'AI is working', mine: true }]);
    });
    await act(async () => {
      await frame();
    });
    const rings = document.querySelectorAll('[data-testid="edit-ai-hold"]');
    expect(rings.length).toBe(1);
    expect(rings[0].getAttribute('data-element')).toBe('lead');
    await act(async () => {
      root.unmount();
    });
    if (realParent) Object.defineProperty(window, 'parent', realParent);
  });
});
