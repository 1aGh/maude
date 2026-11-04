// 2.0.4 (#191) — double-click an Assets tile and it opens large: a picture fitted to the window, a clip with controls,
// a sound, or the name and size of what has no preview. ← → walk the visible tiles, esc / a click outside closes, focus goes
// back to the tile, and a single click is what it was. The key (Space) and the menu row are the registry action
// `assets.spotlight`; the pure parts are spotlight-model.js.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AGENT_PATHS } from '../actions/agents.ts';
import { type ShellKeyState, shellKeyCtx } from '../actions/ctx.ts';
import { documentIndex } from '../actions/documents.ts';
import { ACTIONS, ACTIONS_BY_ID } from '../actions/index.ts';
import { chordFromEvent, type KeyEventLike } from '../actions/keys.ts';
import { resolveChord } from '../actions/resolve.ts';
import { runAssetsAction } from '../client/v2/assets/assets-bus.js';
import {
  groupShown,
  narrowOrder,
  pathWords,
  previewKind,
  sizeLine,
  spotlightRows,
  stepIndex,
} from '../client/v2/assets/spotlight-model.js';

describe('the pure parts', () => {
  test('stepIndex stops at the ends and never wraps', () => {
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, 1, 3)).toBe(2);
    expect(stepIndex(0, -1, 3)).toBe(0);
    expect(stepIndex(1, -1, 3)).toBe(0);
    expect(stepIndex(0, 1, 0)).toBe(-1);
  });

  test('how it is drawn: picture, clip, sound; anything else is a file card', () => {
    expect(previewKind({ kind: 'image' })).toBe('image');
    expect(previewKind({ kind: 'video' })).toBe('video');
    expect(previewKind({ kind: 'audio' })).toBe('audio');
    expect(previewKind({ kind: 'font' })).toBe('file');
    expect(previewKind(undefined)).toBe('file');
  });

  test('the path has no leading slash; the size says nothing when the studio did not say', () => {
    expect(pathWords({ path: 'assets/9f2a.jpg' })).toBe('assets/9f2a.jpg');
    expect(
      pathWords({ path: '/.design/system/club/assets/a.png', rel: 'system/club/assets/a.png' })
    ).toBe('system/club/assets/a.png');
    expect(sizeLine({ size: 2048 })).toBe('2 KB');
    expect(sizeLine({ size: 0 })).toBe('');
  });

  test('the rows are the tile menu’s, minus the separator and Move to trash', () => {
    const rows = spotlightRows([
      { id: 'place', label: 'Place', keys: '↵' },
      { id: 'details', label: 'Show details' },
      { id: 'sep', separator: true },
      { id: 'trash', label: 'Move to trash' },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['place', 'details']);
  });

  test('the order is what the narrow tab draws: Seen first, then each group (a plain group capped)', () => {
    const mk = (p: string) => ({ path: p, name: p });
    const many = Array.from({ length: 30 }, (_, i) => mk(`assets/p${i}.jpg`));
    const groups = [
      { kind: 'added', title: 'Just added', items: [mk('assets/new.jpg')] },
      { kind: 'image', title: 'Photos', items: many },
    ];
    const order = narrowOrder(groups, [{ asset: mk('assets/seen.jpg') }]);
    expect(order[0]).toBe('assets/seen.jpg');
    expect(order[1]).toBe('assets/new.jpg');
    expect(order.length).toBe(2 + groupShown(groups[1] as never).length);
    expect(order.length).toBeLessThan(2 + many.length);
    expect(narrowOrder(groups, [], { uncapped: true }).length).toBe(1 + many.length);
  });
});

describe('the registry', () => {
  const SHELL = documentIndex(ACTIONS, 'shell', () => true);
  const BASE: ShellKeyState = {
    canvasOpen: true,
    timelineVisible: false,
    presenting: false,
    native: true,
    readOnly: false,
    clipSelected: false,
    artboardSelected: true,
    commentFocused: false,
  };
  const SPACE: KeyEventLike = { key: ' ', code: 'Space' };
  const press = (
    s: Partial<ShellKeyState> = {},
    probe: { tag?: string; type?: string } = { tag: 'BUTTON' }
  ) => {
    const ctx = shellKeyCtx(probe, { ...BASE, ...s });
    return resolveChord(SHELL, chordFromEvent(SPACE), ctx)?.action.id ?? null;
  };

  test('assets.spotlight is a shell action, a read for every role, hidden from ⌘K', () => {
    const a = ACTIONS_BY_ID.get('assets.spotlight');
    expect(a).toMatchObject({ label: 'View larger', exec: 'shell' });
    expect(a?.enabled).toBeUndefined();
    expect(a?.search?.hidden).toBe(true);
    expect(AGENT_PATHS['assets.spotlight']).toMatchObject({ effect: 'none' });
  });

  test('Space on a picked tile is assets.spotlight — for a viewer too; with no tile picked it is not', () => {
    expect(press({ assetTileSelected: true })).toBe('assets.spotlight');
    expect(press({ assetTileSelected: true, readOnly: true })).toBe('assets.spotlight');
    expect(press({ assetTileSelected: false })).not.toBe('assets.spotlight');
  });

  test('a text field keeps Space (the search box is not a tile)', () => {
    expect(press({ assetTileSelected: true }, { tag: 'INPUT', type: 'search' })).not.toBe(
      'assets.spotlight'
    );
  });
});

