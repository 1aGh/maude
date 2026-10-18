// S2.11 (artboards ed-lay-auto · ed-lay-reorder · ed-lay-free) — the canvas half of layout: the gap
// and padding bands, the token ruler a gap drag shows, the reorder slot and its two special drops
// (⌥ copy, out of the frame), Place freely and the pin guides, the arrow keys, the registry rows.
// The writers are test/edit-ops-layout.test.ts.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ACTIONS_BY_ID } from '../actions/index.ts';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import { LayerRow } from '../client/inspector/layers.jsx';
import { layersSlot, withSlot } from '../client/v2/inspector/layers-slot.jsx';
import type { EditOpResult } from '../edit-ops/types.ts';
import { computeBands } from '../editing/gap-bands.tsx';
import { EDITING_ACTIONS } from '../editing/index.tsx';
import {
  isConstrainAction,
  isLayoutAction,
  NEEDS_FRAME_LINE,
  NEEDS_ONE_LINE,
  reorderKeyAction,
  runConstrainAction,
  runLayoutAction,
} from '../editing/layout-actions.ts';
import {
  ALREADY_FREE_LINE,
  constrain,
  isPlacedFreely,
  measurePlacement,
  pinGuides,
  pinnedEdges,
  placeBox,
  placeFreely,
} from '../editing/place-freely.tsx';
import {
  outsideFrame,
  panelMotion,
  placeAmong,
  ReorderSlot,
  reorderSlot,
  SLOT_CSS,
  slotLine,
  slotMessage,
  slotRect,
  takeOver,
  translateOf,
} from '../editing/reorder-slot.tsx';
import {
  gapValue,
  RULER_HINT,
  rulerWindow,
  snapToStop,
  spaceNames,
  stopsFromValues,
  TokenRuler,
  tokenRuler,
} from '../editing/token-ruler.tsx';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  tokenRuler.hide();
  reorderSlot.end();
  document.body.innerHTML = '';
});

const mount = async (node: React.ReactNode) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return host;
};

const OK: EditOpResult = { ok: true, actionId: null, writeId: 'w1', rev: 'r', refs: [] };

describe('the registry rows', () => {
  test('Place freely, move earlier / later and Convert are canvas actions for Can edit', () => {
    for (const id of [
      'object.place-freely',
      'object.reorder-earlier',
      'object.reorder-later',
      'object.reorder-to',
      'object.constrain',
      'layout.convert-to-absolute',
    ]) {
      const def = ACTIONS_BY_ID.get(id as never);
      expect(def, id).toBeTruthy();
      expect(def?.exec).toBe('canvas');
      expect(def?.enabled?.minRole).toBe('edit');
    }
    // the two with params belong to a gesture, not to ⌘K
    expect(ACTIONS_BY_ID.get('object.reorder-to' as never)?.search?.hidden).toBe(true);
    expect(ACTIONS_BY_ID.get('object.constrain' as never)?.search?.hidden).toBe(true);
    expect(ACTIONS_BY_ID.get('object.place-freely' as never)?.label).toBe('Place freely');
  });

  test('the editing layer answers the four it runs', () => {
    for (const id of [
      'object.place-freely',
      'object.reorder-earlier',
      'object.reorder-later',
      'layout.convert-to-absolute',
    ]) {
      expect(isLayoutAction(id), id).toBe(true);
      expect((EDITING_ACTIONS as readonly string[]).includes(id), id).toBe(true);
    }
    expect(isLayoutAction('object.rotate')).toBe(false);
  });
});

