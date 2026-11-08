// #113 slice A — checklist sync (contract 113-checklist §3 option 1 vs 2, §7). One element per entry
// means two people working one list at once keep BOTH changes; an `items` array on the sticky would lose one.
// Two docs on the in-memory transport, partitioned then healed, both directions (memory: sync is asymmetric).

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { checkitem, itemsOf } from '../annotations/elements/checkitem.model.ts';
import { keyBetween } from '../annotations/fractional-index.ts';
import { applyOpsToReplica, readReplica, writeReplica } from '../annotations/replica.ts';
import { validateElements } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';

const AT = '2026-11-08T10:12:00Z';

function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  let live = true;
  a.on('update', (u: Uint8Array, origin: unknown) => {
    if (live && origin !== 'wire') Y.applyUpdate(b, u, 'wire');
  });
  b.on('update', (u: Uint8Array, origin: unknown) => {
    if (live && origin !== 'wire') Y.applyUpdate(a, u, 'wire');
  });
  return {
    a,
    b,
    cut: () => {
      live = false;
    },
    heal: () => {
      live = true;
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), 'wire');
      Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)), 'wire');
    },
  };
}

const board = (): AnnotationElement[] =>
  validateElements([
    { id: 's1', type: 'sticky', index: 'a0', x: 0, y: 0, w: 220, h: 176, text: 'Launch' },
    { id: 'c1', type: 'checkitem', index: 'a0', list: 's1', text: 'Write the post' },
    { id: 'c2', type: 'checkitem', index: 'a1', list: 's1', text: 'Record the demo' },
    { id: 'c3', type: 'checkitem', index: 'a2', list: 's1', text: 'Ship' },
  ]).elements;

const items = (doc: Y.Doc) => itemsOf(readReplica(doc)?.elements ?? [], 's1');
const byId = (doc: Y.Doc) => new Map(items(doc).map((e) => [e.id, e]));

for (const first of ['a', 'b'] as const) {
  describe(`concurrent work on one checklist (${first} applies first)`, () => {
    const both = (fa: () => void, fb: () => void) => {
      if (first === 'a') {
        fa();
        fb();
      } else {
        fb();
        fa();
      }
    };

    test('two people tick two different entries at once — both ticks land', () => {
      const { a, b, cut, heal } = pair();
      writeReplica(a, board());
      cut();
      both(
        () =>
          applyOpsToReplica(a, [{ op: 'patch', id: 'c1', set: { done: { by: 'Jonas', at: AT } } }]),
        () =>
          applyOpsToReplica(b, [{ op: 'patch', id: 'c2', set: { done: { by: 'Ana', at: AT } } }])
      );
      heal();
      for (const doc of [a, b]) {
        const m = byId(doc);
        expect(m.get('c1')?.done).toEqual({ by: 'Jonas', at: AT });
        expect(m.get('c2')?.done).toEqual({ by: 'Ana', at: AT });
        expect(m.get('c3')?.done).toBeUndefined();
      }
    });

    test('a tick and a reword of the same entry — both land', () => {
      const { a, b, cut, heal } = pair();
      writeReplica(a, board());
      cut();
      both(
        () =>
          applyOpsToReplica(a, [{ op: 'patch', id: 'c1', set: { done: { by: 'Jonas', at: AT } } }]),
        () =>
          applyOpsToReplica(b, [{ op: 'patch', id: 'c1', set: { text: 'Write the launch post' } }])
      );
      heal();
      for (const doc of [a, b]) {
        expect(byId(doc).get('c1')).toMatchObject({
          text: 'Write the launch post',
          done: { by: 'Jonas', at: AT },
        });
      }
    });

    test('an entry added while another is reordered — both land', () => {
      const { a, b, cut, heal } = pair();
      writeReplica(a, board());
      cut();
      both(
        () =>
          applyOpsToReplica(a, [
            {
              op: 'put',
              el: validateElements([
                {
                  id: 'c4',
                  type: 'checkitem',
                  index: keyBetween('a2', null),
                  list: 's1',
                  text: 'Celebrate',
                },
              ]).elements[0] as AnnotationElement,
            },
          ]),
        () =>
          applyOpsToReplica(b, [{ op: 'patch', id: 'c3', set: { index: keyBetween(null, 'a0') } }])
      );
      heal();
      for (const doc of [a, b]) {
        expect(items(doc).map((e) => e.id)).toEqual(['c3', 'c1', 'c2', 'c4']);
      }
    });

    test('an entry removed while a neighbour is ticked — both land', () => {
      const { a, b, cut, heal } = pair();
      writeReplica(a, board());
      cut();
      both(
        () => applyOpsToReplica(a, [{ op: 'delete', id: 'c1' }]),
        () =>
          applyOpsToReplica(b, [{ op: 'patch', id: 'c2', set: { done: { by: 'Ana', at: AT } } }])
      );
      heal();
      for (const doc of [a, b]) {
        expect(items(doc).map((e) => e.id)).toEqual(['c2', 'c3']);
        expect(byId(doc).get('c2')?.done).toEqual({ by: 'Ana', at: AT });
      }
    });
  });
}

test('the shape the contract rejected loses a tick — an items array is one LWW value', () => {
  // The same experiment on an `items` array carried as an extension field of the sticky: two ticks, one survives.
  const { a, b, cut, heal } = pair();
  const withArray = validateElements([
    {
      id: 's1',
      type: 'sticky',
      index: 'a0',
      x: 0,
      y: 0,
      w: 220,
      h: 176,
      text: 'Launch',
      items: [
        { text: 'one', done: false },
        { text: 'two', done: false },
      ],
    },
  ]).elements;
  writeReplica(a, withArray);
  cut();
  applyOpsToReplica(a, [
    {
      op: 'patch',
      id: 's1',
      set: {
        items: [
          { text: 'one', done: true },
          { text: 'two', done: false },
        ],
      },
    },
  ]);
  applyOpsToReplica(b, [
    {
      op: 'patch',
      id: 's1',
      set: {
        items: [
          { text: 'one', done: false },
          { text: 'two', done: true },
        ],
      },
    },
  ]);
  heal();
  const got = (readReplica(a)?.elements[0]?.items ?? []) as Array<{ done: boolean }>;
  expect(got.filter((i) => i.done)).toHaveLength(1); // one tick lost
});

test('checkitem is the type under test', () => {
  expect(checkitem.type).toBe('checkitem');
});
