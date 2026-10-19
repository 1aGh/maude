// S4.13 (canvas 15 `an-stk-drop`, `an-templates`, `an-stamps`) - a pick follows the pointer and lands at
// 160 px, selected, "160 x 160"; Replace keeps the spot and size, Flip mirrors; a template lands where you
// click; a stamp stays armed. The shell's pick arrives in the messages S4.3 / S4.4 already declared.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import { boardToOps } from '../annotations/board-ops.ts';
import { TEMPLATES, templateBoard } from '../annotations/templates.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { ElementNode } from '../annotations/ui/element-node.tsx';
import { PlacementGhost, StickerSizeChip } from '../annotations/ui/placement.tsx';
import { strokeToRenderItem } from '../annotations/ui/render-model.ts';
import { clusterStamps, stampElement } from '../annotations/ui/stamps.ts';
import { StampClusters } from '../annotations/ui/stamps.tsx';
import {
  dropSticker,
  flipPatch,
  isGallerySticker,
  pendingFor,
  placementOf,
  replacePatch,
  STAMPS_PACK,
  sizeLabel,
} from '../annotations/ui/sticker-drop.ts';
import { expandTemplate, templateExtent } from '../annotations/ui/template-place.ts';
import { elementsToStrokes, strokesToElementMap } from '../annotations/v1-adapter.ts';
import { AnnotationContextToolbar } from '../annotations-context-toolbar.tsx';
import { StrokesStoreContext, type StrokesStoreValue } from '../annotations-layer.tsx';
import { type ImageStroke, STICKER_DROP_SIZE, type Stroke } from '../annotations-model.ts';
import {
  AnnotationSelectionProvider,
  useAnnotationSelection,
} from '../use-annotation-selection.tsx';

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

const REF = { pack: 'project-status', id: 'group-46' };

describe("the shell's pick, in the messages S4.3 / S4.4 declared", () => {
  test('insert-sticker with follow is a sticker that trails the pointer', () => {
    expect(
      placementOf({
        dgn: 'insert-sticker',
        path: 'assets/ab12cd34.png',
        follow: true,
        sticker: REF,
      })
    ).toEqual({ kind: 'sticker', path: 'assets/ab12cd34.png', sticker: REF, follow: true });
  });
  test('the gallery names a sticker by its file; the board keeps the dot-free stem', () => {
    const p = placementOf({
      dgn: 'insert-sticker',
      path: 'assets/ab12cd34.png',
      follow: true,
      sticker: { pack: 'project-status', id: 'group-46.png' },
    });
    expect(p).toMatchObject({
      kind: 'sticker',
      sticker: { pack: 'project-status', id: 'group-46' },
    });
  });
  test('without follow it is the old mid-view drop; a pasted picture has no sticker identity', () => {
    expect(placementOf({ dgn: 'insert-sticker', path: 'assets/x.png' })).toEqual({
      kind: 'sticker',
      path: 'assets/x.png',
      follow: false,
    });
  });
  test('a stamp is the Stamps pack: no picture, the stamp word is the id', () => {
    expect(
      placementOf({
        dgn: 'insert-sticker',
        path: '',
        follow: true,
        sticker: { pack: STAMPS_PACK, id: 'yes' },
      })
    ).toEqual({ kind: 'stamp', stampKind: 'yes' });
  });
  test('insert-template carries its id and follow', () => {
    expect(placementOf({ dgn: 'insert-template', id: 'kanban', follow: true })).toEqual({
      kind: 'template',
      id: 'kanban',
      follow: true,
    });
  });
  test('anything else, and a hostile ref, is nothing', () => {
    expect(placementOf({ dgn: 'tool-set', tool: 'pen' })).toBeNull();
    expect(placementOf({ dgn: 'insert-sticker', path: '' })).toBeNull();
    expect(placementOf(null)).toBeNull();
    const p = placementOf({
      dgn: 'insert-sticker',
      path: 'a.png',
      sticker: { pack: '../x', id: 'y' },
    });
    expect(p).toEqual({ kind: 'sticker', path: 'a.png', follow: false });
  });
});

describe('it lands at 160 px, selected, with its size said', () => {
  const at = { x: 500, y: 300 };
  test('a square STICKER_DROP_SIZE box centred on the click, carrying its identity and its maker', () => {
    const s = dropSticker({ path: 'assets/ab12cd34.png', sticker: REF }, at, 'img1', {
      name: 'Jonas',
    });
    expect(STICKER_DROP_SIZE).toBe(160);
    expect(s).toMatchObject({
      tool: 'image',
      x: 420,
      y: 220,
      w: 160,
      h: 160,
      sticker: REF,
      authorName: 'Jonas',
    });
    expect(sizeLabel(s)).toBe('160 × 160');
    expect(isGallerySticker(s)).toBe(true);
    expect(isGallerySticker({ ...s, sticker: undefined })).toBe(false);
  });
  test('the chip says 160 × 160', () => {
    const html = renderToStaticMarkup(
      createElement(
        'svg',
        null,
        createElement(StickerSizeChip, { box: { x: 420, y: 220, w: 160, h: 160 }, zoom: 1 })
      )
    );
    expect(html).toContain('160 × 160');
    expect(html).toContain('data-testid="annot-sticker-size"');
  });
});