describe('the token ruler: stops from the system', () => {
  const SCALE = stopsFromValues(['4px', '8px', '12px', '16px', '24px', '32px', '48px', '64px']);

  test('stops are the system’s own, ascending, distinct; rem counts; a calc() is skipped', () => {
    expect(stopsFromValues(['24px', '1.5rem', '8px', 'calc(1px + 2px)', '', '8px'])).toEqual([
      8, 24,
    ]);
  });

  test('the ruler shows five stops around where the gap is: 12 · 16 · 24 · 32 · 48', () => {
    expect(rulerWindow(SCALE, 24)).toEqual([12, 16, 24, 32, 48]);
    expect(rulerWindow(SCALE, 4)).toEqual([4, 8, 12, 16, 24]);
    expect(rulerWindow(SCALE, 64)).toEqual([16, 24, 32, 48, 64]);
    expect(rulerWindow([8, 16], 12)).toEqual([8, 16]);
  });

  test('the drag clicks onto a stop; ⌘ takes any number; a system with no scale stays free', () => {
    expect(gapValue(27, SCALE, false)).toBe(24);
    expect(gapValue(29, SCALE, false)).toBe(32);
    expect(gapValue(27.4, SCALE, true)).toBe(27.4);
    expect(gapValue(27.4, [], false)).toBe(27.4);
    expect(gapValue(-9, SCALE, false)).toBe(4); // never below the smallest stop
    expect(snapToStop(20, [16, 24])).toBe(16); // a tie goes to the lower one
  });

  test('the space names are read from the sheets the canvas loaded (--space-*), nothing built in', () => {
    const doc = {
      styleSheets: [
        {
          cssRules: [
            { style: { length: 3, 0: '--space-4', 1: 'color', 2: '--space-24' } },
            { style: { length: 0 }, cssRules: [{ style: { length: 1, 0: '--space-8' } }] },
          ],
        },
        {
          get cssRules(): never {
            throw new Error('cross-origin');
          },
        },
      ],
    } as unknown as Document;
    expect(spaceNames(doc).sort()).toEqual(['--space-24', '--space-4', '--space-8']);
  });

  test('the ruler draws the stops with the current one lit and the hint beneath', async () => {
    await mount(<TokenRuler />);
    expect(document.querySelector('[data-testid="edit-token-ruler"]')).toBeNull();
    await act(async () =>
      tokenRuler.show({
        x: 500,
        y: 300,
        stops: [12, 16, 24, 32, 48],
        on: 24,
        value: 24,
        free: false,
        all: false,
      })
    );
    const ruler = document.querySelector('[data-testid="edit-token-ruler"]') as HTMLElement;
    expect(ruler).toBeTruthy();
    const stops = [...ruler.querySelectorAll('[data-testid^="edit-token-ruler-stop-"]')];
    expect(stops.map((e) => e.textContent)).toEqual(['12', '16', '24', '32', '48']);
    expect(
      stops.filter((e) => e.getAttribute('data-on') === 'true').map((e) => e.textContent)
    ).toEqual(['24']);
    expect(ruler.querySelector('[data-testid="edit-token-ruler-hint"]')?.textContent).toBe(
      RULER_HINT
    );
    expect(RULER_HINT).toBe('⌘ any number · ⌥ every gap at once');
    // ⌘ held: no stop is lit, the number it is right now is
    await act(async () =>
      tokenRuler.show({
        x: 500,
        y: 300,
        stops: [12, 16, 24, 32, 48],
        on: null,
        value: 27,
        free: true,
        all: false,
      })
    );
    expect(document.querySelector('[data-testid="edit-token-ruler-free"]')?.textContent).toBe('27');
    expect(
      document.querySelectorAll('[data-testid^="edit-token-ruler-stop-"][data-on="true"]').length
    ).toBe(0);
    await act(async () => tokenRuler.hide());
    expect(document.querySelector('[data-testid="edit-token-ruler"]')).toBeNull();
  });
});

describe('the gap and padding bands (Services: 3 cards, gap 24, padding 24)', () => {
  const frame = { left: 72, top: 620, width: 1296, height: 280 };
  const card = (i: number) => ({ left: 96 + i * 424, top: 644, width: 400, height: 232 });
  const row = computeBands(
    frame,
    [card(0), card(1), card(2)],
    { top: 24, right: 24, bottom: 24, left: 24 },
    'x',
    1
  );

  test('one band per gap, exactly the gap wide, as tall as the cards, chipped "24"', () => {
    const gaps = row.filter((b) => b.kind === 'gap');
    expect(gaps.map((b) => [b.left, b.width, b.top, b.height, b.label])).toEqual([
      [496, 24, 644, 232, '24'],
      [920, 24, 644, 232, '24'],
    ]);
  });

  test('the padding is a band along each edge; the top and left carry the chip', () => {
    const pad = Object.fromEntries(row.filter((b) => b.kind === 'padding').map((b) => [b.key, b]));
    expect(pad.top).toMatchObject({ left: 72, top: 620, width: 1296, height: 24, label: '24' });
    expect(pad.left).toMatchObject({ left: 72, top: 644, width: 24, height: 232, label: '24' });
    expect(pad.bottom).toMatchObject({ top: 876, height: 24, label: '' });
    expect(pad.right).toMatchObject({ left: 1344, width: 24, label: '' });
  });

  test('zoom is divided out of the chips; a column measures along y', () => {
    const half = computeBands(
      { left: 0, top: 0, width: 200, height: 220 },
      [
        { left: 12, top: 12, width: 176, height: 60 },
        { left: 12, top: 84, width: 176, height: 60 },
      ],
      { top: 12, right: 12, bottom: 12, left: 12 },
      'y',
      0.5
    );
    const gap = half.find((b) => b.kind === 'gap');
    expect(gap).toMatchObject({ top: 72, height: 12, left: 12, width: 176, label: '24' });
  });

  test('children that touch or overlap have no gap band', () => {
    const none = computeBands(
      frame,
      [
        { left: 0, top: 0, width: 50, height: 10 },
        { left: 50, top: 0, width: 50, height: 10 },
      ],
      { top: 0, right: 0, bottom: 0, left: 0 },
      'x',
      1
    );
    expect(none.filter((b) => b.kind === 'gap')).toEqual([]);
  });
});

