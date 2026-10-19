// S4.13 - (1) the Recent stickers live in the per-person annotationPrefs store (S4.8, Q8), not in a
// localStorage key of their own, and the S4.3 key is migrated once; (2) after ONE stamp the Stickers gallery
// folds to the Stamps row (canvas 15 `an-stamps`), and the shell tells the canvas which stamp is armed.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  checkAnnotationPrefsPatch,
  RECENT_STICKERS_MAX,
  sanitizeShellPrefs,
} from '../annotations/ui/tool-prefs.ts';
import {
  loadRecent,
  migrateLegacyRecents,
  RECENT_KEY,
  rememberSticker,
} from '../client/v2/annotations/recent-stickers.js';
import StickersGallery from '../client/v2/annotations/stickers-gallery.jsx';
import { createAnnotationPrefsStore } from '../client/v2/shell/annotation-prefs-store.js';
import { validateUiPrefsPatch } from '../ui-prefs.ts';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});
beforeEach(() => {
  try {
    localStorage.clear();
  } catch {}
});

/** A store with no localStorage mirror, recording what it would write to prefs.json. */
const fresh = () => {
  const writes: unknown[] = [];
  const store = createAnnotationPrefsStore({
    persist: (p: unknown) => writes.push(p),
    storage: null,
  });
  return { store, writes };
};
const ref = (id: string) => ({ pack: 'project-status', id });

describe('Recent lives in the annotation prefs', () => {
  test('a placed sticker is first in the list, written to prefs.json, and not to a key of its own', () => {
    const { store, writes } = fresh();
    rememberSticker(ref('group-46'), store);
    const next = rememberSticker(ref('group-51'), store);
    expect(next.map((r: { id: string }) => r.id)).toEqual(['group-51', 'group-46']);
    expect(loadRecent(store).map((r: { id: string }) => r.id)).toEqual(['group-51', 'group-46']);
    expect(writes.at(-1)).toEqual({
      annotationPrefs: { recentStickers: [ref('group-51'), ref('group-46')] },
    });
    expect(localStorage.getItem(RECENT_KEY)).toBeNull();
  });
  test('placing the same one again moves it to the front, never twice; twelve at most', () => {
    const { store } = fresh();
    for (let i = 0; i < RECENT_STICKERS_MAX + 4; i++) rememberSticker(ref(`s-${i}`), store);
    rememberSticker(ref('s-8'), store);
    const ids = loadRecent(store).map((r: { id: string }) => r.id);
    expect(ids).toHaveLength(RECENT_STICKERS_MAX);
    expect(ids[0]).toBe('s-8');
    expect(ids.filter((i: string) => i === 's-8')).toHaveLength(1);
  });
  test('the S4.3 localStorage list is migrated once, behind what the store already has, then removed', () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify([ref('old-1'), ref('old-2')]));
    const { store, writes } = fresh();
    store.set({ recentStickers: [ref('new-1')] });
    expect(migrateLegacyRecents(store, localStorage)).toBe(true);
    expect(store.get().recentStickers.map((r: { id: string }) => r.id)).toEqual([
      'new-1',
      'old-1',
      'old-2',
    ]);
    expect(localStorage.getItem(RECENT_KEY)).toBeNull();
    expect(migrateLegacyRecents(store, localStorage)).toBe(false); // once
    expect(writes.length).toBeGreaterThanOrEqual(2);
  });
  test('a broken legacy value is dropped, not carried', () => {
    localStorage.setItem(RECENT_KEY, '{not json');
    const { store } = fresh();
    expect(loadRecent(store, localStorage)).toEqual([]);
    expect(localStorage.getItem(RECENT_KEY)).toBeNull();
  });
  test('a hostile list is cleaned by the same gate that guards prefs.json', () => {
    const dirty = [
      ref('ok'),
      { pack: '../etc', id: 'x' },
      { pack: 'a' },
      'str',
      ref('ok'),
      null,
      ref('../x'),
    ];
    expect(sanitizeShellPrefs({ recentStickers: dirty }).recentStickers).toEqual([ref('ok')]);
    expect(sanitizeShellPrefs({ recentStickers: 'nope' }).recentStickers).toBeUndefined();
    expect(checkAnnotationPrefsPatch({ recentStickers: dirty })).toEqual({
      ok: true,
      value: { recentStickers: [ref('ok')] },
    });
    expect(checkAnnotationPrefsPatch({ recentStickers: 'x' }).ok).toBe(false);
    expect(checkAnnotationPrefsPatch({ cursor: 'wait' }).ok).toBe(false);
    expect(validateUiPrefsPatch({ annotationPrefs: { recentStickers: [ref('a')] } }).ok).toBe(true);
  });
  test('the disk list is adopted unless this page already changed it; the canvas never sees it', () => {
    const { store } = fresh();
    store.hydrate({ annotationPrefs: { recentStickers: [ref('disk')] } });
    expect(loadRecent(store)).toEqual([ref('disk')]);
    rememberSticker(ref('mine'), store);
    store.hydrate({ annotationPrefs: { recentStickers: [ref('late-disk')] } });
    expect(loadRecent(store)[0]).toEqual(ref('mine'));
  });
});

