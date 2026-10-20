// S8.19b — the shell → canvas half of "Waiting for Jonas's Mac" vs Missing: the shell lane asks the
// studio per open canvas and posts dgn `asset-state`; the dgn row refuses e-mails and big lists; the
// canvas's placeholder frame says a name only, and anything uncertain is "Not here yet".

import { describe, expect, test } from 'bun:test';

import { frameWords, RELINK_LIVE, relOfSrc } from '../asset-placeholder.tsx';
import { ASSET_STATE_MAX, acceptFromShell } from '../bridge/dgn-protocol.ts';
import {
  ASSET_STATE_POLL_MS,
  assetStateTriggers,
  clearAssetAnswers,
  createAssetStateLane,
} from '../client/v2/assets/asset-state-lane.js';

const ORIGIN = 'http://127.0.0.1:5555';
const JONAS = { name: 'jonas', kind: null, self: false };

function harness(answers: Array<{ status: number; items?: unknown[] }>) {
  const posts: Array<{ msg: Record<string, unknown>; origin: string }> = [];
  const canvasWin = {
    postMessage: (msg: Record<string, unknown>, origin: string) => posts.push({ msg, origin }),
  };
  const frame = { contentWindow: canvasWin, getAttribute: () => 'ui/Post.tsx' };
  const listeners: Array<(e: unknown) => void> = [];
  const win = {
    addEventListener: (_t: string, fn: (e: unknown) => void) => listeners.push(fn),
    removeEventListener: () => {},
  };
  const asked: string[] = [];
  const timers: Array<() => void> = [];
  const relinks: Array<[string, string]> = [];
  const lane = createAssetStateLane({
    win: win as unknown as Window,
    frames: () => [frame as unknown as Element],
    activeWindow: () => canvasWin as unknown as Window,
    canvasOrigin: () => ORIGIN,
    onRelink: (rel: string, canvas: string) => relinks.push([rel, canvas]),
    setTimer: (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimer: () => {},
    fetchImpl: (async (url: string) => {
      asked.push(url);
      const a = answers.shift() ?? { status: 200, items: [] };
      return new Response(JSON.stringify({ items: a.items ?? [] }), { status: a.status });
    }) as unknown as typeof fetch,
  });
  const send = (data: unknown, source: unknown = canvasWin, origin = ORIGIN) => {
    for (const fn of listeners) fn({ data, source, origin });
  };
  const settle = () => new Promise((r) => setTimeout(r, 5));
  return { lane, posts, asked, timers, relinks, send, settle, canvasWin };
}

describe('the shell lane', () => {
  test('canvas open → asset-state; polls every 60 s while waiting; waiting → here without a reload', async () => {
    const h = harness([
      { status: 200, items: [{ rel: 'assets/acko-hero2.png', state: 'waiting', who: JONAS }] },
      { status: 200, items: [{ rel: 'assets/acko-hero2.png', state: 'here' }] },
    ]);
    h.send({ dgn: 'canvas-rendered', file: 'ui/Post.tsx' });
    await h.settle();
    expect(h.asked).toEqual(['/_api/asset-state?canvas=ui%2FPost.tsx']);
    expect(h.posts).toEqual([
      {
        msg: {
          dgn: 'asset-state',
          items: [{ rel: 'assets/acko-hero2.png', state: 'waiting', who: JONAS }],
        },
        origin: ORIGIN,
      },
    ]);
    expect(h.lane.polling()).toBe(true);
    expect(ASSET_STATE_POLL_MS).toBe(60_000);
    h.timers.shift()?.();
    await h.settle();
    expect(h.posts.at(-1)?.msg).toEqual({
      dgn: 'asset-state',
      items: [{ rel: 'assets/acko-hero2.png', state: 'here' }],
    });
    // Nothing waits any more: no further poll is armed.
    expect(h.timers.length).toBe(0);
    h.lane.stop();
  });

  test('a refusal (a cell’s 503) is quiet: nothing to a new frame, "none" to one that had news — never Missing', async () => {
    const h = harness([
      { status: 503 },
      { status: 200, items: [{ rel: 'assets/a.png', state: 'waiting' }] },
      { status: 503 },
    ]);
    h.send({ dgn: 'loaded' });
    await h.settle();
    expect(h.posts).toEqual([]);
    await h.lane.refresh();
    await h.lane.refresh();
    expect(h.posts.map((p) => p.msg.items)).toEqual([
      [{ rel: 'assets/a.png', state: 'waiting' }],
      [],
    ]);
    expect(JSON.stringify(h.posts)).not.toContain('missing');
    h.lane.stop();
  });

  test('Relink… from the active canvas opens the sheet — only for a rel the studio called missing', async () => {
    clearAssetAnswers();
    const h = harness([
      {
        status: 200,
        items: [
          { rel: 'assets/partneri-2025.png', state: 'missing' },
          { rel: 'assets/acko-hero2.png', state: 'waiting', who: JONAS },
          { rel: 'assets/here0001.png', state: 'here' },
        ],
      },
    ]);
    // before the studio has answered nothing is known, so nothing opens
    h.send({ dgn: 'asset-relink-request', rel: 'assets/partneri-2025.png' });
    expect(h.relinks).toEqual([]);
    h.send({ dgn: 'canvas-rendered', file: 'ui/Post.tsx' });
    await h.settle();
    h.send({ dgn: 'asset-relink-request', rel: 'assets/partneri-2025.png' });
    h.send({ dgn: 'asset-relink-request', rel: 'assets/x.png' }, h.canvasWin, 'https://evil.test');
    h.send({ dgn: 'asset-relink-request', rel: 'assets/y.png' }, {});
    expect(h.relinks).toEqual([['assets/partneri-2025.png', 'ui/Post.tsx']]);
    h.lane.stop();
  });

  test('a canvas-forged rel never opens a relink: not in the answer, not missing, not a project path', async () => {
    clearAssetAnswers();
    const h = harness([
      {
        status: 200,
        items: [
          { rel: 'assets/acko-hero2.png', state: 'waiting', who: JONAS },
          { rel: 'assets/here0001.png', state: 'here' },
          { rel: 'assets/gone0001.png', state: 'missing' },
        ],
      },
    ]);
    h.send({ dgn: 'canvas-rendered', file: 'ui/Post.tsx' });
    await h.settle();
    for (const rel of [
      '../../etc/passwd',
      '/etc/passwd',
      'assets/never-mentioned.png',
      'assets/here0001.png',
      'assets/acko-hero2.png',
      './assets/gone0001.png',
      'assets/gone0001.png?x',
      '__proto__',
      'constructor',
    ])
      h.send({ dgn: 'asset-relink-request', rel });
    expect(h.relinks).toEqual([]);
    h.send({ dgn: 'asset-relink-request', rel: 'assets/gone0001.png' });
    expect(h.relinks).toEqual([['assets/gone0001.png', 'ui/Post.tsx']]);
    h.lane.stop();
  });

  test('reconnect and a finished sweep re-ask, once per edge', () => {
    expect(assetStateTriggers(null, { wsConnected: true })).toBe(false);
    expect(assetStateTriggers({ wsConnected: false }, { wsConnected: true })).toBe(true);
    expect(
      assetStateTriggers(
        { wsConnected: true, syncStatus: { state: 'offline' } },
        { wsConnected: true, syncStatus: { state: 'online' } }
      )
    ).toBe(true);
    const running = { state: 'online', assets: { finished: false } };
    const done = { state: 'online', assets: { finished: true } };
    expect(
      assetStateTriggers(
        { wsConnected: true, syncStatus: running },
        { wsConnected: true, syncStatus: done }
      )
    ).toBe(true);
    expect(
      assetStateTriggers(
        { wsConnected: true, syncStatus: done },
        { wsConnected: true, syncStatus: done }
      )
    ).toBe(false);
  });
});

describe('dgn asset-state (shell → canvas)', () => {
  const win = { parent: {} } as unknown as Window;
  const accept = (data: unknown) =>
    acceptFromShell({ data, source: win.parent } as unknown as MessageEvent, win);
  test('a valid list passes; only the parent may say it', () => {
    const items = [{ rel: 'assets/a.png', state: 'waiting', who: JONAS }];
    expect(accept({ dgn: 'asset-state', items })).toEqual({ dgn: 'asset-state', items });
    expect(
      acceptFromShell(
        { data: { dgn: 'asset-state', items }, source: {} } as unknown as MessageEvent,
        win
      )
    ).toBeNull();
  });
  test('S8.14: upload progress passes only as a finite 0..1', () => {
    const ok = [{ rel: 'assets/a.png', state: 'uploading', progress: 0.4 }];
    expect(accept({ dgn: 'asset-state', items: ok })).toEqual({ dgn: 'asset-state', items: ok });
    for (const progress of [1.5, -0.1, Number.NaN, '0.4']) {
      expect(
        accept({ dgn: 'asset-state', items: [{ rel: 'a/b.png', state: 'uploading', progress }] })
      ).toBeNull();
    }
  });
  test('the canvas never receives an e-mail, an unknown state or an oversized list', () => {
    const mail = { name: 'jonas@studyfi.com', kind: 'mac', self: false };
    expect(
      accept({ dgn: 'asset-state', items: [{ rel: 'a/b.png', state: 'waiting', who: mail }] })
    ).toBeNull();
    expect(accept({ dgn: 'asset-state', items: [{ rel: 'a/b.png', state: 'gone' }] })).toBeNull();
    const many = Array.from({ length: ASSET_STATE_MAX + 1 }, (_, i) => ({
      rel: `a/${i}.png`,
      state: 'here',
    }));
    expect(accept({ dgn: 'asset-state', items: many })).toBeNull();
    const extra = accept({
      dgn: 'asset-state',
      items: [
        { rel: 'a/b.png', state: 'waiting', who: { ...JONAS, email: 'j@x.cz' }, deviceId: 'd1' },
      ],
    });
    expect(JSON.stringify(extra)).not.toContain('@');
    expect(JSON.stringify(extra)).not.toContain('d1');
  });
});

describe('the placeholder frame’s words', () => {
  test('a name only; "Jonas\'s device" when the kind is unknown; uncertain is "Not here yet"', () => {
    expect(frameWords({ rel: 'a/b.png', state: 'waiting', who: JONAS as never })?.line).toBe(
      "Waiting for Jonas's device"
    );
    expect(
      frameWords({
        rel: 'a/b.png',
        state: 'waiting',
        who: { name: 'jonas', kind: 'mac', self: false },
      })?.line
    ).toBe("Waiting for Jonas's Mac");
    expect(
      frameWords({ rel: 'a/b.png', state: 'waiting', who: { name: null, kind: 'mac', self: true } })
        ?.line
    ).toBe('Waiting for your other Mac');
    expect(frameWords({ rel: 'a/b.png', state: 'waiting' })).toEqual({
      state: 'waiting',
      line: 'Not here yet',
      relink: false,
    });
    expect(frameWords({ rel: 'a/b.png', state: 'waiting', syncing: true })?.line).toBe('Syncing…');
    expect(frameWords({ rel: 'a/b.png', state: 'missing' })).toEqual({
      state: 'missing',
      line: 'Missing — no device has it',
      relink: RELINK_LIVE,
    });
    expect(frameWords({ rel: 'a/b.png', state: 'here' })).toBeNull();
    expect(frameWords({ rel: 'a/b.png', state: 'uploading' })).toBeNull();
    expect(frameWords(undefined)).toBeNull();
  });
  test('an element’s src maps to the rel the shell named', () => {
    const known = new Set(['assets/acko-hero2.png']);
    expect(relOfSrc('/assets/acko-hero2.png', 'http://c/assets/acko-hero2.png', known)).toBe(
      'assets/acko-hero2.png'
    );
    expect(relOfSrc('./assets/acko-hero2.png?v=3', '', known)).toBe('assets/acko-hero2.png');
    expect(relOfSrc(null, 'http://c/.design/assets/acko-hero2.png?v=1', known)).toBe(
      'assets/acko-hero2.png'
    );
    expect(relOfSrc('assets/other.png', 'http://c/assets/other.png', known)).toBeNull();
  });
});
