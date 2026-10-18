// S1.6 — the shared Trash on the op log: derivation, `trash.restore`,
// `trash.clear` + `trash_cleared`, the per-op role gate (S1-trash.md; S1-slices
// Q2–Q4; V2-1.7 `trash` / `delete`; V2-1.16 L18). Kernel layer, both codecs.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { laneHash } from '../src/project-transactions/lanes.mjs';
import { body, CODECS, canvasOnly, MEMBER, OWNER, rig } from './_kernel-rig.mjs';

const A = 'ws/local/main/ui-a';
const B = 'ws/local/main/ui-b';
const restore = (entry) => [{ op: 'trash.restore', entry }];
const clear = (items) => [{ op: 'trash.clear', ...(items ? { items } : {}) }];

/** An S2 artboard-trash action (S1-trash.md §2): removes artboard `p` from A. */
async function trashArtboard(r, actor = 'you', trashed = [{ artboard: 'p', label: 'Post 1:1' }]) {
  return r.edit(actor, A, body('without-p'), {
    kind: 'trash',
    label: 'Moved “Post 1:1” to the trash',
    origin: { trashed },
  });
}

for (const [codecName, codec] of CODECS) {
  describe(`trash derivation (${codecName} codec)`, () => {
    test('a deleted canvas is in the trash, with who, when and where it was', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      const entry = (await r.docRow(A)).entry;
      const d = await r.del('tereza', A);
      const t = await r.store.trash();
      assert.equal(t.canvases.length, 1);
      const [c] = t.canvases;
      assert.equal(c.id, `canvas:${entry}`);
      assert.equal(c.entry, entry);
      assert.equal(c.doc, A);
      assert.equal(c.path, 'ui/a.tsx');
      assert.equal(c.rev, d.revision);
      assert.equal(c.actionId, d.actionId);
      assert.equal(c.actor, 'tereza');
      assert.equal(typeof c.at, 'number');
      assert.deepEqual(
        (await r.store.trash({ entry })).canvases.map((x) => x.id),
        [c.id]
      );
      assert.deepEqual((await r.store.trash({ entry: 'n_other' })).canvases, []);
    });

    test('a move is not trash; an undone create is', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      await r.ok(r.propose('you', [{ op: 'doc.move', doc: A, to: { path: 'ui/c.tsx' } }]));
      assert.deepEqual((await r.store.trash()).canvases, []);
      const made = await r.create('you', B, 'ui/b.tsx');
      await r.ok(r.propose('you', [{ op: 'history.undo', actionId: made.actionId }]));
      assert.deepEqual(
        (await r.store.trash()).canvases.map((c) => c.doc),
        [B]
      );
    });

    test('a new canvas at the same path does not lose the trashed one', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx', body('old'));
      const oldEntry = (await r.docRow(A)).entry;
      await r.del('you', A);
      await r.create('you', A, 'ui/a.tsx', body('new'));
      assert.notEqual((await r.docRow(A)).entry, oldEntry, 'the doc row now carries the new entry');
      assert.deepEqual(
        (await r.store.trash()).canvases.map((c) => c.entry),
        [oldEntry]
      );
    });

    test('an artboard-trash action lists its artboards; malformed `trashed` is dropped, never refused', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx', body('with-p'));
      const entry = (await r.docRow(A)).entry;
      const t = await trashArtboard(r);
      assert.deepEqual(t.origin.trashed, [{ artboard: 'p', label: 'Post 1:1' }]);
      const items = (await r.store.trash()).artboards;
      assert.equal(items.length, 1);
      assert.deepEqual(
        {
          id: items[0].id,
          entry: items[0].entry,
          doc: items[0].doc,
          artboard: items[0].artboard,
          label: items[0].label,
          actor: items[0].actor,
          rev: items[0].rev,
        },
        {
          id: `artboard:${t.actionId}/p`,
          entry,
          doc: A,
          artboard: 'p',
          label: 'Post 1:1',
          actor: 'you',
          rev: t.revision,
        }
      );
      for (const bad of [
        [{ artboard: 'a/b' }],
        [{ artboard: '' }],
        [{}],
        'p',
        [{ artboard: 'x'.repeat(129) }],
      ]) {
        const res = await r.edit('you', A, body(`x${Math.random()}`), {
          kind: 'trash',
          origin: { trashed: bad },
        });
        assert.equal(res.origin.trashed, undefined, JSON.stringify(bad));
      }
      const notTrash = await r.edit('you', A, body('edit'), {
        origin: { trashed: [{ artboard: 'q' }] },
      });
      assert.equal(notTrash.origin.trashed, undefined, 'only on a kind trash action');
      assert.equal((await r.store.trash()).artboards.length, 1);
    });
  });

  describe(`trash.restore (${codecName} codec)`, () => {
    test('in place: same doc and entry, lanes as they stood, kind restore; ⌘Z sends it back', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      await r.edit('you', A, body('v1'));
      const entry = (await r.docRow(A)).entry;
      const gen = (await r.docRow(A)).generation;
      await r.del('you', A);
      const res = await r.ok(r.propose('jonas', restore(entry), { auth: MEMBER }));
      assert.equal(res.kind, 'restore');
      const row = await r.docRow(A);
      assert.equal(row.retired, false);
      assert.equal(row.entry, entry);
      assert.equal(row.path, 'ui/a.tsx');
      assert.equal(row.generation, gen + 1);
      assert.equal(await r.head(A), body('v1'));
      assert.deepEqual((await r.store.trash()).canvases, []);
      const pub = r.published.at(-1).changes[0];
      assert.equal(pub.revived, true);
      assert.equal(pub.path, 'ui/a.tsx');
      await r.ok(r.propose('jonas', [{ op: 'history.undo', actionId: res.actionId }]));
      assert.equal((await r.docRow(A)).retired, true);
      assert.deepEqual(
        (await r.store.trash()).canvases.map((c) => c.entry),
        [entry]
      );
    });

    test('path taken: lands at “<name> 2” with the same entry and the lanes of the trash revision', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx', body('old'));
      const oldEntry = (await r.docRow(A)).entry;
      await r.del('you', A);
      await r.create('you', A, 'ui/a.tsx', body('new'));
      const res = await r.ok(r.propose('you', restore(oldEntry)));
      const back = (await r.store.manifest()).docs.find((d) => d.entry === oldEntry && !d.retired);
      assert.ok(back, JSON.stringify(res));
      assert.equal(back.path, 'ui/a 2.tsx');
      assert.equal(await r.head(back.doc), body('old'));
      assert.equal(await r.head(A), body('new'), 'the newer canvas is untouched');
      assert.deepEqual((await r.store.trash()).canvases, []);
      // And again: “<name> 3”.
      await r.del('you', back.doc);
      await r.create('you', back.doc, 'ui/a 2.tsx', body('newer'));
      await r.ok(r.propose('you', restore(oldEntry)));
      const third = (await r.store.manifest()).docs.find((d) => d.entry === oldEntry && !d.retired);
      assert.equal(third.path, 'ui/a 3.tsx');
    });

    test('a live or unknown entry is not in the trash; malformed is invalid', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      const entry = (await r.docRow(A)).entry;
      for (const e of [entry, 'n_unknown']) {
        const res = await r.propose('you', restore(e));
        assert.equal(res.body.code, 'dependency-missing');
        assert.equal(res.body.reason, 'not in the trash');
      }
      for (const e of [undefined, '', 'x'.repeat(200), 7]) {
        assert.equal((await r.propose('you', restore(e))).body.code, 'invalid');
      }
    });

    test('needs trash: a role without it, a read-only actor are refused', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      const entry = (await r.docRow(A)).entry;
      await r.del('you', A);
      const noTrash = await r.propose('x', restore(entry), { auth: { can: (c) => c !== 'trash' } });
      assert.equal(noTrash.body.code, 'forbidden');
      assert.equal(
        (await r.propose('v', restore(entry), { auth: { readOnly: true } })).body.code,
        'forbidden'
      );
      assert.equal((await r.docRow(A)).retired, true);
    });

    test('canvas-only session: restores its own canvas; B, unknown and cleared all read not-in-scope', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      await r.create('you', B, 'ui/b.tsx');
      const ea = (await r.docRow(A)).entry;
      const eb = (await r.docRow(B)).entry;
      await r.del('you', A);
      await r.del('you', B);
      const onlyA = canvasOnly({ 'ui/a.tsx': 'member' });
      for (const e of [eb, 'n_unknown']) {
        const res = await r.propose('jonas', restore(e), { auth: onlyA });
        assert.equal(res.body.code, 'not-in-scope', e);
        assert.equal(res.body.reason, undefined);
      }
      const viewer = await r.propose('olga', restore(ea), {
        auth: canvasOnly({ 'ui/a.tsx': 'observer' }),
      });
      assert.equal(viewer.body.code, 'forbidden');
      await r.ok(r.propose('jonas', restore(ea), { auth: onlyA }));
      assert.equal((await r.docRow(A)).retired, false);
    });

    test('a store home without the trash reader answers invalid, never retryable', async () => {
      const r = rig(codec, { drop: ['trash', 'trashCleared'] });
      await r.create('you', A, 'ui/a.tsx');
      const entry = (await r.docRow(A)).entry;
      await r.del('you', A);
      const res = await r.propose('you', restore(entry), { auth: OWNER });
      assert.equal(res.body.code, 'invalid');
      assert.equal((await r.propose('you', clear(), { auth: OWNER })).body.code, 'invalid');
    });
  });

  describe(`trash.clear (${codecName} codec)`, () => {
    test('owner clears everything: tables, log, bodies kept, Restore refused `cleared`', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx', body('with-p'));
      await r.create('you', B, 'ui/b.tsx', body('bee'));
      const ea = (await r.docRow(A)).entry;
      const eb = (await r.docRow(B)).entry;
      const t = await trashArtboard(r);
      const d = await r.del('you', B);
      const bHash = laneHash(body('bee'));
      const res = await r.ok(r.propose('owner', clear(), { auth: OWNER }));
      assert.equal(res.kind, 'trash.clear');
      assert.deepEqual(res.cleared.sort(), [`artboard:${t.actionId}/p`, `canvas:${eb}`].sort());
      assert.deepEqual(await r.store.trash(), { canvases: [], artboards: [] });
      const rows = await r.store.trashCleared();
      assert.deepEqual(
        rows.map((x) => [x.entry, x.artboard, x.rev, x.by, x.clearedRev]).sort(),
        [
          [ea, 'p', t.revision, 'owner', res.revision],
          [eb, '', d.revision, 'owner', res.revision],
        ].sort()
      );
      const logged = await r.row(res.actionId);
      assert.deepEqual(
        logged.origin.cleared.map((x) => `${x.entry}|${x.artboard}|${x.rev}`).sort(),
        [`${ea}|p|${t.revision}`, `${eb}||${d.revision}`].sort()
      );
      assert.ok(logged.effects.every((x) => x.lane === '@trash' && x.op === 'trash.clear'));
      assert.deepEqual(logged.effects.map((x) => x.doc).sort(), [A, B].sort());
      assert.equal(await r.store.blob(bHash), body('bee'), 'store bodies stay (Q4 default)');
      assert.deepEqual(
        r.published
          .at(-1)
          .trashCleared.map((x) => x.id)
          .sort(),
        res.cleared.sort(),
        'the publish names what to delete from the per-Mac / quarantine copies'
      );
      const again = await r.propose('you', restore(eb), { auth: OWNER });
      assert.equal(again.status, 409);
      assert.equal(again.body.code, 'cleared');
      assert.equal((await r.docRow(B)).retired, true);
    });

    test('a member, a caller without `can`, and a canvas-only session cannot clear', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      await r.del('you', A);
      assert.equal((await r.propose('m', clear(), { auth: MEMBER })).body.code, 'forbidden');
      assert.equal(
        (await r.propose('m', clear())).body.code,
        'forbidden',
        'fail closed without can'
      );
      assert.equal(
        (await r.propose('m', clear(), { auth: canvasOnly({ 'ui/a.tsx': 'member' }) })).body.code,
        'not-in-scope'
      );
      assert.equal((await r.store.trash()).canvases.length, 1);
      assert.deepEqual(await r.store.trashCleared(), []);
    });

    test('named items only; unknown and already-cleared ids are skipped; malformed ids invalid; empty → no-op', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      await r.create('you', B, 'ui/b.tsx');
      const ea = (await r.docRow(A)).entry;
      const eb = (await r.docRow(B)).entry;
      await r.del('you', A);
      await r.del('you', B);
      const one = await r.ok(
        r.propose('o', clear([`canvas:${ea}`, 'canvas:n_unknown']), { auth: OWNER })
      );
      assert.deepEqual(one.cleared, [`canvas:${ea}`]);
      assert.deepEqual(one.skipped, [{ id: 'canvas:n_unknown', reason: 'not in the trash' }]);
      assert.deepEqual(
        (await r.store.trash()).canvases.map((c) => c.entry),
        [eb]
      );
      const twice = await r.ok(
        r.propose('o', clear([`canvas:${ea}`, `canvas:${eb}`]), { auth: OWNER })
      );
      assert.deepEqual(twice.cleared, [`canvas:${eb}`]);
      assert.deepEqual(twice.skipped, [{ id: `canvas:${ea}`, reason: 'already cleared' }]);
      for (const bad of [
        [],
        ['nope'],
        ['canvas:'],
        ['artboard:a_x'],
        ['canvas:a', 'canvas:a'],
        'canvas:a',
        [7],
      ]) {
        assert.equal(
          (await r.propose('o', clear(bad), { auth: OWNER })).body.code,
          'invalid',
          JSON.stringify(bad)
        );
      }
      const empty = await r.ok(r.propose('o', clear(), { auth: OWNER }));
      assert.equal(empty.noop, true);
    });

    test('⌘Z cannot bring back a cleared item (canvas delete, artboard trash)', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx', body('with-p'));
      await r.create('you', B, 'ui/b.tsx');
      const t = await trashArtboard(r);
      const d = await r.del('you', B);
      await r.ok(r.propose('o', clear(), { auth: OWNER }));
      const u1 = await r.propose('you', [{ op: 'history.undo', actionId: d.actionId }]);
      assert.equal(u1.body.code, 'undo-conflict');
      assert.deepEqual(u1.body.skipped, [{ doc: B, reason: 'cleared' }]);
      assert.equal((await r.docRow(B)).retired, true);
      const u2 = await r.propose('you', [{ op: 'history.undo', actionId: t.actionId }]);
      assert.equal(u2.body.code, 'undo-conflict');
      assert.equal(await r.head(A), body('without-p'));
      // A trash action that was NOT cleared still undoes as before.
      await r.create('you', 'ws/local/main/ui-c', 'ui/c.tsx');
      const d2 = await r.del('you', 'ws/local/main/ui-c');
      await r.ok(r.propose('you', [{ op: 'history.undo', actionId: d2.actionId }]));
      assert.equal((await r.docRow('ws/local/main/ui-c')).retired, false);
    });

    test('a clear is not undoable', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      await r.del('you', A);
      const c = await r.ok(r.propose('o', clear(), { auth: OWNER }));
      assert.equal(
        (await r.propose('o', [{ op: 'history.undo', actionId: c.actionId }])).body.code,
        'undo-conflict'
      );
      assert.equal((await r.store.trashCleared()).length, 1);
    });
  });
}