describe('after one stamp the gallery folds to the Stamps row', () => {
  const PACKS = [
    {
      slug: 'project-status',
      name: 'Project status stickers',
      stickers: [
        {
          file: 'group-46.png',
          keywords: ['done'],
          url: '/_stickers/project-status/group-46.png',
          pack: 'project-status',
          id: 'group-46.png',
        },
      ],
    },
  ];
  async function mount(props: Record<string, unknown>) {
    (globalThis as any).fetch = async () => ({ json: async () => ({ ok: true, packs: PACKS }) });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    const stamped: string[] = [];
    let closed = 0;
    await act(async () => {
      root.render(
        <StickersGallery
          prefs={fresh().store}
          onPick={() => {}}
          onPickStamp={(id: string) => stamped.push(id)}
          onClose={() => {
            closed++;
          }}
          {...props}
        />
      );
    });
    await act(async () => {});
    return { host, stamped, closed: () => closed };
  }
  const q = (host: Element, id: string) =>
    host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  test('the first stamp is handed to the canvas and the gallery becomes one row; no scrim', async () => {
    const { host, stamped } = await mount({});
    expect(q(host, 'stickers-stamp-yes')).not.toBeNull();
    expect(host.querySelector('.st-scrim')).not.toBeNull();
    await act(async () => q(host, 'stickers-stamp-yes')?.click());
    expect(stamped).toEqual(['yes']);
    const row = q(host, 'tool-panel-stickers') as HTMLElement;
    expect(row.dataset.folded).toBe('stamps');
    expect(host.querySelector('.st-scrim')).toBeNull(); // the clicks that stamp must reach the canvas
    expect(q(host, 'stickers-search')).toBeNull();
    expect(
      row.querySelectorAll('[data-testid^="stamps-row-"][aria-label]').length
    ).toBeGreaterThanOrEqual(6);
    expect(q(host, 'stamps-row-yes')?.dataset.on).toBe('true');
  });
  test('another stamp in the row moves the lit one and re-arms the canvas', async () => {
    const { host, stamped } = await mount({});
    await act(async () => q(host, 'stickers-stamp-yes')?.click());
    await act(async () => q(host, 'stamps-row-star')?.click());
    expect(stamped).toEqual(['yes', 'star']);
    expect(q(host, 'stamps-row-star')?.dataset.on).toBe('true');
    expect(q(host, 'stamps-row-yes')?.dataset.on).toBeUndefined();
  });
  test('the chevron opens the whole gallery again; Done closes', async () => {
    const { host, closed } = await mount({});
    await act(async () => q(host, 'stickers-stamp-yes')?.click());
    await act(async () => q(host, 'stamps-row-more')?.click());
    expect(q(host, 'stickers-search')).not.toBeNull();
    await act(async () => q(host, 'stickers-stamp-heart')?.click());
    await act(async () => q(host, 'stamps-row-done')?.click());
    expect(closed()).toBe(1);
  });
  test('with no handler the Stamps row stays inert and the gallery does not fold', async () => {
    const { host } = await mount({ onPickStamp: undefined });
    expect((q(host, 'stickers-stamp-yes') as HTMLButtonElement).disabled).toBe(true);
    expect(q(host, 'stamps-row-yes')).toBeNull();
  });
});
