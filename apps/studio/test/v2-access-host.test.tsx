// S9.21b — the access host: the shell's one mount for the access states (10 co-ask-edit · co-access-ends ·
// co-trashed).
//
// Done when: the shell socket's `access` / `access-request` frames are read through the hub-notice readers
// (known keys only) · raised says "You can edit … now." and asks for a re-read · ended / link off are the cards,
// Back to Home runs `nav.home` · a request is the owner's toast whose Review opens Share · a read-only canvas's
// dead drag posts one bare `view-only-gesture` (no text) and the shell's tip says why · the open canvas in the
// shared Trash shows the banner, no tip, and is published for the mode lane (Viewing).
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ACCESS_FRAME_EVENT,
  getTrashedOpen,
  shellAccessFrame,
  VIEW_ONLY_EVENT,
} from '../client/v2/access/access-client.js';
import { AccessHost, AccessLayer, accessHostStep } from '../client/v2/access/access-host.jsx';
import { startsDeadDrag, viewOnlyGestureTracker } from '../view-only-gesture.tsx';

beforeAll(() => {
  if (typeof globalThis.document === 'undefined') GlobalRegistrator.register();
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

describe('shell frames', () => {
  test('access / access-request read through the hub-notice readers, known keys only', () => {
    expect(shellAccessFrame({ type: 'access', change: 'raised', grants: ['x'] })).toEqual({
      kind: 'raised',
    });
    expect(shellAccessFrame({ type: 'access', change: 'ended', reason: 'link-off' })).toEqual({
      kind: 'link-off',
    });
    expect(shellAccessFrame({ type: 'access', change: 'ended' })).toEqual({
      kind: 'ended',
      reason: 'removed',
    });
    const r = shellAccessFrame({
      type: 'access-request',
      id: 'r1',
      from: { name: `Petra ${'x'.repeat(200)}`, email: 'petra@x' },
      canvas: 'ui/Combine-kampan.tsx',
      note: '<b>hi</b>',
    });
    expect(r?.kind).toBe('request');
    expect(r?.id).toBe('r1');
    expect(r?.text.startsWith('Petra ')).toBe(true);
    expect(r?.text.endsWith(' asks to edit Combine-kampan')).toBe(true);
    expect(JSON.stringify(r)).not.toContain('petra@x');
    expect(JSON.stringify(r)).not.toContain('<b>');
    expect(shellAccessFrame({ type: 'maude.access', change: 'raised' })).toBeNull();
    expect(shellAccessFrame({ type: 'trash:changed' })).toBeNull();
  });

  test('a step: raised toasts the open canvas and re-reads; ended / link-off stay; a request says Review', () => {
    const s0 = { ended: null, linkOff: false };
    const at = { activePath: '.design/ui/Combine-kampan.tsx', designRel: '.design' };
    const up = accessHostStep(s0, { type: 'access', change: 'raised' }, at);
    expect(up.toast).toEqual({ title: 'You can edit Combine-kampan now.', kind: 'success' });
    expect(up.reread).toBe(true);
    expect(up.state).toBe(s0);
    expect(accessHostStep(s0, { type: 'access', change: 'narrowed' }, at)).toMatchObject({
      toast: null,
      reread: true,
    });
    expect(accessHostStep(s0, { type: 'access', change: 'ended' }, at).state.ended).toBe('removed');
    expect(
      accessHostStep(s0, { type: 'access', change: 'ended', reason: 'link-off' }, at).state.linkOff
    ).toBe(true);
    const req = accessHostStep(
      s0,
      { type: 'access-request', id: 'r1', from: { name: 'Petra' }, canvas: 'ui/A.tsx' },
      at
    );
    expect(req.toast).toMatchObject({
      title: 'Petra asks to edit A',
      action: 'Review',
      review: true,
    });
  });
});

describe('the layer', () => {
  test('ended is the card alone; the tip names the open canvas; a trashed canvas shows the banner, no tip', () => {
    const ended = renderToStaticMarkup(
      createElement(AccessLayer, { ended: 'removed', tip: true, project: 'Alligators brand' })
    );
    expect(ended).toContain('data-testid="access-ended"');
    expect(ended).toContain('You no longer have access to Alligators brand.');
    expect(ended).not.toContain('access-view-tip');
    const tip = renderToStaticMarkup(
      createElement(AccessLayer, { tip: true, canvas: 'ui/Combine-kampan.tsx' })
    );
    expect(tip).toContain('v2ac-tip v2ac-tip--shell');
    expect(tip).toContain('You can look at Combine-kampan, not change it.');
    const trashed = renderToStaticMarkup(
      createElement(AccessLayer, {
        tip: true,
        canvas: 'ui/Combine-cisla.tsx',
        canRestore: false,
        trashedItem: {
          id: 'canvas:e1',
          kind: 'canvas',
          path: 'ui/Combine-cisla.tsx',
          who: 'Tereza',
        },
      })
    );
    expect(trashed).toContain('data-testid="canvas-trashed-banner"');
    expect(trashed).not.toContain('canvas-trashed-restore');
    expect(trashed).not.toContain('access-view-tip');
  });
});

describe('the canvas side (view-only-gesture.tsx)', () => {
  test('a drag on the design posts once per quiet window; a field, a modifier or a click does not', () => {
    const body = document.createElement('div');
    body.className = 'dc-artboard-body';
    const text = document.createElement('p');
    const field = document.createElement('input');
    body.append(text, field);
    document.body.append(body);
    const outside = document.createElement('div');
    document.body.append(outside);
    expect(startsDeadDrag(text)).toBe(true);
    expect(startsDeadDrag(field)).toBe(false);
    expect(startsDeadDrag(outside)).toBe(false);

    let t = 1000;
    const post = mock(() => {});
    const g = viewOnlyGestureTracker({ post, now: () => t, quietMs: 30_000 });
    const drag = (target: Element, dx: number, extra: Record<string, unknown> = {}) => {
      g.down({ button: 0, clientX: 10, clientY: 10, target, ...extra });
      g.move({ clientX: 10 + dx, clientY: 10 });
      g.up();
    };
    drag(text, 3); // a click
    drag(field, 40);
    drag(text, 40, { metaKey: true });
    drag(outside, 40);
    expect(post).toHaveBeenCalledTimes(0);
    drag(text, 40);
    expect(post).toHaveBeenCalledTimes(1);
    t += 5000;
    drag(text, 40);
    expect(post).toHaveBeenCalledTimes(1);
    t += 30_000;
    drag(text, 40);
    expect(post).toHaveBeenCalledTimes(2);
    body.remove();
    outside.remove();
  });

  test('the message is bare: no text, no element, no position', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(import.meta.dir, '..', 'view-only-gesture.tsx'), 'utf8');
    expect(src.includes("postMessage({ dgn: 'view-only-gesture', v: 1 }, '*')")).toBe(true);
    const shell = readFileSync(join(import.meta.dir, '..', 'canvas-shell.tsx'), 'utf8');
    expect(shell.includes('{readOnly && <ViewOnlyGesture />}')).toBe(true);
  });
});

