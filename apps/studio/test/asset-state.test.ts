// S8.19 — the studio half of "Waiting for Jonas's Mac" vs Missing (contract
// S8-S9-asset-presence §5.5): the state table, the hub asker's DDR-054
// filtering, the 60 s cache, the shell route's shape, and the feed (the sweep's
// probe carries `held` + `sweep.final`; the plane's reporter sends the same).

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAssetStateRoutes } from '../routes/asset-state.ts';
import { pushAssets } from '../sync/asset-push.ts';
import {
  askHubPresence,
  combineAssetState,
  createAssetStateService,
  createHeldReporter,
  type HubPresenceItem,
  heldMediaRels,
  reportHeld,
} from '../sync/asset-state.ts';

const JONAS = { name: 'jonas', kind: null, self: false } as const;
const item = (rel: string, state: HubPresenceItem['state'], who?: HubPresenceItem['who']) =>
  ({ rel, state, ...(who ? { who } : {}) }) as HubPresenceItem;

describe('§5.5 table', () => {
  test('file on disk → here; in the upload queue → uploading', () => {
    expect(combineAssetState({ onDisk: true, linked: true, hub: null })).toEqual({ state: 'here' });
    expect(
      combineAssetState({ onDisk: true, uploading: { progress: 0.5 }, linked: true, hub: null })
    ).toEqual({ state: 'uploading', progress: 0.5 });
  });
  test('linked: hub here / waiting / unknown → waiting (who when given)', () => {
    const r = (h: HubPresenceItem | null) =>
      combineAssetState({ onDisk: false, linked: true, hub: h });
    expect(r(item('a/x.png', 'here'))).toEqual({ state: 'waiting', syncing: true });
    expect(r(item('a/x.png', 'waiting', JONAS))).toEqual({ state: 'waiting', who: JONAS });
    expect(r(item('a/x.png', 'unknown'))).toEqual({ state: 'waiting' });
  });
  test('linked: hub missing → missing', () => {
    expect(
      combineAssetState({ onDisk: false, linked: true, hub: item('a/x.png', 'missing') })
    ).toEqual({
      state: 'missing',
    });
  });
  test('linked, hub offline or route 404 → waiting without who', () => {
    expect(combineAssetState({ onDisk: false, linked: true, hub: null })).toEqual({
      state: 'waiting',
    });
  });
  test('local project (no hub), file absent → missing', () => {
    expect(combineAssetState({ onDisk: false, linked: false, hub: null })).toEqual({
      state: 'missing',
    });
  });
});

describe('askHubPresence (hub answers are untrusted)', () => {
  const answering = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  test('keeps only asked rels and known states; a name with an @ is dropped', async () => {
    const m = await askHubPresence({
      fetchImpl: answering({
        items: [
          {
            rel: 'assets/a.png',
            state: 'waiting',
            who: { name: 'j@x.test', kind: 'mac', self: 1 },
          },
          { rel: 'assets/b.png', state: 'gone' },
          { rel: 'assets/never-asked.png', state: 'missing' },
        ],
      }),
      base: 'https://hub.example/',
      token: 't',
      rels: ['assets/a.png', 'assets/b.png'],
    });
    expect(m?.get('assets/a.png')).toEqual({
      rel: 'assets/a.png',
      state: 'waiting',
      who: { name: null, kind: 'mac', self: false },
    });
    expect(m?.has('assets/b.png')).toBe(false);
    expect(m?.has('assets/never-asked.png')).toBe(false);
  });
  test('404 (an older hub) and a network error are null — "Not here yet"', async () => {
    expect(
      await askHubPresence({
        fetchImpl: answering({}, 404),
        base: 'h',
        token: 't',
        rels: ['a/b.png'],
      })
    ).toBe(null);
    const thrower = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(
      await askHubPresence({ fetchImpl: thrower, base: 'h', token: 't', rels: ['a/b.png'] })
    ).toBe(null);
  });
});

describe('the service', () => {
  const root = () => {
    const d = mkdtempSync(join(tmpdir(), 'asset-state-'));
    mkdirSync(join(d, 'assets'), { recursive: true });
    writeFileSync(join(d, 'assets/here.png'), 'x');
    return d;
  };
  test('local project: on disk → here, absent → missing; bad rels are left out', async () => {
    const s = createAssetStateService({ designRoot: root(), hub: () => null });
    expect(
      await s.states(['assets/here.png', 'assets/gone.png', '../etc/passwd', '_state/x.json'])
    ).toEqual({
      'assets/here.png': { state: 'here' },
      'assets/gone.png': { state: 'missing' },
    });
  });
  test('linked: asks the hub once per rel per 60 s; an offline answer is not kept', async () => {
    let t = 0;
    let asks = 0;
    let offline = true;
    const s = createAssetStateService({
      designRoot: root(),
      now: () => t,
      hub: () => ({
        ask: async (rels) => {
          asks += 1;
          if (offline) return null;
          return new Map(
            rels.map((r) => [r, item(r, r.includes('gone') ? 'missing' : 'waiting', JONAS)])
          );
        },
      }),
    });
    expect((await s.states(['assets/gone.png']))['assets/gone.png']).toEqual({ state: 'waiting' });
    offline = false;
    t += 1;
    expect((await s.states(['assets/gone.png']))['assets/gone.png']).toEqual({ state: 'missing' });
    expect(asks).toBe(2);
    t += 30_000;
    await s.states(['assets/gone.png', 'assets/here.png']); // cached; the disk file never asks
    expect(asks).toBe(2);
    t += 31_000;
    expect((await s.states(['assets/w.png']))['assets/w.png']).toEqual({
      state: 'waiting',
      who: JONAS,
    });
    expect(asks).toBe(3);
  });
  test('this Mac’s upload queue wins over the hub', async () => {
    const s = createAssetStateService({
      designRoot: root(),
      hub: () => ({ ask: async () => new Map() }),
      uploading: () => new Map([['assets/here.png', { progress: 0.25 }]]),
    });
    expect((await s.states(['assets/here.png']))['assets/here.png']).toEqual({
      state: 'uploading',
      progress: 0.25,
    });
  });
});

