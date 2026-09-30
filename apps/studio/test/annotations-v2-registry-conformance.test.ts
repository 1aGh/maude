// annotations-v2 (DDR-242, Task 25) — every registered element type honours
// the same contract, and a NEW type is one definition: the `stamp` below is
// declared in this file only, then drawn, hit, moved, synced and read/written
// by the AI verbs through the code paths every built-in type uses.

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { projectBoard } from '../annotations/ai-read.ts';
import { AiBatch } from '../annotations/ai-write.ts';
import {
  BOX_FIELDS,
  boxOf,
  resizeBox,
  solidBoxHit,
  translateBox,
} from '../annotations/elements/_shared.ts';
import { str } from '../annotations/fields.ts';
import { applyOps, diffToOps, parseOps } from '../annotations/ops.ts';
import { REGISTRY, registerElementType, validateElement } from '../annotations/registry.ts';
import { Scene } from '../annotations/scene.ts';
import { parseBoard, serializeBoard, validateElements } from '../annotations/schema.ts';
import type { AnnotationElement, Box, ElementDef, GeomCtx } from '../annotations/types.ts';
import { ElementBox, ElementNode, registerElementView } from '../annotations/ui/element-node.tsx';
import { renderItemsFromStrokes } from '../annotations/ui/render-model.ts';
import { elementsToStrokes, strokesToElementMap } from '../annotations/v1-adapter.ts';
import { isBindable } from '../annotations-bindings.ts';
import {
  strokeBBox,
  strokeHitTest,
  strokesShallowEqual,
  translateOne,
} from '../annotations-model.ts';
import { resizeStroke } from '../use-annotation-resize.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// The throwaway type — this block is ALL it takes to add one.

