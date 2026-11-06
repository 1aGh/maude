// 2.0.7 B2 (decision `v2-207-pages-view`) — the shell's half of Canvas | Pages.
//
//   · while the active canvas shows Pages, Preview and Present are OFF: the mode owner refuses them, the registry
//     greys their rows (menu, ⌘K, keys) and the switch greys its buttons with the reason — never hidden
//   · Pages itself is a registry toggle (Menu › View, ⌘K, "?"), run in the canvas over `run-action`
//   · the paging keys come from the registry: PageDown / PageUp, and → / ← only with nothing selected
//   · the canvas tells the shell over the typed bridge (`pages-view`, active canvas only)
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { canvasKeyIndex, resolveCanvasKey } from '../actions/canvas-keys.ts';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { PROJECT_MENU as MENU } from '../actions/menu.ts';
import { isEnabled } from '../actions/resolve.ts';
import { acceptFromCanvas } from '../bridge/dgn-protocol.ts';
import { createShellMode } from '../client/v2/shell/canvas-mode.js';
import { ModeSwitch, PAGES_REASON } from '../client/v2/shell/mode-switch.jsx';
import { pagesPickBody, savePagesPick } from '../client/v2/shell/pages-pick.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';

const def = (id: string) => {
  const d = ACTIONS_BY_ID.get(id);
  if (!d) throw new Error(`no action ${id}`);
  return d;
};

describe('the mode owner holds Preview and Present off while the canvas shows Pages', () => {
  test('select(preview) and present() are refused in Pages, allowed again in Canvas', () => {
    const m = createShellMode();
    expect(m.pages(true)).toBe(true);
    m.select('preview');
    expect(m.get().mode).toBe('edit');
    expect(m.present({ kind: 'artboards', from: 'start' })).toBe(false);
    expect(m.get().mode).toBe('edit');
    // Edit stays reachable (it is where Pages lives)
    m.select('edit');
    expect(m.get().mode).toBe('edit');
    expect(m.pages(false)).toBe(true);
    m.select('preview');
    expect(m.get().mode).toBe('preview');
  });

  test('the same answer twice changes nothing', () => {
    const m = createShellMode();
    expect(m.pages(false)).toBe(false);
    m.pages(true);
    expect(m.pages(true)).toBe(false);
  });
});

describe('the registry: Pages, its paging, and Preview / Present greyed in Pages', () => {
  test('view.pages is a canvas toggle in Menu › View, ⌘K and the "?" sheet', () => {
    const d = def('view.pages');
    expect(d.kind).toBe('toggle');
    expect(d.exec).toBe('canvas');
    expect(d.label).toBe('Pages');
    expect(d.help?.group).toBe('canvas');
    const view = MENU.find((n) => 'submenu' in n && n.submenu === 'View') as {
      items: Array<{ id?: string }>;
    };
    expect(view.items.some((i) => i.id === 'view.pages')).toBe(true);
    // Edit and Viewing only; not while presenting
    expect(isEnabled(d, menuCtx({ canvasOpen: true }))).toBe(true);
    expect(isEnabled(d, menuCtx({ canvasOpen: true, presenting: true }))).toBe(false);
    expect(isEnabled(d, menuCtx({ canvasOpen: false }))).toBe(false);
  });

  test('Preview and every way into Present are greyed (never hidden) in Pages, with a note', () => {
    const on = menuCtx({ canvasOpen: true, pagesView: true });
    const off = menuCtx({ canvasOpen: true });
    for (const id of [
      'mode.preview',
      'present.from-selection',
      'present.from-start',
      'present.canvas',
    ]) {
      const d = def(id);
      expect([id, isEnabled(d, off)]).toEqual([id, true]);
      expect([id, isEnabled(d, on)]).toEqual([id, false]);
      expect(d.visible?.notFacts ?? []).not.toContain('pagesView');
      expect(d.search?.note).toBe('switch to Canvas first');
    }
  });

  test('Next / Previous page are on only in Pages', () => {
    for (const id of ['pages.next', 'pages.prev']) {
      expect(isEnabled(def(id), menuCtx({ canvasOpen: true }))).toBe(false);
      expect(isEnabled(def(id), menuCtx({ canvasOpen: true, pagesView: true }))).toBe(true);
    }
  });
});

describe('the paging keys, from the registry in the canvas document', () => {
  const index = canvasKeyIndex(['pages.next', 'pages.prev']);
  const key = (k: string, mode = 'edit', selection: 'none' | 'object' = 'none') =>
    resolveCanvasKey(index, { key: k } as never, false, mode as never, true, selection);

  test('PageDown / PageUp page in Edit and Viewing', () => {
    expect(key('PageDown')).toBe('pages.next');
    expect(key('PageUp')).toBe('pages.prev');
    expect(key('PageDown', 'viewing')).toBe('pages.next');
  });

  test('→ / ← page only with nothing selected (a selection’s arrows nudge it)', () => {
    expect(key('ArrowRight')).toBe('pages.next');
    expect(key('ArrowLeft')).toBe('pages.prev');
    expect(key('ArrowRight', 'edit', 'object')).toBeNull();
  });

  test('not in Preview or Present (Present has its own → ←)', () => {
    expect(key('PageDown', 'preview')).toBeNull();
    expect(key('ArrowRight', 'present')).toBeNull();
  });

  test('never while typing', () => {
    expect(
      resolveCanvasKey(index, { key: 'ArrowRight' } as never, true, 'edit', true, 'none')
    ).toBe(null);
  });
});