describe('GET /_api/asset-state', () => {
  const [spec] = createAssetStateRoutes({
    service: () => createAssetStateService({ designRoot: tmpdir(), hub: () => null }),
  });
  test('is main-origin only — never in a canvas allowlist', () => {
    expect(spec?.origin).toBe('main');
    expect(spec?.method).toBe('GET');
  });
  test('400 on a bad rel, 413 past 256, 200 with one item per rel', async () => {
    const get = (q: string) =>
      spec!.handle(new Request(`http://127.0.0.1/_api/asset-state?${q}`), {});
    expect((await get('rel=../x.png')).status).toBe(400);
    expect((await get('')).status).toBe(400);
    const many = Array.from({ length: 257 }, (_, i) => `rel=assets/x${i}.png`).join('&');
    expect((await get(many)).status).toBe(413);
    const ok = await get('rel=assets/zz-none.png');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ items: [{ rel: 'assets/zz-none.png', state: 'missing' }] });
  });
});

describe('the feed', () => {
  test('the sweep’s probe says held + a finished sweep; the answer is read as before', async () => {
    const d = mkdtempSync(join(tmpdir(), 'asset-state-push-'));
    mkdirSync(join(d, 'assets'), { recursive: true });
    writeFileSync(join(d, 'assets/there.png'), 'x');
    let body: { paths?: string[]; held?: unknown; sweep?: { id?: string; final?: unknown } } = {};
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/_asset-probe')) {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ present: ['assets/there.png'] }), { status: 200 });
      }
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const r = await pushAssets({
      designRoot: d,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      syncFiles: false,
      log: { log: () => {}, warn: () => {} },
      sleep: async () => {},
    });
    expect(r.skipped).toBe(1);
    expect(body.paths).toEqual(['assets/there.png']);
    expect(body.held).toBe(true);
    expect(body.sweep?.final).toBe(true);
    expect(body.sweep?.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  test('reportHeld chunks to 1000 with `final` only on the last batch; an empty Mac still finishes', async () => {
    const bodies: { paths: string[]; sweep: { id: string; final?: boolean } }[] = [];
    const fetchImpl = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response('{"present":[]}', { status: 200 });
    }) as typeof fetch;
    const rels = Array.from({ length: 1500 }, (_, i) => `assets/f${i}.png`);
    expect(await reportHeld({ fetchImpl, base: 'h', token: 't', rels, sweepId: 'abc' })).toBe(true);
    expect(bodies.map((b) => [b.paths.length, b.sweep.final === true, b.sweep.id])).toEqual([
      [1000, false, 'abc'],
      [500, true, 'abc'],
    ]);
    bodies.length = 0;
    expect(await reportHeld({ fetchImpl, base: 'h', token: 't', rels: [] })).toBe(true);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.sweep.final).toBe(true);
    const refusing = (async () => new Response(null, { status: 403 })) as unknown as typeof fetch;
    expect(await reportHeld({ fetchImpl: refusing, base: 'h', token: 't', rels })).toBe(false);
  });

  test('the plane reporter: once, again on a change, never inside the floor', async () => {
    let t = 0;
    let set = ['assets/a.png'];
    const sent: string[][] = [];
    const rep = createHeldReporter({
      designRoot: tmpdir(),
      now: () => t,
      list: () => set,
      send: async (rels) => {
        sent.push(rels);
        return true;
      },
    });
    expect(await rep.afterPass()).toBe(true);
    t += 20_000;
    expect(await rep.afterPass()).toBe(false); // unchanged, inside the refresh window
    set = ['assets/a.png', 'assets/b.png'];
    t += 1_000;
    expect(await rep.afterPass()).toBe(true);
    set = ['assets/c.png'];
    t += 1_000;
    expect(await rep.afterPass()).toBe(false); // inside the 15 s floor
    expect(sent).toEqual([['assets/a.png'], ['assets/a.png', 'assets/b.png']]);
  });

  test('heldMediaRels reports media only', () => {
    const d = mkdtempSync(join(tmpdir(), 'asset-state-held-'));
    mkdirSync(join(d, 'assets'), { recursive: true });
    mkdirSync(join(d, 'ui'), { recursive: true });
    writeFileSync(join(d, 'assets/a.png'), 'x');
    writeFileSync(join(d, 'ui/c.tsx'), 'export default () => null;');
    expect(heldMediaRels(d)).toEqual(['assets/a.png']);
  });
});
