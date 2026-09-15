// Unit: the DDR-122 follow-up origin gate — untrusted canvas-realm doc ops may
// never write the canvas SOURCE lanes (html / css / meta / syncMeta), while the
// lanes the canvas legitimately co-authors (comments / annotations /
// presentation) keep working for same-machine boards.
//
// Cloud Phase 1 Task 3. See apps/studio/collab/origins.ts for the threat model
// and for why the gate needs a mirror doc rather than update-byte inspection.

import { describe, expect, test } from 'bun:test';

import * as encoding from 'lib0/encoding';
import { writeUpdate } from 'y-protocols/sync';
import * as Y from 'yjs';

import {
  isBodyLane,
  isCanvasAuthorableLane,
  isTrustedOrigin,
  laneVocabulary,
  markTrustedOrigin,
  rootTypesTouched,
  SHELL_EDIT_ORIGIN,
  touchesBodyLane,
} from '../collab/origins.ts';
import { MESSAGE_SYNC } from '../collab/protocol.ts';
import { createRoom, type RoomCallbacks, type RoomConn } from '../collab/room.ts';

const MESSAGE_SYNC_UPDATE = 2; // y-protocols/sync messageYjsUpdate

function makeConn(id: string, realm?: 'main' | 'canvas'): RoomConn & { recv: Uint8Array[] } {
  const recv: Uint8Array[] = [];
  return {
    id,
    ...(realm ? { realm } : {}),
    send(payload: Uint8Array) {
      recv.push(payload);
    },
    recv,
  };
}

function makeCallbacks(): RoomCallbacks {
  return {
    seed() {
      /* nothing on disk */
    },
    persistJson() {
      /* no-op */
    },
    persistBinary() {
      /* no-op */
    },
  };
}

/** Frame a raw Y update as a y-websocket MESSAGE_SYNC / update frame. */
function syncUpdateFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

/**
 * Build the frame a malicious (or merely careless) canvas peer would send: it
 * mirrors the room's current state, mutates locally, and ships the delta —
 * exactly what `use-collab.tsx` does, minus lock 1.
 */
function peerDelta(room: { doc: Y.Doc }, mutate: (doc: Y.Doc) => void): Uint8Array {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(room.doc));
  const before = Y.encodeStateVector(peer);
  mutate(peer);
  return Y.encodeStateAsUpdate(peer, before);
}

describe('origins — lane vocabulary + trusted sentinels', () => {
  test('body lanes and canvas-authorable lanes are disjoint and complete', () => {
    const { body, canvasAuthorable } = laneVocabulary();
    expect(body).toEqual(['css', 'html', 'meta', 'syncMeta']);
    expect(canvasAuthorable).toEqual(['annotations', 'comments', 'presentation']);
    for (const lane of body) {
      expect(isBodyLane(lane)).toBe(true);
      expect(isCanvasAuthorableLane(lane)).toBe(false);
    }
    for (const lane of canvasAuthorable) {
      expect(isBodyLane(lane)).toBe(false);
      expect(isCanvasAuthorableLane(lane)).toBe(true);
    }
  });

  test('a forged origin object is NOT trusted; only the real sentinel is', () => {
    expect(isTrustedOrigin(SHELL_EDIT_ORIGIN)).toBe(true);
    // The exact shape of the sentinel, rebuilt by an attacker who read the source.
    expect(isTrustedOrigin({ maudeOrigin: 'shell-edit' })).toBe(false);
    expect(isTrustedOrigin('shell-edit')).toBe(false);
    expect(isTrustedOrigin(null)).toBe(false);
    expect(isTrustedOrigin(undefined)).toBe(false);
  });

  test('markTrustedOrigin registers a frozen object and returns it', () => {
    const sentinel = markTrustedOrigin(Object.freeze({ maudeOrigin: 'test' }));
    expect(isTrustedOrigin(sentinel)).toBe(true);
  });

  test('rootTypesTouched resolves nested types up to their root', () => {
    const doc = new Y.Doc();
    const seen: Set<string>[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => {
      if (tr.origin === 'probe') seen.push(rootTypesTouched(tr));
    });
    doc.transact(() => {
      const nested = new Y.Map<string>();
      doc.getArray<Y.Map<string>>('comments').push([nested]);
      nested.set('text', 'hi');
    }, 'probe');
    expect(seen.length).toBe(1);
    expect([...(seen[0] ?? [])]).toEqual(['comments']);
  });

  test('touchesBodyLane discriminates body writes from comment writes', () => {
    const doc = new Y.Doc();
    const verdicts: boolean[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => {
      if (tr.origin === 'probe') verdicts.push(touchesBodyLane(tr));
    });
    doc.transact(() => doc.getArray('comments').push([{ id: 'c1' }]), 'probe');
    doc.transact(() => doc.getText('html').insert(0, '<b>x</b>'), 'probe');
    // An insert into EXISTING text — the case whose target lane is absent from
    // the update bytes (origins.ts § "why a mirror doc").
    doc.transact(() => doc.getText('html').insert(3, 'evil'), 'probe');
    expect(verdicts).toEqual([false, true, true]);
  });
});

