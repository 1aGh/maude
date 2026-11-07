// V2-8.9 round B L1 (belt and braces) — a presence `role` relayed from the hub enters the room only when the
// hub vouched for it (`roleBy: 'hub'`, apps/hub access-docs.mjs `stampHubRole`). A peer on a hub that did not
// stamp it (an older hub) cannot show itself as "· Owner" to this studio's people.

import { describe, expect, test } from 'bun:test';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { bridgeAwareness } from '../collab/awareness-bridge.ts';
import { hasPresenceRoleV1 } from '../sync/journal-client.ts';

function peer(state: Record<string, unknown>) {
  const a = new Awareness(new Y.Doc());
  a.setLocalState(state);
  return a;
}

describe('hub → room: an unvouched role is dropped', () => {
  test('a role with no hub mark is dropped, a hub-stamped one passes, the rest is untouched', () => {
    const room = new Awareness(new Y.Doc());
    const hub = new Awareness(new Y.Doc());
    const detach = bridgeAwareness(room, hub);
    const forger = peer({ name: 'Tereza', role: 'owner' });
    const stamped = peer({ name: 'Jonas', role: 'viewer', roleBy: 'hub' });
    applyAwarenessUpdate(hub, encodeAwarenessUpdate(forger, [forger.clientID]), 'hub-socket');
    applyAwarenessUpdate(hub, encodeAwarenessUpdate(stamped, [stamped.clientID]), 'hub-socket');
    expect(room.getStates().get(forger.clientID)).toEqual({ name: 'Tereza' });
    expect(room.getStates().get(stamped.clientID)).toEqual({
      name: 'Jonas',
      role: 'viewer',
      roleBy: 'hub',
    });
    detach();
  });

  test('the initial exchange drops it too', () => {
    const room = new Awareness(new Y.Doc());
    const hub = new Awareness(new Y.Doc());
    const forger = peer({ name: 'Tereza', role: 'owner' });
    applyAwarenessUpdate(hub, encodeAwarenessUpdate(forger, [forger.clientID]), 'hub-socket');
    const detach = bridgeAwareness(room, hub);
    expect(room.getStates().get(forger.clientID)).toEqual({ name: 'Tereza' });
    detach();
  });
});

// T5.2 (#165) — the mark alone proves nothing on a hub that does not stamp (a 1.x hub relays
// `roleBy: 'hub'` exactly as a peer's studio sent it). The role is kept only from a hub whose /health
// says `presence-role-v1`; until it answers, and from any other hub, it is dropped with its mark.
describe('hub → room: a role is kept only from a hub that stamps roles', () => {
  test('rolesVouched false → a hub-marked role is dropped with its mark; true → kept', () => {
    for (const [vouched, want] of [
      [false, { name: 'Jonas' }],
      [true, { name: 'Jonas', role: 'viewer', roleBy: 'hub' }],
    ] as const) {
      const room = new Awareness(new Y.Doc());
      const hub = new Awareness(new Y.Doc());
      const detach = bridgeAwareness(room, hub, { rolesVouched: () => vouched });
      const marked = peer({ name: 'Jonas', role: 'viewer', roleBy: 'hub' });
      applyAwarenessUpdate(hub, encodeAwarenessUpdate(marked, [marked.clientID]), 'hub-socket');
      expect(room.getStates().get(marked.clientID)).toEqual(want);
      detach();
    }
  });

  test('a bare mark with no role does not cross either', () => {
    const room = new Awareness(new Y.Doc());
    const hub = new Awareness(new Y.Doc());
    const detach = bridgeAwareness(room, hub, { rolesVouched: () => false });
    const marked = peer({ name: 'Jonas', roleBy: 'hub' });
    applyAwarenessUpdate(hub, encodeAwarenessUpdate(marked, [marked.clientID]), 'hub-socket');
    expect(room.getStates().get(marked.clientID)).toEqual({ name: 'Jonas' });
    detach();
  });

  test('room → hub: a studio never forwards the hub mark as its own', () => {
    const room = new Awareness(new Y.Doc());
    const hub = new Awareness(new Y.Doc());
    const detach = bridgeAwareness(room, hub, { rolesVouched: () => true });
    const tab = peer({ name: 'Ana', role: 'member', roleBy: 'hub' });
    applyAwarenessUpdate(room, encodeAwarenessUpdate(tab, [tab.clientID]), 'tab-socket');
    expect(hub.getStates().get(tab.clientID)).toEqual({ name: 'Ana', role: 'member' });
    detach();
  });

  test('the capability word is read from /health capabilities', () => {
    expect(hasPresenceRoleV1(['annotations-v2', 'presence-role-v1'])).toBe(true);
    expect(hasPresenceRoleV1(['annotations-v2'])).toBe(false);
    expect(hasPresenceRoleV1(null)).toBe(false);
  });
});
