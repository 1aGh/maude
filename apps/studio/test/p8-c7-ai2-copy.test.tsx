// P8 stage C round 7 (p8-c7-ai2) — 03 ai-copy: "Copied from <name>" under the copy + the dashed link between the pair.
// The shell sends ids only (`ai-copies`, parent-gated); the canvas reads the name off its own artboard.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

let registeredHere = false;
beforeAll(async () => {
  if (typeof document === 'undefined') {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    GlobalRegistrator.register();
    registeredHere = true;
  }
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (registeredHere && GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AiCopyLinks, copyCaption, copyLinkGeometry } from '../artboard-ai-copies.tsx';
import { COPY_NOTE_MS, copyLinksFor } from '../client/v2/ai/runs-model.js';

describe('copyLinksFor — which artboards are copies of which (the ids only)', () => {
  const now = 5_000_000;
  const file = '.design/ui/C.tsx';
  const copyRun = (extra: Record<string, unknown> = {}) => ({
    runId: 'r1',
    state: 'ended',
    outcome: 'done',
    endedAt: now - 5000,
    label: 'Headline in one word (secret prompt)',
    scope: { canvas: 'ui/C.tsx', artboards: ['post-copy-a1b2c3'] },
    copyOf: { canvas: 'path:.design/ui/C.tsx', artboard: 'post' },
    ...extra,
  });
  const at = (view: unknown) => copyLinksFor(view, { activeCanvas: file, now });

  test('a run on a copy links the copy to the artboard it was copied from: ids, never a word of the ask', () => {
    const rows = at({ mine: [copyRun()] });
    expect(rows).toEqual([{ from: 'post', to: 'post-copy-a1b2c3' }]);
    expect(JSON.stringify(rows)).not.toContain('secret');
  });

  test('live runs link too; an old finished one, a failed one, a plain ask and another canvas do not', () => {
    expect(
      at({ mine: [copyRun({ state: 'running', endedAt: undefined, outcome: undefined })] })
    ).toHaveLength(1);
    expect(at({ mine: [copyRun({ endedAt: now - COPY_NOTE_MS - 1 })] })).toEqual([]);
    expect(at({ mine: [copyRun({ outcome: 'failed' })] })).toEqual([]);
    expect(at({ mine: [copyRun({ copyOf: undefined })] })).toEqual([]);
    expect(
      at({
        mine: [copyRun({ copyOf: { canvas: 'path:.design/ui/Other.tsx', artboard: 'post' } })],
      })
    ).toEqual([]);
  });
});

describe('the canvas side of ai-copy', () => {
  const box = (left: number, top: number, w: number, h: number) =>
    ({ left, top, right: left + w, bottom: top + h, width: w, height: h }) as DOMRect;

  test('the caption names the original; the link joins the facing edges at the middle of their overlap', () => {
    expect(copyCaption('Post 1:1 · Combine 2026')).toBe('Copied from Post 1:1');
    expect(copyCaption('Post 1:1')).toBe('Copied from Post 1:1');
    const from = box(100, 150, 260, 260);
    // beside: the gap between the original's right edge and the copy's left edge, at mid-overlap (150..370)
    expect(copyLinkGeometry(from, box(400, 110, 260, 260))).toEqual({
      x: 360,
      y: 260,
      w: 40,
      h: 0,
    });
    // below: a vertical link from the original's bottom to the copy's top, at mid-overlap
    expect(copyLinkGeometry(from, box(100, 450, 260, 260))).toEqual({
      x: 230,
      y: 410,
      w: 0,
      h: 40,
    });
  });

  const parent = { postMessage: () => {} };
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
  const say = (data: unknown, source: unknown = parent) => {
    const ev = new MessageEvent('message', { data });
    Object.defineProperty(ev, 'source', { value: source });
    window.dispatchEvent(ev);
  };

  test('draws the caption under the copy and a dashed link, only for the shell; [] takes them away', async () => {
    Object.defineProperty(window, 'parent', { value: parent, configurable: true });
    document.body.innerHTML = `<div id="root"></div>
      <div data-dc-screen="post" data-dc-label="Post 1:1 · Combine 2026"></div>
      <div data-dc-screen="post-copy-a1b2c3" data-dc-label="Post 1:1 · Combine 2026 · copy"></div>`;
    const rects: Record<string, DOMRect> = {
      post: box(100, 150, 260, 260),
      'post-copy-a1b2c3': box(400, 110, 260, 260),
    };
    for (const el of document.querySelectorAll('[data-dc-screen]'))
      (el as HTMLElement).getBoundingClientRect = () =>
        rects[el.getAttribute('data-dc-screen') ?? ''] as DOMRect;
    const root = createRoot(document.getElementById('root') as HTMLElement);
    await act(async () => {
      root.render(<AiCopyLinks />);
    });
    expect(document.querySelector('[data-testid="ai-copy-caption"]')).toBeNull();
    const msg = { dgn: 'ai-copies', v: 1, copies: [{ from: 'post', to: 'post-copy-a1b2c3' }] };
    // a sibling frame paints nothing
    await act(async () => {
      say(msg, { name: 'sibling' });
    });
    expect(document.querySelector('[data-testid="ai-copy-caption"]')).toBeNull();
    await act(async () => {
      say(msg);
    });
    await act(async () => {
      await frame();
      await frame();
    });
    const cap = document.querySelector('[data-testid="ai-copy-caption"]') as HTMLElement;
    expect(cap.textContent).toBe('Copied from Post 1:1');
    expect(cap.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(cap.style.left).toBe('400px');
    expect(cap.style.top).toBe('386px'); // 16 px under the copy's bottom (370)
    const link = document.querySelector('[data-testid="ai-copy-link"]') as HTMLElement;
    expect(link.style.left).toBe('360px');
    expect(link.style.top).toBe('260px');
    expect(link.style.width).toBe('40px');
    await act(async () => {
      say({ dgn: 'ai-copies', v: 1, copies: [] });
    });
    expect(document.querySelector('[data-testid="ai-copy-caption"]')).toBeNull();
    await act(async () => {
      root.unmount();
    });
  });
});

describe('the caption makes room for the AI tag when that tag sits below the copy', () => {
  test('a ring tag below the artboard (a narrow one) pushes the caption under it', async () => {
    const parent = { postMessage: () => {} };
    Object.defineProperty(window, 'parent', { value: parent, configurable: true });
    document.body.innerHTML = `<div id="root"></div>
      <div data-dc-screen="post" data-dc-label="Post 1:1"></div>
      <div data-dc-screen="copy" data-dc-label="Post 1:1 · copy"></div>
      <div class="dc-ai-ring" data-artboard="copy" data-at="below" style="display: block"></div>`;
    const box = (left: number, top: number, w: number, h: number) =>
      ({ left, top, right: left + w, bottom: top + h, width: w, height: h }) as DOMRect;
    const rects: Record<string, DOMRect> = {
      post: box(0, 0, 160, 160),
      copy: box(200, 0, 160, 160),
    };
    for (const el of document.querySelectorAll('[data-dc-screen]'))
      (el as HTMLElement).getBoundingClientRect = () =>
        rects[el.getAttribute('data-dc-screen') ?? ''] as DOMRect;
    const root = createRoot(document.getElementById('root') as HTMLElement);
    await act(async () => {
      root.render(<AiCopyLinks />);
    });
    const ev = new MessageEvent('message', {
      data: { dgn: 'ai-copies', v: 1, copies: [{ from: 'post', to: 'copy' }] },
    });
    Object.defineProperty(ev, 'source', { value: parent });
    await act(async () => {
      window.dispatchEvent(ev);
    });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    const cap = document.querySelector('[data-testid="ai-copy-caption"]') as HTMLElement;
    // 160 (bottom) + 16 (gap) + 24 (the tag's room) = 200
    expect(cap.style.top).toBe('200px');
    await act(async () => {
      root.unmount();
    });
  });
});

describe('the relay posts ai-copies to the open canvas', () => {
  const FILE = '.design/ui/C.tsx';
  const run = (extra: Record<string, unknown> = {}) => ({
    runId: 'r_1',
    state: 'running',
    label: 'SECRET prompt',
    scope: { canvas: 'ui/C.tsx', artboards: ['post-copy-a1b2c3'] },
    copyOf: { canvas: `path:${FILE}`, artboard: 'post' },
    leases: [],
    waiting: [],
    ...extra,
  });

  test('the frame hears the pair once, ids only; an ended-and-old run is []', async () => {
    const { createRingsLane } = await import('../client/v2/ai/ring-relay.js');
    const { createRunsStore } = await import('../client/v2/ai/runs-store.js');
    let body: Record<string, unknown> = { seq: 1, mine: [run()], others: [] };
    const fetchImpl = (async () =>
      new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    const store = createRunsStore({ fetchImpl, target: new EventTarget() as unknown as Window });
    document.body.innerHTML = '';
    const sent: Array<Record<string, unknown>> = [];
    const el = document.createElement('iframe');
    el.setAttribute('data-testid', 'canvas-frame');
    el.setAttribute('src', 'http://127.0.0.1:4401/_canvas-shell.html'); // V2-8.9 L2: the relay posts to the frame's origin
    el.setAttribute('data-path', FILE);
    Object.defineProperty(el, 'contentWindow', {
      value: { postMessage: (m: Record<string, unknown>) => sent.push(m) },
    });
    document.body.append(el);
    const stop = createRingsLane({ store, doc: document, win: window });
    await store.refresh();
    const msgs = () => sent.filter((m) => m.dgn === 'ai-copies');
    expect(msgs()).toEqual([
      { dgn: 'ai-copies', v: 1, copies: [{ from: 'post', to: 'post-copy-a1b2c3' }] },
    ]);
    expect(JSON.stringify(sent)).not.toContain('SECRET');
    await store.refresh();
    expect(msgs()).toHaveLength(1);
    body = { seq: 2, mine: [], others: [] };
    await store.refresh();
    expect(msgs().at(-1)).toEqual({ dgn: 'ai-copies', v: 1, copies: [] });
    stop();
  });
});