describe('Replace keeps the spot and size; Flip mirrors', () => {
  const old = dropSticker({ path: 'assets/old.png', sticker: REF }, { x: 500, y: 300 }, 'img1');
  test('Replace swaps the picture in place', () => {
    const patch = replacePatch(old, {
      path: 'assets/new.png',
      sticker: { pack: 'life-style', id: 'best' },
    });
    const next = { ...old, ...patch };
    expect(next).toMatchObject({ x: 420, y: 220, w: 160, h: 160, href: 'assets/new.png' });
    expect(next.sticker).toEqual({ pack: 'life-style', id: 'best' });
  });
  test('a mirrored sticker stays mirrored when replaced', () => {
    const flipped = { ...old, ...flipPatch(old) } as ImageStroke;
    expect(flipped.sticker?.flip).toBe(true);
    const next = {
      ...flipped,
      ...replacePatch(flipped, {
        path: 'assets/new.png',
        sticker: { pack: 'life-style', id: 'best' },
      }),
    };
    expect(next.sticker).toEqual({ pack: 'life-style', id: 'best', flip: true });
  });
  test('Flip toggles; a pasted picture has nothing to carry the flag', () => {
    const f1 = { ...old, ...flipPatch(old) } as ImageStroke;
    expect(f1.sticker).toEqual({ ...REF, flip: true });
    const f2 = { ...f1, ...flipPatch(f1) } as ImageStroke;
    expect(f2.sticker).toEqual(REF);
    expect(flipPatch({ ...old, sticker: undefined })).toBeNull();
  });
  test('the identity rides to the file and back; a flipped sticker draws mirrored', () => {
    const flipped = { ...old, ...flipPatch(old) } as ImageStroke;
    const els = strokesToElementMap([flipped], new Map());
    const el = els.get('img1') as AnnotationElement;
    expect(el.sticker).toEqual({ ...REF, flip: true });
    const back = elementsToStrokes([el])[0] as ImageStroke;
    expect(back.sticker).toEqual({ ...REF, flip: true });
    const item = strokeToRenderItem(back) as { el: AnnotationElement };
    const draw = (e: AnnotationElement) =>
      renderToStaticMarkup(
        createElement(ElementNode, {
          el: e,
          interactive: true,
          edit: null,
          resolveAsset: (h: string) => h,
        })
      );
    expect(draw(item.el)).toContain('scale(-1 1)');
    expect(draw({ ...item.el, sticker: REF })).not.toContain('scale(-1 1)');
  });
});

describe('a template lands where you click', () => {
  test("the origin is the click; every piece is the person's, none the AI's", () => {
    const p = expandTemplate('kanban', { x: 1000, y: 400 }, 'Jonas');
    expect(p).not.toBeNull();
    const secs = (p?.strokes ?? []).filter((s) => s.tool === 'section');
    expect(secs).toHaveLength(3);
    expect(Math.min(...secs.map((s) => (s as { x: number }).x))).toBe(1000);
    expect(Math.min(...secs.map((s) => (s as { y: number }).y))).toBe(400);
    expect(p?.strokes.every((s) => s.author !== 'ai')).toBe(true);
    expect(
      p?.strokes.filter((s) => s.tool === 'sticky').every((s) => s.authorName === 'Jonas')
    ).toBe(true);
    expect(p?.selectIds).toHaveLength(3); // the sections; their cards come along
    expect(p?.box.x).toBe(1000);
  });
  test('the same ops as `annotate --board`: every create and every connect is made', () => {
    for (const t of TEMPLATES) {
      const ops = boardToOps(templateBoard(t.id) as never);
      const made = expandTemplate(t.id, { x: 0, y: 0 });
      const creates = ops.filter((o) => o.op === 'create').length;
      const connects = ops.filter((o) => o.op === 'connect').length;
      // a connection's label is an element of its own, so the count can only be higher than the ops
      expect(made?.count).toBeGreaterThanOrEqual(creates + connects);
      const sections = ops.filter((o) => o.op === 'create' && o.type === 'section').length;
      expect(made?.strokes.filter((s) => s.tool === 'section')).toHaveLength(sections);
    }
  });
  test("the ghost has the template's size; an unknown id is nothing", () => {
    expect(templateExtent('kanban')?.w).toBeGreaterThan(600);
    expect(templateExtent('no-such-template')).toBeNull();
    expect(expandTemplate('no-such-template', { x: 0, y: 0 })).toBeNull();
  });
});

