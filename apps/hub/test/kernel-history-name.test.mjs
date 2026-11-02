// S1.6 — `history.name` + the `names` table, and `history.aside` (V2-1.9 §5.4,
// decision 9; S1-trash.md §3). Kernel layer, both blob codecs.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { laneHash } from '../src/project-transactions/lanes.mjs';
import { body, CODECS, canvasOnly, MEMBER, rig } from './_kernel-rig.mjs';

const A = 'ws/local/main/ui-a';
const B = 'ws/local/main/ui-b';
const name = (doc, revision, n, opts) => [[{ op: 'history.name', doc, revision, name: n }], opts];

for (const [codecName, codec] of CODECS) {
  describe(`history.name (${codecName} codec)`, () => {
    test('names a revision: one `name` action, no head moves, a names row, the log carries it', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      const e = await r.edit('you', A, body('v1'));
      const headBefore = await r.store.heads([A]);
      const res = await r.ok(
        r.propose('you', [{ op: 'history.name', doc: A, revision: e.revision, name: '  Final  ' }])
      );
      assert.equal(res.kind, 'name');
      assert.equal(res.label, 'Final');
      assert.deepEqual(res.named, {
        entry: (await r.docRow(A)).entry,
        rev: e.revision,
        name: 'Final',
      });
      assert.deepEqual(await r.store.heads([A]), headBefore, 'no head moves');
      const logged = await r.row(res.actionId);
      assert.equal(logged.kind, 'name');
      assert.equal(logged.label, 'Final');
      assert.deepEqual(logged.origin.named, res.named, 'the log carries the fact');
      assert.deepEqual(
        logged.effects.map((x) => [x.lane, x.op, x.doc]),
        [['@name', 'name', A]],
        'no lane effect'
      );
      const rows = await r.store.names((await r.docRow(A)).entry);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].targetRev, e.revision);
      assert.equal(rows[0].name, 'Final');
      assert.equal(rows[0].actor, 'you');
      assert.equal(rows[0].rev, res.revision);
      // A restore to a revision after the name still reads the real lane.
      assert.equal(await r.store.laneAt(A, 'html', res.revision), laneHash(body('v1')));
      assert.equal(r.published.at(-1).changes.length, 0, 'nothing to write to disk');
    });

    test('snaps to the newest revision ≤ it that changed the canvas', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      await r.create('you', B, 'ui/b.tsx');
      const onA = await r.edit('you', A, body('v1'));
      const onB = await r.edit('you', B, body('b1'));
      const res = await r.ok(r.propose('you', ...name(A, onB.revision, 'Snap')));
      assert.equal(res.named.rev, onA.revision);
      const rows = await r.store.names((await r.docRow(A)).entry);
      assert.deepEqual(
        rows.map((x) => x.targetRev),
        [onA.revision]
      );
      // Other kinds never count as a version: naming after a name snaps past it.
      const again = await r.ok(r.propose('you', ...name(A, res.revision, 'Again')));
      assert.equal(again.named.rev, onA.revision);
      assert.equal(
        (await r.store.names((await r.docRow(A)).entry))[0].name,
        'Again',
        'newest wins'
      );
    });

    test('null removes the name; the name action stays in the log', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      const e = await r.edit('you', A, body('v1'));
      const named = await r.ok(r.propose('you', ...name(A, e.revision, 'Keep')));
      const cleared = await r.ok(r.propose('you', ...name(A, e.revision, null)));
      assert.equal(cleared.kind, 'name');
      assert.equal(cleared.label, null);
      assert.equal(cleared.named.name, null);
      assert.deepEqual(await r.store.names((await r.docRow(A)).entry), []);
      assert.ok(await r.row(named.actionId), 'the first name action is still logged');
      assert.equal((await r.row(cleared.actionId)).effects[0].op, 'name.clear');
    });

    test('malformed names and revisions are invalid (final, nothing logged)', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      const e = await r.edit('you', A, body('v1'));
      const head = await r.rev();
      for (const [n, revision] of [
        ['', e.revision],
        ['   ', e.revision],
        ['x'.repeat(81), e.revision],
        ['bad\u0007bell', e.revision],
        [42, e.revision],
        ['ok', head + 1],
        ['ok', 0],
        ['ok', 1.5],
      ]) {
        const res = await r.propose('you', ...name(A, revision, n));
        assert.equal(res.status, 400, `${JSON.stringify(n)} @ ${revision}`);
        assert.equal(res.body.code, 'invalid');
      }
      // 80 code points, emoji included, is fine.
      await r.ok(r.propose('you', ...name(A, e.revision, '🙂'.repeat(80))));
      // Combined with another op.
      const mixed = await r.propose('you', [
        { op: 'history.name', doc: A, revision: e.revision, name: 'x' },
        {
          op: 'lane.replace',
          doc: A,
          lane: 'html',
          content: body('v2'),
          base: laneHash(body('v1')),
        },
      ]);
      assert.equal(mixed.body.code, 'invalid');
      assert.equal(await r.head(A), body('v1'));
    });

    test('a revision before the canvas existed has no version to name', async () => {
      const r = rig(codec);
      await r.create('you', B, 'ui/b.tsx');
      const early = await r.rev();
      await r.create('you', A, 'ui/a.tsx');
      const res = await r.propose('you', ...name(A, early, 'Too early'));
      assert.equal(res.body.code, 'invalid');
    });

    test('an unknown or trashed canvas is dependency-missing', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      const e = await r.edit('you', A, body('v1'));
      assert.equal(
        (await r.propose('you', ...name('ws/local/main/ui-nope', e.revision, 'x'))).body.code,
        'dependency-missing'
      );
      await r.del('you', A);
      assert.equal(
        (await r.propose('you', ...name(A, e.revision, 'x'))).body.code,
        'dependency-missing'
      );
    });

    test('a moved canvas is named through its live continuation (same entry)', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      const e = await r.edit('you', A, body('v1'));
      const entry = (await r.docRow(A)).entry;
      await r.ok(r.propose('you', [{ op: 'doc.move', doc: A, to: { path: 'ui/moved.tsx' } }]));
      const res = await r.ok(r.propose('you', ...name(A, e.revision, 'Before the move')));
      assert.equal(res.named.entry, entry);
      assert.equal((await r.store.names(entry))[0].name, 'Before the move');
    });

    test('needs edit: a read-only actor and a role without edit are refused', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      const e = await r.edit('you', A, body('v1'));
      const ro = await r.propose(
        'viewer',
        ...name(A, e.revision, 'x', { auth: { readOnly: true } })
      );
      assert.equal(ro.body.code, 'forbidden');
      const noEdit = await r.propose(
        'x',
        ...name(A, e.revision, 'x', { auth: { can: () => false } })
      );
      assert.equal(noEdit.body.code, 'forbidden');
      await r.ok(r.propose('member', ...name(A, e.revision, 'ok', { auth: MEMBER })));
    });

    test('canvas-only session: names only its canvas; another or an unknown canvas is not-in-scope', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      await r.create('you', B, 'ui/b.tsx');
      const e = await r.edit('you', B, body('b1'));
      const onlyA = canvasOnly({ 'ui/a.tsx': 'member' });
      for (const doc of [B, 'ws/local/main/ui-nope']) {
        const res = await r.propose('jonas', ...name(doc, e.revision, 'x', { auth: onlyA }));
        assert.equal(res.status, 403);
        assert.deepEqual(
          Object.keys(res.body).filter(
            (k) =>
              ![
                'protocol',
                'status',
                'code',
                'transactionId',
                'proposalHash',
                'currentRevision',
                'epoch',
              ].includes(k)
          ),
          [],
          'not-in-scope carries no detail (U1)'
        );
        assert.equal(res.body.code, 'not-in-scope');
      }
      assert.deepEqual(await r.store.names((await r.docRow(B)).entry), []);
      await r.ok(r.propose('jonas', ...name(A, e.revision, 'Mine', { auth: onlyA })));
      const observer = canvasOnly({ 'ui/a.tsx': 'observer' });
      const ro = await r.propose('olga', ...name(A, e.revision, 'x', { auth: observer }));
      assert.equal(ro.body.code, 'forbidden');
    });

    test('a name is not undoable (⌘Z → undo-conflict) and the name stays', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      const e = await r.edit('you', A, body('v1'));
      const named = await r.ok(r.propose('you', ...name(A, e.revision, 'Stay')));
      const undo = await r.propose('you', [{ op: 'history.undo', actionId: named.actionId }]);
      assert.equal(undo.body.code, 'undo-conflict');
      assert.equal((await r.store.names((await r.docRow(A)).entry))[0].name, 'Stay');
    });

    test('v1 envelope: a client cannot stamp origin.named / origin.cleared; a v1 edit answers as before', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      const res = await r.edit('you', A, body('v1'), {
        origin: {
          deviceId: 'd1',
          named: { entry: 'x', rev: 1, name: 'spoof' },
          cleared: [{}],
          trashed: [{ artboard: 'p' }],
        },
      });
      assert.deepEqual(res.origin, { deviceId: 'd1' });
      assert.deepEqual(
        Object.keys(res).sort(),
        [
          'actionId',
          'actorId',
          'committedAt',
          'effects',
          'epoch',
          'kind',
          'label',
          'merged',
          'origin',
          'parentRevision',
          'projectId',
          'proposalHash',
          'protocol',
          'revision',
          'status',
          'transactionId',
        ].sort()
      );
      assert.deepEqual((await r.row(res.actionId)).origin, { deviceId: 'd1' });
    });
  });

  describe(`history.aside (${codecName} codec)`, () => {
    test('keeps the body as a version without moving any head', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      await r.edit('you', A, body('mine'));
      const heads = await r.store.heads([A]);
      const res = await r.ok(
        r.propose('you', [
          {
            op: 'history.aside',
            doc: A,
            lane: 'html',
            content: body('theirs'),
            label: 'Jonas’s version, not kept',
          },
        ])
      );
      assert.equal(res.kind, 'aside');
      assert.equal(res.label, 'Jonas’s version, not kept');
      assert.deepEqual(await r.store.heads([A]), heads, 'no head moves');
      const logged = await r.row(res.actionId);
      assert.equal(logged.effects.length, 1);
      const [fx] = logged.effects;
      assert.equal(fx.lane, '@aside');
      assert.equal(fx.op, 'aside.html');
      assert.equal(fx.doc, A);
      assert.equal(fx.beforeHash, laneHash(body('mine')));
      assert.equal(fx.afterHash, laneHash(body('theirs')));
      assert.equal(await r.store.blob(fx.afterHash), body('theirs'), 'restorable body');
      assert.equal(
        await r.store.laneAt(A, 'html', res.revision),
        laneHash(body('mine')),
        'restore reads the real lane'
      );
      assert.equal(r.published.at(-1).changes.length, 0);
    });

    test('an undo rebases straight past an aside (it is not a lane effect)', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx', body('v0', '\n    <i>x</i>\n    <b>k0</b>'));
      const mine = await r.edit('you', A, body('v1', '\n    <i>x</i>\n    <b>k0</b>'));
      await r.ok(
        r.propose('you', [{ op: 'history.aside', doc: A, lane: 'html', content: body('zz') }])
      );
      await r.ok(r.propose('you', [{ op: 'history.undo', actionId: mine.actionId }]));
      assert.equal(await r.head(A), body('v0', '\n    <i>x</i>\n    <b>k0</b>'));
    });

    test('needs edit and a live canvas; bad source is refused; equal to the head is a no-op', async () => {
      const r = rig(codec);
      await r.create('you', A, 'ui/a.tsx');
      const aside = (content, auth) =>
        r.propose('x', [{ op: 'history.aside', doc: A, lane: 'html', content }], { auth });
      assert.equal((await aside(body('t'), { can: () => false })).body.code, 'forbidden');
      assert.equal(
        (await aside(body('t'), canvasOnly({ 'ui/b.tsx': 'member' }))).body.code,
        'not-in-scope'
      );
      assert.equal((await aside('export default (')).body.code, 'source-invalid');
      const same = await r.ok(aside(body()));
      assert.equal(same.noop, true);
      const bad = await r.propose('x', [
        { op: 'history.aside', doc: A, lane: 'nope', content: 'x' },
      ]);
      assert.equal(bad.body.code, 'invalid');
      const gone = await r.propose('x', [
        { op: 'history.aside', doc: B, lane: 'html', content: body() },
      ]);
      assert.equal(gone.body.code, 'dependency-missing');
    });
  });
}
