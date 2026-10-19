// S4.13 (canvas 15 `an-stamps`, contract S4 Q7) — a stamp is an upsert by id, a cluster counts one per
// person per kind, and the hover card says "5 stamps on Směr B".

import { describe, expect, test } from 'bun:test';

import { stampId, stampSpotOf } from '../annotations/elements/stamp.model.ts';
import { STAMP_KINDS } from '../annotations/stamp-kinds.ts';
import {
  clusterStamps,
  MAX_FACES,
  STAMP_BOX,
  stampCardRows,
  stampCardTitle,
  stampElement,
  upsertStampStroke,
} from '../annotations/ui/stamps.ts';
import type { ElementStroke, Stroke } from '../annotations-model.ts';

const B = 'ab:smer-b';
const mk = (kind: string, name: string, over: Record<string, unknown> = {}) =>
  stampElement({ kind, who: { name }, target: B, x: 800, y: 360, ...over });

describe('a stamp is an upsert by id', () => {
  test('the id is stamp-<spot>-<author>-<kind> and the box sits on the point', () => {
    const s = mk('yes', 'Jonas');
    expect(s.id).toBe(stampId({ spot: B, author: 'Jonas', kind: 'yes' }));
    expect(s.type).toBe('stamp');
    expect(s.kind).toBe('yes');
    expect(s.target).toBe(B);
    expect(s.w).toBe(STAMP_BOX);
    expect(s.x).toBe(800 - STAMP_BOX / 2);
    expect(s.author).toEqual({ kind: 'human', name: 'Jonas' });
  });
  test('the same person, kind and spot is the same element; another kind or person is another', () => {
    expect(mk('yes', 'Jonas').id).toBe(mk('yes', 'Jonas', { x: 900 }).id);
    expect(mk('yes', 'Jonas').id).not.toBe(mk('star', 'Jonas').id);
    expect(mk('yes', 'Jonas').id).not.toBe(mk('yes', 'Tereza').id);
  });
  test('a free stamp takes the 40 px world cell under the point as its spot', () => {
    const a = stampElement({ kind: 'yes', who: { name: 'Jonas' }, x: 410, y: 410 });
    const b = stampElement({ kind: 'yes', who: { name: 'Jonas' }, x: 439, y: 421 });
    const c = stampElement({ kind: 'yes', who: { name: 'Jonas' }, x: 442, y: 410 });
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
    expect(a.target).toBeUndefined();
  });
  test('an unknown kind or an empty name is refused, not guessed', () => {
    expect(() => stampElement({ kind: 'Nope!', who: { name: 'Jonas' }, x: 0, y: 0 })).toThrow();
  });
  test('upserting replaces the element in place and never doubles it', () => {
    const first = mk('yes', 'Jonas');
    const other: Stroke = { id: 'st', tool: 'sticky' } as Stroke;
    let strokes = upsertStampStroke([other], first);
    expect(strokes).toHaveLength(2);
    strokes = upsertStampStroke(strokes, mk('yes', 'Jonas', { x: 905 }));
    expect(strokes).toHaveLength(2);
    const el = (strokes[1] as ElementStroke).el;
    expect(el.x).toBe(905 - STAMP_BOX / 2);
    expect(strokes[0]).toBe(other);
    strokes = upsertStampStroke(strokes, mk('star', 'Jonas'));
    expect(strokes).toHaveLength(3);
  });
});

describe('clusters count one per person per kind (Q7)', () => {
  const five = [
    mk('yes', 'You'),
    mk('yes', 'Jonas'),
    mk('yes', 'Petra'),
    mk('star', 'Tereza'),
    mk('heart', 'Tereza'),
  ];
  test('five stamps on Směr B are one cluster of 5', () => {
    const cl = clusterStamps(five);
    expect(cl).toHaveLength(1);
    expect(cl[0]?.count).toBe(5);
    expect(cl[0]?.spot).toBe(B);
    expect(cl[0]?.faces).toHaveLength(MAX_FACES);
    expect(cl[0]?.showCount).toBe(true);
  });
  test('a forged second copy (another id, same person + kind + spot) counts once', () => {
    const forged = { ...mk('yes', 'Jonas'), id: 'stamp-forged' };
    expect(clusterStamps([...five, forged])[0]?.count).toBe(5);
  });
  test('two stamps show two faces and no count; one is a lone face', () => {
    const two = clusterStamps([mk('yes', 'Tereza'), mk('yes', 'Jonas')])[0];
    expect(two?.count).toBe(2);
    expect(two?.showCount).toBe(false);
    expect(clusterStamps([mk('ask', 'Petra')])[0]?.faces).toHaveLength(1);
  });
  test('stamps on different spots are different clusters; free ones in one cell gather', () => {
    const a = stampElement({ kind: 'yes', who: { name: 'A' }, x: 405, y: 405 });
    const b = stampElement({ kind: 'star', who: { name: 'B' }, x: 430, y: 430 });
    const far = stampElement({ kind: 'yes', who: { name: 'A' }, x: 905, y: 905 });
    const cl = clusterStamps([a, b, far, mk('yes', 'Jonas')]);
    expect(cl).toHaveLength(3);
    const gathered = cl.find((c) => c.count === 2);
    expect(gathered?.items.map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
    expect(gathered?.spot).toBe(stampSpotOf(a));
  });
  test('a bound cluster sits on its host; a free one on its first stamp', () => {
    const host = { x: 600, y: 190, w: 360, h: 203 };
    const bound = clusterStamps(five, (t) => (t === B ? host : null))[0];
    expect(bound?.x).toBeGreaterThanOrEqual(host.x);
    expect(bound?.y).toBeGreaterThan(host.y + host.h - 60);
    const free = clusterStamps(five)[0];
    expect(typeof free?.x).toBe('number');
  });
  test('anything that is not a stamp, or has no kind, is ignored', () => {
    expect(
      clusterStamps([{ id: 'x', type: 'sticky' } as never, { ...mk('yes', 'A'), kind: '' }])
    ).toEqual([]);
  });
});

describe('the hover card', () => {
  test('"5 stamps on Směr B"', () => {
    expect(stampCardTitle(5, 'Směr B')).toBe('5 stamps on Směr B');
    expect(stampCardTitle(1, 'Směr B')).toBe('1 stamp on Směr B');
    expect(stampCardTitle(2, '')).toBe('2 stamps');
  });
  test('one row per stamp: who, what, ordered by person then kind', () => {
    const rows = stampCardRows(
      clusterStamps([mk('star', 'Tereza'), mk('yes', 'You'), mk('heart', 'Tereza')])[0]!,
      'You'
    );
    expect(rows.map((r) => `${r.who} ${r.name}`)).toEqual([
      'You Yes',
      'Tereza Star',
      'Tereza Love it',
    ]);
    expect(STAMP_KINDS.some((k) => k.name === 'Love it')).toBe(true);
  });
});
