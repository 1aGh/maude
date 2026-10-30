// S9.24 — object-level conflicts at proposal replay (S9 Q10, decision
// maude/v2-S9-object-conflict-per-element-id). A proposal made on an older base
// (an offline Mac coming back) that changed the SAME sticky a peer changed meanwhile
// is held at the head's version, its own board is kept aside in the same action,
// and the answer names the element. Tested in BOTH directions (sync is not
// symmetric — whoever replays second is the loser), plus: a v1 proposal (no flag)
// merges exactly as before, and a replay of the same transaction answers once.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseBoard, serializeBoard } from '../../studio/annotations/schema.ts';
import { resolveObjectConflict } from '../../studio/sync/object-conflict.ts';
import { laneHash } from '../src/project-transactions/lanes.mjs';
import { body, rig } from './_kernel-rig.mjs';

const A = 'ws/local/main/ui-a';

const sticky = (id, text, extra = {}) => ({
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
const board = (...els) => serializeBoard(els);
const textsOf = (content) =>
  parseBoard(content)
    .elements.map((e) => `${e.id}:${e.text}`)
    .sort();

const BASE = 'Číslo na zádech?';
const YOURS = 'Číslo na zádech větší — 30 cm';
const JONAS = 'Číslo 25 cm — jinak se nad něj nevejde sponzor';

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
          annotations: board(sticky('s_one', BASE), sticky('s_two', 'B', { index: 'a1', x: 0 })),
        },
      },
    ])
  );
  const base = await r.head(A, 'annotations');
  const replace = (actor, content, { hold = true, tx } = {}) =>
    r.propose(
      actor,
      [
        {
          op: 'lane.replace',
          doc: A,
          lane: 'annotations',
          content,
          baseContent: base,
          ...(hold ? { objects: 'hold' } : {}),
        },
      ],
      tx ? { tx } : {}
    );
  return { r, base, replace };
}

for (const [first, second] of [
  ['jonas', 'you'],
  ['you', 'jonas'],
]) {
  describe(`object conflict — ${first} lands first, ${second} replays (both directions)`, () => {
    const textOf = { you: YOURS, jonas: JONAS };

    test('the replaying side is held at the head, kept aside, and told which sticky', async () => {
      const { r, base, replace } = await setup();
      const won = await r.ok(
        replace(
          first,
          board(sticky('s_one', textOf[first]), sticky('s_two', 'B', { index: 'a1', x: 0 }))
        )
      );
      assert.deepEqual(won.merged ?? [], [], 'the first one is an ordinary edit');
      // The second was made on the same base (offline) — it also moved the OTHER sticky.
      const mine = board(
        sticky('s_one', textOf[second]),
        sticky('s_two', 'B', { index: 'a1', x: 400 })
      );
      const res = await r.ok(replace(second, mine));
      const head = parseBoard(await r.head(A, 'annotations')).elements;
      assert.equal(head.find((e) => e.id === 's_one').text, textOf[first], 'no silent overwrite');
      assert.equal(head.find((e) => e.id === 's_two').x, 400, 'the rest of the change still lands');
      const [m] = res.merged;
      assert.equal(m.conflicts.length, 1);
      assert.equal(m.conflicts[0].id, 's_one');
      assert.deepEqual(m.conflicts[0].fields, ['text']);
      assert.equal(m.conflicts[0].mine.text, textOf[second]);
      assert.equal(m.conflicts[0].theirs.text, textOf[first]);
      // Nothing lost: the loser's board is an @aside effect of THIS action, restorable.
      const logged = await r.row(res.actionId);
      const aside = logged.effects.filter((fx) => fx.lane === '@aside');
      assert.equal(aside.length, 1);
      assert.equal(aside[0].op, 'aside.annotations');
      assert.equal(aside[0].afterHash, laneHash(mine));
      assert.equal(await r.store.blob(aside[0].afterHash), mine);
      void base;
    });

    test('a replay of the same transaction answers once (one action, one aside)', async () => {
      const { r, replace } = await setup();
      await r.ok(
        replace(
          first,
          board(sticky('s_one', textOf[first]), sticky('s_two', 'B', { index: 'a1', x: 0 }))
        )
      );
      const mine = board(
        sticky('s_one', textOf[second]),
        sticky('s_two', 'B', { index: 'a1', x: 0 })
      );
      const a = await r.ok(replace(second, mine, { tx: 'tx-replay-0001' }));
      const revAfter = await r.rev();
      const b = await r.ok(replace(second, mine, { tx: 'tx-replay-0001' }));
      assert.equal(b.actionId, a.actionId, 'the same answer');
      assert.equal(await r.rev(), revAfter, 'no second action');
    });
  });
}