describe('room origin gate — canvas realm', () => {
  test('REJECTS a canvas-realm write to the body lane; doc untouched, not broadcast', async () => {
    const room = createRoom('ui-screen', makeCallbacks());
    const shell = makeConn('shell', 'main');
    const canvas = makeConn('canvas', 'canvas');
    await room.connect(shell);
    await room.connect(canvas);
    shell.recv.length = 0;

    // Seed a body through the trusted path so the attack is an insert into
    // EXISTING text — the case update-byte inspection cannot classify.
    room.doc.transact(() => room.doc.getText('html').insert(0, '<main>ok</main>'), 'sync-agent');
    shell.recv.length = 0;
    canvas.recv.length = 0;

    const evil = peerDelta(room, (d) => d.getText('html').insert(6, 'PWNED'));
    room.receive(canvas, syncUpdateFrame(evil));

    expect(room.doc.getText('html').toString()).toBe('<main>ok</main>');
    expect(room.gateRefusals()).toBe(1);
    // Nothing reached the other peer.
    expect(shell.recv.length).toBe(0);
    // The refused peer got a corrective full-state frame instead.
    expect(canvas.recv.length).toBe(1);
    await room.destroy();
  });

  test('REJECTS canvas-realm writes to css, meta and syncMeta too', async () => {
    for (const [lane, mutate] of [
      ['css', (d: Y.Doc) => d.getText('css').insert(0, '.evil{}')],
      ['meta', (d: Y.Doc) => d.getText('meta').insert(0, '{"evil":1}')],
      ['syncMeta', (d: Y.Doc) => d.getMap('syncMeta').set('bodyEditAt', 1)],
    ] as const) {
      const room = createRoom(`lane-${lane}`, makeCallbacks());
      const canvas = makeConn('canvas', 'canvas');
      await room.connect(canvas);
      room.receive(canvas, syncUpdateFrame(peerDelta(room, mutate)));
      expect(room.gateRefusals()).toBe(1);
      expect(Y.encodeStateAsUpdate(room.doc).length).toBe(
        Y.encodeStateAsUpdate(new Y.Doc()).length
      );
      await room.destroy();
    }
  });

  test('ALLOWS canvas-realm comments + annotations (same-machine boards keep working)', async () => {
    const room = createRoom('board', makeCallbacks());
    const shell = makeConn('shell', 'main');
    const canvas = makeConn('canvas', 'canvas');
    await room.connect(shell);
    await room.connect(canvas);
    shell.recv.length = 0;

    room.receive(
      canvas,
      syncUpdateFrame(
        peerDelta(room, (d) => {
          d.getArray('comments').push([{ id: 'c1', text: 'from the canvas' }]);
          d.getMap('annotations').set('svg', '<svg><rect/></svg>');
        })
      )
    );

    expect(room.doc.getArray('comments').toArray()).toEqual([
      { id: 'c1', text: 'from the canvas' },
    ]);
    expect(room.doc.getMap('annotations').get('svg')).toBe('<svg><rect/></svg>');
    expect(room.gateRefusals()).toBe(0);
    // And it DID reach the other peer.
    expect(shell.recv.length).toBeGreaterThan(0);
    await room.destroy();
  });

  test('a mixed frame is refused WHOLESALE — no partial application of the good half', async () => {
    const room = createRoom('mixed', makeCallbacks());
    const canvas = makeConn('canvas', 'canvas');
    await room.connect(canvas);

    room.receive(
      canvas,
      syncUpdateFrame(
        peerDelta(room, (d) => {
          d.getArray('comments').push([{ id: 'decoy' }]);
          d.getText('html').insert(0, 'PWNED');
        })
      )
    );

    expect(room.gateRefusals()).toBe(1);
    expect(room.doc.getArray('comments').length).toBe(0);
    expect(room.doc.getText('html').toString()).toBe('');
    await room.destroy();
  });

  test('the gate SURVIVES a refusal — the next honest canvas frame still applies', async () => {
    const room = createRoom('recover', makeCallbacks());
    const canvas = makeConn('canvas', 'canvas');
    await room.connect(canvas);

    room.receive(canvas, syncUpdateFrame(peerDelta(room, (d) => d.getText('html').insert(0, 'x'))));
    expect(room.gateRefusals()).toBe(1);

    room.receive(
      canvas,
      syncUpdateFrame(peerDelta(room, (d) => d.getArray('comments').push([{ id: 'after' }])))
    );
    expect(room.gateRefusals()).toBe(1);
    expect(room.doc.getArray('comments').toArray()).toEqual([{ id: 'after' }]);
    await room.destroy();
  });

  test('the MAIN realm is ungated — the shell may still write the body', async () => {
    const room = createRoom('shell-write', makeCallbacks());
    const shell = makeConn('shell', 'main');
    await room.connect(shell);

    room.receive(shell, syncUpdateFrame(peerDelta(room, (d) => d.getText('html').insert(0, 'ok'))));

    expect(room.doc.getText('html').toString()).toBe('ok');
    expect(room.gateRefusals()).toBe(0);
    await room.destroy();
  });

  test('a conn with no realm defaults to trusted (pre-existing callers unchanged)', async () => {
    const room = createRoom('legacy', makeCallbacks());
    const legacy = makeConn('legacy');
    await room.connect(legacy);

    room.receive(
      legacy,
      syncUpdateFrame(peerDelta(room, (d) => d.getText('html').insert(0, 'ok')))
    );

    expect(room.doc.getText('html').toString()).toBe('ok');
    expect(room.gateRefusals()).toBe(0);
    await room.destroy();
  });

  test('awareness frames from the canvas realm pass through the gate untouched', async () => {
    const room = createRoom('presence', makeCallbacks());
    const canvas = makeConn('canvas', 'canvas');
    await room.connect(canvas);

    // A well-formed awareness frame from a peer's own Awareness instance.
    const peerDoc = new Y.Doc();
    const { Awareness, encodeAwarenessUpdate } = await import('y-protocols/awareness');
    const peerAwareness = new Awareness(peerDoc);
    peerAwareness.setLocalState({ name: 'canvas peer' });
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1 /* MESSAGE_AWARENESS */);
    encoding.writeVarUint8Array(
      encoder,
      encodeAwarenessUpdate(peerAwareness, [peerAwareness.clientID])
    );
    room.receive(canvas, encoding.toUint8Array(encoder));

    expect(room.awareness.getStates().get(peerAwareness.clientID)).toEqual({ name: 'canvas peer' });
    expect(room.gateRefusals()).toBe(0);
    await room.destroy();
  });

  test('a malformed sync frame from the canvas realm mutates nothing and leaves the room usable', async () => {
    const room = createRoom('garbage', makeCallbacks());
    const canvas = makeConn('canvas', 'canvas');
    await room.connect(canvas);

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, MESSAGE_SYNC_UPDATE);
    encoding.writeVarUint8Array(encoder, new Uint8Array([0xff, 0xff, 0xff, 0xff]));
    // yjs swallows an undecodable update internally rather than throwing, so
    // this is not a *gate* refusal — it never becomes a transaction at all, on
    // the mirror or on the room doc. Assert the property that matters: nothing
    // applied, no crash, and the gate still works afterwards.
    room.receive(canvas, encoding.toUint8Array(encoder));

    expect(Y.encodeStateAsUpdate(room.doc).length).toBe(Y.encodeStateAsUpdate(new Y.Doc()).length);

    room.receive(canvas, syncUpdateFrame(peerDelta(room, (d) => d.getText('html').insert(0, 'x'))));
    expect(room.gateRefusals()).toBe(1);
    room.receive(
      canvas,
      syncUpdateFrame(peerDelta(room, (d) => d.getArray('comments').push([{ id: 'ok' }])))
    );
    expect(room.doc.getArray('comments').toArray()).toEqual([{ id: 'ok' }]);
    await room.destroy();
  });
});

describe('accepted revisions — the room doc is a replica no browser writes', () => {
  test('a main-realm comments/annotations write is refused and the peer is re-told the truth', async () => {
    let accepted = true;
    const room = createRoom('accepted-canvas', {
      ...makeCallbacks(),
      acceptedMode: () => accepted,
    });
    const conn = makeConn('browser-main', 'main');
    await room.connect(conn);
    const before = conn.recv.length;
    room.receive(
      conn,
      syncUpdateFrame(peerDelta(room, (d) => d.getArray('comments').push([{ id: 'c1' }])))
    );
    expect(room.doc.getArray('comments').length).toBe(0);
    expect(room.gateRefusals()).toBe(1);
    expect(conn.recv.length).toBeGreaterThan(before); // server truth re-asserted
    // Out of accepted mode the same frame is an ordinary write again.
    accepted = false;
    room.receive(
      conn,
      syncUpdateFrame(peerDelta(room, (d) => d.getArray('comments').push([{ id: 'c2' }])))
    );
    expect(room.doc.getArray('comments').length).toBe(1);
    await room.destroy();
  });
});
