// The control-channel keep-alive (2026-10-05, "an idle desktop lets its cloud
// cell sleep", Bug B).
//
// An idle `maude.files` socket heard nothing: presence is dropped on the
// control document and the Hocuspocus server never pings, so the provider's
// 30 s silence check recycled the socket every ~33 s — and every reconnect
// re-ran document discovery against a cell that therefore never slept.
//
// Pinned here:
//   - the keep-alive addresses the control document and nothing else, and
//     stops when stopped;
//   - against a REAL server and a REAL provider with a shortened silence
//     check, the socket stays up with the keep-alive and is recycled without
//     it — so the check still catches a dead socket (issue #118);
//   - the frame is never a poke to any parser (an old desktop must not run a
//     pass every 15 s).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';

import {
  CTL_KEEPALIVE_FRAME,
  CTL_KEEPALIVE_MS,
  createCtlKeepalive,
  FILES_CTL_DOC,
  parsePoke,
} from '../src/files-ctl.mjs';

function fakeInstance(names) {
  const sent = new Map(names.map((n) => [n, []]));
  const documents = new Map(
    names.map((n) => [n, { broadcastStateless: (p) => sent.get(n).push(p) }])
  );
  return { instance: { hocuspocus: { documents } }, sent };
}

describe('createCtlKeepalive', () => {
  it('broadcasts on the control document only, every interval, and stops', () => {
    const { instance, sent } = fakeInstance([FILES_CTL_DOC, 'ui-screen']);
    let armed = null;
    let cleared = false;
    const ka = createCtlKeepalive({
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
    armed.fn();
    assert.deepEqual(sent.get(FILES_CTL_DOC), [CTL_KEEPALIVE_FRAME, CTL_KEEPALIVE_FRAME]);
    assert.deepEqual(sent.get('ui-screen'), []);
    assert.equal(ka.sent(), 2);
    ka.stop();
    assert.equal(cleared, true);
  });

  it('nobody attached is the ordinary idle state — nothing sent, nothing thrown', () => {
    const { instance } = fakeInstance(['ui-screen']);
    const ka = createCtlKeepalive({ instance });
    ka.tick();
    assert.equal(ka.sent(), 0);
  });

  it('a broadcast that throws is logged, never raised', () => {
    const errors = [];
    const instance = {
      documents: new Map([
        [
          FILES_CTL_DOC,
          {
            broadcastStateless() {
              throw new Error('socket gone');
            },
          },
        ],
      ]),
    };
    const ka = createCtlKeepalive({ instance, log: { error: (m) => errors.push(m) } });
    ka.tick();
    assert.equal(errors.length, 1);
  });

  it('the frame is never a poke', () => {
    assert.equal(parsePoke(CTL_KEEPALIVE_FRAME), null);
  });
});

/**
 * Attach a real provider to the control document with a shortened silence
 * check, and count how many times its socket (re)connects in `windowMs`.
 */
async function connectsOver({ keepaliveMs, silenceMs, windowMs }) {
  const server = new Server({ port: 0, quiet: true });
  await server.listen();
  const port = server.address.port;
  const ka = keepaliveMs ? createCtlKeepalive({ instance: server, intervalMs: keepaliveMs }) : null;
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
    name: FILES_CTL_DOC,
    document: new Y.Doc(),
    token: 't',
  });
  provider.attach?.();
  // The provider's own awareness renewals would keep a socket talking; the
  // hub drops presence on this document, so turn it off here too.
  provider.awareness?.setLocalState(null);
  await new Promise((r) => setTimeout(r, windowMs));
  ka?.stop();
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

  it('without it, the silence check recycles the socket (still alive for #118)', async () => {
    const opens = await connectsOver({ keepaliveMs: 0, silenceMs: 1_200, windowMs: 4_000 });
    assert.ok(opens >= 2, `expected the idle socket to be recycled, saw ${opens} open(s)`);
  });
});