describe('the switch greys Preview and Present with the reason in Pages', () => {
  const caps = { edit: true, preview: true, present: true, comment: true };
  const render = (pages: boolean) =>
    renderToStaticMarkup(<ModeSwitch mode="edit" caps={caps} canPresent pages={pages} />);
  const button = (html: string, testid: string) =>
    html.match(new RegExp(`<button[^>]*data-testid="${testid}"[^>]*>`))?.[0] ?? '';

  test('Pages on: disabled, and each says why', () => {
    const html = render(true);
    for (const id of ['palette-mode-preview', 'palette-mode-present', 'mode-present-menu']) {
      const b = button(html, id);
      expect([id, b.includes('disabled=""')]).toEqual([id, true]);
      expect([id, b.includes(`title="${PAGES_REASON}"`)]).toEqual([id, true]);
    }
    // Edit stays a live button
    expect(button(html, 'palette-mode-edit').includes('disabled=""')).toBe(false);
  });

  test('Canvas: nothing greyed', () => {
    const html = render(false);
    for (const id of ['palette-mode-preview', 'palette-mode-present', 'mode-present-menu'])
      expect([id, button(html, id).includes('disabled=""')]).toEqual([id, false]);
  });
});

describe('the bridge: `pages-view` from the active canvas only', () => {
  const ORIGIN = 'http://canvas.test';
  const active = { name: 'active' } as unknown as Window;
  const sibling = { name: 'sibling' } as unknown as Window;
  const ev = (data: unknown, source: unknown) =>
    ({ data, source, origin: ORIGIN }) as unknown as MessageEvent;
  const ctx = { canvasOrigin: ORIGIN, active };

  test('a well-formed report is accepted from the active canvas, junk and siblings are not', () => {
    const msg = { dgn: 'pages-view', v: 1, on: true, index: 1, total: 6 };
    expect(acceptFromCanvas(ev({ ...msg, extra: 'x' }, active), ctx)).toEqual(msg as never);
    expect(acceptFromCanvas(ev(msg, sibling), ctx)).toBeNull();
    expect(acceptFromCanvas(ev({ ...msg, on: 'yes' }, active), ctx)).toBeNull();
    expect(acceptFromCanvas(ev({ ...msg, v: 2 }, active), ctx)).toBeNull();
  });
});

describe('the shell remembers the pick for the canvas it has open (main origin, the view file)', () => {
  test('the body names the open canvas and only `canvasView`', () => {
    expect(pagesPickBody('.design/ui/Six.tsx', '.design', 'pages')).toEqual({
      file: '.design/ui/Six.tsx',
      patch: { canvasView: 'pages' },
    });
    expect(pagesPickBody('ui/Six.tsx', '.design', 'canvas')).toEqual({
      file: '.design/ui/Six.tsx',
      patch: { canvasView: 'canvas' },
    });
    // nothing open, the Design system tab, a path that climbs out, or a value that is not a view: nothing
    expect(pagesPickBody(null, '.design', 'pages')).toBeNull();
    expect(pagesPickBody('__system__', '.design', 'pages')).toBeNull();
    expect(pagesPickBody('ui/../../secrets.tsx', '.design', 'pages')).toBeNull();
    expect(pagesPickBody('.design/ui/Six.tsx', '.design', 'slides')).toBeNull();
  });

  test('one PATCH to /_api/canvas-meta', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}');
    };
    await savePagesPick('.design/ui/Six.tsx', '.design', 'pages', fake as never);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/_api/canvas-meta');
    expect(calls[0].init.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      file: '.design/ui/Six.tsx',
      patch: { canvasView: 'pages' },
    });
  });

  test('`pages-pick` from the active canvas only, a closed set of views', () => {
    const ORIGIN = 'http://canvas.test';
    const active = { name: 'active' } as unknown as Window;
    const ev = (data: unknown, source: unknown) =>
      ({ data, source, origin: ORIGIN }) as unknown as MessageEvent;
    const ctx = { canvasOrigin: ORIGIN, active };
    const msg = { dgn: 'pages-pick', v: 1, view: 'pages' };
    expect(acceptFromCanvas(ev(msg, active), ctx)).toEqual(msg as never);
    expect(acceptFromCanvas(ev({ ...msg, view: 'slides' }, active), ctx)).toBeNull();
    expect(acceptFromCanvas(ev(msg, { name: 'other' }), ctx)).toBeNull();
  });
});
