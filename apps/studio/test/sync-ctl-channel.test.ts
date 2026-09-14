// The file-event control channel, receiver side — Sync v2 Increment 2
// (DDR-226 §4/§6).
//
// Four things are pinned:
//
//   1. **The gate.** `resolveCellCtl` needs workspace mode + a LOOPBACK hub +
//      a token, and NOTHING about cell pairing. Getting that wrong is what
//      would leave the watcher-gap bug alive on every cell but the pilot.
//   2. **The wire format is a twin, and twins drift.** `sync/poke.ts` and the
//      hub's `files-ctl.mjs` are pinned against each other over an adversarial
//      corpus — the `file-membership` precedent, imported across the package
//      boundary on purpose.
//   3. **A poke is a doorbell.** It triggers a read; it never carries content,
//      and the receiver only ever emits a bus event for a path.
//   4. **Fail-closed on the cursor.** A `reanchor` is honoured, not read as
//      "nothing changed"; a page we could not read never advances the cursor.

import { describe, expect, test } from 'bun:test';

// The HUB's implementation, across the package boundary — this file is what
// pins the two ends of the wire to each other.
import * as hub from '../../hub/src/files-ctl.mjs';
import { createCtlHealer } from '../sync/ctl-heal.ts';
import {
  type CtlProviderLike,
  createCtlProvider,
  resolveCellCtl,
  toWsUrl,
} from '../sync/ctl-provider.ts';
import { parsePoke } from '../sync/poke.ts';

const CELL_ENV = {
  MAUDE_WORKSPACE_MODE: '1',
  MAUDE_LOOPBACK_SYNC_URL: 'http://127.0.0.1:4321',
  MAUDE_LOOPBACK_SYNC_TOKEN: 'tok',
};

describe('resolveCellCtl — the gate, and what it deliberately does NOT check', () => {
  test('workspace mode + a loopback hub + a token is enough', () => {
    expect(resolveCellCtl(CELL_ENV)).toEqual({
      url: 'http://127.0.0.1:4321',
      token: 'tok',
    });
  });

  test('it does NOT require cell pairing — that is the whole point', () => {
    // Every pairing precondition absent. `CELL_LIVE_PAIRING` is a one-tenant
    // pilot allowlist; the container watcher gap is on every cell, so the
    // control channel must not inherit the pilot's gate.
    expect(
      resolveCellCtl({
        ...CELL_ENV,
        MAUDE_CELL_PAIRING: undefined,
        MAUDE_SHARED_DOC: undefined,
        MAUDE_SYNC_NO_AUTOCOMMIT: undefined,
      })
    ).not.toBeNull();
  });

  test('never outside workspace mode — a desktop must not start this', () => {
    expect(resolveCellCtl({ ...CELL_ENV, MAUDE_WORKSPACE_MODE: undefined })).toBeNull();
    expect(resolveCellCtl({ ...CELL_ENV, MAUDE_WORKSPACE_MODE: '0' })).toBeNull();
  });

  test('a cell talks to ITSELF or to nothing (DDR-209)', () => {
    for (const url of [
      'http://hub.example.com',
      'https://evil.test',
      'http://10.0.0.5:4321',
      'http://169.254.169.254',
      'not-a-url',
      '',
    ]) {
      expect(resolveCellCtl({ ...CELL_ENV, MAUDE_LOOPBACK_SYNC_URL: url })).toBeNull();
    }
    for (const url of ['http://localhost:1', 'http://127.0.0.1:2', 'http://[::1]:3']) {
      expect(resolveCellCtl({ ...CELL_ENV, MAUDE_LOOPBACK_SYNC_URL: url })).not.toBeNull();
    }
  });

  test('no token, no channel', () => {
    expect(resolveCellCtl({ ...CELL_ENV, MAUDE_LOOPBACK_SYNC_TOKEN: '' })).toBeNull();
  });

  test('MAUDE_FILE_EVENTS=0 is the operator kill switch', () => {
    expect(resolveCellCtl({ ...CELL_ENV, MAUDE_FILE_EVENTS: '0' })).toBeNull();
  });
});

