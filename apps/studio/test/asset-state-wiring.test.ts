// S8.19b — the asset-state wiring: the route reads a canvas's own media refs (`?canvas=`), the
// service is built over the live runtime (presence asker + the plane's pending pushes), a cell
// refuses, and anything uncertain reads as the quiet "Not here yet" — never Missing.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assetStateDepsFor, createAssetStateRoutes } from '../routes/asset-state.ts';
import {
  assetRefsInSource,
  type HubPresenceItem,
  normaliseAssetRef,
  uploadingFromRows,
} from '../sync/asset-state.ts';

const JONAS = { name: 'jonas', kind: null, self: false } as const;

function project() {
  const d = mkdtempSync(join(tmpdir(), 'asset-wiring-'));
  mkdirSync(join(d, 'assets'), { recursive: true });
  mkdirSync(join(d, 'ui'), { recursive: true });
  writeFileSync(join(d, 'assets/here.png'), 'x');
  writeFileSync(
    join(d, 'ui/Post.tsx'),
    [
      'export default () => (<div>',
      '  <img src="/assets/here.png" />',
      "  <img src='./assets/acko-hero2.png' />",
      '  <img src={`assets/partneri-2025.png`} />',
      '  <img src="https://example.com/x.png" />',
      '  <img src="data:image/png;base64,AAAA" />',
      '  <video src="assets/clip.mp4?v=2" />',
      '  <p>{"assets/notes.txt"}</p>',
      '</div>);',
    ].join('\n')
  );
  return d;
}

const get = (spec: ReturnType<typeof createAssetStateRoutes>[number], q: string) =>
  spec.handle(new Request(`http://127.0.0.1/_api/asset-state?${q}`), {});

describe('a canvas names its own media', () => {
  test('refs are normalised to designRoot-relative rels; URLs, data and non-media are skipped', () => {
    expect(normaliseAssetRef('/assets/a.png')).toBe('assets/a.png');
    expect(normaliseAssetRef('./assets/a.png#x')).toBe('assets/a.png');
    expect(normaliseAssetRef('https://x.test/assets/a.png')).toBeNull();
    expect(normaliseAssetRef('//cdn/assets/a.png')).toBeNull();
    expect(normaliseAssetRef('../assets/a.png')).toBeNull();
    expect(normaliseAssetRef('_state/a.png')).toBeNull();
    const d = project();
    const src = readFileSync(join(d, 'ui/Post.tsx'), 'utf8');
    expect(assetRefsInSource(src)).toEqual([
      'assets/here.png',
      'assets/acko-hero2.png',
      'assets/partneri-2025.png',
      'assets/clip.mp4',
    ]);
  });
});

describe('GET /_api/asset-state?canvas=', () => {
  test('answers every media ref of that canvas; local file wins over the hub', async () => {
    const d = project();
    const hub = new Map<string, HubPresenceItem>([
      ['assets/here.png', { rel: 'assets/here.png', state: 'missing' }],
      ['assets/acko-hero2.png', { rel: 'assets/acko-hero2.png', state: 'waiting', who: JONAS }],
      ['assets/partneri-2025.png', { rel: 'assets/partneri-2025.png', state: 'missing' }],
    ]);
    const [spec] = createAssetStateRoutes(
      assetStateDepsFor({
        designRoot: d,
        designRel: '.design',
        env: {},
        runtime: () => ({
          assetPresenceAsker: () => ({
            ask: async (rels) =>
              new Map(rels.map((r) => [r, hub.get(r) ?? { rel: r, state: 'unknown' }])),
          }),
          assetUploading: () => new Map(),
        }),
      })
    );
    const res = await get(spec!, 'canvas=.design/ui/Post.tsx');
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([
      { rel: 'assets/here.png', state: 'here' },
      { rel: 'assets/acko-hero2.png', state: 'waiting', who: JONAS },
      { rel: 'assets/partneri-2025.png', state: 'missing' },
      { rel: 'assets/clip.mp4', state: 'waiting' },
    ]);
    expect((await get(spec!, 'canvas=ui/Nope.tsx')).status).toBe(404);
    expect((await get(spec!, 'canvas=../etc/passwd')).status).toBe(404);
    expect((await get(spec!, 'canvas=ui/Post.tsx&rel=assets/x.png')).status).toBe(400);
  });

  test('a hub that cannot answer is "Not here yet", never Missing', async () => {
    const d = project();
    const answer: Map<string, HubPresenceItem> | null = null;
    const [spec] = createAssetStateRoutes(
      assetStateDepsFor({
        designRoot: d,
        designRel: '.design',
        env: {},
        runtime: () => ({ assetPresenceAsker: () => ({ ask: async () => answer }) }),
      })
    );
    const res = await get(spec!, 'rel=assets/acko-hero2.png');
    expect((await res.json()).items).toEqual([{ rel: 'assets/acko-hero2.png', state: 'waiting' }]);
  });

  test('the plane’s pending pushes read as uploading', async () => {
    expect(
      [
        ...uploadingFromRows({
          'assets/a.png': { state: 'pushing' },
          'assets/b.png': { state: 'local-only' },
          'assets/c.png': { state: 'on-hub' },
          'assets/d.png': { state: 'stuck' },
        }).keys(),
      ].sort()
    ).toEqual(['assets/a.png', 'assets/b.png']);
    const d = project();
    const [spec] = createAssetStateRoutes(
      assetStateDepsFor({
        designRoot: d,
        designRel: '.design',
        env: {},
        runtime: () => ({
          assetPresenceAsker: () => ({ ask: async () => new Map() }),
          assetUploading: () => uploadingFromRows({ 'assets/here.png': { state: 'pushing' } }),
        }),
      })
    );
    expect((await (await get(spec!, 'rel=assets/here.png')).json()).items).toEqual([
      { rel: 'assets/here.png', state: 'uploading' },
    ]);
  });

  test('a cell refuses (503) — the client reads it as the quiet "Not here yet"', async () => {
    const [spec] = createAssetStateRoutes(
      assetStateDepsFor({
        designRoot: project(),
        designRel: '.design',
        env: { MAUDE_WORKSPACE_MODE: '1' },
        runtime: () => null,
      })
    );
    const res = await get(spec!, 'rel=assets/here.png');
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain('missing');
  });
});