describe('the wiring', () => {
  test('app.jsx relays the shell frames and re-reads /_config on a raised / narrowed role', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const app = readFileSync(join(import.meta.dir, '..', 'client', 'app.jsx'), 'utf8');
    const at = app.indexOf("m.type === 'access' || m.type === 'access-request'");
    expect(at).toBeGreaterThan(0);
    const block = app.slice(at, app.indexOf('} else if', at));
    expect(block.includes("(m.change === 'raised' || m.change === 'narrowed')")).toBe(true);
    expect(block.includes('loadServerConfig();')).toBe(true);
    expect(block.includes('new CustomEvent(ACCESS_FRAME_EVENT, { detail: m })')).toBe(true);
  });

  test('the Share cluster mounts the host and its mode lane goes Viewing on a trashed canvas', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(import.meta.dir, '..', 'client', 'v2', 'shell', 'share-cluster-host.jsx'),
      'utf8'
    );
    expect(src.includes('canEdit: !viewerMode && !trashedOpen,')).toBe(true);
    expect(src.includes('<AccessHost')).toBe(true);
    const bridge = readFileSync(
      join(import.meta.dir, '..', 'client', 'hooks', 'use-canvas-bridge.jsx'),
      'utf8'
    );
    expect(bridge.includes('window.dispatchEvent(new CustomEvent(VIEW_ONLY_EVENT));')).toBe(true);
  });
});