describe('the reorder slot', () => {
  test('the tag says where the card lands; ⌥ says a copy; leaving the frame says placed freely', () => {
    const base = { name: 'Small apps', index: 1, total: 3, copy: false, out: false };
    expect(slotLine(base)).toBe('Small apps · moves to 1 of 3');
    expect(slotLine({ ...base, copy: true })).toBe('Small apps · a copy goes to 1 of 3');
    expect(slotLine({ ...base, out: true })).toBe('Small apps · placed freely');
  });

  test('the slot is the card’s own layout box: the float’s transform taken off, zoom included', () => {
    expect(translateOf('translate(120px, -40px)')).toEqual([120, -40]);
    expect(translateOf('none')).toEqual([0, 0]);
    expect(
      slotRect({ left: 500, top: 300, width: 400, height: 232 }, 'translate(100px, -20px)', 2)
    ).toEqual({
      left: 300,
      top: 340,
      width: 400,
      height: 232,
    });
  });

  test('outside the frame needs more than a wobble', () => {
    const f = { left: 100, top: 100, width: 300, height: 200 };
    expect(outsideFrame(395, 150, f)).toBe(false);
    expect(outsideFrame(420, 150, f)).toBe(true);
    expect(outsideFrame(250, 80, f)).toBe(true);
  });

  test('neighbours slide on --dur-panel with --ease-out; fallbacks when the canvas has neither', () => {
    expect(panelMotion().ms).toBe(220);
    document.documentElement.style.setProperty('--dur-panel', '0.3s');
    document.documentElement.style.setProperty('--ease-out', 'cubic-bezier(0, 0, 0.2, 1)');
    expect(panelMotion()).toEqual({ ms: 300, easing: 'cubic-bezier(0, 0, 0.2, 1)' });
    document.documentElement.style.removeProperty('--dur-panel');
    document.documentElement.style.removeProperty('--ease-out');
  });

  test('reduced motion: the slot fades in (opacity), it is not switched off', () => {
    expect(SLOT_CSS).toContain('animation: ed-slot-fade var(--dur-panel');
    expect(SLOT_CSS).toContain('var(--ease-out');
    const reduced = SLOT_CSS.slice(SLOT_CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('animation-name: ed-slot-fade');
    expect(reduced).not.toContain('animation: none');
    expect(reduced).not.toContain('animation-duration: 1ms');
  });

  const tree = () => {
    document.body.innerHTML = `
      <article data-dc-screen="desktop"><div class="dc-artboard-body">
        <section data-cd-id="services" style="display:flex">
          <div data-cd-id="apps" aria-label="Small apps"></div>
          <div data-cd-id="product" aria-label="Product design"></div>
          <div data-cd-id="brand" aria-label="Brand systems"></div>
          <div data-cd-id="badge" style="position:absolute"></div>
        </section>
      </div></article>`;
    const q = (id: string) => document.querySelector(`[data-cd-id="${id}"]`) as HTMLElement;
    return { q };
  };

  test('its place among the siblings that take part in the layout', () => {
    const { q } = tree();
    expect(placeAmong(q('apps'))).toEqual({ index: 1, total: 3 });
    expect(placeAmong(q('brand'))).toEqual({ index: 3, total: 3 });
  });

  test('the store: ⌥ makes it a copy; out only over empty space', () => {
    const { q } = tree();
    reorderSlot.begin(q('apps'), q('services'));
    q('services').getBoundingClientRect = () =>
      ({
        left: 100,
        top: 100,
        width: 300,
        height: 200,
        right: 400,
        bottom: 300,
        x: 100,
        y: 100,
        toJSON() {},
      }) as DOMRect;
    reorderSlot.move(250, 150, true, false);
    expect(reorderSlot.get()).toMatchObject({ copy: true, out: false });
    reorderSlot.move(700, 150, false, false);
    expect(reorderSlot.get()).toMatchObject({ copy: false, out: true });
    // over another object the v1 drop (move out / into it) stands
    reorderSlot.move(700, 150, false, true);
    expect(reorderSlot.get()?.out).toBe(false);
    expect(reorderSlot.end()?.el).toBe(q('apps'));
    expect(reorderSlot.get()).toBeNull();
  });

  test('the layer draws the numbered slot and the tag, and nothing when no card is lifted', async () => {
    const { q } = tree();
    await mount(<ReorderSlot />);
    expect(document.querySelector('[data-testid="edit-reorder-slot"]')).toBeNull();
    await act(async () => reorderSlot.begin(q('apps'), q('services')));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    const slot = document.querySelector('[data-testid="edit-reorder-slot"]') as HTMLElement;
    expect(slot?.getAttribute('data-n')).toBe('1');
    expect(document.querySelector('[data-testid="edit-reorder-slot-n"]')?.textContent).toBe('1');
    expect(document.querySelector('[data-testid="edit-reorder-tag"]')?.textContent).toBe(
      'Small apps · moves to 1 of 3'
    );
    await act(async () => {
      reorderSlot.end();
    });
    expect(document.querySelector('[data-testid="edit-reorder-slot"]')).toBeNull();
  });
});

describe('the slot reaches Layers (S2.11b: dgn reorder-slot)', () => {
  const parse = (raw: Record<string, unknown>) =>
    (
      DGN_TABLE.c2s as unknown as Record<string, { parse: (r: Record<string, unknown>) => unknown }>
    )['reorder-slot']?.parse(raw);
  test('the row is parent-gated and keeps index, total and the frame’s id — nothing else', () => {
    expect(parse({ index: 2, total: 3, parentId: 'services', junk: 1 })).toEqual({
      index: 2,
      total: 3,
      parentId: 'services',
    });
    // index 0 = no slot (the drag ended); the frame may be unstamped
    expect(parse({ index: 0, total: 0 })).toEqual({ index: 0, total: 0 });
    expect((DGN_TABLE.c2s as Record<string, { gate: string }>)['reorder-slot']?.gate).toBe(
      'active'
    );
  });
  test('whole numbers in bounds, a slot inside its total, an id that fits the grammar — else dropped', () => {
    for (const bad of [
      { index: 1.5, total: 3, parentId: 'a' },
      { index: -1, total: 3, parentId: 'a' },
      { index: 10001, total: 10001, parentId: 'a' },
      { index: 4, total: 3, parentId: 'a' },
      { index: 1, total: 3 }, // a slot to draw names its frame
      { index: 1, total: 3, parentId: 'has space' },
      { index: 1, total: 3, parentId: '../x' },
      { index: 1, total: 3, parentId: 'a'.repeat(65) },
      { total: 3, parentId: 'a' },
      { index: '2', total: 3, parentId: 'a' },
    ])
      expect(parse(bad), JSON.stringify(bad)).toBeNull();
  });
  test('slotMessage: the place among its siblings and the frame it was lifted from; null = ended', () => {
    document.body.innerHTML = `<section data-cd-id="services" style="display:flex"><i data-cd-id="a"></i><i data-cd-id="b"></i></section>`;
    const b = document.querySelector('[data-cd-id="b"]') as HTMLElement;
    const frame = document.querySelector('[data-cd-id="services"]') as HTMLElement;
    expect(slotMessage({ el: b, frame, copy: false, out: false })).toEqual({
      dgn: 'reorder-slot',
      index: 2,
      total: 2,
      parentId: 'services',
    });
    expect(slotMessage({ el: b, frame: null, copy: false, out: false })).toMatchObject({
      index: 2,
    });
    expect(slotMessage(null)).toEqual({ dgn: 'reorder-slot', index: 0, total: 0 });
  });
  test('the canvas tells the shell while the card moves, and when it lets go', async () => {
    document.body.innerHTML = `<article data-dc-screen="desktop"><div class="dc-artboard-body"><section data-cd-id="services" style="display:flex"><div data-cd-id="apps"></div><div data-cd-id="product"></div><div data-cd-id="brand"></div></section></div></article>`;
    const q = (id: string) => document.querySelector(`[data-cd-id="${id}"]`) as HTMLElement;
    const sent: unknown[] = [];
    const real = window.parent.postMessage;
    window.parent.postMessage = ((m: unknown) => sent.push(m)) as never;
    try {
      await mount(<ReorderSlot />);
      await act(async () => reorderSlot.begin(q('apps'), q('services')));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 40));
      });
      expect(sent).toContainEqual({
        dgn: 'reorder-slot',
        index: 1,
        total: 3,
        parentId: 'services',
      });
      // the card settles in the middle: the same slot is not re-sent, the new one is
      q('services').insertBefore(q('apps'), q('brand'));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 40));
      });
      expect(sent).toContainEqual({
        dgn: 'reorder-slot',
        index: 2,
        total: 3,
        parentId: 'services',
      });
      await act(async () => {
        reorderSlot.end();
      });
      expect(sent[sent.length - 1]).toEqual({ dgn: 'reorder-slot', index: 0, total: 0 });
    } finally {
      window.parent.postMessage = real;
    }
  });
  test('Layers: the numbered slot opens inside the frame’s children at the same place', async () => {
    const nodes = [
      {
        id: 'services',
        index: 0,
        label: 'Services',
        type: 'box',
        tag: 'section',
        children: [
          { id: 'apps', index: 0, label: 'Small apps', type: 'box', tag: 'div' },
          { id: 'product', index: 0, label: 'Product', type: 'box', tag: 'div' },
          { id: 'brand', index: 0, label: 'Brand', type: 'box', tag: 'div' },
        ],
      },
    ];
    // nothing lifted, nothing drawn; an unknown frame draws nothing either
    expect(withSlot(nodes, null)).toBe(nodes);
    expect(withSlot(nodes, { index: 2, total: 3, parentId: 'nope' })).toBe(nodes);
    const withIt = withSlot(nodes, { index: 2, total: 3, parentId: 'services' });
    expect(withIt[0]?.children?.map((c: { id: string }) => c.id)).toEqual([
      'apps',
      '__slot__',
      'product',
      'brand',
    ]);
    expect(nodes[0]?.children?.length).toBe(3); // the tree itself is not touched
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        <div role="tree">
          {withIt.map((n: { id: string }) => (
            <LayerRow
              key={n.id}
              node={n as never}
              depth={0}
              collapsed={new Set()}
              onToggle={() => {}}
              onSelect={() => {}}
              onHover={() => {}}
            />
          ))}
        </div>
      )
    );
    const slot = host.querySelector('[data-testid="layers-slot"]') as HTMLElement;
    expect(slot?.getAttribute('data-n')).toBe('2');
    expect(slot?.textContent).toContain('2');
    // second among the frame's rows: after "Small apps", before "Product"
    const order = [...host.querySelectorAll('[data-layer-key], [data-testid="layers-slot"]')].map(
      (e) => e.getAttribute('data-layer-key') ?? 'slot'
    );
    expect(order).toEqual(['services:0', 'apps:0', 'slot', 'product:0', 'brand:0']);
  });
  test('the store holds the last slot the canvas sent and forgets it at index 0', () => {
    layersSlot.set({ index: 2, total: 3, parentId: 'services' });
    expect(layersSlot.get()).toEqual({ index: 2, total: 3, parentId: 'services' });
    layersSlot.set({ index: 0, total: 0 });
    expect(layersSlot.get()).toBeNull();
  });
});

