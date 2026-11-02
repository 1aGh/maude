// S9.24 — object-level conflict detection (sync/object-conflict.ts) and the answer the
// studio trusts (accepted-link `heldObjects`). The kernel half — both directions, the
// aside, replay-once, v1 unchanged, the three picks — is apps/hub/test/kernel-object-conflict.test.mjs.
import { describe, expect, test } from 'bun:test';
import type { AnnotationElement } from '../annotations/types.ts';
import { heldObjects } from '../sync/accepted-link.ts';
import {
  findObjectConflicts,
  mergeHoldingObjects,
  resolveObjectConflict,
} from '../sync/object-conflict.ts';

const st = (id: string, text: string, extra: Record<string, unknown> = {}): AnnotationElement => ({
  id,
  type: 'sticky',
  index: 'a0',
  x: 630,
  y: 460,
  w: 190,
  h: 120,
  text,
  ...extra,
});
const m = (...els: AnnotationElement[]) => new Map(els.map((e) => [e.id, e]));

const BASE = 'Číslo na zádech?';
const YOURS = 'Číslo na zádech větší — 30 cm';
const JONAS = 'Číslo 25 cm — jinak se nad něj nevejde sponzor';

describe('findObjectConflicts — the unit is one element id', () => {
  test('the same sticky rewritten on both sides is one conflict, in either direction', () => {
    const base = m(st('s1', BASE));
    for (const [mine, theirs] of [
      [YOURS, JONAS],
      [JONAS, YOURS],
    ] as const) {
      const c = findObjectConflicts(base, m(st('s1', mine)), m(st('s1', theirs)));
      expect(c.map((x) => [x.id, x.fields])).toEqual([['s1', ['text']]]);
      expect(c[0]?.mine?.text).toBe(mine);
      expect(c[0]?.theirs?.text).toBe(theirs);
    }
  });

  test('words that do not touch, geometry, and one-sided edits are no conflict', () => {
    const base = m(st('s1', BASE), st('s2', 'B', { index: 'a1' }));
    expect(
      findObjectConflicts(
        base,
        m(st('s1', `Velké ${BASE}`), st('s2', 'B', { index: 'a1' })),
        m(st('s1', `${BASE} Ano.`), st('s2', 'B', { index: 'a1' }))
      )
    ).toEqual([]);
    expect(
      findObjectConflicts(
        base,
        m(st('s1', BASE, { x: 1, rot: 5 }), st('s2', 'B', { index: 'a1' })),
        m(st('s1', BASE, { x: 2, rot: 9 }), st('s2', 'B', { index: 'a1' }))
      )
    ).toEqual([]);
    expect(
      findObjectConflicts(
        base,
        m(st('s1', YOURS), st('s2', 'B', { index: 'a1' })),
        m(st('s1', BASE), st('s2', 'C', { index: 'a1' }))
      )
    ).toEqual([]);
  });

  test('a colour both changed differently is a conflict; delete against an edit is too', () => {
    const base = m(st('s1', BASE, { fill: 'yellow' }));
    expect(
      findObjectConflicts(
        base,
        m(st('s1', BASE, { fill: 'pink' })),
        m(st('s1', BASE, { fill: 'blue' }))
      )[0]?.fields
    ).toEqual(['fill']);
    const del = findObjectConflicts(m(st('s1', BASE)), m(), m(st('s1', JONAS)));
    expect(del[0]?.fields).toEqual(['deleted']);
    expect(del[0]?.mine).toBeNull();
  });
});

describe('mergeHoldingObjects — held at the head, the rest lands', () => {
  test('the conflicted sticky keeps theirs; another sticky moved by mine still moves', () => {
    const base = m(st('s1', BASE), st('s2', 'B', { index: 'a1', x: 0 }));
    const mine = m(st('s1', YOURS), st('s2', 'B', { index: 'a1', x: 400 }));
    const theirs = m(st('s1', JONAS), st('s2', 'B', { index: 'a1', x: 0 }));
    const r = mergeHoldingObjects(base, mine, theirs);
    expect(r.conflicts.map((c) => c.id)).toEqual(['s1']);
    const out = new Map(r.elements.map((e) => [e.id, e]));
    expect(out.get('s1')?.text).toBe(JONAS);
    expect(out.get('s2')?.x).toBe(400);
  });
});

describe('resolveObjectConflict — Keep both is a copy with a fresh id, beside the winner', () => {
  test('two distinct ids, both texts, the copy stacked just above and to the right', () => {
    const head = m(st('s1', JONAS), st('s2', 'B', { index: 'a5' }));
    const r = resolveObjectConflict(head, { id: 's1', mine: st('s1', YOURS) }, 'both');
    const ids = r.elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(3);
    expect(r.copyId).not.toBe('s1');
    const copy = r.elements.find((e) => e.id === r.copyId);
    expect(copy?.text).toBe(YOURS);
    expect(copy?.x).toBe(630 + 190 + 24);
    expect(String(copy?.index) > 'a0' && String(copy?.index) < 'a5').toBe(true);
    expect(r.elements.find((e) => e.id === 's1')?.text).toBe(JONAS);
  });

  test('mine replaces in place (keeps the head’s stacking); theirs changes nothing', () => {
    const head = m(st('s1', JONAS, { index: 'a3' }));
    const mine = resolveObjectConflict(head, { id: 's1', mine: st('s1', YOURS) }, 'mine');
    expect(mine.elements).toEqual([st('s1', YOURS, { index: 'a3' })]);
    expect(
      resolveObjectConflict(head, { id: 's1', mine: st('s1', YOURS) }, 'theirs').elements
    ).toEqual([...head.values()]);
  });
});

describe('heldObjects — only a well-formed answer reaches the card', () => {
  test('reads merged[].conflicts; drops malformed rows; nothing when there is none', () => {
    const r = heldObjects({
      protocol: 1,
      status: 'accepted',
      transactionId: 'tx_1',
      merged: [
        {
          doc: 'd',
          lane: 'annotations',
          merged: true,
          conflicts: [
            { id: 's1', type: 'sticky', fields: ['text', 3], mine: { text: 'a' }, theirs: null },
            { id: 5, type: 'sticky' },
          ],
        } as never,
      ],
    });
    expect(r.objectConflicts).toEqual([
      { id: 's1', type: 'sticky', fields: ['text'], mine: { text: 'a' }, theirs: null },
    ]);
    expect(heldObjects({ protocol: 1, status: 'accepted', transactionId: null })).toEqual({});
  });
});
