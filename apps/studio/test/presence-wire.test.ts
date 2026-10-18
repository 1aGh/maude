// S9.23 — the mixed v1 / v2 awareness test (S9-slices S9.23 "Mixed v1/v2 awareness test"):
// real y-protocols awareness on both sides of a wire, a v2 peer that publishes the presence fields and a
// v1 peer that has never heard of them. The receiver reads both through the same trust boundary; the v1
// peer renders as "on this canvas", nobody's e-mail crosses, and a Bring is heard by a v2 follower only.
import { describe, expect, test } from 'bun:test';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import { stripUnheldFields } from '../collab/awareness-bridge.ts';
import {
  collapseFaces,
  NOT_FOLLOWING,
  peopleList,
  pickSummon,
  syncFollow,
} from '../presence/model.ts';
import { readForeignPeers } from '../use-collab.tsx';

const NOW = 1_800_000_000_000;
const room = () => new Awareness(new Y.Doc());
function relay(from: Awareness, to: Awareness) {
  applyAwarenessUpdate(to, encodeAwarenessUpdate(from, [from.clientID]), 'wire');
}
const base = {
  color: 'x',
  cursor: null,
  selection: null,
  annotationSelection: [],
  viewport: { x: 1, y: 2, zoom: 1 },
};

describe('mixed v1 / v2 peers in one room', () => {
  test('the v2 leader’s fields arrive; the v1 peer shows its quiet defaults; no e-mail on the wire', () => {
    const leader = room();
    const v1 = room();
    const me = room();
    leader.setLocalState({
      ...base,
      name: 'Jonas',
      artboard: 'a4',
      surface: 'browser',
      inComments: false,
      summon: { id: 'abcdefgh1234', at: NOW - 100 },
      email: 'jonas@example.com', // a hostile or careless peer
    });
    v1.setLocalState({ ...base, name: 'michal.dovrtel@studyfi.com' }); // a v1 git name that is an address
    relay(leader, me);
    relay(v1, me);

    const peers = readForeignPeers(me);
    const jonas = peers.find((p) => p.name === 'Jonas');
    const old = peers.find((p) => p.clientID === v1.clientID);
    expect(jonas).toMatchObject({ artboard: 'a4', surface: 'browser', summon: { at: NOW - 100 } });
    expect('email' in (jonas as object)).toBe(false);
    expect(old).toMatchObject({ artboard: null, idleSince: null, surface: 'app', summon: null });
    expect(JSON.stringify(peers)).not.toContain('@');
    expect(old?.name).toBe('michal dovrtel');

    // the list: the v1 peer is "on this canvas", the v2 one says where
    const list = peopleList(peers, {
      labelOf: (id) => (id === 'a4' ? 'A4 · plakát' : null),
      now: NOW,
      canvasLabel: 'Combine-kampan',
    });
    expect(list.heading).toBe('3 on Combine-kampan');
    expect(list.rows.find((r) => r.name === 'Jonas')?.where).toBe('A4 · plakát · in a browser');
    expect(list.rows.find((r) => r.clientID === v1.clientID)?.where).toBe('on this canvas');
    expect(collapseFaces(peers).more).toBe(0);
  });

  test('a Bring is heard from the wire: the follower moves to the leader; the v1 peer ignores the field', () => {
    const leader = room();
    const me = room();
    leader.setLocalState({ ...base, name: 'Jonas', summon: { id: 'abcdefgh1234', at: NOW - 100 } });
    relay(leader, me);
    const peers = readForeignPeers(me);
    expect(pickSummon(peers, NOW)?.clientID).toBe(leader.clientID);
    expect(syncFollow(NOT_FOLLOWING, peers, NOW)).toMatchObject({
      target: leader.clientID,
      summonId: 'abcdefgh1234',
    });
    // Stop: the leader clears the field, the follower is released
    leader.setLocalState({ ...base, name: 'Jonas', summon: null });
    relay(leader, me);
    const after = readForeignPeers(me);
    const moved = syncFollow(NOT_FOLLOWING, peers, NOW);
    expect(syncFollow(moved, after, NOW + 1000).target).toBeNull();
  });

  test('a connection without the `summon` capability never reaches the room with the field', () => {
    const viewer = room();
    viewer.setLocalState({ ...base, name: 'Vojta', summon: { id: 'abcdefgh1234', at: NOW } });
    const dropped = stripUnheldFields(viewer, [viewer.clientID], (cap) => cap !== 'summon');
    expect(dropped).toBe(1);
    const me = room();
    relay(viewer, me);
    expect(pickSummon(readForeignPeers(me), NOW)).toBeNull();
  });
});

describe('the canvas tells the shell where people are (dgn `peers`)', () => {
  const parse = (peers: unknown) => DGN_TABLE.c2s.peers.parse({ peers });
  test('the presence fields cross, checked by value; nothing else does', () => {
    const ok = parse([
      {
        clientID: 7,
        name: 'Tereza',
        artboard: 'a4',
        surface: 'browser',
        inComments: true,
        idleSince: NOW,
        email: 'a@b.c',
      },
    ]);
    expect(ok).toEqual({
      peers: [
        {
          clientID: 7,
          name: 'Tereza',
          artboard: 'a4',
          surface: 'browser',
          inComments: true,
          idleSince: NOW,
        },
      ],
    });
    // a pre-S9.23 canvas (names only) is still accepted as ever
    expect(parse([{ clientID: 7, name: 'Tereza' }])).toEqual({
      peers: [{ clientID: 7, name: 'Tereza' }],
    });
  });
  test('a planted value rejects the whole list, never half of it', () => {
    expect(parse([{ clientID: 7, name: 'T', artboard: '<img src=x>' }])).toBeNull();
    expect(parse([{ clientID: 7, name: 'T', surface: 'tv' }])).toBeNull();
    expect(parse([{ clientID: 7, name: 'T', idleSince: -5 }])).toBeNull();
    expect(parse([{ clientID: 7, name: 'T', inComments: 'yes' }])).toBeNull();
  });
});
