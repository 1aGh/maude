// S8.15 (12 · ia-photo-inspector · ia-photo-steps) — the Photo tab edits ONE use: it seeds from the use's own edit,
// previews on that use, commits as the per-use file then `photo.use-edit` through /_api/edit-op (one undo step),
// Reset points the use back at every use, and "Apply to every use…" is a sheet driven by the server's answer.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type Call = { url: string; method: string; body: unknown };

const ASSET = 'assets/abcdef12.jpg';
const EDIT8 = '0123abcd';
const NEW8 = 'feedbeef';
const PUNCHY_EVERY = { adjustments: { contrast: 0.25, brightness: 0.04 } };
const OWN = { adjustments: { grayscale: 1 } };

let calls: Call[];
let answer: { uses: unknown[]; canApply: boolean; reason?: string };
let putAnswer: () => unknown;
let host: HTMLDivElement;
let root: Root;
let mod: typeof import('../client/v2/photo/photo-section.jsx');
let panel: typeof import('../client/inspector/inspector-panel.jsx');

const fakeFetch = (async (input: string, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ url, method, body });
  const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status });
  if (url.startsWith('/_api/photo-every-use') && method === 'GET')
    return json({ ok: true, ...answer });
  if (url.startsWith('/_api/photo-every-use') && method === 'POST')
    return json({ ok: true, path: 'assets/abcdef12.photo.json', canvases: [] });
  if (url.startsWith('/_api/photo-edit') && method === 'PUT') return json(putAnswer());
  if (url.startsWith('/_api/photo-edit') && url.includes('&edit=')) return json(OWN);
  if (url.startsWith('/_api/photo-edit')) return json(PUNCHY_EVERY);
  if (url === '/_api/edit-op') return json({ ok: true, writeId: 'w1', actionId: null });
  return json({}, 404);
}) as unknown as typeof fetch;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = async (ms = 30) => {
  await act(async () => {
    await sleep(ms);
  });
};
const $ = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = async (id: string) => {
  await act(async () => {
    $(id)?.click();
  });
};

beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mod = await import('../client/v2/photo/photo-section.jsx');
  panel = await import('../client/inspector/inspector-panel.jsx');
});
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => {
  calls = [];
  answer = {
    uses: [
      { canvas: 'ui/score.tsx', name: 'score', artboards: ['Post 4:5 · MVP'], own: 1 },
      { canvas: 'ui/web.tsx', name: 'web', artboards: ['Desktop · Hráči'], own: 0 },
      { canvas: 'ui/recap.tsx', name: 'recap', artboards: ['16:9'], own: 0 },
    ],
    canApply: true,
  };
  putAnswer = () => ({ ok: true, path: `assets/abcdef12.${NEW8}.photo.json`, edit: NEW8 });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const el = (attrs: Record<string, string> = {}) => ({
  id: 'photo',
  index: 0,
  artboardId: 'mvp',
  file: 'ui/score.tsx',
  tag: 'img',
  photoAsset: ASSET,
  attrs: { src: ASSET, ...attrs },
});

async function mount(props: Record<string, unknown> = {}) {
  const previews: unknown[][] = [];
  const records: unknown[] = [];
  await act(async () => {
    root.render(
      createElement(mod.PhotoSection, {
        asset: ASSET,
        el: el(),
        fetchImpl: fakeFetch,
        onPreview: (e: unknown, use: unknown) => previews.push([e, use]),
        onRecordEdit: (r: unknown) => records.push(r),
        onRemoveBackground: async () => ({ maskAsset: 'assets/99999999.png' }),
        ...props,
      })
    );
  });
  await settle();
  return { previews, records };
}

describe('seed', () => {
  test('a use with its own edit starts from it', async () => {
    await mount({ el: el({ 'data-photo-edit': EDIT8 }) });
    expect(calls[0]?.url).toBe(`/_api/photo-edit?asset=${encodeURIComponent(ASSET)}&edit=${EDIT8}`);
    expect($('photo-look-mono')?.getAttribute('aria-checked')).toBe('true');
    expect($('photo-section')?.dataset.edit).toBe(EDIT8);
  });

  test('a use without one starts from the every-use edit', async () => {
    await mount();
    expect(calls.some((c) => c.url.includes('&edit='))).toBe(false);
    expect($('photo-look-punchy')?.getAttribute('aria-checked')).toBe('true');
  });
});

describe('a change lands on this use only', () => {
  test('a look previews on the use, then writes the per-use file and photo.use-edit', async () => {
    const { previews, records } = await mount();
    await click('photo-look-warmer');
    expect(previews.at(-1)).toEqual([{ adjustments: { sepia: 0.35 } }, 'photo']);
    await settle(260);
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe(`/_api/photo-edit?asset=${encodeURIComponent(ASSET)}&perUse=1`);
    expect(put?.body).toEqual({ adjustments: { sepia: 0.35 } });
    // nothing writes the every-use file
    expect(calls.some((c) => c.method === 'PUT' && !c.url.includes('perUse=1'))).toBe(false);
    const op = calls.find((c) => c.url === '/_api/edit-op');
    expect(op?.body).toEqual({
      file: 'ui/score.tsx',
      op: 'photo.use-edit',
      targets: [{ artboard: 'mvp', element: 'photo' }],
      params: { edit: NEW8 },
    });
    expect(records).toEqual([
      { op: 'edit-op', writeId: 'w1', label: 'Edited this use of a photo' },
    ]);
    expect($('photo-section')?.dataset.edit).toBe(NEW8);
  });

  test('the same bytes again write no second edit-op', async () => {
    putAnswer = () => ({ ok: true, path: 'x', edit: EDIT8 });
    await mount({ el: el({ 'data-photo-edit': EDIT8 }) });
    await click('photo-look-mono');
    await settle(260);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(calls.some((c) => c.url === '/_api/edit-op')).toBe(false);
  });

  test('a refused per-use write says so and touches no TSX', async () => {
    putAnswer = () => ({ ok: false, status: 403, error: 'no' });
    await mount();
    await click('photo-look-night');
    await settle(260);
    expect($('photo-error')?.textContent).toBe('Not changed; try again.');
    expect(calls.some((c) => c.url === '/_api/edit-op')).toBe(false);
  });

  test('Reset points the use back at every use and shows that look', async () => {
    const { previews } = await mount({ el: el({ 'data-photo-edit': EDIT8 }) });
    await click('photo-reset');
    await settle(60);
    const op = calls.find((c) => c.url === '/_api/edit-op');
    expect((op?.body as { params?: unknown } | undefined)?.params).toEqual({ edit: null });
    expect(previews.at(-1)).toEqual([PUNCHY_EVERY, 'photo']);
    expect($('photo-section')?.dataset.edit).toBeUndefined();
  });

  test('✦ Remove background adds the cut-out on this use; the switch takes it off', async () => {
    const { previews } = await mount();
    await click('photo-ai-remove-bg');
    await settle();
    expect(previews.at(-1)?.[0]).toMatchObject({
      backgroundRemoved: { enabled: true, maskAsset: 'assets/99999999.png' },
    });
    expect($('photo-cutout-switch')?.textContent).toContain('Background removed');
  });

  test('the Image section’s ✦ asks for the cut-out on the way in, once', async () => {
    let asked = 0;
    let used = 0;
    await mount({
      intent: 'remove-background',
      onIntentUsed: () => used++,
      onRemoveBackground: async () => {
        asked++;
        return { maskAsset: 'assets/99999999.png' };
      },
    });
    await settle();
    expect([asked, used]).toEqual([1, 1]);
  });
});

describe('Only this use changes', () => {
  test('names how many more canvases show it', async () => {
    await mount();
    expect($('photo-scope-line')?.textContent).toBe(
      'abcdef12.jpg is in 2 more canvases — they keep the original. Reset brings this one back too.'
    );
  });

  test('the open canvas in the shell form (.design/ui/score.tsx) is not counted as another canvas', async () => {
    await mount({ el: { ...el(), file: '.design/ui/score.tsx' } });
    expect($('photo-scope-line')?.textContent).toBe(
      'abcdef12.jpg is in 2 more canvases — they keep the original. Reset brings this one back too.'
    );
    await click('photo-every-use-open');
    const rows = [...host.querySelectorAll<HTMLElement>('[data-testid="photo-every-use-row"]')];
    expect(rows.map((r) => r.dataset.canvas)).toEqual(['ui/web.tsx', 'ui/recap.tsx']);
  });

  test('a picture used in one other canvas says "1 more canvas" from the shell form', async () => {
    answer = { ...answer, uses: answer.uses.slice(0, 2) };
    await mount({ el: { ...el(), file: '.design/ui/score.tsx' } });
    expect($('photo-scope-line')?.textContent).toBe(
      'abcdef12.jpg is in 1 more canvas — they keep the original. Reset brings this one back too.'
    );
  });

  test('a custom design root is honoured', async () => {
    answer = { ...answer, uses: answer.uses.slice(0, 2) };
    await mount({ el: { ...el(), file: 'docs/design/ui/score.tsx' }, designRel: 'docs/design' });
    expect($('photo-scope-line')?.textContent).toContain('is in 1 more canvas —');
  });

  test('the sheet names each other canvas and applies through the server', async () => {
    const { previews } = await mount();
    await click('photo-every-use-open');
    expect($('photo-every-use-title')?.textContent).toBe('Apply Punchy to every use?');
    const rows = [...host.querySelectorAll<HTMLElement>('[data-testid="photo-every-use-row"]')];
    expect(rows.map((r) => r.dataset.canvas)).toEqual(['ui/web.tsx', 'ui/recap.tsx']);
    await click('photo-every-use-apply');
    await settle();
    const post = calls.find((c) => c.url === '/_api/photo-every-use' && c.method === 'POST');
    expect(post?.body).toEqual({ asset: ASSET, edit: PUNCHY_EVERY });
    expect($('photo-every-use-sheet')).toBeNull();
    expect(previews.at(-1)).toEqual([PUNCHY_EVERY, undefined]);
  });

  test('⌘K "Apply to every use…" opens the same sheet', async () => {
    const { runInspectorAction } = await import('../client/v2/inspector/inspector-actions.js');
    await mount();
    await act(async () => {
      await runInspectorAction('photo.apply-every-use');
    });
    expect($('photo-every-use-sheet')).not.toBeNull();
  });

  test('when the session may not change every canvas, Apply is disabled and says why', async () => {
    answer = { ...answer, canApply: false, reason: 'Ask the owner to change this.' };
    await mount();
    await click('photo-every-use-open');
    expect(($('photo-every-use-apply') as HTMLButtonElement).disabled).toBe(true);
    expect($('photo-every-use-refused')?.textContent).toBe('Ask the owner to change this.');
    await click('photo-every-use-apply');
    expect(calls.some((c) => c.method === 'POST' && c.url === '/_api/photo-every-use')).toBe(false);
  });
});

describe('Advanced', () => {
  test('every knob is there, controlled: its change lands on this use, not the every-use file', async () => {
    await mount();
    await click('fold-inspector.photo-toggle');
    const knobs = $('photo-knobs');
    expect(knobs).not.toBeNull();
    const before = calls.length;
    const reset = host.querySelector<HTMLButtonElement>('[aria-label="reset Adjustments section"]');
    await act(async () => reset?.click());
    await settle(260);
    const fresh = calls.slice(before);
    // the controlled knobs fetched nothing and wrote nothing themselves
    expect(fresh.some((c) => c.method === 'PUT' && !c.url.includes('perUse=1'))).toBe(false);
    expect(fresh.find((c) => c.method === 'PUT')?.body).toEqual({});
  });
});

describe('wiring', () => {
  test('photo-preview names the use only when there is one', () => {
    expect(mod.photoPreviewMessage(ASSET, OWN, 'photo')).toEqual({
      dgn: 'photo-preview',
      asset: ASSET,
      edit: OWN,
      use: 'photo',
    });
    expect(mod.photoPreviewMessage(ASSET, null, undefined)).toEqual({
      dgn: 'photo-preview',
      asset: ASSET,
      edit: null,
    });
  });

  test('per use: an artboard picture with an id; an annotation image keeps v1', () => {
    const pic = el();
    expect(panel.isPhotoPerUse({ asset: ASSET, kind: 'artboard-img' }, pic)).toBe(true);
    expect(panel.isPhotoPerUse({ asset: ASSET, kind: 'annotation-image' }, null)).toBe(false);
    expect(panel.isPhotoPerUse({ asset: ASSET, kind: 'artboard-img' }, { ...pic, id: '' })).toBe(
      false
    );
    // a wrapper resolved by scanning its HTML is not the picture
    expect(
      panel.isPhotoPerUse({ asset: ASSET, kind: 'artboard-img' }, { ...pic, photoAsset: undefined })
    ).toBe(false);
  });
});

// P8 round 7 (12 · ia-photo-inspector): the board's photo inspector draws Placement · Fill · Fit · Crop under the file's name,
// and Light / Colour as a track with its value as words — no number box beside it.
describe('the board’s photo inspector', () => {
  test('Placement is Fill · Fit · Crop, asked as image.crop', async () => {
    const asks: unknown[] = [];
    await mount({
      onRunAction: (m: unknown) => asks.push(m),
      el: { ...el(), refs: [{ artboard: 'mvp', element: 'photo' }] },
    });
    const row = $('photo-placement');
    expect(row?.textContent).toContain('Placement');
    const buttons = [...(row?.querySelectorAll('button') ?? [])];
    expect(buttons.map((b) => b.textContent)).toEqual(['Fill', 'Fit', 'Crop']);
    await act(async () => {
      buttons.find((b) => b.textContent === 'Crop')?.click();
    });
    expect(asks).toEqual([
      {
        dgn: 'run-action',
        v: 1,
        id: 'image.crop',
        params: { targets: [{ artboard: 'mvp', element: 'photo' }], fit: 'crop' },
      },
    ]);
    // the segment shows the ask at once, and Crop says what it does to the photo
    expect($('photo-crop-line')?.textContent).toBe('The whole photo stays — only the frame moves.');
  });

  test('Light and Colour have a track and a value, not a number field', async () => {
    await mount();
    for (const id of ['photo-light', 'photo-colour']) {
      expect($(id)?.querySelector('input')).toBeNull();
      expect($(id)?.querySelector('.ph-sl-v')?.textContent).toMatch(/^[+−-]?\d+$/);
    }
  });
});