describe('the drops that are not the v1 write', () => {
  const tree = () => {
    document.body.innerHTML = `
      <article data-dc-screen="desktop"><div class="dc-artboard-body">
        <section data-cd-id="services" style="display:flex">
          <div data-cd-id="apps"></div><div data-cd-id="product"></div><div data-cd-id="brand"></div>
        </section>
      </div></article>`;
    return (id: string) => document.querySelector(`[data-cd-id="${id}"]`) as HTMLElement;
  };
  const rect = { left: 0, top: 0, width: 0, height: 0 };

  test('⌥ at the drop: one reorder-to with copy, the neighbour as the second target, one revert record', async () => {
    const q = tree();
    const asks: unknown[] = [];
    const recs: unknown[] = [];
    const took = takeOver(
      {
        el: q('brand'),
        floatRect: rect,
        ref: q('apps'),
        position: 'before',
        altKey: true,
        out: false,
      },
      { run: async (a) => (asks.push(a), OK), record: (r) => recs.push(r) }
    );
    expect(took).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(asks).toEqual([
      {
        op: 'object.reorder-to',
        targets: [
          { artboard: 'desktop', element: 'brand' },
          { artboard: 'desktop', element: 'apps' },
        ],
        params: { position: 'before', copy: true },
      },
    ]);
    expect(recs.length).toBe(1);
  });

  test('without ⌥ and inside the frame, the v1 drop carries on (takeOver returns false)', () => {
    const q = tree();
    expect(
      takeOver(
        {
          el: q('brand'),
          floatRect: rect,
          ref: q('apps'),
          position: 'before',
          altKey: false,
          out: false,
        },
        {}
      )
    ).toBe(false);
    expect(
      takeOver(
        { el: q('brand'), floatRect: rect, ref: null, position: null, altKey: true, out: false },
        {}
      )
    ).toBe(false);
  });

  test('a drop out of the frame asks Place freely, with the frame as the second target when it is static', async () => {
    const q = tree();
    const asks: Array<{ op: string; targets: unknown[]; params: Record<string, unknown> }> = [];
    const took = takeOver(
      {
        el: q('apps'),
        floatRect: { left: 10, top: 20, width: 40, height: 30 },
        ref: null,
        position: null,
        altKey: false,
        out: true,
      },
      { run: async (a) => (asks.push(a as never), OK) }
    );
    expect(took).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(asks.length).toBe(1);
    expect(asks[0]?.op).toBe('object.place-freely');
    expect(asks[0]?.targets).toEqual([
      { artboard: 'desktop', element: 'apps' },
      { artboard: 'desktop', element: 'services' },
    ]);
    expect(asks[0]?.params).toMatchObject({ x: 10, y: 20, w: 40, h: 30, relativeParent: true });
  });
});