describe('toWsUrl', () => {
  test('maps the scheme and trims the trailing slash', () => {
    expect(toWsUrl('http://127.0.0.1:9/')).toBe('ws://127.0.0.1:9');
    expect(toWsUrl('https://x.cloud.maude.sh//')).toBe('wss://x.cloud.maude.sh');
  });
});

describe('the poke frame is a TWIN — hub and studio must agree', () => {
  const corpus: unknown[] = [
    JSON.stringify({ t: 'files', head: 0 }),
    JSON.stringify({ t: 'files', head: 0, documents: true }),
    JSON.stringify({ t: 'files', head: 0, documents: 'true' }),
    JSON.stringify({ t: 'files', head: 1 }),
    JSON.stringify({ t: 'files', head: 999999 }),
    JSON.stringify({ t: 'files', head: -1 }),
    JSON.stringify({ t: 'files', head: 1.5 }),
    JSON.stringify({ t: 'files', head: '3' }),
    JSON.stringify({ t: 'files', head: null }),
    JSON.stringify({ t: 'files' }),
    JSON.stringify({ t: 'other', head: 3 }),
    JSON.stringify({ head: 3 }),
    JSON.stringify([1, 2]),
    JSON.stringify('files'),
    'not json',
    '',
    `{"t":"files","head":1,"pad":"${'x'.repeat(600)}"}`,
    null,
    undefined,
    42,
    {},
  ];

  test('both parsers agree on every entry of an adversarial corpus', () => {
    for (const input of corpus) {
      const mine = parsePoke(input);
      const theirs = hub.parsePoke(input);
      expect(mine).toEqual(theirs as typeof mine);
    }
  });

  test('and they agree on the document name', () => {
    expect(hub.FILES_CTL_DOC).toBe('maude.files');
  });

  test('extra fields are dropped, not refused — an additive hub must not mute us', () => {
    expect(parsePoke(JSON.stringify({ t: 'files', head: 7, future: 'field' }))).toEqual({
      head: 7,
    });
  });
});

/** A provider stub that lets a test push frames in. */
function fakeProvider() {
  const handlers = new Map<string, (d: unknown) => void>();
  let destroyed = false;
  const provider: CtlProviderLike = {
    on: ((event: string, cb: (d: unknown) => void) => {
      handlers.set(event, cb);
    }) as CtlProviderLike['on'],
    destroy() {
      destroyed = true;
    },
  };
  return {
    provider,
    emit: (event: string, data: unknown) => handlers.get(event)?.(data),
    destroyed: () => destroyed,
    ready: () => handlers.size > 0,
  };
}

