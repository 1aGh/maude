// Phase 8 stage C round 7 — 12 Import and Assets: "Rename…" in the tile menu (ia-assets-keys), as the board draws it:
// Place in … ↵ · Show details ⌘I · Rename… · Copy ⌘C · — · Move to trash. The field names what it renames; Enter asks
// the studio (`POST /_api/assets/rename`), the line under the head says the answer, with Undo.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { renameAssetRequest } from '../client/v2/assets/rename-asset.js';
import { tileMenuItems } from '../client/v2/assets/tile-menu.jsx';

describe('the tile menu (12 · ia-assets-keys)', () => {
  test('an editor gets Rename… after Show details, in the board order; a viewer does not', () => {
    const ids = tileMenuItems({ kind: 'image' }, { placeLabel: 'MVP zápasu' }).map(
      (i) => i.label ?? '—'
    );
    expect(ids).toEqual([
      'Place in MVP zápasu',
      'Show details',
      'Rename…',
      'Copy',
      '—',
      'Move to trash',
    ]);
    expect(tileMenuItems({ kind: 'image' }, { readOnly: true }).map((i) => i.id)).toEqual([
      'details',
    ]);
    // with several picked, the row would name one of many: it is not offered
    expect(tileMenuItems({ kind: 'image' }, { count: 3 }).some((i) => i.id === 'rename')).toBe(
      false
    );
  });
});

describe('the writer', () => {
  const answer = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  test('says the new name, and the reason a used picture keeps its own', async () => {
    const ok = await renameAssetRequest('assets/p1.jpg', 'Kick off', {
      fetchImpl: answer(200, { ok: true, to: 'assets/Kick off.jpg' }),
    });
    expect(ok).toMatchObject({
      ok: true,
      to: 'assets/Kick off.jpg',
      message: 'Renamed to “Kick off.jpg”.',
    });
    const used = await renameAssetRequest('assets/p1.jpg', 'Hero', {
      fetchImpl: answer(409, { ok: false, reason: 'used' }),
    });
    expect(used.ok).toBe(false);
    expect(used.message).toContain('is on a canvas, so its name stays');
    const same = await renameAssetRequest('assets/p1.jpg', ' p1 ', { fetchImpl: answer(500, {}) });
    expect(same).toMatchObject({ ok: false, keep: true });
    expect(
      (await renameAssetRequest('assets/p1.jpg', 'x', { fetchImpl: answer(403, {}) })).message
    ).toBe('Not renamed. You can look here; ask to edit.');
  });
});

describe('the panel (render)', () => {
  const realFetch = globalThis.fetch;
  const posts: Array<{ url: string; body: unknown }> = [];
  const rows = Array.from({ length: 3 }, (_, i) => ({
    rel: `assets/p${i}.jpg`,
    kind: 'image',
    size: 1024 * (i + 1),
    mtimeMs: 100 + i,
    usedIn: [],
    usedBy: 0,
    usedElsewhere: false,
    olderVersions: false,
    recentTake: false,
    notUsed: true,
  }));
  const roots: Root[] = [];
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.startsWith('/_api/index?part=assets'))
        return new Response(JSON.stringify({ seq: 1, history: 'ready', assets: rows }), {
          status: 200,
        });
      if (url === '/_api/assets/rename') {
        const body = JSON.parse(String(init?.body));
        posts.push({ url, body });
        return new Response(
          JSON.stringify({ ok: true, rel: body.asset, to: `assets/${body.name}.jpg` }),
          {
            status: 200,
          }
        );
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    GlobalRegistrator.unregister();
  });
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
  });
  // React's own handlers (happy-dom's synthetic input/submit events do not reach them)
  const props = (el: HTMLElement) =>
    (el as unknown as Record<string, Record<string, (e: unknown) => void>>)[
      Object.getOwnPropertyNames(el).find((k) => k.startsWith('__reactProps')) as string
    ];
  const q = (h: HTMLElement, id: string) => h.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  test('Rename… opens a named field with the name; Enter renames and says so, with Undo', async () => {
    const { AssetsPanel } = await import('../client/v2/left-panel/assets-panel.jsx');
    const host = document.createElement('div');
    document.body.append(host);
    const r = createRoot(host);
    roots.push(r);
    await act(async () => r.render(<AssetsPanel designRel=".design" />));
    await act(async () => new Promise((res) => setTimeout(res, 30)));
    const tile = host.querySelector('[data-testid="assets-tile"]') as HTMLElement;
    await act(async () => {
      tile.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true })
      );
    });
    const row = q(host, 'assets-menu-rename');
    expect(row?.textContent).toBe('Rename…');
    await act(async () => row?.click());
    const input = q(host, 'assets-rename-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    const rel = posts.length === 0 ? input.getAttribute('aria-label') : '';
    expect(rel).toMatch(/^New name for p\d\.jpg$/);
    const old = input.value;
    expect(old).toMatch(/^p\d$/);
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      set?.call(input, 'Kick off');
      props(input).onChange?.({ target: input, currentTarget: input });
    });
    await act(async () => {
      props(input).onKeyDown?.({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
      await new Promise((res) => setTimeout(res, 20));
    });
    expect(posts.at(-1)?.body).toEqual({ asset: `assets/${old}.jpg`, name: 'Kick off' });
    expect(q(host, 'assets-renamed')?.textContent).toContain('Renamed to “Kick off.jpg”.');
    expect(q(host, 'assets-renamed-undo')?.textContent).toBe('Undo');
  });
});