describe('Place freely: measuring', () => {
  const box = (over: Partial<Parameters<typeof placeBox>[0]> = {}) =>
    placeBox({
      child: { left: 120, top: 150, width: 400, height: 232 },
      frame: { left: 96, top: 126, width: 1296, height: 280 },
      frameBorder: { left: 0, top: 0 },
      margin: { left: 0, top: 0 },
      scale: 1,
      boxSizing: 'border-box',
      padBorder: { w: 0, h: 0 },
      ...over,
    });

  test('X and Y are the card’s margin edge inside the frame; W and H are its box', () => {
    expect(box()).toEqual({ x: 24, y: 24, w: 400, h: 232 });
  });

  test('the zoom is divided out, the frame’s border and the card’s margin come off', () => {
    expect(
      box({
        child: { left: 52.5, top: 67, width: 200, height: 116 },
        frame: { left: 48, top: 63, width: 648, height: 140 },
        scale: 0.5,
        frameBorder: { left: 1, top: 1 },
        margin: { left: 8, top: 8 },
      })
    ).toEqual({ x: 0, y: -1, w: 400, h: 232 });
  });

  test('a content-box width excludes padding and border', () => {
    expect(box({ boxSizing: 'content-box', padBorder: { w: 32, h: 16 } })).toMatchObject({
      w: 368,
      h: 216,
    });
  });

  test('already placed freely is told so and nothing is asked', async () => {
    document.body.innerHTML = `<article data-dc-screen="a"><div class="dc-artboard-body"><i data-cd-id="d" style="position:absolute"></i></div></article>`;
    const el = document.querySelector('[data-cd-id="d"]') as HTMLElement;
    expect(isPlacedFreely(getComputedStyle(el).position)).toBe(true);
    const said: string[] = [];
    let asked = 0;
    expect(
      await placeFreely(el, { toast: (m) => said.push(m), run: async () => (asked++, OK) })
    ).toBeNull();
    expect(said).toEqual([ALREADY_FREE_LINE]);
    expect(asked).toBe(0);
  });

  test('a card directly in the artboard needs no pin on a frame', () => {
    document.body.innerHTML = `<article data-dc-screen="a"><div class="dc-artboard-body"><i data-cd-id="d"></i></div></article>`;
    const m = measurePlacement(document.querySelector('[data-cd-id="d"]') as HTMLElement);
    expect(m?.relativeFrame).toBeNull();
  });

  test('a refusal is one toast in the server’s words and nothing is recorded', async () => {
    document.body.innerHTML = `<article data-dc-screen="a"><div class="dc-artboard-body"><div data-cd-id="f"><i data-cd-id="d"></i></div></div></article>`;
    const el = document.querySelector('[data-cd-id="d"]') as HTMLElement;
    const said: string[] = [];
    const recs: unknown[] = [];
    await placeFreely(el, {
      run: async () => ({ ok: false, code: 'locked', message: 'Logo is locked · ⇧⌘L unlocks' }),
      toast: (m) => said.push(m),
      record: (r) => recs.push(r),
    });
    expect(said).toEqual(['Logo is locked · ⇧⌘L unlocks']);
    expect(recs).toEqual([]);
  });

  test('constrain asks for the pins and the measured geometry in one request', async () => {
    const asks: unknown[] = [];
    await constrain(
      { artboard: 'post', element: 'datum' },
      { h: 'right', v: 'top' },
      { x: 800, y: 64, w: 216, h: 216, parentW: 1080, parentH: 1080 },
      { run: async (a) => (asks.push(a), OK) }
    );
    expect(asks).toEqual([
      {
        op: 'object.constrain',
        targets: [{ artboard: 'post', element: 'datum' }],
        params: {
          h: 'right',
          v: 'top',
          geometry: { x: 800, y: 64, w: 216, h: 216, parentW: 1080, parentH: 1080 },
        },
      },
    ]);
  });
});

