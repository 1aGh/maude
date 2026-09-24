#!/usr/bin/env node
// F3 protocol scenarios against a REAL backend (accepted-revision API + Yjs
// socket), each with its own disposable documents so reruns never collide.
//
//   node protocol-scenarios.mjs --backend cloud|selfhost [--work <selfhost dir>] [--only S03,S05]
//
// Prints one JSON result per scenario; exit 1 if any fails. No secrets printed.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { canvasSource, loadBackend, sha } from './backend.mjs';
const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));

const argv = process.argv.slice(2);
const arg = (n, fb = null) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 ? argv[i + 1] : fb;
};
const only = (arg('only') ?? '').split(',').filter(Boolean);
const B = await loadBackend(arg('backend'), { work: arg('work') });
const run = randomUUID().slice(0, 8);
const results = [];

async function scenario(id, fn) {
  if (only.length && !only.includes(id)) return;
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ id, backend: B.name, status: 'pass', ms: Date.now() - started, ...detail });
  } catch (e) {
    results.push({ id, backend: B.name, status: 'fail', ms: Date.now() - started, error: String(e?.message ?? e).slice(0, 500) });
  }
}

const ok = (r, what) => {
  assert.equal(r.status, 200, `${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
};

async function createCanvas(who, name, source) {
  const doc = `ui-${name.toLowerCase()}`;
  const r = await B.propose(who, [{ op: 'doc.create', doc, path: `ui/${name}.tsx`, lanes: { html: source } }], { label: `F3 create ${name}` });
  ok(r, `create ${name}`);
  const d = await B.doc(doc, who);
  assert.equal(d.source, source, 'created source readable');
  return doc;
}

// S03 — A changes the title, B changes the color, both from the SAME base.
await scenario('S03', async () => {
  const name = `F3Merge${run}`;
  const base = canvasSource(name, 'Original title');
  const doc = await createCanvas('a', name, base);
  const baseHash = sha(base);
  const a = ok(await B.propose('a', [{ op: 'lane.replace', doc, lane: 'html', base: baseHash, content: base.replaceAll('Original title', 'Designer A title') }]), 'A title');
  const b = await B.propose('b', [{ op: 'lane.replace', doc, lane: 'html', base: baseHash, content: base.replace('color: "red"', 'color: "blue"') }]);
  const final = (await B.doc(doc, 'b')).source;
  if (b.status === 200) {
    assert.ok(final.includes('Designer A title') && final.includes('color: "blue"'), 'both independent changes survive');
    return { doc, outcome: 'merged', aAction: a.actionId, bAction: b.body.actionId, finalHash: sha(final) };
  }
  // The other permitted outcome: an explicit refusal that preserves the candidate.
  assert.equal(b.status, 409, `B: ${b.status}`);
  assert.ok(final.includes('Designer A title'), 'accepted A survives');
  return { doc, outcome: 'explicit-conflict', code: b.body.code, finalHash: sha(final) };
});

// S05 — raw Yjs Update/SyncStep2 and an old epoch on an already-open socket.
await scenario('S05', async () => {
  const require = createRequire(join(REPO, 'apps/hub/package.json'));
  const { HocuspocusProvider } = require('@hocuspocus/provider');
  const Y = require('yjs');
  const pr = createRequire(require.resolve('@hocuspocus/provider'));
  const encoding = pr('lib0/encoding');
  const sync = pr('y-protocols/sync');
  const name = `F3Fence${run}`;
  const source = canvasSource(name, 'Fenced');
  const doc = await createCanvas('a', name, source);
  const before = await B.bootstrap('a');
  const logBefore = ok(await B.api('a', 'revisions?after=0&limit=500'), 'log');
  const readers = [];
  const reader = () => {
    const d = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: B.origin.replace(/^http/, 'ws'),
      name: doc,
      token: B.tokens.a.token,
      document: d,
    });
    const r = { d, provider, html: () => d.getText('html').toString() };
    readers.push(r);
    return r;
  };
  const until = async (f, label, ms = 20000) => {
    const end = Date.now() + ms;
    while (!f()) {
      assert.ok(Date.now() < end, label);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  try {
    const rogue = reader();
    const witness = reader();
    await until(() => rogue.provider.synced && witness.provider.synced && rogue.html() === source && witness.html() === source, 'initial replicas');
    rogue.provider.setAwarenessField('user', { name: 'F3 fence probe', color: '#3366cc' });
    await until(() => [...witness.provider.awareness.getStates().values()].some((s) => s.user?.name === 'F3 fence probe'), 'bounded awareness delivered');
    const poisoned = new Y.Doc();
    Y.applyUpdate(poisoned, Y.encodeStateAsUpdate(rogue.d));
    poisoned.getText('html').insert(0, '// F3 unauthorized raw update\n');
    assert.equal(rogue.provider.configuration.websocketProvider.webSocket.readyState, 1, 'already-open socket');
    for (const type of ['Update', 'SyncStep2']) {
      const e = encoding.createEncoder();
      encoding.writeVarString(e, rogue.provider.effectiveName);
      encoding.writeVarUint(e, 0);
      if (type === 'Update') sync.writeUpdate(e, Y.encodeStateAsUpdate(poisoned));
      else sync.writeSyncStep2(e, poisoned);
      rogue.provider.configuration.websocketProvider.send(encoding.toUint8Array(e));
    }
    await new Promise((r) => setTimeout(r, 2000));
    const fresh = reader();
    await until(() => fresh.provider.synced && fresh.html() === source, 'fresh replica has only accepted state');
    assert.equal(witness.html(), source, 'witness unchanged');
    poisoned.destroy();
    const old = await B.propose('a', [{ op: 'dir.create', path: `ui/F3OldEpoch${run}` }], { epoch: before.epoch - 1 });
    assert.equal(old.status, 409, 'old epoch');
    assert.equal(old.body.code, 'epoch-stale');
    const after = await B.bootstrap('a');
    assert.equal(after.revision, before.revision, 'head unchanged');
    assert.deepEqual(ok(await B.api('a', 'revisions?after=0&limit=500'), 'log'), logBefore, 'log unchanged');
    return { doc, revision: after.revision, epoch: after.epoch, oldEpoch: old.body.code };
  } finally {
    for (const r of readers) {
      r.provider.destroy();
      r.d.destroy();
    }
  }
});

// S08 — every source/document operation; a stale generation cannot resurrect.
await scenario('S08', async () => {
  const name = `F3Ops${run}`;
  let src = canvasSource(name, 'Ops', { body: '\n    <p className="lede">Paragraph</p>' });
  const doc = await createCanvas('a', name, src);
  const step = async (who, next, what) => {
    ok(await B.propose(who, [{ op: 'lane.replace', doc, lane: 'html', base: sha(src), content: next }]), what);
    src = next;
    assert.equal((await B.doc(doc, who === 'a' ? 'b' : 'a')).source, next, `${what} visible to the other designer`);
  };
  await step('a', src.replace('>Ops<', '>Ops text<'), 'text');
  await step('b', src.replace('color: "red"', 'color: "green"'), 'css');
  await step('a', src.replace('className="lede"', 'className="lede" data-kind="x"'), 'attribute');
  await step('b', src.replace('<p ', '<hr />\n    <p '), 'insert');
  await step('a', src.replace('<hr />\n    <p className="lede" data-kind="x">Paragraph</p>', '<p className="lede" data-kind="x">Paragraph</p>\n    <hr />'), 'move');
  await step('b', src.replace('\n    <hr />', ''), 'delete element');
  const staleBase = sha(src);
  const moved = `ui/F3Moved${run}.tsx`;
  ok(await B.propose('a', [{ op: 'doc.move', doc, to: { path: moved } }]), 'canvas rename/move');
  const afterMove = await B.bootstrap('b');
  const movedDoc = afterMove.docs.find((d) => d.path === moved && !d.retired);
  assert.ok(movedDoc, 'rename visible to the other designer at its new path');
  assert.ok(!afterMove.docs.find((d) => d.doc === doc && !d.retired), 'old name retired');
  assert.equal((await B.doc(movedDoc.doc, 'b')).source, src, 'content moved intact');
  ok(await B.propose('b', [{ op: 'doc.delete', doc: movedDoc.doc }]), 'canvas delete');
  const stale = [];
  for (const target of [doc, movedDoc.doc]) {
    const r = await B.propose('a', [
      { op: 'lane.replace', doc: target, lane: 'html', base: staleBase, content: src.replace('Ops text', 'Resurrected') },
    ]);
    assert.notEqual(r.status, 200, `stale write to ${target} refused`);
    stale.push({ target: target === doc ? 'old-name' : 'moved-name', status: r.status, code: r.body.code });
  }
  const live = (await B.bootstrap('a')).docs.filter((d) => [doc, movedDoc.doc].includes(d.doc) && !d.retired);
  assert.equal(live.length, 0, 'deleted canvas stays deleted under both names');
  return { doc, movedTo: movedDoc.doc, staleWrites: stale };
});

// S10 — personal undo compensates own effects only; ABA; foreign undo; deleted target.
await scenario('S10', async () => {
  const name = `F3Undo${run}`;
  const base = canvasSource(name, 'Original title');
  const doc = await createCanvas('a', name, base);
  const aTitle = base.replaceAll('Original title', 'A title');
  const aAct = ok(await B.propose('a', [{ op: 'lane.replace', doc, lane: 'html', base: sha(base), content: aTitle }]), 'A title').actionId;
  const bColor = aTitle.replace('color: "red"', 'color: "blue"');
  ok(await B.propose('b', [{ op: 'lane.replace', doc, lane: 'html', base: sha(aTitle), content: bColor }]), 'B color');
  const undo = ok(await B.propose('a', [{ op: 'history.undo', actionId: aAct }]), 'A undo own');
  const afterUndo = (await B.doc(doc, 'b')).source;
  assert.ok(afterUndo.includes('Original title') && afterUndo.includes('color: "blue"'), 'undo keeps B color');
  const redo = ok(await B.propose('a', [{ op: 'history.redo', actionId: undo.actionId }]), 'A redo');
  const afterRedo = (await B.doc(doc, 'b')).source;
  assert.ok(afterRedo.includes('A title') && afterRedo.includes('color: "blue"'), 'redo keeps B color');
  const foreign = await B.propose('b', [{ op: 'history.undo', actionId: aAct }]);
  assert.equal(foreign.status, 403, 'foreign undo forbidden');
  // ABA: B changes A's title away and back; A's undo must refuse, not clobber.
  const bAway = afterRedo.replaceAll('A title', 'B away');
  ok(await B.propose('b', [{ op: 'lane.replace', doc, lane: 'html', base: sha(afterRedo), content: bAway }]), 'B away');
  ok(await B.propose('b', [{ op: 'lane.replace', doc, lane: 'html', base: sha(bAway), content: afterRedo }]), 'B back');
  const headBefore = await B.bootstrap('a');
  const aba = await B.propose('a', [{ op: 'history.undo', actionId: aAct }]);
  if (aba.status === 200) {
    const s = (await B.doc(doc, 'a')).source;
    assert.ok(s.includes('color: "blue"'), 'ABA undo keeps peer effect');
  } else {
    assert.equal(aba.status, 409, `ABA undo: ${aba.status}`);
    assert.equal((await B.bootstrap('a')).revision, headBefore.revision, 'refused undo changes nothing');
  }
  ok(await B.propose('b', [{ op: 'doc.delete', doc }]), 'delete target');
  const dead = await B.propose('a', [{ op: 'history.undo', actionId: aAct }]);
  assert.notEqual(dead.status, 200, 'undo on deleted target refused');
  return { doc, aba: aba.status === 200 ? 'compensated' : aba.body.code, deletedTarget: { status: dead.status, code: dead.body.code } };
});

for (const r of results) console.log(JSON.stringify(r));
process.exitCode = results.some((r) => r.status !== 'pass') ? 1 : 0;
