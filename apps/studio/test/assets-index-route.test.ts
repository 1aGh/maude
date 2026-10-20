// S8.12 — `GET /_api/index?part=assets`: the Assets tab's one read (contract S8-slices.md § S8.12; S8.11 left the
// route's body unwired). The response is built by `assetsResponse` so the rule that matters — a canvas-only session
// sees the assets its granted canvases name and nothing else (V2-1.16 L9) — is testable without a studio.
import { describe, expect, test } from 'bun:test';

import { assetsResponse } from '../index/assets-response.ts';
import type { AssetRow, AssetsAnswer, AssetView } from '../index/types.ts';

const row = (rel: string, usedIn: string[]): AssetRow => ({
  rel,
  kind: 'image',
  size: 10,
  mtimeMs: 1,
  usedIn,
  usedBy: usedIn.length,
  usedElsewhere: false,
  olderVersions: false,
  recentTake: false,
  notUsed: usedIn.length === 0,
});
const ROWS = [row('assets/aaaaaaaa.png', ['ui/a.tsx']), row('assets/bbbbbbbb.png', ['ui/b.tsx'])];

/** An index whose assetsAnswer() honours the view the way the real one does. */
function fakeIndex() {
  const seen: Array<AssetView | undefined> = [];
  return {
    seen,
    index: {
      snapshot: () => ({ canvases: [{ rel: 'ui/a.tsx' }, { rel: 'ui/b.tsx' }] }),
      assetsAnswer: (view?: AssetView): AssetsAnswer => {
        seen.push(view);
        const assets = view ? ROWS.filter((r) => r.usedIn.some((c) => view.canvases.has(c))) : ROWS;
        return { seq: 7, history: 'ready', assets };
      },
    },
  };
}

describe('assetsResponse', () => {
  test('a project role gets every row, with no view', async () => {
    const f = fakeIndex();
    const res = assetsResponse(f.index, { full: true, seesCanvas: () => true });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as AssetsAnswer;
    expect(body.assets.map((r) => r.rel)).toEqual(['assets/aaaaaaaa.png', 'assets/bbbbbbbb.png']);
    expect(f.seen).toEqual([undefined]);
  });

  test('a canvas-only session is handed only its granted canvases as the view (L9)', async () => {
    const f = fakeIndex();
    const res = assetsResponse(f.index, { full: false, seesCanvas: (c) => c === 'ui/a.tsx' });
    const body = (await res.json()) as AssetsAnswer;
    expect(body.assets.map((r) => r.rel)).toEqual(['assets/aaaaaaaa.png']);
    expect([...(f.seen[0]?.canvases ?? [])]).toEqual(['ui/a.tsx']);
    expect(JSON.stringify(body)).not.toContain('bbbbbbbb');
  });

  test('a session that sees no canvas sees no asset', async () => {
    const f = fakeIndex();
    const res = assetsResponse(f.index, { full: false, seesCanvas: () => false });
    expect(((await res.json()) as AssetsAnswer).assets).toEqual([]);
  });
});