const stamp: ElementDef = {
  type: 'stamp',
  fields: { ...BOX_FIELDS, glyph: str({ max: 8, plain: true }) },
  caps: {
    box: true,
    rotatable: false,
    resizable: true,
    bindable: true,
    container: false,
    textSlot: null,
  },
  bounds: (el) => boxOf(el),
  hitTest: (el, px, py, tol) => solidBoxHit(el, px, py, tol),
  translate: translateBox,
  resize: resizeBox,
  meaningful: (el) => boxOf(el).w >= 8 && boxOf(el).h >= 8,
};
registerElementType(stamp);
registerElementView('stamp', ({ el }) => {
  const b = boxOf(el);
  return createElement(
    ElementBox,
    { el, x: b.x, y: b.y, w: b.w, h: b.h },
    createElement('span', { className: 'stamp' }, String(el.glyph ?? ''))
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// One valid sample per registered type.

const SAMPLES: Record<string, Record<string, unknown>> = {
  sticky: { x: 10, y: 20, w: 200, h: 200, text: 'hi' },
  text: { x: 10, y: 20, w: 80, h: 18, text: 'label' },
  shape: { x: 10, y: 20, w: 120, h: 80, kind: 'rect', fill: '#ffffff' },
  arrow: { start: { x: 0, y: 0 }, end: { x: 100, y: 40 } },
  pen: { points: [0, 0, 10, 10, 30, 5] },
  image: { x: 10, y: 20, w: 120, h: 80, href: 'assets/0123abcd.png' },
  link: { x: 10, y: 20, w: 260, h: 76, url: 'https://example.com', title: 'Example' },
  mediaref: { x: 10, y: 20, w: 280, h: 76, src: 'assets/0123abcd.mp4', title: 'clip' },
  section: { x: 10, y: 20, w: 480, h: 320, label: 'Area' },
  stamp: { x: 10, y: 20, w: 40, h: 40, glyph: '★' },
};

const CTX: GeomCtx = { origin: { x: 0, y: 0 }, resolve: () => null };

function sample(type: string, id = `${type}1`): AnnotationElement {
  const r = validateElement({ id, type, index: 'a0', ...SAMPLES[type] });
  if (!r.ok) throw new Error(`${type}: ${r.reason}`);
  return r.el;
}

const near = (a: Box | null, b: Box | null) => {
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  if (!a || !b) return;
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(a[k] - b[k])).toBeLessThan(0.02);
};

test('every registered type has a sample (a new type must add one here)', () => {
  expect([...REGISTRY.keys()].sort()).toEqual(Object.keys(SAMPLES).sort());
});

describe.each(Object.keys(SAMPLES))('%s', (type) => {
  const def = REGISTRY.get(type) as ElementDef;

  test('spec round trip: canonical form is a fixed point, also through a board file', () => {
    const el = sample(type);
    const again = validateElement(JSON.parse(JSON.stringify(el)));
    expect(again.ok && again.el).toEqual(el);
    expect(parseBoard(serializeBoard([el])).elements).toEqual([el]);
  });

  test('hostile input is rejected or sanitized, never thrown', () => {
    const hostile = JSON.parse(
      `{"id":"h1","type":"${type}","index":"a0","__proto__":{"polluted":1},"constructor":1,"x":"1e999","w":-5}`
    );
    expect(() => validateElement(hostile)).not.toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(validateElement({ ...sample(type), id: '../x' }).ok).toBe(false);
    expect(validateElement({ ...sample(type), index: 'not an index!' }).ok).toBe(false);
    expect(validateElements([sample(type), 42, null, 'x']).elements.length).toBe(1);
  });

  test('bounds / translate / resize agree', () => {
    const el = sample(type);
    const b = def.bounds(el, CTX);
    expect(b).not.toBeNull();
    const moved = { ...el, ...def.translate(el, 15, -7) } as AnnotationElement;
    const mb = def.bounds(moved, CTX) as Box;
    near(mb, { ...(b as Box), x: (b as Box).x + 15, y: (b as Box).y - 7 });
    if (def.caps.box && def.caps.resizable) {
      const target = { x: 5, y: 6, w: 150, h: 90 };
      const resized = { ...el, ...def.resize(el, target, CTX) } as AnnotationElement;
      near(def.bounds(resized, CTX), target);
    }
    expect(def.meaningful(el)).toBe(true);
  });

  test('hit test: never far away; boxes are hit inside unless their interior is click-through', () => {
    const el = sample(type);
    const b = def.bounds(el, CTX) as Box;
    expect(def.hitTest(el, b.x + b.w + 500, b.y + b.h + 500, 2, CTX)).toBe(false);
    const hollow = type === 'section' || (type === 'shape' && !el.fill);
    if (def.caps.box && !hollow) {
      expect(def.hitTest(el, b.x + b.w / 2, b.y + b.h / 2, 0, CTX)).toBe(true);
    }
  });

  test('ops: put, patch and delete round-trip, and the inverse restores', () => {
    const el = sample(type);
    const empty = new Map<string, AnnotationElement>();
    const put = applyOps(empty, parseOps([{ op: 'put', el }]).ops);
    expect(put.rejected).toEqual([]);
    const moved = applyOps(put.state, [{ op: 'patch', id: el.id, set: def.translate(el, 3, 4) }]);
    expect(moved.rejected).toEqual([]);
    expect(applyOps(moved.state, moved.inverse).state.get(el.id)).toEqual(el);
    expect(applyOps(put.state, [{ op: 'delete', id: el.id }]).state.has(el.id)).toBe(false);
  });

  test('AI read shows it; AI write creates it through the registry', () => {
    const el = sample(type);
    const read = projectBoard([el]);
    expect(read.elements.map((e) => e.id)).toEqual([el.id]);
    expect(read.elements[0]?.type).toBe(type);
    if (def.caps.box) {
      const batch = new AiBatch([]);
      const { id: _i, type: _t, index: _x, ...fields } = el;
      const id = batch.create(type, fields);
      expect(batch.state.get(id)?.type).toBe(type);
      expect(batch.state.get(id)?.author).toEqual({ kind: 'ai' });
    }
  });

  test('the whiteboard round trip: board → strokes → board is the identity', () => {
    const el = sample(type);
    const board = new Map([[el.id, el]]);
    const strokes = elementsToStrokes(board.values());
    expect(diffToOps(board, strokesToElementMap(strokes, board))).toEqual([]);
  });

  test('draws as its own node', () => {
    const items = renderItemsFromStrokes(elementsToStrokes([sample(type)]));
    expect(items.length).toBe(1);
    const html = renderToStaticMarkup(
      createElement(ElementNode, {
        el: (items[0] as { el: AnnotationElement }).el,
        ends: (items[0] as { ends?: never }).ends,
        interactive: true,
        edit: null,
        resolveAsset: (h: string) => h,
      })
    );
    expect(html).toContain(`data-id="${type}1"`);
    expect(html).not.toContain('dc-annot-placeholder');
  });
});

describe('stamp — a type added in one file works end to end', () => {
  test('the editing tools select and move it through its definition', () => {
    const el = sample('stamp');
    const [s] = elementsToStrokes([el]);
    if (!s) throw new Error('no stroke');
    expect(s.tool).toBe('element');
    expect(strokeBBox(s)).toEqual({ x: 10, y: 20, w: 40, h: 40 });
    expect(strokeHitTest(s, 30, 40, 0)).toBe(true);
    expect(strokeHitTest(s, 300, 400, 2)).toBe(false);
    const moved = translateOne(s, 100, 0);
    expect(strokesShallowEqual([s], [moved])).toBe(false);
    const board = new Map([[el.id, el]]);
    const ops = diffToOps(board, strokesToElementMap([moved], board));
    expect(ops).toEqual([{ op: 'patch', id: el.id, set: { x: 110 }, expect: { x: 10 } }]);
  });

  test('inside a section it moves with it (parent-relative, like every box)', () => {
    const sec = validateElement({
      id: 'sec',
      type: 'section',
      index: 'a0',
      x: 0,
      y: 0,
      w: 400,
      h: 300,
    });
    const st = validateElement({
      id: 'st',
      type: 'stamp',
      index: 'a0',
      parent: 'sec',
      x: 20,
      y: 20,
      w: 40,
      h: 40,
    });
    if (!sec.ok || !st.ok) throw new Error('fixture');
    const board = new Map([
      [sec.el.id, sec.el],
      [st.el.id, st.el],
    ]);
    const moved = applyOps(board, [{ op: 'patch', id: 'sec', set: { x: 100 } }]).state;
    expect(new Scene(moved.values()).worldBox('st')).toEqual({ x: 120, y: 20, w: 40, h: 40 });
    const strokes = elementsToStrokes(moved.values());
    expect(strokeBBox(strokes.find((x) => x.id === 'st') as never)).toEqual({
      x: 120,
      y: 20,
      w: 40,
      h: 40,
    });
    expect(diffToOps(moved, strokesToElementMap(strokes, moved))).toEqual([]);
  });

  test('an arrow binds to it', () => {
    const batch = new AiBatch([sample('stamp'), sample('sticky')]);
    batch.connect({ from: 'stamp1', to: 'sticky1' });
    const arrow = [...batch.state.values()].find((e) => e.type === 'arrow');
    expect(arrow?.start).toEqual({ el: 'stamp1' });
  });

  test('the resize handles and arrow binding treat it like any card', () => {
    const [s] = elementsToStrokes([sample('stamp')]);
    if (!s) throw new Error('no stroke');
    expect(isBindable(s)).toBe(true);
    const patch = resizeStroke(s, 'se', 110, 120);
    expect(strokeBBox({ ...s, ...patch } as typeof s)).toEqual({ x: 10, y: 20, w: 100, h: 100 });
  });

  test('a built-in type cannot be replaced', () => {
    expect(() => registerElementType({ ...stamp, type: 'sticky' })).toThrow();
  });
});

describe('unknown type passthrough (a newer peer’s element)', () => {
  const future = { id: 'f1', type: 'hologram', index: 'a0', x: 1, y: 2, beam: { hue: 3 } };

  test('kept verbatim (bounded), round-trips a board and an op, drawn as a placeholder', () => {
    const r = validateElement(future);
    expect(r.ok && r.el).toEqual(future);
    expect(parseBoard(serializeBoard([r.ok ? r.el : (future as never)])).elements).toEqual([
      future as never,
    ]);
    const put = applyOps(new Map(), [{ op: 'put', el: future as never }]);
    expect(put.state.get('f1')).toEqual(future as never);
    expect(projectBoard(put.state.values()).elements[0]?.type).toBe('hologram');
    const html = renderToStaticMarkup(
      createElement(ElementNode, {
        el: future as never,
        interactive: false,
        edit: null,
        resolveAsset: (h: string) => h,
      })
    );
    expect(html).toContain('dc-annot-placeholder');
  });

  test('the whiteboard never drops it (not a stroke; its record survives an edit)', () => {
    const board = new Map<string, AnnotationElement>([
      ['f1', future as never],
      ['sticky1', sample('sticky')],
    ]);
    const strokes = elementsToStrokes(board.values());
    expect(strokes.map((s) => s.id)).toEqual(['sticky1']);
    const next = strokesToElementMap(strokes, board);
    expect(next.get('f1')).toEqual(future as never);
  });
});
