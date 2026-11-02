// S8.22b — what S8.22 left: the one toast after "Add files…" (import-toast.js), the offline line (import-offline.js),
// "Added by <name>" in the details (details-model.js), and the ask-once memory (ask-once.js). The route and the
// converters are S8.22's (import-convert.test.ts, v2-import-lines.test.ts); the origin record's name is in
// asset-origins.test.ts / asset-details.test.ts.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { askNow, clearAsked, markAsked, wasAsked } from '../client/v2/assets/ask-once.js';
import { addedByLine } from '../client/v2/assets/details-model.js';
import { importsWaitHere } from '../client/v2/assets/import-offline.js';
import { arrivalNote, toastArrivals } from '../client/v2/assets/import-toast.js';

const landed = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  result: { path: 'assets/aaaa1111.jpg', ...extra },
});

describe('the one toast', () => {
  test('a plain photo that landed says nothing; a second copy, a .psd and a HEIC each say their line', () => {
    expect(arrivalNote([landed('IMG_1.jpg')])).toBeNull();
    expect(arrivalNote([landed('IMG_2231.jpg', { reused: true })])?.text).toBe(
      'IMG_2231.jpg is already in Assets — placed the same one, not a copy.'
    );
    expect(arrivalNote([landed('dres.psd', { converted: 'psd' })])?.text).toBe(
      'Placed the flat picture from dres.psd. Its layers stay in Photoshop.'
    );
    expect(arrivalNote([landed('IMG_5012.HEIC', { converted: 'heic' })])?.text).toBe(
      'IMG_5012.HEIC came in as a JPG the canvas can show.'
    );
  });

  test('a refusal with a reason says so in its words (warn); a plain failure is the panel’s own error, not a toast', () => {
    const note = arrivalNote([{ name: 'big.psd', result: { error: 'x', reason: 'too-large' } }]);
    expect(note).toEqual({
      tone: 'warn',
      text: 'big.psd is too large to bring in. Add a smaller copy.',
    });
    expect(arrivalNote([{ name: 'a.jpg', result: { error: 'upload failed (500)' } }])).toBeNull();
  });

  test('several files make ONE toast: two lines, then how many more', () => {
    const rows = ['a', 'b', 'c', 'd'].map((n) => landed(`${n}.heic`, { converted: 'heic' }));
    const note = arrivalNote(rows);
    expect(note?.text).toBe(
      'a.heic came in as a JPG the canvas can show. b.heic came in as a JPG the canvas can show. And two more.'
    );
  });

  test('offline: "Kept on this Mac" is said once, last, and only when something landed', () => {
    const off = { offline: true };
    expect(arrivalNote([landed('IMG_1.jpg')], off)?.text).toBe(
      'Kept on this Mac — goes up by itself once it’s online.'
    );
    expect(arrivalNote([landed('a.heic', { converted: 'heic' }), landed('b.jpg')], off)?.text).toBe(
      'a.heic came in as a JPG the canvas can show. Kept on this Mac — goes up by itself once it’s online.'
    );
    // nothing landed: nothing is kept
    expect(arrivalNote([{ name: 'x', result: { error: 'e' } }], off)).toBeNull();
    // online: no offline sentence
    expect(arrivalNote([landed('IMG_1.jpg')], { offline: false })).toBeNull();
  });

  test('toastArrivals shows one toast (success styling for info), none for nothing, and tolerates no toast', () => {
    const seen: Array<[string, boolean]> = [];
    const toast = (m: string, ok: boolean) => seen.push([m, ok]);
    toastArrivals(toast, [landed('IMG_1.jpg')]);
    expect(seen).toEqual([]);
    toastArrivals(toast, [landed('a.heic', { converted: 'heic' })]);
    toastArrivals(toast, [{ name: 'b.psd', result: { error: 'x', reason: 'timeout' } }]);
    expect(seen.map((s) => s[1])).toEqual([true, false]);
    expect(() => toastArrivals(undefined, [landed('a.heic', { converted: 'heic' })])).not.toThrow();
  });
});

