// T5.2 (#165) — the kernel refuses an undo that would drop a collaborator's text (kg
// maude/v2-michal-undo-refuses-over-collaborator-text). A v2 studio already asks before it sends the
// undo (sync/hub-text-undo.ts); an older desktop does not, and the annotations lane merge lets the
// revert win on an overlapping text ("ours"), so their words were silently lost. The kernel now runs
// the same 3-way text check while it rebases the revert through later work: an overlap refuses the
// WHOLE undo `undo-conflict` (one target or several — never half applied), a non-overlapping edit
// still merges, and every other field keeps the lane merge it had.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseBoard, serializeBoard } from '../../studio/annotations/schema.ts';
import { laneHash } from '../src/project-transactions/lanes.mjs';
import { body, rig } from './_kernel-rig.mjs';

const A = 'ws/local/main/ui-a';

const sticky = (id, text, extra = {}) => ({
  id,
  type: 'sticky',
  index: 'a0',
  x: 0,
  y: 0,
  w: 190,
  h: 120,
  text,
  ...extra,
});
const board = (...els) => serializeBoard(els);
const textOf = (content, id) => parseBoard(content).elements.find((e) => e.id === id)?.text;

async function setup() {
  const r = rig(null);
  await r.ok(
    r.propose('you', [
      {
        op: 'doc.create',
        doc: A,
        path: 'ui/a.tsx',
        lanes: {
          html: body(),
          annotations: board(sticky('s1', 'Hello'), sticky('s2', 'Other', { index: 'a1' })),
        },
      },
    ])
  );
  const replace = async (actor, content) =>
    r.ok(
      r.propose(actor, [
        {
          op: 'lane.replace',
          doc: A,
          lane: 'annotations',
          content,
          base: laneHash(await r.head(A, 'annotations')),
        },
      ])
    );
  return { r, replace };
}

describe('undo over a collaborator’s text', () => {
  test('their later edit overlaps mine → undo-conflict; their text stays', async () => {
    const { r, replace } = await setup();
    const mine = await replace(
      'you',
      board(sticky('s1', 'Hello world'), sticky('s2', 'Other', { index: 'a1' }))
    );
    await replace(
      'jonas',
      board(sticky('s1', 'Hello planet'), sticky('s2', 'Other', { index: 'a1' }))
    );
    const u = await r.propose('you', [{ op: 'history.undo', actionId: mine.actionId }]);
    assert.equal(u.status, 409, JSON.stringify(u.body));
    assert.equal(u.body.code, 'undo-conflict');
    assert.equal(textOf(await r.head(A, 'annotations'), 's1'), 'Hello planet');
  });

  test('their later edit does not overlap mine → the undo merges and keeps it', async () => {
    const { r, replace } = await setup();
    const mine = await replace(
      'you',
      board(sticky('s1', 'Hello world'), sticky('s2', 'Other', { index: 'a1' }))
    );
    await replace(
      'jonas',
      board(sticky('s1', 'Peer: Hello world'), sticky('s2', 'Other', { index: 'a1' }))
    );
    const u = await r.propose('you', [{ op: 'history.undo', actionId: mine.actionId }]);
    assert.equal(u.status, 200, JSON.stringify(u.body));
    assert.equal(textOf(await r.head(A, 'annotations'), 's1'), 'Peer: Hello');
  });

  test('a later move of the same sticky is no text overlap → the undo goes through', async () => {
    const { r, replace } = await setup();
    const mine = await replace(
      'you',
      board(sticky('s1', 'Hello world'), sticky('s2', 'Other', { index: 'a1' }))
    );
    await replace(
      'jonas',
      board(sticky('s1', 'Hello world', { x: 400 }), sticky('s2', 'Other', { index: 'a1' }))
    );
    const u = await r.propose('you', [{ op: 'history.undo', actionId: mine.actionId }]);
    assert.equal(u.status, 200, JSON.stringify(u.body));
    const el = parseBoard(await r.head(A, 'annotations')).elements.find((e) => e.id === 's1');
    assert.equal(el.text, 'Hello');
    assert.equal(el.x, 400);
  });

  test('several targets: one overlap refuses all of them — nothing is half applied', async () => {
    const { r, replace } = await setup();
    const html = await r.edit('you', A, body('v1'));
    const mine = await replace(
      'you',
      board(sticky('s1', 'Hello world'), sticky('s2', 'Other', { index: 'a1' }))
    );
    await replace(
      'jonas',
      board(sticky('s1', 'Hello planet'), sticky('s2', 'Other', { index: 'a1' }))
    );
    const before = (await r.kernel.state()).revision;
    const u = await r.propose('you', [
      { op: 'history.undo', actionIds: [html.actionId, mine.actionId] },
    ]);
    assert.equal(u.status, 409, JSON.stringify(u.body));
    assert.equal(u.body.code, 'undo-conflict');
    assert.equal((await r.kernel.state()).revision, before, 'no new version');
    assert.equal(await r.head(A), body('v1'), 'the source edit is not undone either');
    assert.equal(textOf(await r.head(A, 'annotations'), 's1'), 'Hello planet');
  });
});