describe('the Position row’s pins arrive as run-action object.constrain (S2.11b)', () => {
  const GEO = { x: 800, y: 64, w: 216, h: 216, parentW: 1080, parentH: 1080 };
  test('the editing layer answers it, and the registry row is the one it runs', () => {
    expect((EDITING_ACTIONS as readonly string[]).includes('object.constrain')).toBe(true);
    expect(isConstrainAction('object.constrain')).toBe(true);
    expect(isConstrainAction('object.rotate')).toBe(false);
  });
  test('Right + Bottom with the measured geometry: ONE object.constrain, one undo record', async () => {
    const asks: Array<{ op: string; targets: unknown[]; params: unknown }> = [];
    const recs: unknown[] = [];
    await runConstrainAction(
      {
        targets: [{ artboard: 'post', element: 'datum' }],
        h: 'right',
        v: 'bottom',
        geometry: GEO,
      },
      [],
      { run: async (a) => (asks.push(a as never), OK), record: (r) => recs.push(r) }
    );
    expect(asks).toEqual([
      {
        op: 'object.constrain',
        targets: [{ artboard: 'post', element: 'datum' }],
        params: { h: 'right', v: 'bottom', geometry: GEO },
      },
    ]);
    expect(recs.length).toBe(1);
  });
  test('no targets means the selection; a bad pin or an unmeasured object asks nothing and says so', async () => {
    const asks: unknown[] = [];
    const said: string[] = [];
    const deps = {
      run: async (a: unknown) => (asks.push(a), OK),
      toast: (m: string) => said.push(m),
    };
    const sel = [{ id: 'datum', artboardId: 'post', selector: '[data-cd-id="datum"]' }];
    await runConstrainAction({ h: 'right', v: 'top', geometry: GEO }, sel, deps);
    expect(asks.length).toBe(1);
    await runConstrainAction({ h: 'diagonal', v: 'top', geometry: GEO }, sel, deps);
    await runConstrainAction({ h: 'right', v: 'top', geometry: { ...GEO, w: 'x' } }, sel, deps);
    await runConstrainAction({ h: 'right', v: 'top', geometry: GEO }, [], deps);
    expect(asks.length).toBe(1);
    expect(said.length).toBe(3);
  });
});