describe('the ghost trails the pointer until a click', () => {
  async function mount(pending: Parameters<typeof PlacementGhost>[0]['pending']) {
    const placed: Array<{ x: number; y: number }> = [];
    let cancelled = 0;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        <PlacementGhost
          pending={pending}
          zoom={0.5}
          resolveAsset={(p: string) => `/${p}`}
          templateSize={() => ({ w: 700, h: 400 })}
          onPlace={(at) => placed.push(at)}
          onCancel={() => {
            cancelled++;
          }}
        />
      )
    );
    return { host, placed, cancelled: () => cancelled };
  }
  const fire = async (type: string, init: Record<string, unknown> = {}) =>
    act(async () => {
      document.body.dispatchEvent(
        new (globalThis as any).PointerEvent(type, { bubbles: true, cancelable: true, ...init })
      );
    });

  test('nothing is drawn until the pointer is in; then a sticker at the size it will land', async () => {
    const { host } = await mount({
      kind: 'sticker',
      path: 'assets/a.png',
      sticker: REF,
      follow: true,
    });
    expect(host.querySelector('[data-testid="annot-placing"]')).toBeNull();
    await fire('pointermove', { clientX: 300, clientY: 200 });
    const g = document.querySelector('[data-testid="annot-placing"]') as HTMLElement;
    expect(g.dataset.placing).toBe('sticker');
    expect(g.style.width).toBe('80px'); // 160 px of canvas at 50 %
    expect(g.style.left).toBe('260px');
    expect(g.getAttribute('src')).toBe('/assets/a.png');
  });
  test('a click places it THERE and the click goes no further', async () => {
    const { placed } = await mount({ kind: 'template', id: 'kanban', follow: true });
    await fire('pointermove', { clientX: 410, clientY: 170 });
    expect(
      (document.querySelector('[data-testid="annot-placing"]') as HTMLElement).dataset.placing
    ).toBe('template');
    let reached = 0;
    document.body.addEventListener('pointerdown', () => reached++);
    await fire('pointerdown', { button: 0, clientX: 410, clientY: 170 });
    expect(placed).toEqual([{ x: 410, y: 170 }]);
    expect(reached).toBe(0);
  });
  test('Esc lets go; so does a right click; a spent pick draws nothing', async () => {
    const a = await mount({ kind: 'stamp', stampKind: 'yes' });
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    });
    expect(a.cancelled()).toBe(1);
    await act(async () => {
      document.dispatchEvent(
        new (globalThis as any).MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      );
    });
    expect(a.cancelled()).toBe(2);
    await act(async () => {
      for (const r of roots.splice(0)) r.unmount();
    });
    const b = await mount(null);
    await fire('pointermove', { clientX: 5, clientY: 5 });
    expect(b.host.querySelector('[data-testid="annot-placing"]')).toBeNull();
  });
});

