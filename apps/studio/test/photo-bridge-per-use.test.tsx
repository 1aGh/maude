// S8.15 — the photo bridge renders each use of a picture by the render order of contract
// S8-asset-sidecars §5.1: a use's own edit (`data-photo-edit` + a valid file), else the
// every-use file, else the original. Two uses of one picture bake apart, and a live preview
// with `use` changes that one use only.
//
// The bake is replaced by a stub that writes the edit it was given into the data URL, so the
// test reads off each element which edit it shows.

import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

mock.module('../photo/pipeline.ts', () => ({
  renderPhotoDataUrl: async ({ edit }: { edit: unknown }) =>
    `data:text/plain,${encodeURIComponent(JSON.stringify(edit))}`,
}));

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { PhotoPreviewBridge } from '../canvas-lib.tsx';

const ASSET = 'assets/0a1b2c3d.png';
const OWN = { adjustments: { contrast: 0.5 } };
const EVERY = { adjustments: { brightness: 0.2 } };

const shown = (el: Element) => {
  const src = el.getAttribute('src') ?? '';
  return src.startsWith('data:') ? JSON.parse(decodeURIComponent(src.split(',')[1] ?? '')) : src;
};

async function mount(
  imgs: Array<{ id: string; edit?: string }>,
  answers: Record<string, unknown>
): Promise<{ els: HTMLImageElement[]; asked: string[]; done: () => Promise<void> }> {
  document.body.innerHTML = '';
  const els = imgs.map(({ id, edit }) => {
    const img = document.createElement('img');
    img.setAttribute('src', `/.design/${ASSET}`);
    img.setAttribute('data-cd-id', id);
    if (edit) img.setAttribute('data-photo-edit', edit);
    document.body.append(img);
    return img;
  });
  const asked: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const q = String(url).split('?')[1] ?? '';
    asked.push(q);
    const edit = new URLSearchParams(q).get('edit');
    const body = answers[edit ?? 'every'] ?? {};
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<PhotoPreviewBridge />));
  await settle();
  return {
    els,
    asked,
    done: async () => {
      await act(async () => root.unmount());
      globalThis.fetch = realFetch;
    },
  };
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 200)); // past the bake debounce
  });

test('a use with its own edit shows it; the other use of the same picture shows every-use', async () => {
  const m = await mount([{ id: 'mvp', edit: '9f8e7d6c' }, { id: 'score' }], {
    '9f8e7d6c': OWN,
    every: EVERY,
  });
  try {
    expect(shown(m.els[0] as Element).adjustments).toEqual(OWN.adjustments);
    expect(shown(m.els[1] as Element).adjustments).toEqual(EVERY.adjustments);
    expect(m.asked).toContain(`asset=${encodeURIComponent(ASSET)}&edit=9f8e7d6c`);
  } finally {
    await m.done();
  }
});

test('a missing or invalid own file falls back to every-use, then to the original', async () => {
  const a = await mount([{ id: 'mvp', edit: '9f8e7d6c' }], { every: EVERY });
  try {
    expect(shown(a.els[0] as Element).adjustments).toEqual(EVERY.adjustments);
  } finally {
    await a.done();
  }
  const b = await mount(
    [
      { id: 'mvp', edit: '9f8e7d6c' },
      { id: 'bad', edit: '../x' },
    ],
    {}
  );
  try {
    for (const el of b.els) expect(shown(el)).toBe(`/.design/${ASSET}`);
    // a name outside 8–16 hex is never asked for
    expect(b.asked.some((q) => q.includes('edit=..'))).toBe(false);
  } finally {
    await b.done();
  }
});

test('a live preview with `use` changes that one use only', async () => {
  const m = await mount([{ id: 'mvp' }, { id: 'score' }], {});
  try {
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { dgn: 'photo-preview', asset: ASSET, edit: OWN, use: 'mvp' },
        })
      );
    });
    await settle();
    expect(shown(m.els[0] as Element).adjustments).toEqual(OWN.adjustments);
    expect(shown(m.els[1] as Element)).toBe(`/.design/${ASSET}`);
    // the v1 preview (no `use`) still changes every use without an edit of its own
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { dgn: 'photo-preview', asset: ASSET, edit: EVERY } })
      );
    });
    await settle();
    expect(shown(m.els[1] as Element).adjustments).toEqual(EVERY.adjustments);
  } finally {
    await m.done();
  }
});
