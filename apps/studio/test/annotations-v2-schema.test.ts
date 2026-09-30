// annotations-v2 (DDR-242) — schema, registry and canonical board form.
import { describe, expect, test } from 'bun:test';
import { MAX_NESTING_DEPTH } from '../annotations/constants.ts';
import {
  compareOrder,
  isValidOrderKey,
  keyBetween,
  keysBetween,
} from '../annotations/fractional-index.ts';
import { validateElement } from '../annotations/registry.ts';
import { parseBoard, serializeBoard, validateElements } from '../annotations/schema.ts';

const sticky = { id: 'st1', type: 'sticky', index: 'a0', x: 10, y: 20, w: 200, h: 200, text: 'hi' };

describe('validateElement', () => {
  test('canonical: spec key order, defaults omitted, numbers rounded', () => {
    const r = validateElement({
      text: 'hi',
      h: 200.004,
      w: 200,
      y: 20.123456,
      x: 10,
      index: 'a0',
      type: 'sticky',
      id: 'st1',
      fill: '#fce8a6', // default → omitted
      radius: 8, // default → omitted
      bold: false, // default → omitted
      junk: 'dropped',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.el)).toEqual(['id', 'type', 'index', 'x', 'y', 'w', 'h', 'text']);
    expect(r.el.y).toBe(20.12);
    expect(r.el.h).toBe(200);
  });

  test('hostile input: proto keys, NaN, huge numbers, bad colours, javascript: hrefs', () => {
    const raw = JSON.parse(
      '{"id":"i1","type":"image","index":"a0","x":1e300,"y":NaN,"w":10,"h":10,"href":"javascript:alert(1)","__proto__":{"polluted":1}}'.replace(
        'NaN',
        '0'
      )
    );
    const r = validateElement(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.el.x).toBe(1_000_000);
    expect(r.el.href).toBeUndefined(); // invalid → default '' → omitted
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(validateElement({ ...sticky, x: Number.NaN }).ok).toBe(false); // required field
    expect(validateElement({ ...sticky, fill: 'red; background:url(x)' }).ok).toBe(true);
    const bad = validateElement({ ...sticky, fill: 'red; background:url(x)' });
    if (bad.ok) expect(bad.el.fill).toBeUndefined();
  });

  test('ids, types and self-parent are validated', () => {
    expect(validateElement({ ...sticky, id: '../etc' }).ok).toBe(false);
    expect(validateElement({ ...sticky, id: 'x'.repeat(65) }).ok).toBe(false);
    expect(validateElement({ ...sticky, parent: 'st1' }).ok).toBe(false);
    expect(validateElement(null).ok).toBe(false);
    expect(validateElement([sticky]).ok).toBe(false);
  });

  test('control and bidi characters are stripped from text; newlines kept', () => {
    const r = validateElement({ ...sticky, text: 'a‮b\u0000c\nd' });
    expect(r.ok && r.el.text).toBe('abc\nd');
  });

  test('shape label is an embedded record; an empty label is omitted', () => {
    const r = validateElement({
      id: 'r1',
      type: 'shape',
      index: 'a0',
      kind: 'ellipse',
      x: 0,
      y: 0,
      w: 50,
      h: 40,
      label: { text: 'Hi', align: 'center' },
    });
    expect(r.ok && r.el.label).toEqual({ text: 'Hi' });
    const e = validateElement({
      id: 'r2',
      type: 'shape',
      index: 'a0',
      x: 0,
      y: 0,
      w: 5,
      h: 5,
      label: {},
    });
    expect(e.ok && 'label' in e.el).toBe(false);
  });

  test('arrow ends: auto, pinned, free; half magnets collapse to auto', () => {
    const r = validateElement({
      id: 'a1',
      type: 'arrow',
      index: 'a0',
      start: { el: 'r1', nx: 1, ny: 0.5 },
      end: { el: 'r2', nx: 0.5 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.el.start).toEqual({ el: 'r1', nx: 1, ny: 0.5 });
    expect(r.el.end).toEqual({ el: 'r2' });
    const free = validateElement({
      id: 'a2',
      type: 'arrow',
      index: 'a0',
      start: { x: 1, y: 2 },
      end: { x: 3, y: 4 },
    });
    expect(free.ok && free.el.start).toEqual({ x: 1, y: 2 });
  });

  test('pen points: flat list, odd tail dropped, non-finite rejected', () => {
    const r = validateElement({
      id: 'p1',
      type: 'pen',
      index: 'a0',
      points: [0, 0, 1.23456, 2, 9],
    });
    expect(r.ok && r.el.points).toEqual([0, 0, 1.23, 2]);
    expect(validateElement({ id: 'p2', type: 'pen', index: 'a0', points: [0, 'x'] }).ok).toBe(
      false
    );
  });

  test('unknown types round-trip, bounded and key-sorted', () => {
    const r = validateElement({
      id: 'u1',
      type: 'hologram',
      index: 'a0',
      z: 1,
      a: { deep: [1, 2] },
      __proto__: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.el)).toEqual(['id', 'type', 'index', 'a', 'z']);
  });

  test('link urls must be http(s)', () => {
    const base = { id: 'l1', type: 'link', index: 'a0', x: 0, y: 0, w: 10, h: 10 };
    expect(validateElement({ ...base, url: 'https://x.dev' }).ok).toBe(true);
    expect(validateElement({ ...base, url: 'javascript:alert(1)' }).ok).toBe(false);
  });
});

describe('board', () => {
  test('dedupes ids, repairs indexes, clears invalid parents, never drops the board', () => {
    const r = validateElements([
      sticky,
      { ...sticky, text: 'dup' },
      { ...sticky, id: 'st2', index: 'not valid!' },
      { ...sticky, id: 'st3', parent: 'nope' },
      { ...sticky, id: 'st4', parent: 'st1' }, // sticky is not a container
      'garbage',
    ]);
    expect(r.elements.map((e) => e.id).sort()).toEqual(['st1', 'st2', 'st3', 'st4']);
    const st2 = r.elements.find((e) => e.id === 'st2');
    expect(st2 && isValidOrderKey(st2.index)).toBe(true);
    expect(r.elements.find((e) => e.id === 'st3')?.parent).toBeUndefined();
    expect(r.elements.find((e) => e.id === 'st4')?.parent).toBeUndefined();
    expect(r.dropped.length).toBeGreaterThanOrEqual(4);
  });

  test('parent cycles are broken', () => {
    const sec = (id: string, parent?: string) => ({
      id,
      type: 'section',
      index: 'a0',
      parent,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    });
    const r = validateElements([sec('a', 'b'), sec('b', 'a')]);
    expect(
      r.elements.every((e) => e.parent === undefined || r.elements.some((p) => p.id === e.parent))
    ).toBe(true);
    expect(r.elements.filter((e) => e.parent === undefined).length).toBeGreaterThanOrEqual(1);
  });

  test('nesting deeper than the cap is flattened', () => {
    const chain = Array.from({ length: MAX_NESTING_DEPTH + 3 }, (_, i) => ({
      id: `s${i}`,
      type: 'section',
      index: 'a0',
      parent: i === 0 ? undefined : `s${i - 1}`,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    }));
    const r = validateElements(chain);
    expect(r.elements.length).toBe(chain.length);
    expect(r.dropped.some((d) => d.reason.includes('parent'))).toBe(true);
  });

  test('serialize → parse is identity and bytes are deterministic', () => {
    const els = validateElements([
      { id: 'sec', type: 'section', index: 'a0', x: 0, y: 0, w: 400, h: 300, label: 'Ideas' },
      { ...sticky, parent: 'sec', index: 'a1' },
      { id: 'a1', type: 'arrow', index: 'a2', start: { el: 'st1' }, end: { x: 500, y: 20 } },
    ]).elements;
    const text = serializeBoard(els);
    expect(text.split('\n')[0]).toBe('{"format":"maude.annotations","v":2,"elements":[');
    const back = parseBoard(text);
    expect(back.dropped).toEqual([]);
    expect(serializeBoard(back.elements)).toBe(text);
    expect(serializeBoard([...els].reverse())).toBe(text);
    // Parent line precedes child line.
    expect(text.indexOf('"id":"sec"')).toBeLessThan(text.indexOf('"id":"st1"'));
  });

  test('empty board is elements:[]; malformed / newer files yield zero elements with a reason', () => {
    expect(serializeBoard([])).toBe('{"format":"maude.annotations","v":2,"elements":[]}\n');
    expect(parseBoard('{').dropped[0]?.reason).toBe('not a board document');
    expect(
      parseBoard('{"format":"maude.annotations","v":3,"elements":[]}').dropped[0]?.reason
    ).toContain('newer');
    expect(parseBoard('<svg/>').elements).toEqual([]);
  });
});

describe('fractional index', () => {
  test('keys are strictly ordered and between', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    const mid = keyBetween(a, b);
    expect(a < mid && mid < b).toBe(true);
    const many = keysBetween(a, b, 50);
    for (let i = 1; i < many.length; i++)
      expect((many[i - 1] as string) < (many[i] as string)).toBe(true);
    expect(keyBetween(null, a) < a).toBe(true);
  });

  test('concurrent inserts collide; (index, id) keeps a total order', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    const k1 = keyBetween(a, b);
    const k2 = keyBetween(a, b);
    expect(k1).toBe(k2);
    expect(compareOrder({ index: k1, id: 'x' }, { index: k2, id: 'y' })).toBe(-1);
  });
});
