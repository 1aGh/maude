// P8 bug sweep B2 — ⌘Z ⌘Z after three Inspector edits to one element said "Can't undo Edit canvas — someone
// else changed it since" with nobody else there. Opacity then corners are two insertions side by side in the
// element's one `style` string; ⌘Z #1 undid the corners (fine), ⌘Z #2 had to revert the opacity and rebased
// that revert through the corners edit AND its own undo as if they were someone else's later work. Edit and
// undo cancel to nothing, but diff3 sees two touching hunks and called it a conflict, so the press came back
// `undo-conflict` and the step was skipped: the next ⌘Z undid something older and the opacity stayed.
// The actor's finished round trips (an edit and the undo that reverted it) are not later work.
// Kernel layer, both codecs, with and without the batched `store.actions`.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { body, CODECS, rig } from './_kernel-rig.mjs';

const A = 'ws/local/main/ui-a';
// one element, one attribute string the edits grow on the same line, side by side
const style = (...props) => body(`s ${props.join(' , ')}`.trim());
const undo = (actionId) => [{ op: 'history.undo', actionId }];
const redo = (actionId) => [{ op: 'history.redo', actionId }];

for (const [name, codec] of CODECS) {
  for (const drop of [[], ['actions']]) {
    describe(`undo past an undone neighbour (${name}${drop.length ? ', no store.actions' : ''})`, () => {
      test('width → opacity → corners: ⌘Z ⌘Z ⌘Z walks all three back', async () => {
        const r = rig(codec, { drop });
        await r.create('you', A, 'ui/a.tsx', style('w1'));
        const e1 = (await r.edit('you', A, style('w2'))).actionId;
        const e2 = (await r.edit('you', A, style('w2', 'o5'))).actionId;
        const e3 = (await r.edit('you', A, style('w2', 'o5', 'r12'))).actionId;
        await r.ok(r.propose('you', undo(e3), { label: 'Undo' }));
        assert.equal(await r.head(A), style('w2', 'o5'));
        const u2 = await r.propose('you', undo(e2), { label: 'Undo' });
        assert.equal(u2.status, 200, JSON.stringify(u2.body));
        assert.equal(await r.head(A), style('w2'));
        await r.ok(r.propose('you', undo(e1), { label: 'Undo' }));
        assert.equal(await r.head(A), style('w1'));
      });

      test('undo → redo → undo of the newer edit, then the older one beside it', async () => {
        const r = rig(codec, { drop });
        await r.create('you', A, 'ui/a.tsx', style('w1'));
        const e1 = (await r.edit('you', A, style('w1', 'o5'))).actionId;
        const e2 = (await r.edit('you', A, style('w1', 'o5', 'r12'))).actionId;
        const u = await r.ok(r.propose('you', undo(e2), { label: 'Undo' }));
        await r.ok(r.propose('you', redo(u.actionId), { label: 'Redo' }));
        await r.ok(r.propose('you', undo(e2), { label: 'Undo' }));
        assert.equal(await r.head(A), style('w1', 'o5'));
        const c = await r.propose('you', undo(e1), { label: 'Undo' });
        assert.equal(c.status, 200, JSON.stringify(c.body));
        assert.equal(await r.head(A), style('w1'));
      });

      test('⇧⌘Z past a neighbour that was undone and redone in between', async () => {
        const r = rig(codec, { drop });
        await r.create('you', A, 'ui/a.tsx', style('w1'));
        const e1 = (await r.edit('you', A, style('w1', 'o5'))).actionId;
        const e2 = (await r.edit('you', A, style('w1', 'o5', 'r12'))).actionId;
        const u2 = await r.ok(r.propose('you', undo(e2), { label: 'Undo' }));
        const u1 = await r.ok(r.propose('you', undo(e1), { label: 'Undo' }));
        assert.equal(await r.head(A), style('w1'));
        await r.ok(r.propose('you', redo(u1.actionId), { label: 'Redo' }));
        assert.equal(await r.head(A), style('w1', 'o5'));
        // the corners redo reverts its undo through the opacity's undo + redo, a round trip that came to nothing
        const c = await r.propose('you', redo(u2.actionId), { label: 'Redo' });
        assert.equal(c.status, 200, JSON.stringify(c.body));
        assert.equal(await r.head(A), style('w1', 'o5', 'r12'));
      });

      test('after a redo the edit is live again: undoing the one before it conflicts only if it must', async () => {
        const r = rig(codec, { drop });
        await r.create('you', A, 'ui/a.tsx', style('w1'));
        const e1 = (await r.edit('you', A, style('w1', 'o5'))).actionId;
        const e2 = (await r.edit('you', A, style('w1', 'o5', 'r12'))).actionId;
        const u = await r.ok(r.propose('you', undo(e2), { label: 'Undo' }));
        await r.ok(r.propose('you', redo(u.actionId), { label: 'Redo' }));
        assert.equal(await r.head(A), style('w1', 'o5', 'r12'));
        // the corners edit is back in force beside the opacity: reverting the opacity under it is a real clash
        const c = await r.propose('you', undo(e1), { label: 'Undo' });
        assert.equal(c.status, 409, JSON.stringify(c.body));
        assert.equal(await r.head(A), style('w1', 'o5', 'r12'));
      });

      test('a peer’s edit beside the target is still a conflict', async () => {
        const r = rig(codec, { drop });
        await r.create('you', A, 'ui/a.tsx', style('w1'));
        const e1 = (await r.edit('you', A, style('w1', 'o5'))).actionId;
        await r.edit('peer', A, style('w1', 'o5', 'r12'));
        const c = await r.propose('you', undo(e1), { label: 'Undo' });
        assert.equal(c.status, 409, JSON.stringify(c.body));
        assert.equal(c.body.code, 'undo-conflict');
      });
    });
  }
}
