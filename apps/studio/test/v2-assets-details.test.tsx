// S8.21 — the Assets tab's details per kind (12 · ia-asset-details, ia-advanced) and its "Generated" group.
// The server half: asset-details.test.ts. The keys (⌘I) and the agent path: v2-assets-keys.test.ts.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { runAssetsAction } from '../client/v2/assets/assets-bus.js';
import {
  addedText,
  advancedHint,
  advancedRows,
  clock,
  detailsKind,
  editsLine,
  fallbackDetails,
  madeWith,
  momentText,
  placeText,
  sizeRow,
  titleOf,
  useRows,
} from '../client/v2/assets/details-model.js';
import { runMeta, runTitle, splitGenerated } from '../client/v2/assets/generated.js';
import { readAssetDetails } from '../client/v2/assets/use-asset-details.js';

const photo = (extra: Record<string, unknown> = {}) => ({
  rel: 'assets/d34bb59d.jpg',
  name: 'd34bb59d.jpg',
  kind: 'image',
  ext: 'jpg',
  size: 3_250_000,
  mtimeMs: Date.UTC(2026, 8, 27, 21, 40),
  madeByAi: null,
  footage: null,
  uses: [
    { canvas: 'ui/matchday.tsx', boards: [{ id: 'ab-post', label: 'Post 4:5 · Fotky ze zápasu' }] },
    { canvas: 'ui/club-web/website.tsx', boards: [] },
  ],
  advanced: {
    storedAs: 'assets/d34bb59d.jpg',
    edits: [],
    cutOuts: [],
    inCanvases: '<img src="assets/d34bb59d.jpg">',
  },
  ...extra,
});

describe('the words', () => {
  test('a photo says its size, a clip its length, a sound its length first', () => {
    expect(sizeRow(photo(), { width: 4032, height: 3024 })).toEqual({
      k: 'Size',
      v: '4032 × 3024 · 3.1 MB · JPG',
    });
    expect(sizeRow(photo(), {})).toEqual({ k: 'Size', v: '3.1 MB · JPG' });
    expect(
      sizeRow(photo({ kind: 'video', ext: 'mp4', size: 3_400_000 }), {
        width: 1280,
        height: 720,
        duration: 7,
      })
    ).toEqual({
      k: 'Size',
      v: '1280 × 720 · 0:07 · 3.2 MB',
    });
    expect(
      sizeRow(photo({ kind: 'audio', ext: 'mp3', size: 240 * 1024 }), { duration: 15 })
    ).toEqual({
      k: 'Length',
      v: '0:15 · 240 KB · MP3',
    });
    expect(clock(75)).toBe('1:15');
    expect(clock(3725)).toBe('1:02:05');
  });

  test('which sheet: Made by AI wins over the kind; a clip with no analysis is a plain clip', () => {
    const made = { prompt: 'x', provider: 'fal', model: 'm', at: '2026-10-05T10:00:00Z' };
    expect(detailsKind(photo())).toBe('photo');
    expect(detailsKind(photo({ madeByAi: made }))).toBe('made');
    expect(detailsKind(photo({ kind: 'audio' }))).toBe('sound');
    expect(detailsKind(photo({ kind: 'video' }))).toBe('clip');
    expect(
      detailsKind(photo({ kind: 'video', footage: { summary: 's', tags: [], moments: [] } }))
    ).toBe('footage');
  });

  test('made with: who, with what, and the day; a generated asset is titled by what was asked for', () => {
    const made = {
      prompt: 'Hráč slaví touchdown, noční stadion, mlha',
      provider: 'google',
      model: 'Nano Banana Pro',
      at: '2026-10-05T10:00:00Z',
    };
    expect(madeWith(made)).toBe('Google · Nano Banana Pro · 5 Oct');
    expect(titleOf(photo({ madeByAi: made }))).toBe('Hráč slaví touchdown');
    expect(titleOf(photo())).toBe('d34bb59d.jpg');
    expect(madeWith(null)).toBe('');
  });

  test('moments and added', () => {
    expect(momentText({ start: 1, end: 4, note: 'run' })).toBe('0:01–0:04 run');
    expect(momentText({ start: 5, end: 5.2, note: '' })).toBe('0:05');
    const t = Date.UTC(2026, 8, 27, 21, 40);
    expect(addedText(t, t + 120_000)).toBe('2 min ago');
    expect(addedText(0)).toBe('');
  });

  test('every use is a row; an artboard row opens the artboard, a canvas with none opens the canvas', () => {
    expect(useRows(photo()).map((r) => [r.name, r.board, r.boardId])).toEqual([
      ['matchday', 'Post 4:5 · Fotky ze zápasu', 'ab-post'],
      ['website', null, null],
    ]);
  });

  test('edits in words, and Advanced shows only the rows that have something to say', () => {
    const edited = photo({
      advanced: {
        storedAs: 'assets/d34bb59d.jpg',
        original: '~/Pictures/IMG.jpg',
        edits: ['assets/d34bb59d.photo.json', 'assets/d34bb59d.0a293589.photo.json'],
        cutOuts: ['assets/0a293589.png'],
        inCanvases: '<img src="assets/d34bb59d.jpg">',
        command: 'maude design import-asset ~/Pictures/IMG.jpg --kind raster',
      },
    });
    expect(editsLine(edited)).toBe('Changed on every use, and 1 use has its own look');
    expect(editsLine(photo())).toBe('');
    expect(advancedRows(edited).map((r) => r.k)).toEqual([
      'Stored as',
      'Original',
      'Edits',
      'Cut-out',
      'In canvases',
    ]);
    expect(advancedRows(photo()).map((r) => r.k)).toEqual(['Stored as', 'In canvases']);
    expect(advancedHint(edited)).toBe('file name · original path · edits');
    expect(placeText('MVP zápasu')).toBe('Place in MVP zápasu');
    expect(placeText(null)).toBe('Place');
  });

  test('the tab’s own row is enough for a quiet sheet', () => {
    const d = fallbackDetails({
      path: 'assets/aa11bb22.mp4',
      name: 'aa11bb22.mp4',
      kind: 'video',
      size: 5,
      usedIn: ['ui/a.tsx'],
    });
    expect(d.advanced.inCanvases).toBe('<video src="assets/aa11bb22.mp4">');
    expect(d.uses).toEqual([{ canvas: 'ui/a.tsx', boards: [] }]);
    expect(d.madeByAi).toBeNull();
  });

  test('the details read: a 404 is "gone", a refusal or a broken answer is an error, nothing throws', async () => {
    const answer = (status: number, body: unknown) => async () =>
      new Response(JSON.stringify(body), { status });
    expect(
      (await readAssetDetails('assets/x.jpg', answer(200, { ok: true, details: photo() }))).state
    ).toBe('ready');
    expect((await readAssetDetails('assets/x.jpg', answer(404, {}))).state).toBe('gone');
    expect((await readAssetDetails('assets/x.jpg', answer(500, {}))).state).toBe('error');
    expect((await readAssetDetails('assets/x.jpg', answer(200, { ok: false }))).state).toBe(
      'error'
    );
    expect(
      (
        await readAssetDetails('assets/x.jpg', async () => {
          throw new Error('offline');
        })
      ).state
    ).toBe('error');
  });
});

