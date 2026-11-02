// gate-a-fix4a — ⌘Z after ⌘Z → ⇧⌘Z. The ⌘Z projection (client/v2/undo/projection.js) names an
// entry by its own action id for good: after an undo and its redo the entry is `done` again and the
// next ⌘Z sends `history.undo` of that SAME action. The kernel used to rebase that revert through the
// action's own undo and redo as if they were someone else's later work — they cancel out to "no
// change", so the press came back `undo-conflict` (409) and the shell marked your own edit stale.
// A target's own undo / redo chain is the target's history, not later work: the revert skips it.
// Everyone else's later work still rebases (and still conflicts). Kernel layer, both codecs, with and
// without the batched `store.actions`.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { body, CODECS, rig } from './_kernel-rig.mjs';

const A = 'ws/local/main/ui-a';
const two = (p, q) => body(p, `\n    <i>spacer</i>\n    <i>spacer</i>\n    <p>${q}</p>`);
const undo = (actionId) => [{ op: 'history.undo', actionId }];
const redo = (actionId) => [{ op: 'history.redo', actionId }];

for (const [name, codec] of CODECS) {
  for (const drop of [[], ['actions']]) {
    describe(`undo after undo + redo (${name}${drop.length ? ', no store.actions' : ''})`, () => {
      test('⌘Z → ⇧⌘Z → ⌘Z undoes the edit again, and the cycle repeats', async () => {
        const r = rig(codec, { drop });
        await r.create('you', A, 'ui/a.tsx', two('v0', 'q0'));
        const a = (await r.edit('you', A, two('v1', 'q0'))).actionId;
        const u1 = await r.ok(r.propose('you', undo(a), { label: 'Undo' }));
        assert.equal(await r.head(A), two('v0', 'q0'));
        await r.ok(r.propose('you', redo(u1.actionId), { label: 'Redo' }));
        assert.equal(await r.head(A), two('v1', 'q0'));
        const u2 = await r.propose('you', undo(a), { label: 'Undo' });
        assert.equal(u2.status, 200, JSON.stringify(u2.body));
        assert.equal(await r.head(A), two('v0', 'q0'));
        // and once more round: redo the second undo, undo the edit a third time
        await r.ok(r.propose('you', redo(u2.body.actionId), { label: 'Redo' }));
        assert.equal(await r.head(A), two('v1', 'q0'));
        await r.ok(r.propose('you', undo(a), { label: 'Undo' }));
        assert.equal(await r.head(A), two('v0', 'q0'));
      });

      test('a multi-target undo (Undo history) after the cycle undoes it too', async () => {
        const r = rig(codec, { drop });
        await r.create('you', A, 'ui/a.tsx', two('v0', 'q0'));
        const a = (await r.edit('you', A, two('v1', 'q0'))).actionId;
        const u1 = await r.ok(r.propose('you', undo(a), { label: 'Undo' }));
        await r.ok(r.propose('you', redo(u1.actionId), { label: 'Redo' }));
        await r.ok(r.propose('you', [{ op: 'history.undo', actionIds: [a] }]));
        assert.equal(await r.head(A), two('v0', 'q0'));
      });

      test('a peer’s later edit elsewhere in the file is kept', async () => {
        const r = rig(codec, { drop });
        await r.create('you', A, 'ui/a.tsx', two('v0', 'q0'));
        const a = (await r.edit('you', A, two('v1', 'q0'))).actionId;
        const u1 = await r.ok(r.propose('you', undo(a), { label: 'Undo' }));
        await r.ok(r.propose('you', redo(u1.actionId), { label: 'Redo' }));
        await r.edit('peer', A, two('v1', 'q1'));
        await r.ok(r.propose('you', undo(a), { label: 'Undo' }));
        assert.equal(await r.head(A), two('v0', 'q1'));
      });

      test('a peer who changed the same spot after the redo still makes it a conflict', async () => {
        const r = rig(codec, { drop });
        await r.create('you', A, 'ui/a.tsx', two('v0', 'q0'));
        const a = (await r.edit('you', A, two('v1', 'q0'))).actionId;
        const u1 = await r.ok(r.propose('you', undo(a), { label: 'Undo' }));
        await r.ok(r.propose('you', redo(u1.actionId), { label: 'Redo' }));
        await r.edit('peer', A, two('v2', 'q0'));
        const u2 = await r.propose('you', undo(a), { label: 'Undo' });
        assert.equal(u2.status, 409, JSON.stringify(u2.body));
        assert.equal(u2.body.code, 'undo-conflict');
        assert.equal(await r.head(A), two('v2', 'q0'));
      });
    });
  }
}