describe('the host, mounted', () => {
  const realFetch = globalThis.fetch;
  let trashBody: unknown = { legacy: true };
  afterEach(() => {
    globalThis.fetch = realFetch;
    trashBody = { legacy: true };
  });
  function mount(props: Record<string, unknown>) {
    globalThis.fetch = (async (url: string) =>
      new Response(JSON.stringify(String(url) === '/_api/trash' ? trashBody : { entries: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    const el = document.createElement('div');
    document.body.append(el);
    const root = createRoot(el);
    const toast = mock((_n: unknown) => {});
    const run = mock((_id: string) => {});
    act(() => {
      root.render(
        createElement(AccessHost, {
          activePath: '.design/ui/Combine-kampan.tsx',
          designRel: '.design',
          tabs: [{ path: '.design/ui/Combine-kampan.tsx' }],
          project: 'Alligators brand',
          canEdit: true,
          toast,
          run,
          onOpenTab: () => {},
          ...props,
        })
      );
    });
    return {
      el,
      toast,
      run,
      unmount: () => {
        act(() => root.unmount());
        el.remove();
      },
    };
  }
  const frame = (detail: unknown) =>
    act(() => {
      window.dispatchEvent(new CustomEvent(ACCESS_FRAME_EVENT, { detail }));
    });

  test('a request toasts with Review → Share; ended dims the window, Back to Home runs nav.home', () => {
    const h = mount({});
    frame({
      type: 'access-request',
      id: 'r1',
      from: { name: 'Petra Malá' },
      canvas: 'ui/Combine-kampan.tsx',
    });
    expect(h.toast).toHaveBeenCalledTimes(1);
    const n = h.toast.mock.calls[0][0] as {
      title: string;
      action: { label: string; onClick: () => void };
    };
    expect(n.title).toBe('Petra Malá asks to edit Combine-kampan');
    expect(n.action.label).toBe('Review');
    n.action.onClick();
    expect(h.run).toHaveBeenCalledWith('share.open');
    frame({ type: 'access', change: 'raised' });
    expect((h.toast.mock.calls[1][0] as { title: string }).title).toBe(
      'You can edit Combine-kampan now.'
    );
    frame({ type: 'access', change: 'ended' });
    const home = h.el.querySelector('[data-testid="access-ended-home"]') as HTMLButtonElement;
    expect(home).not.toBeNull();
    act(() => home.click());
    expect(h.run).toHaveBeenCalledWith('nav.home');
    h.unmount();
  });

  test('the canvas’s dead drag shows the tip; the open canvas in the trash shows the banner and goes Viewing', async () => {
    const h = mount({});
    act(() => {
      window.dispatchEvent(new CustomEvent(VIEW_ONLY_EVENT));
    });
    expect(h.el.querySelector('[data-testid="access-view-tip"]')?.textContent).toContain(
      'You can look at Combine-kampan, not change it.'
    );
    h.unmount();
    expect(getTrashedOpen()).toBeNull();

    trashBody = {
      items: [
        {
          id: 'canvas:e1',
          kind: 'canvas',
          path: 'ui/Combine-kampan.tsx',
          who: 'Tereza',
          at: Date.now(),
        },
      ],
      canClear: false,
      seq: 2,
    };
    const t = mount({});
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(t.el.querySelector('[data-testid="canvas-trashed-banner"]')?.textContent).toContain(
      'Tereza moved Combine-kampan to the trash'
    );
    expect(getTrashedOpen()).toBe('ui/Combine-kampan.tsx');
    t.unmount();
    expect(getTrashedOpen()).toBeNull();
  });
});