describe('the pin guides (Datum keeps 64 from the corner)', () => {
  test('a pinned edge is a declaration in the style', () => {
    expect(pinnedEdges({ left: '', right: '64px', top: '64px', bottom: 'auto' })).toEqual({
      left: false,
      right: true,
      top: true,
      bottom: false,
    });
  });

  test('Right + Top: one guide to each edge, "64" on both, at 0.36 zoom too', () => {
    const k = 0.36;
    const frame = { left: 300, top: 130, width: 1080 * k, height: 1080 * k };
    const datum = { left: 300 + 800 * k, top: 130 + 64 * k, width: 216 * k, height: 216 * k };
    const g = pinGuides(datum, frame, { top: true, right: true, bottom: false, left: false }, k);
    expect(g.map((x) => [x.edge, x.label])).toEqual([
      ['top', '64'],
      ['right', '64'],
    ]);
    // the right guide runs from the object’s right edge to the frame’s
    const right = g.find((x) => x.edge === 'right');
    expect(right?.x1).toBeCloseTo(datum.left + datum.width, 5);
    expect(right?.x2).toBeCloseTo(frame.left + frame.width, 5);
  });

  test('a pin at distance 0 draws nothing', () => {
    const g = pinGuides(
      { left: 0, top: 0, width: 10, height: 10 },
      { left: 0, top: 0, width: 100, height: 100 },
      { top: true, right: false, bottom: false, left: true },
      1
    );
    expect(g).toEqual([]);
  });
});