describe('Generated: the join', () => {
  const rows = ['a1b2c3d4', 'e5f60718', '9a0b1c2d', 'ffffffff'].map((s) => ({
    path: `assets/${s}.png`,
    name: `${s}.png`,
    kind: 'image',
    size: 1,
    mtimeMs: 1,
  }));
  const groups = [
    {
      group: 'g1',
      prompt: 'night touchdown',
      provider: 'fal',
      at: '2026-10-18T09:12:00Z',
      takes: ['assets/a1b2c3d4.png', 'assets/e5f60718.png', 'assets/gone0000.png'],
    },
    {
      group: 'g2',
      prompt: 'again',
      provider: 'fal',
      at: '2026-10-17T09:12:00Z',
      takes: ['assets/e5f60718.png', 'assets/9a0b1c2d.png'],
    },
  ];

  test('a run keeps its takes in order; a row belongs to the first run that lists it; a take the tab does not list is skipped', () => {
    const { runs, rest, claimed } = splitGenerated(rows, groups);
    expect(runs.map((r) => r.items.map((i: { name: string }) => i.name))).toEqual([
      ['a1b2c3d4.png', 'e5f60718.png'],
      ['9a0b1c2d.png'],
    ]);
    expect(rest.map((r) => r.name)).toEqual(['ffffffff.png']);
    expect(claimed.size).toBe(3);
  });

  test('a search that hides every take of a run hides the run; nothing generated, nothing claimed', () => {
    expect(splitGenerated([rows[3]], groups).runs).toEqual([]);
    expect(splitGenerated(rows, []).rest).toHaveLength(4);
    expect(splitGenerated(rows, null as unknown as never[]).rest).toHaveLength(4);
  });

  test('the words of a run', () => {
    const { runs } = splitGenerated(rows, groups);
    expect(runTitle(runs[0])).toBe('night touchdown');
    expect(runMeta(runs[0])).toBe('2 takes · fal · 18 Oct');
    expect(runMeta(runs[1])).toBe('1 take · fal · 17 Oct');
    expect(runTitle({ prompt: 'x'.repeat(100) })).toHaveLength(64);
    expect(runTitle({})).toBe('Generated');
  });
});

