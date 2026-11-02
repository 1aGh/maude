// P8 (p8-collision) — Hocuspocus unloads a document by NAME. A peer that loads the
// document between a direct connection's two unloads is orphaned: the stale object's
// trailing unload deletes the peer's live document from the map, so the next accepted
// revision writes into a different instance and the peer never hears it.
// See src/unload-by-identity.mjs.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { Hocuspocus } from '@hocuspocus/server';

import { unloadByIdentity } from '../src/unload-by-identity.mjs';

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** What `applyAccepted` does to a document, then a peer (a direct connection stands in
 *  for its socket: it holds the document the same way) loads it straight after. */
async function raceOnce(hp) {
  const writer = await hp.openDirectConnection('doc', {});
  await writer.transact((d) => d.getMap('m').set('k', 1));
  await writer.disconnect();
  const peer = await hp.openDirectConnection('doc', {});
  await tick();
  return peer;
}

describe('a peer that loads a document right after a direct connection unloaded it', () => {
  test('upstream: the late unload of the old object deletes the peer’s live document', async () => {
    const hp = new Hocuspocus({ quiet: true });
    const peer = await raceOnce(hp);
    // If this starts failing, Hocuspocus fixed it: delete the guard and this file.
    assert.notEqual(
      hp.documents.get('doc'),
      peer.document,
      'upstream now unloads by identity — drop src/unload-by-identity.mjs'
    );
    const orphan = peer.document;
    await peer.disconnect();
    // The orphan is no longer in the map, so nothing else will release its awareness timer.
    orphan.destroy();
  });

  test('guarded: the peer’s document stays the one in the map and still takes updates', async () => {
    const hp = unloadByIdentity(new Hocuspocus({ quiet: true }));
    const peer = await raceOnce(hp);
    assert.equal(hp.documents.get('doc'), peer.document);
    // The next accepted revision lands in the peer's own instance.
    const next = await hp.openDirectConnection('doc', {});
    assert.equal(next.document, peer.document);
    await next.transact((d) => d.getMap('m').set('k', 2));
    assert.equal(peer.document.getMap('m').get('k'), 2);
    await next.disconnect();
    await peer.disconnect();
  });

  test('guarded: an ordinary last-connection unload still happens', async () => {
    const hp = unloadByIdentity(new Hocuspocus({ quiet: true }));
    const only = await hp.openDirectConnection('solo', {});
    await only.transact((d) => d.getMap('m').set('k', 1));
    await only.disconnect();
    await tick();
    assert.equal(hp.documents.has('solo'), false);
  });

  test('the guard is idempotent', () => {
    const hp = new Hocuspocus({ quiet: true });
    assert.equal(unloadByIdentity(unloadByIdentity(hp)), hp);
  });
});