describe('object conflict — what is NOT a conflict', () => {
  test('different words in one sticky that do not touch merge (both kept, no card)', async () => {
    const { r, replace } = await setup();
    const two = sticky('s_two', 'B', { index: 'a1', x: 0 });
    await r.ok(replace('jonas', board(sticky('s_one', `${BASE} Ano.`), two)));
    const res = await r.ok(replace('you', board(sticky('s_one', `Velké ${BASE}`), two)));
    assert.equal(res.merged[0].conflicts, undefined);
    assert.deepEqual(textsOf(await r.head(A, 'annotations')), [
      `s_one:Velké ${BASE} Ano.`,
      's_two:B',
    ]);
  });

  test('a drag race keeps acceptance order (geometry is never a card)', async () => {
    const { r, replace } = await setup();
    const two = sticky('s_two', 'B', { index: 'a1', x: 0 });
    await r.ok(replace('jonas', board(sticky('s_one', BASE, { x: 10 }), two)));
    const res = await r.ok(replace('you', board(sticky('s_one', BASE, { x: 20 }), two)));
    assert.equal(res.merged[0].conflicts, undefined);
    const head = parseBoard(await r.head(A, 'annotations')).elements;
    assert.equal(head.find((e) => e.id === 's_one').x, 20);
  });

  test('a v1 proposal (no `objects` field) merges exactly as before — acceptance order', async () => {
    const { r, replace } = await setup();
    const two = sticky('s_two', 'B', { index: 'a1', x: 0 });
    await r.ok(replace('jonas', board(sticky('s_one', JONAS), two), { hold: false }));
    const res = await r.ok(replace('you', board(sticky('s_one', YOURS), two), { hold: false }));
    assert.equal(res.merged[0].conflicts, undefined);
    const logged = await r.row(res.actionId);
    assert.equal(logged.effects.filter((fx) => fx.lane === '@aside').length, 0);
    const head = parseBoard(await r.head(A, 'annotations')).elements;
    assert.equal(
      head.find((e) => e.id === 's_one').text,
      YOURS,
      'the v1 rule: ours wins an overlap'
    );
  });

  test('deleted on one side, changed on the other, is a conflict (the change is kept)', async () => {
    const { r, replace } = await setup();
    const two = sticky('s_two', 'B', { index: 'a1', x: 0 });
    await r.ok(replace('jonas', board(sticky('s_one', JONAS), two)));
    const res = await r.ok(replace('you', board(two)));
    assert.equal(res.merged[0].conflicts[0].id, 's_one');
    assert.deepEqual(res.merged[0].conflicts[0].fields, ['deleted']);
    assert.equal(res.merged[0].conflicts[0].mine, null);
    const head = parseBoard(await r.head(A, 'annotations')).elements;
    assert.equal(head.find((e) => e.id === 's_one').text, JONAS);
  });
});

describe('the card — Keep yours / Keep theirs / Keep both, each one action on the head', () => {
  async function held() {
    const { r, replace } = await setup();
    const two = sticky('s_two', 'B', { index: 'a1', x: 0 });
    await r.ok(replace('jonas', board(sticky('s_one', JONAS), two)));
    const res = await r.ok(replace('you', board(sticky('s_one', YOURS), two)));
    const [conflict] = res.merged[0].conflicts;
    const pick = async (choice) => {
      const headText = await r.head(A, 'annotations');
      const headMap = new Map(parseBoard(headText).elements.map((e) => [e.id, e]));
      const out = resolveObjectConflict(headMap, conflict, choice);
      const before = await r.rev();
      const content = out.elements.length ? serializeBoard(out.elements) : '';
      if (content !== headText) {
        await r.ok(
          r.propose('you', [
            {
              op: 'lane.replace',
              doc: A,
              lane: 'annotations',
              content,
              base: laneHash(headText),
              objects: 'hold',
            },
          ])
        );
      }
      return {
        out,
        steps: (await r.rev()) - before,
        head: parseBoard(await r.head(A, 'annotations')).elements,
      };
    };
    return { pick };
  }

  test('Keep both: two stickies with distinct ids, both texts, ONE action', async () => {
    const { pick } = await held();
    const { out, steps, head } = await pick('both');
    assert.equal(steps, 1, 'one action — one undo step');
    const stickies = head.filter((e) => e.type === 'sticky' && e.id !== 's_two');
    assert.equal(stickies.length, 2);
    assert.notEqual(stickies[0].id, stickies[1].id);
    assert.ok(out.copyId && out.copyId !== 's_one');
    assert.deepEqual(stickies.map((e) => e.text).sort(), [JONAS, YOURS].sort());
    const copy = head.find((e) => e.id === out.copyId);
    assert.equal(copy.x, 630 + 190 + 24, 'beside the winner');
    // A v1 peer reads the result: a plain board, nothing dropped.
    assert.equal(parseBoard(serializeBoard(head)).dropped.length, 0);
  });

  test('Keep yours: the sticky becomes yours, one action', async () => {
    const { pick } = await held();
    const { steps, head } = await pick('mine');
    assert.equal(steps, 1);
    assert.equal(head.find((e) => e.id === 's_one').text, YOURS);
    assert.equal(head.filter((e) => e.type === 'sticky').length, 2);
  });

  test("Keep Jonas's: nothing changes (yours stays kept aside)", async () => {
    const { pick } = await held();
    const { steps, head } = await pick('theirs');
    assert.equal(steps, 0);
    assert.equal(head.find((e) => e.id === 's_one').text, JONAS);
  });
});
