import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { HocuspocusProvider, Y, versions } from './deps.mjs';
import { BASE, DOC, Outbox, proposal } from './candidate-kernel.mjs';
import { packet, start } from './server.mjs';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(label);
    await delay(10);
  }
}
async function client(hub, token, name = DOC) {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({ url: hub.ws, name, token, document: doc });
  await until(() => provider.isSynced, 'provider sync ' + token);
  return {
    doc,
    provider,
    close() {
      provider.destroy();
      doc.destroy();
    },
  };
}
async function submit(hub, bytes, token = 'writer') {
  return (
    await fetch(hub.http + '/proposals', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token },
      body: bytes,
    })
  ).json();
}
function source(doc) {
  return doc.getText('source').toString();
}
function replace(doc, value) {
  let delta;
  const capture = (u) => {
    delta = u;
  };
  doc.once('update', capture);
  doc.transact(() => {
    const text = doc.getText('source');
    text.delete(0, text.length);
    text.insert(0, value);
  });
  return delta;
}
function unchanged(hub, peer, root, value = BASE) {
  assert.equal(source(hub.accepted), value);
  assert.equal(source(peer.doc), value);
  assert.equal(hub.kernel.state.source, value);
  assert.equal(readFileSync(join(root, 'checkout/canvas.tsx'), 'utf8'), value);
}