describe('← → in an auto layout', () => {
  const none = { meta: false, ctrl: false, alt: false, shift: false };
  const row = { display: 'flex', flexDirection: 'row' };

  test('a row: ← earlier, → later; a column: ↑ earlier, ↓ later; reverse flips', () => {
    expect(reorderKeyAction('ArrowLeft', none, row, 'static')).toBe('object.reorder-earlier');
    expect(reorderKeyAction('ArrowRight', none, row, 'static')).toBe('object.reorder-later');
    expect(
      reorderKeyAction('ArrowUp', none, { display: 'flex', flexDirection: 'column' }, 'relative')
    ).toBe('object.reorder-earlier');
    expect(
      reorderKeyAction('ArrowDown', none, { display: 'flex', flexDirection: 'column' }, 'static')
    ).toBe('object.reorder-later');
    expect(
      reorderKeyAction(
        'ArrowLeft',
        none,
        { display: 'flex', flexDirection: 'row-reverse' },
        'static'
      )
    ).toBe('object.reorder-later');
  });

  test('not in a layout, not on the cross axis, not with a modifier, not when placed freely: nothing', () => {
    expect(
      reorderKeyAction('ArrowLeft', none, { display: 'block', flexDirection: 'row' }, 'static')
    ).toBeNull();
    expect(reorderKeyAction('ArrowLeft', none, null, 'static')).toBeNull();
    expect(reorderKeyAction('ArrowUp', none, row, 'static')).toBeNull();
    expect(reorderKeyAction('ArrowLeft', { ...none, shift: true }, row, 'static')).toBeNull();
    expect(reorderKeyAction('ArrowLeft', { ...none, meta: true }, row, 'static')).toBeNull();
    expect(reorderKeyAction('ArrowLeft', none, row, 'absolute')).toBeNull();
  });

  test('the shell’s run-action (or a Layers row) asks one reorder-earlier edit-op per request', async () => {
    const asks: Array<{ op: string; targets: unknown[] }> = [];
    const recs: unknown[] = [];
    await runLayoutAction(
      'object.reorder-earlier',
      [],
      [{ artboard: 'desktop', element: 'product' }],
      { run: async (a) => (asks.push(a as never), OK), record: (r) => recs.push(r) }
    );
    expect(asks.map((a) => [a.op, a.targets])).toEqual([
      ['object.reorder-earlier', [{ artboard: 'desktop', element: 'product' }]],
    ]);
    expect(recs.length).toBe(1);
  });

  test('with nothing selected the line says what to do', async () => {
    const said: string[] = [];
    await runLayoutAction('object.reorder-later', [], undefined, { toast: (m) => said.push(m) });
    await runLayoutAction('layout.convert-to-absolute', [], undefined, {
      toast: (m) => said.push(m),
    });
    expect(said).toEqual([NEEDS_ONE_LINE, NEEDS_ONE_LINE]);
  });

  test('Convert asks v1’s subtree convert for a frame; a leaf with no children is told to pick a frame', async () => {
    document.body.innerHTML = `<article data-dc-screen="a"><div class="dc-artboard-body"><div data-cd-id="f"><i data-cd-id="c"></i></div><i data-cd-id="leaf"></i></div></article>`;
    const seen: string[] = [];
    (
      window as unknown as { __maudeConvertToAbsolute?: (el: HTMLElement) => Promise<void> }
    ).__maudeConvertToAbsolute = async (el) => {
      seen.push(el.getAttribute('data-cd-id') ?? '');
    };
    const sel = (id: string) => [{ id, artboardId: 'a', selector: `[data-cd-id="${id}"]` }];
    await runLayoutAction('layout.convert-to-absolute', sel('f'), undefined, {});
    expect(seen).toEqual(['f']);
    await runLayoutAction('layout.convert-to-absolute', sel('leaf'), undefined, {});
    expect(seen).toEqual(['f']);
    expect(NEEDS_FRAME_LINE).toBe('Select a frame first.');
    (window as unknown as { __maudeConvertToAbsolute?: unknown }).__maudeConvertToAbsolute =
      undefined;
  });
});