describe('offline means kept on this Mac', () => {
  test('a linked project with no network, or a link that is offline, waits here; a local project has nothing to keep', () => {
    expect(importsWaitHere({ linked: true, online: false })).toBe(true);
    expect(importsWaitHere({ linked: true, online: true, phase: 'offline' })).toBe(true);
    expect(importsWaitHere({ linked: true, online: true, phase: 'stalled' })).toBe(true);
    expect(importsWaitHere({ linked: false, online: false })).toBe(false);
    expect(importsWaitHere({ linked: true, online: true, phase: 'synced' })).toBe(false);
    expect(importsWaitHere()).toBe(false);
  });
});

describe('Added by', () => {
  test('a named origin reads "Added by Tereza"; no name, or an e-mail, reads nothing', () => {
    expect(addedByLine({ addedBy: 'Tereza' })).toBe('Added by Tereza');
    expect(addedByLine({})).toBe('');
    expect(addedByLine(null)).toBe('');
    expect(addedByLine({ addedBy: 'tereza@example.com' })).toBe('');
    expect(addedByLine({ addedBy: '  ' })).toBe('');
  });
});

describe('asked once', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  };

  test('the first need asks, the next file does not; the two questions are separate', () => {
    const s = memory();
    expect(askNow('figma', s)).toBe(true);
    expect(askNow('figma', s)).toBe(false);
    expect(wasAsked('figma', s)).toBe(true);
    expect(wasAsked('google', s)).toBe(false);
    expect(askNow('google', s)).toBe(true);
  });

  test('connecting forgets it, so a removed key can ask again', () => {
    const s = memory();
    markAsked('google', s);
    clearAsked('google', s);
    expect(askNow('google', s)).toBe(true);
  });

  test('blocked storage means "ask", never a throw', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(askNow('figma', broken)).toBe(true);
    expect(() => clearAsked('figma', broken)).not.toThrow();
    expect(wasAsked('nonsense', memory())).toBe(false);
  });
});

describe('Add files…: one toast', () => {
  const realFetch = globalThis.fetch;
  let imported: Record<string, unknown> = {};
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    globalThis.fetch = (async (url: string) => {
      if (url.startsWith('/_api/index?part=assets'))
        return new Response(JSON.stringify({ seq: 1, history: 'ready', assets: [] }), {
          status: 200,
        });
      if (url.startsWith('/_api/import-asset'))
        return new Response(JSON.stringify(imported), { status: 200 });
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
  });

  async function dropHeic(props: Record<string, unknown>) {
    const { AssetsPanel } = await import('../client/v2/left-panel/assets-panel.jsx');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<AssetsPanel designRel=".design" {...props} />));
    await act(async () => new Promise((r) => setTimeout(r, 40)));
    const panel = host.querySelector('[data-testid="assets-panel"]') as HTMLElement;
    const ev = new window.Event('drop', { bubbles: true, cancelable: true }) as Event & {
      dataTransfer?: unknown;
    };
    ev.dataTransfer = {
      types: ['Files'],
      files: [new File([new Uint8Array([1, 2, 3])], 'IMG_5012.HEIC', { type: 'image/heic' })],
    };
    await act(async () => {
      panel.dispatchEvent(ev);
    });
    await act(async () => new Promise((r) => setTimeout(r, 80)));
  }

  test('a HEIC that came in as a JPG says so once; offline adds the Kept-on-this-Mac sentence', async () => {
    imported = { ok: true, path: 'assets/d34bb59d.jpg', converted: 'heic' };
    const seen: Array<[string, boolean]> = [];
    await dropHeic({ toast: (m: string, ok: boolean) => seen.push([m, ok]) });
    expect(seen).toEqual([['IMG_5012.HEIC came in as a JPG the canvas can show.', true]]);

    seen.length = 0;
    await dropHeic({
      toast: (m: string, ok: boolean) => seen.push([m, ok]),
      isOffline: () => true,
    });
    expect(seen).toEqual([
      [
        'IMG_5012.HEIC came in as a JPG the canvas can show. Kept on this Mac — goes up by itself once it’s online.',
        true,
      ],
    ]);
  });

  test('a refusal says its reason in words, and a studio that gave no toast changes nothing', async () => {
    imported = { ok: false, reason: 'not-on-mac' };
    const seen: Array<[string, boolean]> = [];
    await dropHeic({ toast: (m: string, ok: boolean) => seen.push([m, ok]) });
    expect(seen).toEqual([
      ['IMG_5012.HEIC comes in on a Mac. Here, add it as a PNG or JPG.', false],
    ]);
    await dropHeic({});
  });
});