describe('the small toolbar over a sticker: Replace… · Flip · Lock · Duplicate', () => {
  const sticker = (o: Partial<ImageStroke> = {}): ImageStroke => ({
    ...dropSticker({ path: 'assets/a.png', sticker: REF }, { x: 500, y: 300 }, 'img1'),
    ...o,
  });
  function Select({ ids }: { ids: string[] }) {
    const sel = useAnnotationSelection();
    // biome-ignore lint/correctness/useExhaustiveDependencies: select once
    useEffect(() => sel.replace(ids), []);
    return null;
  }
  async function mountToolbar(strokes: Stroke[]) {
    const ran: string[] = [];
    const updates: Array<[string, unknown]> = [];
    const locks: Array<[readonly string[], boolean]> = [];
    const store = {
      strokes,
      setStrokes: () => {},
      updateStroke: (id: string, patch: unknown) => updates.push([id, patch]),
      deleteStrokes: () => {},
      translateStrokes: () => {},
      applyToStrokes: () => {},
      groupSelection: () => null,
      ungroupSelection: () => {},
      setLocked: (ids: readonly string[], v: boolean) => locks.push([ids, v]),
      runAction: (id: string) => {
        ran.push(id);
        return true;
      },
    } as unknown as StrokesStoreValue;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        <AnnotationSelectionProvider>
          <StrokesStoreContext.Provider value={store}>
            <Select ids={[strokes[0]?.id as string]} />
            <AnnotationContextToolbar editingId={null} />
          </StrokesStoreContext.Provider>
        </AnnotationSelectionProvider>
      )
    );
    return { host, ran, updates, locks };
  }
  const q = (host: Element, id: string) =>
    host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  test("the four controls, in the canvas's words", async () => {
    const { host } = await mountToolbar([sticker()]);
    expect(q(host, 'annot-ctx-replace')?.textContent).toBe('Replace…');
    expect(q(host, 'annot-ctx-flip')?.textContent).toBe('Flip');
    expect(q(host, 'annot-ctx-lock')).not.toBeNull();
    expect(q(host, 'annot-ctx-duplicate')?.textContent).toBe('Duplicate');
  });
  test('Flip mirrors through the store; Duplicate and Lock go through it too', async () => {
    const { host, ran, updates, locks } = await mountToolbar([sticker()]);
    await act(async () => q(host, 'annot-ctx-flip')?.click());
    expect(updates).toEqual([['img1', { sticker: { ...REF, flip: true } }]]);
    await act(async () => q(host, 'annot-ctx-duplicate')?.click());
    expect(ran).toEqual(['annotation.duplicate']);
    await act(async () => q(host, 'annot-ctx-lock')?.click());
    expect(locks).toEqual([[['img1'], true]]);
  });
  test('Replace… asks the shell to open the gallery in replace mode for THIS sticker', async () => {
    const sent: unknown[] = [];
    const real = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: (m: unknown) => sent.push(m) },
    });
    try {
      const { host } = await mountToolbar([sticker()]);
      await act(async () => q(host, 'annot-ctx-replace')?.click());
    } finally {
      if (real) Object.defineProperty(window, 'parent', real);
    }
    expect(sent).toEqual([
      { dgn: 'tool-panel-open', panel: 'stickers', anchor: null, replace: 'img1' },
    ]);
  });
  test('a pasted picture keeps the Alt panel: no Replace / Flip', async () => {
    const { host } = await mountToolbar([sticker({ sticker: undefined })]);
    expect(q(host, 'annot-ctx-flip')).toBeNull();
    expect(host.querySelector('[aria-label="Image properties"]')).not.toBeNull();
  });
});

describe('stamps on the canvas gather into clusters', () => {
  const B = 'ab:smer-b';
  const mk = (kind: string, name: string) =>
    stampElement({ kind, who: { name }, target: B, x: 800, y: 360 });
  const five = [
    mk('yes', 'You'),
    mk('yes', 'Jonas'),
    mk('yes', 'Petra'),
    mk('star', 'Tereza'),
    mk('heart', 'Tereza'),
  ];

  test('five stamps on Směr B: two faces and a 5', () => {
    const html = renderToStaticMarkup(
      createElement(StampClusters, { clusters: clusterStamps(five), labelOf: () => 'Směr B' })
    );
    expect(html).toContain('data-count="5"');
    expect(html).toContain('aria-label="5 stamps on Směr B"');
    expect(html.match(/data-testid="annot-stamp-face"/g)).toHaveLength(2);
    expect(html).toContain('data-testid="annot-stamp-count"');
  });
  test('two stamps have no count; hovering a cluster opens "5 stamps on Směr B"', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        <StampClusters clusters={clusterStamps(five)} labelOf={() => 'Směr B'} me="Jonas" />
      )
    );
    expect(host.querySelector('[data-testid="annot-stamp-card"]')).toBeNull();
    const group = host.querySelector('button') as HTMLElement;
    await act(async () => {
      group.dispatchEvent(new (globalThis as any).PointerEvent('pointerenter', { bubbles: false }));
      group.focus();
    });
    const card = host.querySelector('[data-testid="annot-stamp-card"]') as HTMLElement;
    expect(card.textContent).toContain('5 stamps');
    expect(card.textContent).toContain('on Směr B');
    expect(card.querySelectorAll('[data-testid="annot-stamp-card-row"]')).toHaveLength(5);
    expect(card.textContent).toContain('You'); // Jonas, the signed-in person, reads "You"
  });
});

describe('S4.19 G2 - a pick arms placement from any Preview tool', () => {
  test('the ghost follows visibility alone, never the active tool (Hand has no draw tool)', () => {
    const stamp = { kind: 'stamp', stampKind: 'yes' } as const;
    expect(pendingFor(stamp, true)).toBe(stamp);
    expect(pendingFor(stamp, false)).toBeNull();
    expect(pendingFor(null, true)).toBeNull();
  });
  test('the layer hands the ghost pendingFor(), not an isActive gate', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(import.meta.dir, '..', 'annotations-layer.tsx'),
      'utf8'
    ) as string;
    const at = src.indexOf('<PlacementGhost');
    expect(at).toBeGreaterThan(0);
    const tag = src.slice(at, at + 200);
    expect(tag).toContain('pending={pendingFor(placing, visible)}');
    expect(tag).not.toContain('isActive');
  });
});
