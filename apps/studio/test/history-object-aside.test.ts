// S9.24 — Version history · "this sticky" lists the version a conflict did not keep. The kernel
// keeps the loser's board aside in the SAME edit action (kind `edit`), so the reader must read
// `@aside` effects on edit actions too, not only on `history.aside` (kind `aside`).
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import { serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { asideVersionsOf } from '../history/object-aside.ts';
import type { HistoryAction } from '../sync/accepted-link.ts';

const sticky = (id: string, text: string): AnnotationElement => ({
  id,
  type: 'sticky',
  index: 'a0',
  x: 0,
  y: 0,
  w: 190,
  h: 120,
  text,
});
const blobs = new Map<string, string>();
const put = (els: AnnotationElement[]) => {
  const body = serializeBoard(els);
  const h = createHash('sha256').update(body).digest('hex');
  blobs.set(h, body);
  return h;
};
const action = (
  revision: number,
  kind: string,
  actor: string,
  effects: Array<{ lane: string; op: string; afterHash?: string }>
): HistoryAction => ({
  revision,
  actor,
  actionId: `act_${revision}`,
  kind,
  label: null,
  committedAt: revision * 1000,
  undoes: null,
  effects: effects.map((e) => ({ doc: 'ui-a', beforePath: null, afterPath: null, ...e })),
});
const read = async (h: string) => blobs.get(h) ?? null;

describe('asideVersionsOf', () => {
  test('a held conflict (kind edit) and a history.aside (kind aside) are both rows; other stickies and lanes are not', async () => {
    const yours = put([sticky('s1', 'Číslo na zádech větší — 30 cm'), sticky('s2', 'x')]);
    const pick = put([sticky('s1', 'Číslo na zádech?')]);
    const other = put([sticky('s7', 'nothing to do with s1')]);
    const actions = [
      action(5, 'edit', 'You', [
        { lane: 'annotations', op: 'lane.replace', afterHash: put([sticky('s1', 'Jonas')]) },
        { lane: '@aside', op: 'aside.annotations', afterHash: yours },
      ]),
      action(3, 'aside', 'Tereza', [{ lane: '@aside', op: 'aside.annotations', afterHash: pick }]),
      action(4, 'edit', 'You', [{ lane: '@aside', op: 'aside.annotations', afterHash: other }]),
      action(2, 'edit', 'You', [{ lane: '@aside', op: 'aside.meta', afterHash: yours }]),
    ];
    const rows = await asideVersionsOf(actions, 's1', read);
    expect(rows.map((r) => [r.revision, r.kind, r.actor, r.element.text])).toEqual([
      [5, 'edit', 'You', 'Číslo na zádech větší — 30 cm'],
      [3, 'aside', 'Tereza', 'Číslo na zádech?'],
    ]);
  });

  test('a missing blob or a malformed hash is skipped, never a guess', async () => {
    const rows = await asideVersionsOf(
      [
        action(9, 'edit', 'You', [
          { lane: '@aside', op: 'aside.annotations', afterHash: 'f'.repeat(64) },
        ]),
        action(8, 'edit', 'You', [{ lane: '@aside', op: 'aside.annotations', afterHash: '../x' }]),
      ],
      's1',
      read
    );
    expect(rows).toEqual([]);
  });
});