test('installed Hocuspocus gates raw Update and SyncStep2 for writer/reader/loopback; awareness stays live', async (t) => {
  t.diagnostic(JSON.stringify(versions));
  assert.match(versions['@hocuspocus/server'], /^4\./);
  const root = mkdtempSync(join(tmpdir(), 't7-gate-'));
  const hub = await start(root);
  const clients = [];
  try {
    const peer = await client(hub, 'reader');
    clients.push(peer);
    let peerUpdates = 0;
    peer.doc.on('update', () => peerUpdates++);
    for (const token of ['writer', 'reader', 'loopback']) {
      const author = await client(hub, token);
      clients.push(author);
      const acceptedBytes = Buffer.from(Y.encodeStateAsUpdate(hub.accepted));
      const malicious = new Y.Doc();
      replace(malicious, 'REJECTED_' + token);
      const update = Y.encodeStateAsUpdate(malicious);
      for (const type of [0, 4])
        for (const kind of [1, 2]) {
          const connection = hub.accepted.getConnections().find((c) => c.context.token === token);
          connection.readOnly = false; // An already-open legacy socket must be fenced again per message.
          const before = hub.seen.filter(
            (s) => s.token === token && s.type === type && s.subtype === kind
          ).length;
          author.provider.configuration.websocketProvider.webSocket.send(
            packet(DOC, type, update, kind)
          );
          await until(
            () =>
              hub.seen.filter((s) => s.token === token && s.type === type && s.subtype === kind)
                .length > before,
            'server received raw packet'
          );
          // Same connection heartbeat is a barrier after serialized receiver processing.
          author.provider.awareness.setLocalState({ cursor: [type * 10 + kind, token.length] });
          await until(
            () =>
              peer.provider.awareness.getStates().get(author.doc.clientID)?.cursor?.[0] ===
              type * 10 + kind,
            'awareness delivered'
          );
          unchanged(hub, peer, root);
          assert.deepEqual(
            Buffer.from(Y.encodeStateAsUpdate(hub.accepted)),
            acceptedBytes,
            'accepted Yjs struct bytes unchanged'
          );
          assert.equal(hub.kernel.state.history.length, 0);
          assert.equal(peerUpdates, 0, 'no rejected Y update broadcast');
        }
      malicious.destroy();
    }
    // Fresh independent session arrives with optimistic bytes already in its document.
    // Its handshake SyncStep2 must not seed/replace an existing accepted document.
    const handshakeDoc = new Y.Doc();
    Y.applyUpdate(handshakeDoc, Y.encodeStateAsUpdate(peer.doc));
    replace(handshakeDoc, 'REJECTED_HANDSHAKE');
    const handshakeBefore = hub.seen.filter((s) => s.token === 'writer' && s.subtype === 1).length;
    const handshakeProvider = new HocuspocusProvider({
      url: hub.ws,
      name: DOC,
      token: 'writer',
      document: handshakeDoc,
    });
    try {
      await until(
        () =>
          hub.seen.filter((s) => s.token === 'writer' && s.subtype === 1).length > handshakeBefore,
        'fresh session sends SyncStep2'
      );
      handshakeProvider.awareness.setLocalState({ cursor: [99, 99] });
      await until(
        () => peer.provider.awareness.getStates().get(handshakeDoc.clientID)?.cursor?.[0] === 99,
        'fresh session awareness barrier'
      );
      unchanged(hub, peer, root);
      assert.equal(peerUpdates, 0, 'handshake did not broadcast rejected bytes');
    } finally {
      handshakeProvider.destroy();
      handshakeDoc.destroy();
    }
    const readerMutation = await submit(
      hub,
      proposal('reader-change', BASE + '\n', hub.kernel.state),
      'reader'
    );
    assert.equal(readerMutation.code, 'forbidden');
    unchanged(hub, peer, root);
    // Creation path is authenticated before document allocation/load.
    const unknown = new Y.Doc();
    replace(unknown, 'REJECTED_CREATION');
    let denied = false;
    const unlisted = new HocuspocusProvider({
      url: hub.ws,
      name: 'projects/p/accepted/unknown',
      token: 'writer',
      document: unknown,
      onAuthenticationFailed() {
        denied = true;
      },
    });
    try {
      await until(() => denied, 'unknown document denied');
      assert.equal(hub.server.hocuspocus.documents.has('projects/p/accepted/unknown'), false);
    } finally {
      unlisted.destroy();
      unknown.destroy();
    }
  } finally {
    for (const c of clients) c.close();
    await hub.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('persisted rejected U1 and dependent U2 survive restart/reconnect; semantic rebase accepts once', async () => {
  const root = mkdtempSync(join(tmpdir(), 't7-rebase-'));
  let hub = await start(root);
  let peer = await client(hub, 'reader');
  let writer = await client(hub, 'writer');
  const outboxPath = join(root, 'outbox');
  let outbox = new Outbox(outboxPath);
  let candidate = new Y.Doc();
  Y.applyUpdate(candidate, Y.encodeStateAsUpdate(peer.doc));
  const bad = 'export default function Canvas(){return <div>REJECTED_U1</span>}';
  const repaired = 'export default function Canvas(){return <div>CORRECTED_U2</div>}';
  try {
    const u1 = replace(candidate, bad);
    const request1 = proposal('u1', bad, hub.kernel.state);
    const retained1 = outbox.retain('u1', request1, candidate, u1);
    const result1 = await submit(hub, request1);
    assert.equal(result1.code, 'source-invalid');
    unchanged(hub, peer, root);
    const u2 = replace(candidate, repaired);
    const request2 = proposal('u2', repaired, hub.kernel.state, ['u1']);
    const retained2 = outbox.retain('u2', request2, candidate, u2);
    // CRDT dependency exists: replaying raw U2 onto accepted state cannot reconstruct repaired source.
    const wrong = new Y.Doc();
    Y.applyUpdate(wrong, Y.encodeStateAsUpdate(peer.doc));
    Y.applyUpdate(wrong, u2);
    assert.notEqual(source(wrong), repaired);
    wrong.destroy();
    const result2 = await submit(hub, request2);
    assert.equal(result2.code, 'dependency-missing');
    // Also try the full repaired candidate (which includes U1 structs) through the raw public lane.
    const count = hub.seen.length;
    writer.provider.configuration.websocketProvider.webSocket.send(
      packet(DOC, 0, Y.encodeStateAsUpdate(candidate), 1)
    );
    await until(() => hub.seen.length > count, 'raw dependent candidate arrived');
    await delay(30);
    unchanged(hub, peer, root);
    assert.equal(hub.kernel.state.history.length, 0);
    writer.close();
    peer.close();
    candidate.destroy();
    await hub.close();
    hub = await start(root);
    peer = await client(hub, 'reader');
    writer = await client(hub, 'writer');
    outbox = new Outbox(outboxPath);
    candidate = outbox.restore('u2');
    assert.equal(source(candidate), repaired);
    assert.deepEqual(outbox.read('u1'), retained1);
    assert.deepEqual(outbox.read('u2'), retained2);
    assert.deepEqual(await submit(hub, Buffer.from(retained1.request, 'base64')), result1);
    assert.deepEqual(await submit(hub, Buffer.from(retained2.request, 'base64')), result2);
    unchanged(hub, peer, root);
    assert.equal(hub.kernel.state.history.length, 0);
    // Rebase is explicit proven-base source.replace with a new transaction; original candidates immutable.
    const rebased = JSON.parse(proposal('u3', source(candidate), hub.kernel.state));
    rebased.rebasedFrom = 'u2';
    const bytes = Buffer.from(JSON.stringify(rebased));
    const accepted = await submit(hub, bytes);
    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.revision, 1);
    await until(() => source(peer.doc) === repaired, 'accepted source broadcast');
    unchanged(hub, peer, root, repaired);
    assert.deepEqual(await submit(hub, bytes), accepted);
    assert.equal(hub.kernel.state.history.length, 1);
    assert.equal(
      (
        await submit(
          hub,
          Buffer.from(
            JSON.stringify({ ...rebased, action: { ...rebased.action, label: 'changed' } })
          )
        )
      ).code,
      'transaction-id-reused'
    );
    assert.equal(
      hub.kernel.state.history.some((item) => item.source.includes('REJECTED_U1')),
      false
    );
    assert.deepEqual(outbox.read('u1'), retained1);
    assert.deepEqual(outbox.read('u2'), retained2);
    // Restart after successful publication proves result and accepted source recovery in this local adapter.
    writer.close();
    peer.close();
    await hub.close();
    hub = await start(root);
    peer = await client(hub, 'reader');
    writer = await client(hub, 'writer');
    assert.deepEqual(await submit(hub, bytes), accepted);
    unchanged(hub, peer, root, repaired);
    assert.equal(hub.kernel.state.history.length, 1);
  } finally {
    writer.close();
    peer.close();
    candidate.destroy();
    await hub.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('epoch changes and membership revocation fence already authenticated sockets', async () => {
  const root = mkdtempSync(join(tmpdir(), 't7-fence-'));
  const hub = await start(root);
  const clients = [];
  try {
    const peer = await client(hub, 'reader');
    const writer = await client(hub, 'writer');
    const service = await client(hub, 'loopback');
    clients.push(peer, writer, service);
    const attack = new Y.Doc();
    replace(attack, 'REJECTED_AFTER_FENCE');
    const update = Y.encodeStateAsUpdate(attack);
    attack.destroy();
    const writerConnection = hub.accepted
      .getConnections()
      .find((c) => c.context.token === 'writer');
    hub.actors.delete('writer');
    writer.provider.configuration.websocketProvider.webSocket.send(packet(DOC, 0, update, 2));
    await until(
      () => !hub.accepted.getConnections().includes(writerConnection),
      'revoked socket closed'
    );
    unchanged(hub, peer, root);
    assert.equal(hub.kernel.state.history.length, 0);
    writer.provider.disconnect();
    const serviceConnection = hub.accepted
      .getConnections()
      .find((c) => c.context.token === 'loopback');
    hub.kernel.state.epoch++;
    service.provider.configuration.websocketProvider.webSocket.send(packet(DOC, 0, update, 1));
    await until(
      () => !hub.accepted.getConnections().includes(serviceConnection),
      'old epoch socket closed'
    );
    service.provider.disconnect();
    unchanged(hub, peer, root);
    assert.equal(hub.kernel.state.history.length, 0);
  } finally {
    for (const c of clients) c.close();
    await hub.close();
    rmSync(root, { recursive: true, force: true });
  }
});

async function subprocess(root) {
  const child = fork(new URL('./worker.mjs', import.meta.url), [root], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const [ready] = await once(child, 'message');
  return {
    ...ready,
    async kill() {
      const done = once(child, 'exit');
      child.kill('SIGKILL');
      await done;
    },
  };
}
test('actual coordinator process replacement retains rejected dependency chain and one accepted revision', async () => {
  const root = mkdtempSync(join(tmpdir(), 't7-process-'));
  let hub = await subprocess(root);
  let peer = await client(hub, 'reader');
  const outboxPath = join(root, 'outbox');
  let outbox = new Outbox(outboxPath);
  let candidate = new Y.Doc();
  Y.applyUpdate(candidate, Y.encodeStateAsUpdate(peer.doc));
  const state = () => JSON.parse(readFileSync(join(root, 'canonical.json'), 'utf8'));
  try {
    const invalid = 'export default () => <div>REJECTED_U1_PROCESS</span>';
    const repaired = 'export default () => <div>REPAIRED_PROCESS</div>';
    const u1 = replace(candidate, invalid);
    const p1 = proposal('process-u1', invalid, state());
    const saved1 = outbox.retain('process-u1', p1, candidate, u1);
    assert.equal((await submit(hub, p1)).code, 'source-invalid');
    const u2 = replace(candidate, repaired);
    const p2 = proposal('process-u2', repaired, state(), ['process-u1']);
    const saved2 = outbox.retain('process-u2', p2, candidate, u2);
    assert.equal((await submit(hub, p2)).code, 'dependency-missing');
    peer.close();
    candidate.destroy();
    await hub.kill();
    hub = await subprocess(root);
    peer = await client(hub, 'reader');
    outbox = new Outbox(outboxPath);
    candidate = outbox.restore('process-u2');
    assert.deepEqual(outbox.read('process-u1'), saved1);
    assert.deepEqual(outbox.read('process-u2'), saved2);
    assert.equal(source(candidate), repaired);
    assert.equal((await submit(hub, Buffer.from(saved1.request, 'base64'))).code, 'source-invalid');
    assert.equal(
      (await submit(hub, Buffer.from(saved2.request, 'base64'))).code,
      'dependency-missing'
    );
    assert.equal(source(peer.doc), BASE);
    assert.equal(state().source, BASE);
    assert.equal(state().history.length, 0);
    assert.equal(readFileSync(join(root, 'checkout/canvas.tsx'), 'utf8'), BASE);
    const corrected = proposal('process-u3', source(candidate), state());
    const result = await submit(hub, corrected);
    assert.equal(result.status, 'accepted');
    await until(() => source(peer.doc) === repaired, 'accepted after actual process restart');
    peer.close();
    await hub.kill();
    hub = await subprocess(root);
    peer = await client(hub, 'reader');
    assert.deepEqual(await submit(hub, corrected), result);
    assert.equal(state().revision, 1);
    assert.equal(state().history.length, 1);
    assert.equal(source(peer.doc), repaired);
    assert.equal(readFileSync(join(root, 'checkout/canvas.tsx'), 'utf8'), repaired);
  } finally {
    peer.close();
    candidate.destroy();
    await hub.kill();
    rmSync(root, { recursive: true, force: true });
  }
});
