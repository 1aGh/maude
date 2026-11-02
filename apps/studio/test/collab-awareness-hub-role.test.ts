// V2-8.9 round B L1 (belt and braces) — a presence `role` relayed from the hub enters the room only when the
// hub vouched for it (`roleBy: 'hub'`, apps/hub access-docs.mjs `stampHubRole`). A peer on a hub that did not
// stamp it (an older hub) cannot show itself as "· Owner" to this studio's people.

import { describe, expect, test } from 'bun:test';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { bridgeAwareness } from '../collab/awareness-bridge.ts';

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
