// P8 stage C round 10 (14 ed-pen): the inspector's Point card — "Point · Corner Smooth / Sharp · X · Y" — for the point of a
// Pen path being edited. The canvas says which point (the payload's `data-dc-pen-point`); a click on Sharp or a typed X asks
// ONE `path.edit` and records ONE undo step.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { parsePathD, pointType } from '../edit-ops/path-model.ts';
import {
  getPenPoint,
  parsePenPointAttr,
  penPointAttr,
  penPointInfo,
  setPenPoint,
} from '../editing/pen/point-store.ts';

const realFetch = globalThis.fetch;
const asked: Array<Record<string, unknown>> = [];
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url) === '/_api/edit-op') {
      asked.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true, writeId: 'w9', actionId: null }), {
        status: 200,
      });
    }
    return String(url).endsWith('.css')
      ? new Response(':root{--space-5:24px;}', { status: 200 })
      : new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
});
afterAll(async () => {
  // No `unregisterSections()`: the bodies register once per process (module cache) — taking them out here left
  // every later file in a combined run with no inspector sections. `stashSlots()` is the reversible way.
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
const recorded: Array<Record<string, unknown>> = [];
beforeEach(async () => {
  asked.length = 0;
  recorded.length = 0;
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  foldStore.set('inspector', false);
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});
const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

// the swoosh: start (120,520), a smooth point at (380,570), an end (900,450) — drawn at left 100 / top 400
const D = 'M20 120 C 100 170, 180 170, 280 170 S 700 90, 800 50';
const FILE = '.design/ui/Combine.tsx';
const PATH = {
  id: 'swoosh',
  index: 0,
  file: FILE,
  tag: 'svg',
  classes: '',
  selector: '[data-cd-id="swoosh"]',
  text: '',
  bounds: { x: 100, y: 400, w: 800, h: 170 },
  worldW: 800,
  worldH: 170,
  dom_path: ['div', 'svg'],
  authored: { stroke: 'var(--accent)', 'stroke-width': '4px', position: 'absolute' } as Record<
    string,
    string
  >,
  computed: { position: 'absolute' } as Record<string, string>,
  customStyles: {},
  attrs: { 'data-shape': 'path', 'data-dc-pen-points': '3' } as Record<string, string>,
  html: `<svg data-cd-id="swoosh" data-shape="path" width="800" height="170" viewBox="0 0 800 170" style="position: absolute; left: 100px; top: 400px; stroke: var(--accent)"><path d="${D}" /></svg>`,
  parentDisplay: 'block',
  parentFlexDirection: '',
  artboardId: 'post',
};
const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'Studio', tokensCssRel: 'system/studio/colors_and_type.css' }],
  defaultDesignSystem: 'Studio',
};

