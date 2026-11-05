// fix/205 — a REVIVED document publishes every lane it holds.
//
// A delete drops the hub's live document (`deleteDocument`, hub-integration.mjs), so the replica
// a revived document comes back into is empty. The kernel published a revive with no lanes at all:
// the hub's copy stayed empty, and the canvas only looked restored on a peer that still held the
// deleted doc — the stale lineage that doubled a re-created canvas's body. Both ways back — the
// undo of the delete and the Trash restore — must carry the lanes as they stood.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { body, CODECS, MEMBER, rig } from './_kernel-rig.mjs';

const A = 'ws/local/main/ui-a';
const CSS = '.a { color: red; }\n';

for (const [codecName, codec] of CODECS) {
  describe(`a revived document publishes its lanes (${codecName} codec)`, () => {
    async function deleted() {
      const r = rig(codec);
      await r.ok(
        r.propose('you', [
          { op: 'doc.create', doc: A, path: 'ui/a.tsx', lanes: { html: body(), css: CSS } },
        ])
      );
      await r.edit('you', A, body('v1'));
      const entry = (await r.docRow(A)).entry;
      const gone = await r.del('you', A);
      return { r, entry, deleteAction: gone.actionId };
    }

    test('the undo of the delete', async () => {
      const { r, deleteAction } = await deleted();
      await r.ok(r.propose('you', [{ op: 'history.undo', actionId: deleteAction }]));
      const pub = r.published.at(-1).changes.find((c) => c.doc === A);
      assert.equal(pub.revived, true);
      assert.equal(pub.lanes.html, body('v1'));
      assert.equal(pub.lanes.css, CSS);
    });

    test('the Trash restore', async () => {
      const { r, entry } = await deleted();
      await r.ok(r.propose('jonas', [{ op: 'trash.restore', entry }], { auth: MEMBER }));
      const pub = r.published.at(-1).changes.find((c) => c.doc === A);
      assert.equal(pub.revived, true);
      assert.equal(pub.lanes.html, body('v1'));
      assert.equal(pub.lanes.css, CSS);
    });

    test('a plain edit still publishes only the lane it touched', async () => {
      const r = rig(codec);
      await r.ok(
        r.propose('you', [
          { op: 'doc.create', doc: A, path: 'ui/a.tsx', lanes: { html: body(), css: CSS } },
        ])
      );
      await r.edit('you', A, body('v2'));
      const pub = r.published.at(-1).changes.find((c) => c.doc === A);
      assert.deepEqual(Object.keys(pub.lanes), ['html']);
    });
  });
}