describe('createCtlProvider', () => {
  test('a well-formed frame reaches onPoke; a malformed one is counted, not passed', async () => {
    const f = fakeProvider();
    const heads: number[] = [];
    const ctl = createCtlProvider({
      url: 'http://127.0.0.1:1',
      token: 't',
      onPoke: (h) => heads.push(h),
      log: { log() {}, warn() {}, error() {} },
      connect: () => f.provider,
    });
    // The attach is one microtask late by design.
    await Promise.resolve();
    await Promise.resolve();

    f.emit('stateless', { payload: JSON.stringify({ t: 'files', head: 11 }) });
    f.emit('stateless', { payload: 'garbage' });
    f.emit('stateless', { payload: JSON.stringify({ t: 'files', head: -2 }) });

    expect(heads).toEqual([11]);
    expect(ctl.received()).toBe(1);
    expect(ctl.malformed()).toBe(2);
    ctl.stop();
    expect(f.destroyed()).toBe(true);
  });

  test('a handler that throws never escapes the channel', async () => {
    const f = fakeProvider();
    const errors: string[] = [];
    createCtlProvider({
      url: 'http://127.0.0.1:1',
      token: 't',
      onPoke: () => {
        throw new Error('boom');
      },
      log: { log() {}, warn() {}, error: (m: string) => errors.push(m) },
      connect: () => f.provider,
    });
    await Promise.resolve();
    await Promise.resolve();
    f.emit('stateless', { payload: JSON.stringify({ t: 'files', head: 1 }) });
    expect(errors.length).toBe(1);
  });

  test('a connect that fails degrades to no channel, never to a throw', async () => {
    const warns: string[] = [];
    const ctl = createCtlProvider({
      url: 'http://127.0.0.1:1',
      token: 't',
      onPoke: () => {},
      log: { log() {}, warn: (m: string) => warns.push(m), error() {} },
      connect: () => {
        throw new Error('no provider module');
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(warns.join(' ')).toContain('falling back to the reconciler poll');
    expect(ctl.connected()).toBe(false);
    ctl.stop();
  });

  test('stopping before the attach resolves still destroys the provider', async () => {
    const f = fakeProvider();
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const ctl = createCtlProvider({
      url: 'http://127.0.0.1:1',
      token: 't',
      onPoke: () => {},
      log: { log() {}, warn() {}, error() {} },
      connect: async () => {
        await gate;
        return f.provider;
      },
    });
    ctl.stop();
    release?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.destroyed()).toBe(true);
  });
});

/** A journal the healer can read, with a scripted response per call. */
function journalServer(pages: Array<Record<string, unknown>>) {
  const asked: string[] = [];
  let i = 0;
  const fetchImpl = (async (url: string) => {
    asked.push(String(url));
    const body = pages[Math.min(i, pages.length - 1)];
    i += 1;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
}

describe('createCtlHealer — poke ⇒ journal ⇒ fs:any', () => {
  const base = { hubUrl: 'http://127.0.0.1:1', token: 't' };
  const silent = { log() {}, warn() {} };

  test('the FIRST poke only sets the baseline — a boot must not replay history', async () => {
    const emitted: string[] = [];
    const { fetchImpl, asked } = journalServer([{ epoch: 'e', head: 5, entries: [] }]);
    const healer = createCtlHealer({
      ...base,
      emit: (r) => emitted.push(r),
      fetchImpl,
      log: silent,
    });
    healer.onPoke(5);
    await healer.drain();
    // Everything at or below head 5 is already on disk and already rendered;
    // replaying it would be a reload storm on every cell wake.
    expect(asked).toEqual([]);
    expect(emitted).toEqual([]);
  });

  // THE HOLE THE FIRST-POKE BASELINE LEFT. The hub pokes only when the journal
  // APPENDS, so the first poke a freshly booted child sees is itself a change
  // it has never seen — and adopting its head as the baseline swallowed it.
  // On a cell that is "the first asset a peer delivered after boot never
  // healed the open canvas", which reads exactly like a dead channel.
  test('anchor() takes the baseline from the head, so the first poke is a real read', async () => {
    const emitted: string[] = [];
    const { fetchImpl, asked } = journalServer([
      { epoch: 'e', head: 5, entries: [] },
      {
        epoch: 'e',
        head: 6,
        entries: [
          {
            seq: 6,
            path: 'assets/late.png',
            sha256: 'c'.repeat(64),
            size: 1,
            class: 'inert-media',
          },
        ],
      },
    ]);
    const healer = createCtlHealer({
      ...base,
      emit: (r) => emitted.push(r),
      fetchImpl,
      log: silent,
      debounceMs: 0,
    });
    await healer.anchor();
    healer.onPoke(6);
    await healer.drain();

    expect(emitted).toEqual(['assets/late.png']);
    expect(asked[1]).toContain('since=5');
  });

  test('anchor() never overrules a cursor a poke already set', async () => {
    const { fetchImpl } = journalServer([{ epoch: 'e', head: 99, entries: [] }]);
    const healer = createCtlHealer({ ...base, emit: () => {}, fetchImpl, log: silent });
    healer.onPoke(5);
    await healer.anchor();
    // Still anchored at 5 — a poke at 5 is noise, and one above it is a read.
    healer.onPoke(5);
    expect(healer.ignored()).toBe(1);
  });

  test('a later poke reads the journal and announces each path', async () => {
    const emitted: string[] = [];
    const { fetchImpl, asked } = journalServer([
      {
        epoch: 'e',
        head: 7,
        entries: [
          { seq: 6, path: 'assets/a.png', sha256: 'a'.repeat(64), size: 1, class: 'inert-media' },
          {
            seq: 7,
            path: 'system/ds/brand.css',
            sha256: 'b'.repeat(64),
            size: 2,
            class: 'companion-text',
          },
        ],
      },
    ]);
    const healer = createCtlHealer({
      ...base,
      emit: (r) => emitted.push(r),
      fetchImpl,
      log: silent,
      debounceMs: 0,
    });
    healer.onPoke(5);
    healer.onPoke(7);
    await healer.drain();

    expect(emitted).toEqual(['assets/a.png', 'system/ds/brand.css']);
    expect(asked[0]).toContain('since=5');
    expect(healer.healed()).toBe(2);

    // And the NEXT read carries the epoch it learned, so a rotation fails
    // closed hub-side instead of silently handing back a foreign log.
    healer.onPoke(8);
    await healer.drain();
    expect(asked[1]).toContain('epoch=e');
  });

  test('a poke AT the cursor is counted and ignored', async () => {
    const { fetchImpl, asked } = journalServer([{ epoch: 'e', head: 5, entries: [] }]);
    const healer = createCtlHealer({ ...base, emit: () => {}, fetchImpl, log: silent });
    healer.onPoke(5);
    healer.onPoke(5);
    await healer.drain();
    expect(healer.ignored()).toBe(1);
    expect(asked).toEqual([]);
  });

  // A BACKWARD head is the one thing "at or below" must not swallow: an epoch
  // rotation, a compaction and a restore-from-backup all move the head down, and
  // they are exactly what `reanchor` was written to recover from — so the old
  // rule made that recovery unreachable from the states it existed for, and a
  // cursor parked above the log left the healer deaf for good. The cursor is not
  // moved on the poke's word (a coalesced frame can carry a stale head); the
  // journal is asked, and its own `since > head` rule answers.
  test('a poke BELOW the cursor asks the journal instead of being ignored', async () => {
    const { fetchImpl, asked } = journalServer([
      { epoch: 'e2', head: 2, reanchor: true, reason: 'cursor not in this log' },
      { epoch: 'e2', head: 3, entries: [{ seq: 3, path: 'assets/a.png', class: 'inert-media' }] },
    ]);
    const healer = createCtlHealer({
      ...base,
      emit: () => {},
      fetchImpl,
      log: silent,
      debounceMs: 0,
    });
    healer.onPoke(5);
    healer.onPoke(3);
    await healer.drain();
    expect(asked.length).toBe(1);
    expect(asked[0]).toContain('since=5');
  });

  test('a TOMBSTONE is not a heal — deletion is Increment 6', async () => {
    const emitted: string[] = [];
    const { fetchImpl } = journalServer([
      {
        epoch: 'e',
        head: 9,
        entries: [
          { seq: 8, path: 'assets/gone.png', sha256: null, deleted: true, class: 'inert-media' },
          { seq: 9, path: 'assets/here.png', sha256: 'c'.repeat(64), class: 'inert-media' },
        ],
      },
    ]);
    const healer = createCtlHealer({
      ...base,
      emit: (r) => emitted.push(r),
      fetchImpl,
      log: silent,
      debounceMs: 0,
    });
    healer.onPoke(7);
    healer.onPoke(9);
    await healer.drain();
    expect(emitted).toEqual(['assets/here.png']);
  });

  test('a malformed row is dropped, the rest of the page still lands', async () => {
    const emitted: string[] = [];
    const { fetchImpl } = journalServer([
      {
        epoch: 'e',
        head: 4,
        entries: [
          { seq: 3, path: '../../etc/passwd', class: 'inert-media' },
          { seq: 0, path: 'assets/zero.png' },
          { path: 'assets/no-seq.png' },
          { seq: 4, path: 'assets/ok.png', class: 'inert-media' },
        ],
      },
    ]);
    const healer = createCtlHealer({
      ...base,
      emit: (r) => emitted.push(r),
      fetchImpl,
      log: silent,
      debounceMs: 0,
    });
    healer.onPoke(2);
    healer.onPoke(4);
    await healer.drain();
    expect(emitted).toEqual(['assets/ok.png']);
  });

  test('a reanchor is HONOURED — never read as "nothing changed"', async () => {
    const warns: string[] = [];
    const emitted: string[] = [];
    const { fetchImpl } = journalServer([
      { epoch: 'e2', head: 40, reanchor: true, reason: 'epoch changed' },
    ]);
    const healer = createCtlHealer({
      ...base,
      emit: (r) => emitted.push(r),
      fetchImpl,
      log: { log() {}, warn: (m: string) => warns.push(m) },
      debounceMs: 0,
    });
    healer.onPoke(1);
    healer.onPoke(2);
    await healer.drain();
    expect(emitted).toEqual([]);
    expect(warns.join(' ')).toContain('re-anchor');
  });

  test('an unreadable page never advances the cursor', async () => {
    const emitted: string[] = [];
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call === 1) return new Response('nope', { status: 500 });
      return new Response(
        JSON.stringify({
          epoch: 'e',
          head: 3,
          entries: [{ seq: 3, path: 'assets/late.png', class: 'inert-media' }],
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const healer = createCtlHealer({
      ...base,
      emit: (r) => emitted.push(r),
      fetchImpl,
      log: silent,
      debounceMs: 0,
    });
    healer.onPoke(2);
    healer.onPoke(3);
    await healer.drain();
    expect(emitted).toEqual([]);
    // The cursor stayed at 2, so the retry asks for the SAME range and the
    // file that was missed the first time still arrives.
    await healer.drain();
    expect(emitted).toEqual(['assets/late.png']);
  });
});

test('document invalidation uses the metadata handler, never the heavy file pass', async () => {
  const f = fakeProvider();
  let docs = 0;
  let files = 0;
  const ctl = createCtlProvider({
    url: 'http://127.0.0.1:1',
    token: 't',
    connect: () => f.provider,
    onDocuments: () => {
      docs++;
    },
    onPoke: () => {
      files++;
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  f.emit('stateless', { payload: JSON.stringify({ t: 'files', head: 0, documents: true }) });
  expect(docs).toBe(1);
  expect(files).toBe(0);
  f.emit('stateless', { payload: JSON.stringify({ t: 'files', head: 4 }) });
  expect(docs).toBe(1);
  expect(files).toBe(1);
  ctl.stop();
});

test('control reconnect checks membership even when an empty project has no canvas providers', async () => {
  const f = fakeProvider();
  let reads = 0;
  const ctl = createCtlProvider({
    url: 'http://127.0.0.1:1',
    token: 't',
    connect: () => f.provider,
    onDocuments: () => {
      reads++;
    },
    onPoke: () => {
      throw new Error('must not walk files');
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  f.emit('status', { status: 'connected' });
  f.emit('status', { status: 'connected' });
  expect(reads).toBe(1);
  f.emit('status', { status: 'disconnected' });
  f.emit('status', { status: 'connected' });
  expect(reads).toBe(2);
  ctl.stop();
  f.emit('stateless', { payload: JSON.stringify({ t: 'files', head: 0, documents: true }) });
  expect(reads).toBe(2);
});