async function card(point: string | null) {
  await import('../client/v2/inspector/sections/index.js');
  (await import('../client/v2/inspector/kinds/path.jsx')).registerPathKind();
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const selected = {
    ...PATH,
    attrs: { ...PATH.attrs, ...(point ? { 'data-dc-pen-point': point } : {}) },
  };
  await act(async () =>
    root.render(
      <InspectorFrame
        {...({
          selected,
          layersTree: { artboardId: 'post', nodes: [] },
          cfg: CFG,
          canvasFile: FILE,
          onOptimistic: () => {},
          onRecordEdit: (r: Record<string, unknown>) => recorded.push(r),
          onReplaceMedia: () => {},
          onUndoRedo: () => {},
        } as never)}
      />
    )
  );
  await settle();
}
const click = async (el: Element | null) => {
  await act(async () => {
    el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await settle();
};

describe('the point the canvas reports', () => {
  test('a point reads in container px, with its kind; it round-trips through the payload attribute', () => {
    const model = parsePathD(D);
    const info = penPointInfo(model, { sub: 0, i: 1 }, { x: 100, y: 400 });
    expect(info).toEqual({ sub: 0, i: 1, kind: 'smooth', x: 380, y: 570 });
    expect(penPointAttr(info)).toBe('0,1,smooth,380,570');
    expect(parsePenPointAttr('0,1,smooth,380,570')).toEqual(info);
    expect(parsePenPointAttr('nonsense')).toBeNull();
    expect(parsePenPointAttr(undefined)).toBeNull();
    const svg = {};
    setPenPoint(svg, info);
    expect(getPenPoint(svg)).toEqual(info);
    setPenPoint(svg, null);
    expect(getPenPoint(svg)).toBeNull();
  });
  test('the canvas puts it on the path’s selection payload, and only while it is set', async () => {
    const { hoverTargetToSelection } = await import('../dom-selection.ts');
    document.body.innerHTML = `<div data-dc-screen="post"><div class="dc-artboard-body">${PATH.html}</div></div>`;
    const el = document.querySelector('[data-cd-id="swoosh"]') as Element;
    const target = { el, cdId: 'swoosh', artboardId: 'post' } as never;
    expect(hoverTargetToSelection(target).attrs?.['data-dc-pen-point']).toBeUndefined();
    setPenPoint(el, { sub: 0, i: 1, kind: 'smooth', x: 380, y: 570 });
    expect(hoverTargetToSelection(target).attrs?.['data-dc-pen-point']).toBe('0,1,smooth,380,570');
    setPenPoint(el, null);
  });
});

describe('14 ed-pen: the Point card', () => {
  test('a selected point: Corner and X · Y, Stroke with its Ends row; no point selected: no Point section', async () => {
    await card('0,1,smooth,380,570');
    expect(q('insp-point-corner')).not.toBeNull();
    expect(q('insp-point-x')?.querySelector('input')?.value).toBe('380');
    expect(q('insp-point-y')?.querySelector('input')?.value).toBe('570');
    expect(q('insp-ctl-path-ends')).not.toBeNull();
    document.body.innerHTML = '';
    await card(null);
    expect(q('insp-point-corner')).toBeNull();
    expect(q('insp-ctl-path-ends')).not.toBeNull();
  });

  test('Sharp on a smooth point: ONE path.edit with that point’s handles gone, one undo step', async () => {
    await card('0,1,smooth,380,570');
    await click(
      document.querySelector('[data-testid="insp-point-corner"] button[aria-label="Sharp"]')
    );
    expect(asked).toHaveLength(1);
    const ask = asked[0] as {
      op: string;
      file: string;
      targets: unknown[];
      params: { path: unknown };
    };
    expect(ask.op).toBe('path.edit');
    expect(ask.file).toBe(FILE);
    expect(ask.targets).toEqual([{ artboard: 'post', element: 'swoosh' }]);
    const sent = ask.params.path as ReturnType<typeof parsePathD>;
    const sub = sent.subs[0];
    expect(sub?.points[1]).toMatchObject({ x: 380, y: 570 }); // container px: local 280,170 + origin 100,400
    expect(sub?.points[1]?.in).toBeUndefined();
    expect(sub?.points[1]?.out).toBeUndefined();
    expect(pointType(sub as never, 1)).toBe('sharp');
    expect(recorded).toEqual([{ op: 'edit-op', writeId: 'w9', label: 'Edit path' }]);
  });

  test('already Smooth: clicking Smooth asks nothing', async () => {
    await card('0,1,smooth,380,570');
    await click(
      document.querySelector('[data-testid="insp-point-corner"] button[aria-label="Smooth"]')
    );
    expect(asked).toHaveLength(0);
  });

  test('typing X moves the point (and its handles) by the difference, in one write', async () => {
    await card('0,1,smooth,380,570');
    const input = q('insp-point-x')?.querySelector('input') as HTMLInputElement;
    await act(async () => {
      input.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      set?.call(input, '400');
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.blur();
    });
    await settle();
    expect(asked).toHaveLength(1);
    const sent = (asked[0] as { params: { path: ReturnType<typeof parsePathD> } }).params.path;
    const was = parsePathD(D).subs[0]?.points[1];
    const now = sent.subs[0]?.points[1];
    expect(now?.x).toBe(400);
    expect(now?.y).toBe(570);
    // the handles went with it: 20 px to the right of where they were (container origin 100 → local 300)
    expect(now?.out?.x).toBe((was?.out?.x ?? 0) + 100 + 20);
  });
});
