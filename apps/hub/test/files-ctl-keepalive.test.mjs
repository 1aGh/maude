// The socket keep-alive (2026-10-05, "an idle desktop lets its cloud cell
// sleep", Bug B; widened to canvas sockets after the v1.6.13 night).
//
// An idle `maude.files` socket heard nothing: presence is dropped on the
// control document and the Hocuspocus server never pings, so the provider's
// 30 s silence check recycled the socket every ~33 s — and every reconnect
// re-ran document discovery against a cell that therefore never slept.
//
// Pinned here:
//   - one frame per socket per tick, control document first, every canvas
//     socket included, and it stops when stopped;
//   - against a REAL server and a REAL provider with a shortened silence
//     check, the socket stays up with the keep-alive and is recycled without
//     it — so the check still catches a dead socket (issue #118);
//   - the frame is never a poke to any parser (an old desktop must not run a
//     pass every 15 s).

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';

import {
  CTL_KEEPALIVE_FRAME,
  CTL_KEEPALIVE_MS,
  createSocketKeepalive,
  FILES_CTL_DOC,
  parsePoke,
} from '../src/files-ctl.mjs';

/** Documents → connections; a connection is `{ webSocket, sendStateless }`. */
function fakeInstance(layout) {
  const frames = [];
  const sockets = new Map();
  const socket = (id) => {
    if (!sockets.has(id)) sockets.set(id, { id });
    return sockets.get(id);
  };
  const documents = new Map(
    Object.entries(layout).map(([name, socketIds]) => [
      name,
      {
        getConnections: () =>
          socketIds.map((id) => ({
            webSocket: socket(id),
            sendStateless: (p) => frames.push({ doc: name, socket: id, p }),
          })),
      },
    ])
  );
  return { instance: { hocuspocus: { documents } }, frames };
}

describe('createSocketKeepalive', () => {
  it('one frame per SOCKET per tick — control doc first, canvases too', () => {
    // Socket A carries the control doc and two canvases; socket B only canvases;
    // socket C only one canvas (a second desktop, say).
    const { instance, frames } = fakeInstance({
      [FILES_CTL_DOC]: ['A'],
      'ui-one': ['A', 'B'],
      'ui-two': ['A', 'B', 'C'],
    });
    let armed = null;
    let cleared = false;
    const ka = createSocketKeepalive({
      instance,
      setIntervalImpl: (fn, ms) => {
        armed = { fn, ms };
        return { unref() {} };
      },
      clearIntervalImpl: () => {
        cleared = true;
      },
    });
    ka.start();
    assert.equal(armed.ms, CTL_KEEPALIVE_MS);
    assert.equal(CTL_KEEPALIVE_MS, 15_000);
    armed.fn();
    assert.deepEqual(frames, [
      { doc: FILES_CTL_DOC, socket: 'A', p: CTL_KEEPALIVE_FRAME },
      { doc: 'ui-one', socket: 'B', p: CTL_KEEPALIVE_FRAME },
      { doc: 'ui-two', socket: 'C', p: CTL_KEEPALIVE_FRAME },
    ]);
    armed.fn();
    assert.equal(ka.sent(), 6);
    ka.stop();
    assert.equal(cleared, true);
  });

  it('nobody attached is the ordinary idle state — nothing sent, nothing thrown', () => {
    const { instance } = fakeInstance({ 'ui-screen': [] });
    const ka = createSocketKeepalive({ instance });
    ka.tick();
    assert.equal(ka.sent(), 0);
  });

  it('a send that throws is logged once, never raised, and the others still go', () => {
    const errors = [];
    const sentTo = [];
    const instance = {
      documents: new Map([
        [
          'ui-a',
          {
            getConnections: () => [
              {
                webSocket: 1,
                sendStateless() {
                  throw new Error('socket gone');
                },
              },
              { webSocket: 2, sendStateless: () => sentTo.push(2) },
            ],
          },
        ],
      ]),
    };
    const ka = createSocketKeepalive({ instance, log: { error: (m) => errors.push(m) } });
    ka.tick();
    ka.tick();
    assert.equal(errors.length, 1);
    assert.deepEqual(sentTo, [2, 2]);
  });

  it('the frame is never a poke, and never a save-mode notice', () => {
    assert.equal(parsePoke(CTL_KEEPALIVE_FRAME), null);
    assert.notEqual(JSON.parse(CTL_KEEPALIVE_FRAME).type, 'maude.mode');
  });
});

/**
 * Attach a real provider to the control document with a shortened silence
 * check, and count how many times its socket (re)connects in `windowMs`.
 */
async function connectsOver({ keepaliveMs, silenceMs, windowMs, name = FILES_CTL_DOC }) {
  const server = new Server({ port: 0, quiet: true });
  await server.listen();
  const port = server.address.port;
  const ka = keepaliveMs
    ? createSocketKeepalive({ instance: server, intervalMs: keepaliveMs })
    : null;
  ka?.start();
  let opens = 0;
  const socket = new HocuspocusProviderWebsocket({
    url: `ws://127.0.0.1:${port}`,
    messageReconnectTimeout: silenceMs,
    minDelay: 50,
    delay: 50,
    jitter: false,
    onOpen: () => {
      opens += 1;
    },
  });
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name,
    document: new Y.Doc(),
    token: 't',
  });
  provider.attach?.();
  // The provider's own awareness renewals would keep a socket talking; the
  // hub drops presence on this document, so turn it off here too.
  provider.awareness?.setLocalState(null);
  await new Promise((r) => setTimeout(r, windowMs));
  ka?.stop();
  // TEARDOWN MUST NOT LEAVE A RETRY BEHIND. A close landed shortly before
  // `destroy()` leaves `onClose`'s `setTimeout(connect, delay)` pending, and
  // `connect()` sets `shouldConnect` back to true — so the socket retries a
  // destroyed server forever and this file's process never exits (it held CI's
  // Test step to its 30-minute limit on the v1.6.13 release commit).
  socket.connect = async () => {};
  socket.cancelWebsocketRetry?.();
  provider.destroy();
  socket.destroy();
  await server.destroy();
  return opens;
}

describe('against a real server and provider', () => {
  it('with the keep-alive, an idle control socket stays up', async () => {
    const opens = await connectsOver({ keepaliveMs: 300, silenceMs: 1_200, windowMs: 4_000 });
    assert.equal(opens, 1);
  });

  it('a CANVAS socket stays up too (v1.6.13 night: 214 upgrades/h from canvas shards)', async () => {
    const opens = await connectsOver({
      keepaliveMs: 300,
      silenceMs: 1_200,
      windowMs: 4_000,
      name: 'ui-screen',
    });
    assert.equal(opens, 1);
  });

  it('without it, the silence check recycles the socket (still alive for #118)', async () => {
    const opens = await connectsOver({ keepaliveMs: 0, silenceMs: 1_200, windowMs: 4_000 });
    assert.ok(opens >= 2, `expected the idle socket to be recycled, saw ${opens} open(s)`);
  });
});

// BELT AND BRACES. Every assertion above is about a real `@hocuspocus/provider`
// socket, whose retry machinery is not ours to stop completely: on CI's Linux
// runner this file's tests all reported `ok` and its process then stayed alive
// until the 30-minute job limit (v1.6.13 release commit). Once every test here
// has finished (the early-exit guard has already recorded that), nothing in
// this file may keep the process up. Unref'd: a clean file exits on its own.
after(() => {
  setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
});