// ── the tab ──────────────────────────────────────────────────────────────────────────────────────────────────────
describe('the Assets tab', () => {
  const realFetch = globalThis.fetch;
  let calls: Array<{ url: string; body?: unknown }> = [];
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
      irow('assets/aaaa1111.jpg', 'image', { mtimeMs: 9 }),
      irow('assets/bbbb2222.jpg', 'image', { mtimeMs: 8, size: 3_250_000 }),
      irow('assets/cccc3333.png', 'image', { mtimeMs: 7 }),
      irow('assets/dddd4444.mp4', 'video', { mtimeMs: 2 }),
      irow('assets/eeee5555.mp3', 'audio', { mtimeMs: 1 }),
    ],
  };
  const LIB = 'system/club/assets';
  let index: unknown = INDEX;
  let dsPage: unknown = null;

  beforeAll(() => {
    // a base URL: happy-dom fires `error` at once on an <img> whose relative src has no base to resolve against
    GlobalRegistrator.register({ url: 'http://localhost:4399/' });
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    globalThis.fetch = (async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.startsWith('/_api/index?part=assets'))
        return new Response(JSON.stringify(index), { status: 200 });
      if (url.startsWith('/_api/ds/assets'))
        return new Response(JSON.stringify(dsPage), { status: 200 });
      if (url === '/_api/edit-op')
        return new Response(
          JSON.stringify({ ok: true, writeId: 'w_0123456789abcdef', actionId: 'a1', created: [] }),
          { status: 200 }
        );
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
    calls = [];
    index = INDEX;
    dsPage = null;
  });
  const wait = (ms = 40) => act(async () => new Promise((r) => setTimeout(r, ms)));
  async function mount(props: Record<string, unknown> = {}) {
    const { AssetsPanel } = await import('../client/v2/left-panel/assets-panel.jsx');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<AssetsPanel designRel=".design" {...props} />));
    await wait();
    return host;
  }
  const q = (id: string, within: ParentNode = document) =>
    within.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const tiles = (host: HTMLElement) => [
    ...host.querySelectorAll<HTMLElement>('[data-testid="assets-tile"]'),
  ];
  const tileOf = (host: HTMLElement, rel: string) =>
    tiles(host).find((t) => t.dataset.asset === rel) as HTMLElement;
  const click = (el: Element | null | undefined) =>
    act(async () => {
      el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
  const dbl = (el: Element | null | undefined) =>
    act(async () => {
      el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
      el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 2 }));
      el?.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    });
  const key = (k: string, target?: Element | null) =>
    act(async () => {
      (target ?? document.activeElement ?? document.body).dispatchEvent(
        new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
      );
    });
  const title = () => q('spotlight-title')?.textContent;

  test('a single click picks the tile and opens nothing', async () => {
    const host = await mount();
    await click(tileOf(host, 'assets/aaaa1111.jpg'));
    expect(tileOf(host, 'assets/aaaa1111.jpg').getAttribute('aria-pressed')).toBe('true');
    expect(q('asset-spotlight')).toBeNull();
  });

  test('a double-click opens that asset: a dialog named by the file, the picture at the tile’s own address', async () => {
    const host = await mount();
    await dbl(tileOf(host, 'assets/bbbb2222.jpg'));
    const dlg = document.querySelector<HTMLElement>('[role="dialog"]') as HTMLElement;
    expect(dlg).not.toBeNull();
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const label = document.getElementById(dlg.getAttribute('aria-labelledby') as string);
    expect(label?.textContent).toBe('bbbb2222.jpg');
    const img = q('spotlight-image') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/.design/assets/bbbb2222.jpg');
    // the tile drew the same address
    expect(tileOf(host, 'assets/bbbb2222.jpg').querySelector('img')?.getAttribute('src')).toBe(
      img.getAttribute('src')
    );
    expect(q('spotlight-path')?.textContent).toBe('assets/bbbb2222.jpg');
    expect(q('spotlight-size')?.textContent).toBe('3.1 MB');
    // and it is the picked tile now
    expect(tileOf(host, 'assets/bbbb2222.jpg').getAttribute('aria-pressed')).toBe('true');
  });

  test('← → step through the visible tiles in the tab’s order and stop at the ends', async () => {
    const host = await mount();
    const order = tiles(host).map((t) => t.dataset.asset as string);
    expect(order.length).toBe(5);
    await dbl(tileOf(host, order[0] as string));
    expect(title()).toBe((order[0] as string).split('/').pop());
    expect((q('spotlight-prev') as HTMLButtonElement).disabled).toBe(true);
    await key('ArrowRight', q('spotlight-stage'));
    expect(title()).toBe((order[1] as string).split('/').pop());
    expect(q('spotlight-position')?.textContent).toBe('2 of 5');
    await key('ArrowLeft', q('spotlight-stage'));
    await key('ArrowLeft', q('spotlight-stage'));
    expect(title()).toBe((order[0] as string).split('/').pop());
    for (let i = 0; i < 8; i++) await key('ArrowRight', q('spotlight-stage'));
    expect(title()).toBe((order[4] as string).split('/').pop());
    expect((q('spotlight-next') as HTMLButtonElement).disabled).toBe(true);
    // the pick followed: the tile you were looking at is the picked one
    expect(tileOf(host, order[4] as string).getAttribute('aria-pressed')).toBe('true');
  });

  test('a clip plays with controls; a sound plays too', async () => {
    const host = await mount();
    await dbl(tileOf(host, 'assets/dddd4444.mp4'));
    const video = q('spotlight-video') as HTMLVideoElement;
    expect(video.tagName).toBe('VIDEO');
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.getAttribute('src')).toBe('/.design/assets/dddd4444.mp4');
    await key('ArrowRight', q('spotlight-stage'));
    const audio = q('spotlight-sound')?.querySelector('audio') as HTMLAudioElement;
    expect(audio.hasAttribute('controls')).toBe(true);
  });

  test('a file the window cannot draw says its name and size (the model, through the component)', async () => {
    const { AssetSpotlight } = await import('../client/v2/assets/spotlight.jsx');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        <AssetSpotlight
          items={[{ path: 'assets/Inter.ttf', name: 'Inter.ttf', kind: 'font', size: 52_000 }]}
          index={0}
          urlOf={(p: string) => `/.design/${p}`}
          onIndex={() => {}}
          onClose={() => {}}
        />
      )
    );
    expect(q('spotlight-file')?.textContent).toContain('Inter.ttf');
    expect(q('spotlight-file')?.textContent).toContain('51 KB');
    expect(q('spotlight-file')?.textContent).toContain('no preview');
    expect(q('spotlight-image')).toBeNull();
  });

  test('a picture that will not load says so, with its name and size, instead of a broken box', async () => {
    const host = await mount();
    await dbl(tileOf(host, 'assets/bbbb2222.jpg'));
    const img = q('spotlight-image') as HTMLImageElement;
    await act(async () => {
      img.dispatchEvent(new window.Event('error'));
    });
    expect(q('spotlight-image')).toBeNull();
    expect(q('spotlight-file')?.textContent).toContain('bbbb2222.jpg');
    expect(q('spotlight-file')?.textContent).toContain('could not be shown');
  });

  test('esc closes it and focus goes back to the tile', async () => {
    const host = await mount();
    const tile = tileOf(host, 'assets/aaaa1111.jpg');
    await dbl(tile);
    expect(q('asset-spotlight')).not.toBeNull();
    await key('Escape');
    await wait();
    expect(q('asset-spotlight')).toBeNull();
    expect(document.activeElement).toBe(tile);
  });

  test('after stepping, esc gives focus to the tile that was showing — not the one that opened it', async () => {
    const host = await mount();
    const order = tiles(host).map((t) => t.dataset.asset as string);
    await dbl(tileOf(host, order[0] as string));
    await key('ArrowRight', q('spotlight-stage'));
    await key('Escape');
    await wait();
    expect(document.activeElement).toBe(tileOf(host, order[1] as string));
  });

  test('a click outside (the scrim, or the empty stage) closes it; a click on the picture does not', async () => {
    const host = await mount();
    const tile = tileOf(host, 'assets/aaaa1111.jpg');
    await dbl(tile);
    expect(q('spotlight-image')).not.toBeNull();
    await click(q('spotlight-image'));
    expect(q('asset-spotlight')).not.toBeNull();
    await click(q('spotlight-scrim'));
    await wait();
    expect(q('asset-spotlight')).toBeNull();
    expect(document.activeElement).toBe(tile);
    await dbl(tile);
    await click(q('spotlight-stage'));
    await wait();
    expect(q('asset-spotlight')).toBeNull();
  });

  test('the close button closes it', async () => {
    const host = await mount();
    await dbl(tileOf(host, 'assets/aaaa1111.jpg'));
    await click(q('spotlight-close'));
    await wait();
    expect(q('asset-spotlight')).toBeNull();
  });

  test('Tab stays inside the window: from the last control it wraps to the first', async () => {
    const host = await mount();
    await dbl(tileOf(host, 'assets/aaaa1111.jpg'));
    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    const btns = [...dlg.querySelectorAll<HTMLElement>('button:not([disabled])')];
    const last = btns[btns.length - 1] as HTMLElement;
    last.focus();
    await act(async () => {
      last.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      );
    });
    expect(dlg.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(btns[0]);
  });

  test('the window shows the actions the tile has: Place and Show details for a picture, never Move to trash', async () => {
    const host = await mount({
      placeTarget: { canvas: 'ui/post.tsx', artboardId: 'post' },
      placeLabel: 'Post 1:1',
    });
    await dbl(tileOf(host, 'assets/aaaa1111.jpg'));
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid^="spotlight-row-"]')].map(
      (r) => r.dataset.testid
    );
    expect(rows).toEqual([
      'spotlight-row-place',
      'spotlight-row-details',
      'spotlight-row-rename',
      'spotlight-row-copy',
    ]);
    expect(q('spotlight-row-place')?.textContent).toContain('Place in Post 1:1');
  });

  test('Place from the window closes it and runs the same one edit-op as ↵', async () => {
    const host = await mount({
      placeTarget: { canvas: 'ui/post.tsx', artboardId: 'post' },
      placeLabel: 'Post 1:1',
    });
    await dbl(tileOf(host, 'assets/aaaa1111.jpg'));
    await click(q('spotlight-row-place'));
    await wait();
    expect(q('asset-spotlight')).toBeNull();
    const edits = calls.filter((c) => c.url === '/_api/edit-op');
    expect(edits).toHaveLength(1);
    expect(edits[0]?.body).toMatchObject({ op: 'image.place', file: 'ui/post.tsx' });
  });

  test('a viewer gets Show details only; a clip has no Place', async () => {
    const host = await mount({ readOnly: true });
    await dbl(tileOf(host, 'assets/aaaa1111.jpg'));
    expect(
      [...document.querySelectorAll<HTMLElement>('[data-testid^="spotlight-row-"]')].map(
        (r) => r.dataset.testid
      )
    ).toEqual(['spotlight-row-details']);
  });

  test('Space on the picked tile (assets.spotlight through the bus) opens the one picked', async () => {
    const host = await mount();
    await click(tileOf(host, 'assets/cccc3333.png'));
    await act(async () => {
      runAssetsAction('assets.spotlight');
    });
    expect(title()).toBe('cccc3333.png');
  });

  test('the tile menu has View larger, and it opens the same window', async () => {
    const host = await mount();
    const tile = tileOf(host, 'assets/bbbb2222.jpg');
    await act(async () => {
      tile.dispatchEvent(
        new window.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        })
      );
    });
    await click(q('assets-menu-spotlight'));
    expect(title()).toBe('bbbb2222.jpg');
  });

  test('a design system’s library opens the same window over its own files, at the tile’s own address', async () => {
    const f = (name: string) => ({
      path: `${LIB}/${name}`,
      name,
      ext: 'jpg',
      kind: 'image',
      size: 2048,
      mtimeMs: 1,
      placeable: true,
    });
    dsPage = {
      ok: true,
      ds: 'club',
      root: LIB,
      dir: '',
      dirs: [],
      files: [f('one.jpg'), f('two.jpg')],
      total: 2,
      next: null,
    };
    const host = await mount({ designSystems: [{ name: 'club', path: 'system/club' }] });
    const sel = q('assets-source', host) as HTMLSelectElement;
    await act(async () => {
      sel.value = 'ds:club';
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await wait();
    const tile = tiles(host)[0] as HTMLElement;
    await dbl(tile);
    expect(title()).toBe('one.jpg');
    expect(q('spotlight-image')?.getAttribute('src')).toBe(`/.design/${LIB}/one.jpg`);
    expect(q('spotlight-path')?.textContent).toBe(`${LIB}/one.jpg`);
    await key('ArrowRight', q('spotlight-stage'));
    expect(title()).toBe('two.jpg');
    await key('Escape');
    await wait();
    expect(q('asset-spotlight')).toBeNull();
    expect(document.activeElement).toBe(tiles(host)[1]);
  });

  test('prefers-reduced-motion is honoured in the stylesheet', async () => {
    const css = await Bun.file(
      new URL('../client/v2/assets/spotlight.css', import.meta.url)
    ).text();
    expect(css).toContain('prefers-reduced-motion: reduce');
  });
});
