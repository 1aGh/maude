// S7.22 — the Safe zones section of the artboard inspector (08 ak-safe-zones): the platform select writes the
// `safeZones` prop through the one edit-op route, "Show on canvas" is the person's own view state, and the
// section is drawn for a fixed-size or video artboard only. Real markup, real registry; only fetch is faked.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type Sent = { url: string; method: string; body: unknown };
const sent: Sent[] = [];
let answer: (url: string, method: string) => Response = () =>
  new Response(JSON.stringify({ ok: true, writeId: 'w1', actionId: null }), { status: 200 });
const realFetch = globalThis.fetch;
const seated: Array<() => void> = [];

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    sent.push({
      url: String(url),
      method,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return answer(String(url), method);
  }) as unknown as typeof fetch;
});
afterAll(() => {
  for (const off of seated.splice(0)) off();
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
async function mount(el: React.ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el));
  await settle();
  return host;
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const must = (el: Element | null, what: string) => {
  if (!el) throw new Error(`missing ${what}`);
  return el as HTMLElement;
};

const FILE = '.design/ui/Matchday.tsx';
const STORY = (attrs: Record<string, string> = {}) => ({
  selector: '[data-dc-screen="story"]',
  tag: 'article',
  artboardId: 'story',
  file: FILE,
  attrs: { 'data-dc-kind': 'digital', ...attrs },
  bounds: { x: 0, y: 0, w: 1080, h: 1920 },
  worldW: 1080,
  worldH: 1920,
});

async function frame(el: ReturnType<typeof STORY>) {
  if (!seated.length) {
    const { registerSlot } = await import('../client/v2/inspector/slots.js');
    const sz = await import('../client/v2/inspector/sections/safe-zones.jsx');
    sz.offSafeZones();
    seated.push(
      registerSlot('safe-zones', {
        id: 'safe-zones.artboard',
        order: 10,
        kinds: ['artboard'],
        when: ({ selection }: { selection: unknown }) => {
          const e = (Array.isArray(selection) ? selection[0] : selection) as never;
          return ['digital', 'video'].includes(sz.artboardKindOf(e));
        },
        Body: sz.SafeZonesBody,
      })
    );
  }
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  sent.length = 0;
  return mount(
    <InspectorFrame
      {...({
        selected: el,
        layersTree: null,
        cfg: { designRel: '.design', designSystems: [], defaultDesignSystem: '' },
        canvasFile: FILE,
        onOptimistic: () => {},
        onRecordEdit: () => {},
        onReplaceMedia: () => {},
        onUndoRedo: () => {},
      } as never)}
    />
  );
}
const pick = async (el: Element | null, value: string) => {
  const e = must(el, 'select') as HTMLSelectElement;
  await act(async () => {
    e.value = value;
    e.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await settle();
};

describe('which artboards get the section', () => {
  test('a fixed-size artboard and a video artboard do; a web page and a print sheet do not', async () => {
    expect(q(await frame(STORY()), 'insp-sec-safe-zones')).not.toBeNull();
    expect(
      q(await frame(STORY({ 'data-dc-kind': 'video' })), 'insp-sec-safe-zones')
    ).not.toBeNull();
    expect(q(await frame(STORY({ 'data-dc-kind': 'web' })), 'insp-sec-safe-zones')).toBeNull();
    expect(q(await frame(STORY({ 'data-dc-kind': 'print' })), 'insp-sec-safe-zones')).toBeNull();
  });

  test('the section is titled "Safe zones" and the select is the canvas menu, None first', async () => {
    const host = await frame(STORY());
    expect(q(host, 'insp-sec-safe-zones')?.getAttribute('aria-label')).toBe('Safe zones');
    const sel = must(q(host, 'insp-safe-zones'), 'select') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual([
      'None',
      'Instagram story',
      'Instagram Reels',
      'Instagram profile grid',
      'TikTok',
      'YouTube Shorts',
      'Facebook event cover',
    ]);
    expect(sel.value).toBe('');
  });

  test('the foot (a chosen platform only) says never exported and carries the date; None has no foot', async () => {
    expect(q(await frame(STORY()), 'insp-safe-zones-foot')).toBeNull();
    const host = await frame(STORY({ 'data-dc-safe-zones': 'instagram-story' }));
    expect(q(host, 'insp-safe-zones-foot')?.textContent).toBe(
      'Shown on the canvas only — never exported. Zones as each platform publishes them, checked Oct 2026.'
    );
  });
});

describe('the artboard already has a zone', () => {
  test('the select shows it, "Show on canvas" appears, and so does the platform\'s note', async () => {
    const host = await frame(STORY({ 'data-dc-safe-zones': 'instagram-reels' }));
    expect((q(host, 'insp-safe-zones') as HTMLSelectElement).value).toBe('instagram-reels');
    expect(q(host, 'insp-row-safe-zones-show')).not.toBeNull();
    expect(q(host, 'insp-safe-zones-note')?.textContent).toContain('Caption and audio');
  });

  test('no zone, no "Show on canvas" row; an id this build does not know reads as None', async () => {
    expect(q(await frame(STORY()), 'insp-row-safe-zones-show')).toBeNull();
    const host = await frame(STORY({ 'data-dc-safe-zones': 'snapchat' }));
    expect((q(host, 'insp-safe-zones') as HTMLSelectElement).value).toBe('');
  });
});

describe('writes', () => {
  test('picking a platform is one artboard.set-safe-zones edit-op for this artboard', async () => {
    const host = await frame(STORY());
    await pick(q(host, 'insp-safe-zones'), 'tiktok');
    const post = sent.find((s) => s.method === 'POST');
    expect(post?.url).toBe('/_api/edit-op');
    expect(post?.body).toEqual({
      file: FILE,
      op: 'artboard.set-safe-zones',
      targets: [],
      params: { artboard: 'story', preset: 'tiktok' },
    });
  });

  test('None clears it (preset null)', async () => {
    const host = await frame(STORY({ 'data-dc-safe-zones': 'tiktok' }));
    await pick(q(host, 'insp-safe-zones'), '');
    const post = sent.find((s) => s.method === 'POST');
    expect(
      (post?.body as { params?: { preset?: unknown } } | undefined)?.params?.preset
    ).toBeNull();
  });

  test('a refusal comes back as a plain line and the select returns to what is on disk', async () => {
    answer = () =>
      new Response(JSON.stringify({ ok: false, code: 'held-by-ai', message: 'x' }), {
        status: 409,
      });
    const host = await frame(STORY());
    await pick(q(host, 'insp-safe-zones'), 'tiktok');
    expect(q(host, 'insp-safe-zones-said')?.textContent).toBe(
      'Not changed. This belongs to AI until it’s done; Stop is in the AI chat.'
    );
    expect((q(host, 'insp-safe-zones') as HTMLSelectElement).value).toBe('');
    answer = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  test('"Show on canvas" is view state: a PATCH of overlays.safeZones, no edit-op, and the canvas is told', async () => {
    answer = (_u, m) =>
      m === 'GET'
        ? new Response(JSON.stringify({ overlays: {} }), { status: 200 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 });
    const heard: unknown[] = [];
    window.addEventListener('maude:canvas-view-chrome', (e) =>
      heard.push((e as CustomEvent).detail)
    );
    const host = await frame(STORY({ 'data-dc-safe-zones': 'instagram-reels' }));
    const box = must(q(host, 'insp-safe-zones-show')?.querySelector('input') ?? null, 'switch');
    expect((box as HTMLInputElement).checked).toBe(true); // shown unless turned off
    await act(async () => {
      box.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await settle();
    const patch = sent.find((s) => s.method === 'PATCH');
    expect(patch?.url).toBe('/_api/canvas-meta');
    expect(patch?.body).toEqual({ file: FILE, patch: { overlays: { safeZones: false } } });
    expect(sent.some((s) => s.url === '/_api/edit-op')).toBe(false);
    expect(heard).toEqual([{ canvas: FILE, patch: { safeZones: false } }]);
  });

  test('a canvas whose view state says it was turned off opens with the switch off', async () => {
    answer = (_u, m) =>
      m === 'GET'
        ? new Response(JSON.stringify({ overlays: { safeZones: false } }), { status: 200 })
        : new Response('{}', { status: 200 });
    const host = await frame(STORY({ 'data-dc-safe-zones': 'tiktok' }));
    const box = must(q(host, 'insp-safe-zones-show')?.querySelector('input') ?? null, 'switch');
    expect((box as HTMLInputElement).checked).toBe(false);
  });
});