describe('the Assets tab', () => {
  const realFetch = globalThis.fetch;
  let urls: string[] = [];
  let detail: unknown = null;
  let generated: unknown = { ok: true, groups: [] };
  const irow = (rel: string, kind: string, extra: Record<string, unknown> = {}) => ({
    rel,
    kind,
    size: 4096,
    mtimeMs: 1,
    usedIn: [],
    usedBy: 0,
    usedElsewhere: false,
    olderVersions: false,
    recentTake: false,
    notUsed: true,
    ...extra,
  });
  const INDEX = {
    seq: 1,
    history: 'ready',
    assets: [
      irow('assets/d34bb59d.jpg', 'image', {
        mtimeMs: 2,
        usedIn: ['ui/matchday.tsx'],
        notUsed: false,
      }),
      irow('assets/a1b2c3d4.png', 'image', { mtimeMs: 9 }),
      irow('assets/e5f60718.png', 'image', { mtimeMs: 8 }),
      irow('assets/2a886bcf.mp3', 'audio', { mtimeMs: 1 }),
    ],
  };

  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    globalThis.fetch = (async (url: string) => {
      urls.push(url);
      if (url.startsWith('/_api/index?part=assets'))
        return new Response(JSON.stringify(INDEX), { status: 200 });
      if (url.startsWith('/_api/asset-details'))
        return detail
          ? new Response(JSON.stringify(detail), { status: 200 })
          : new Response('{}', { status: 404 });
      if (url.startsWith('/_api/asset-generated'))
        return new Response(JSON.stringify(generated), { status: 200 });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    GlobalRegistrator.unregister();
  });
  const roots: Root[] = [];
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
    urls = [];
    detail = null;
    generated = { ok: true, groups: [] };
  });
  async function mount(props: Record<string, unknown> = {}) {
    const { AssetsPanel } = await import('../client/v2/left-panel/assets-panel.jsx');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<AssetsPanel designRel=".design" {...props} />));
    await act(async () => new Promise((r) => setTimeout(r, 40)));
    return host;
  }
  const q = (host: HTMLElement, id: string) =>
    host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const all = (host: HTMLElement, id: string) => [
    ...host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
  ];
  const click = (el: Element | null | undefined) =>
    act(async () => {
      el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
  const openDetails = async (host: HTMLElement, rel: string) => {
    await click(all(host, 'assets-tile').find((t) => t.dataset.asset === rel));
    await act(async () => {
      runAssetsAction('assets.details');
    });
    await act(async () => new Promise((r) => setTimeout(r, 40)));
  };

  test('Generated is a group of its own after Just added: one block per run, not repeated under Photos', async () => {
    generated = {
      ok: true,
      groups: [
        {
          group: 'g1',
          prompt: 'night touchdown',
          provider: 'fal',
          at: '2026-10-18T09:12:00Z',
          takes: ['assets/a1b2c3d4.png', 'assets/e5f60718.png'],
        },
      ],
    };
    const host = await mount();
    expect([...host.querySelectorAll('.lp-group')].map((g) => g.textContent)).toEqual([
      'Generated2',
      'Photos1',
      'Sound1',
    ]);
    const runs = all(host, 'assets-gen-run');
    expect(runs).toHaveLength(1);
    expect(runs[0]?.textContent).toContain('night touchdown');
    expect(runs[0]?.textContent).toContain('2 takes · fal · 18 Oct');
    expect(
      [...runs[0]!.querySelectorAll<HTMLElement>('[data-testid="assets-tile"]')].map(
        (t) => t.dataset.asset
      )
    ).toEqual(['assets/a1b2c3d4.png', 'assets/e5f60718.png']);
    expect(
      all(host, 'assets-tile').filter((t) => t.dataset.asset === 'assets/a1b2c3d4.png')
    ).toHaveLength(1);
    expect(q(host, 'assets-group-generated')).not.toBeNull();
  });

  test('a studio with no generated media (or one that cannot say) draws no Generated group', async () => {
    const host = await mount();
    expect(q(host, 'assets-group-generated')).toBeNull();
    expect([...host.querySelectorAll('.lp-group')].map((g) => g.textContent)).toEqual([
      'Photos3',
      'Sound1',
    ]);
  });

  test('a photo’s details replace the list; Used in opens the artboard; Advanced holds the stored name', async () => {
    detail = { ok: true, details: photo() };
    const opened: Array<[string, string | null]> = [];
    const host = await mount({
      onOpenCanvas: (p: string, b: string | null) => opened.push([p, b]),
      placeLabel: 'MVP zápasu',
      placeTarget: { canvas: 'ui/x.tsx', artboardId: 'ab' },
    });
    await openDetails(host, 'assets/d34bb59d.jpg');
    expect(q(host, 'assets-details')?.dataset.kind).toBe('photo');
    expect(host.querySelector<HTMLElement>('.lp-assets-list')?.hidden).toBe(true);
    expect(q(host, 'assets-search')).toBeNull();
    expect(q(host, 'assets-details-place')?.textContent).toContain('Place in MVP zápasu');
    expect(q(host, 'assets-details-used-title')?.textContent).toBe('Used in 2 canvases');
    const uses = all(host, 'assets-details-use');
    expect(uses.map((u) => u.dataset.board ?? null)).toEqual(['ab-post', null]);
    await click(uses[0]);
    await click(uses[1]);
    expect(opened).toEqual([
      ['.design/ui/matchday.tsx', 'ab-post'],
      ['.design/ui/club-web/website.tsx', null],
    ]);
    // mono lives only under Advanced, and Advanced starts closed
    expect(q(host, 'assets-details-adv-stored')).toBeNull();
    await click(q(host, 'fold-assets.details-toggle'));
    expect(q(host, 'assets-details-adv-stored')?.textContent).toContain('assets/d34bb59d.jpg');
    await click(q(host, 'assets-details-close'));
    expect(q(host, 'assets-details')).toBeNull();
    expect(host.querySelector<HTMLElement>('.lp-assets-list')?.hidden).toBe(false);
  });

  test('Made by AI says the prompt, the provider and the one licence line, once', async () => {
    detail = {
      ok: true,
      details: photo({
        madeByAi: {
          prompt: 'night touchdown, stadium lights',
          provider: 'google',
          model: 'Nano Banana Pro',
          at: '2026-10-05T10:00:00Z',
          licence: 'May carry an invisible SynthID watermark.',
        },
      }),
    };
    const host = await mount();
    await openDetails(host, 'assets/d34bb59d.jpg');
    expect(q(host, 'assets-details')?.dataset.kind).toBe('made');
    expect(q(host, 'assets-details-made')?.textContent).toContain('Made by AI');
    expect(q(host, 'assets-details-prompt')?.textContent).toContain(
      'night touchdown, stadium lights'
    );
    expect(q(host, 'assets-details-madewith')?.textContent).toContain(
      'Google · Nano Banana Pro · 5 Oct'
    );
    expect(all(host, 'assets-details-licence')).toHaveLength(1);
    expect(q(host, 'assets-details-licence')?.textContent).toBe(
      'May carry an invisible SynthID watermark.'
    );
  });

  test('a sound says its length first; footage says what AI saw and its good moments', async () => {
    detail = {
      ok: true,
      details: photo({
        rel: 'assets/2a886bcf.mp3',
        name: '2a886bcf.mp3',
        kind: 'audio',
        ext: 'mp3',
        size: 245760,
      }),
    };
    let host = await mount();
    await openDetails(host, 'assets/2a886bcf.mp3');
    expect(q(host, 'assets-details')?.dataset.kind).toBe('sound');
    expect(q(host, 'assets-details-size')?.textContent).toContain('Length');
    expect(q(host, 'assets-details-place')).toBeNull(); // a sound is not placed from here
    await act(async () => roots.splice(0).forEach((r) => r.unmount()));
    document.body.innerHTML = '';

    detail = {
      ok: true,
      details: photo({
        rel: 'assets/d34bb59d.jpg',
        kind: 'video',
        ext: 'mp4',
        footage: {
          summary: 'A runner breaks a tackle and scores.',
          tags: ['sport'],
          moments: [{ start: 1, end: 4, note: 'run' }],
        },
      }),
    };
    host = await mount();
    await openDetails(host, 'assets/d34bb59d.jpg');
    expect(q(host, 'assets-details')?.dataset.kind).toBe('footage');
    expect(q(host, 'assets-details-saw')?.textContent).toContain(
      'A runner breaks a tackle and scores.'
    );
    expect(q(host, 'assets-details-moments')?.textContent).toContain('0:01–0:04 run');
  });

  test('a studio that does not serve the details still gives a quiet sheet from the row', async () => {
    const host = await mount();
    await openDetails(host, 'assets/d34bb59d.jpg');
    expect(q(host, 'assets-details')?.dataset.state).toBe('gone');
    expect(q(host, 'assets-details')?.textContent).toContain('Used in 1 canvas');
  });

  test('a viewer sees the details but no Place', async () => {
    detail = { ok: true, details: photo() };
    const host = await mount({ readOnly: true });
    await openDetails(host, 'assets/d34bb59d.jpg');
    expect(q(host, 'assets-details')).not.toBeNull();
    expect(q(host, 'assets-details-place')).toBeNull();
  });
});
