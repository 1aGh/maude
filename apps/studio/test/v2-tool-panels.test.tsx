// V2-4.5c — the shell's tool panels (V2-1.2 §5.5).
//  · pure: iframe px → shell px, and where a panel goes (above a low toolbar, below a high one);
//  · lane: `toolbar-rect` is remembered and `tool-panel-open` opens the Stickers picker anchored to the
//    LAST rect — from the active canvas on the canvas origin only (a background canvas, a sibling frame
//    and a foreign origin open nothing); Assets opens the left panel; Templates / Components have no
//    surface yet and open nothing;
//  · the picker renders pinned (data-placement + inline px) or, with no anchor, as today's dialog;
//  · the canvas side: the Stickers slot posts `tool-panel-open`, never the retired `open-sticker-picker`.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  // `document`, not `window`: a `window` stub another file left must not skip the DOM.
  if (typeof document === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import StickersGallery from '../client/v2/annotations/stickers-gallery.jsx';
import { placePanel, toShellRect } from '../client/v2/shell/tool-panels.js';
import { createToolPanelLane } from '../client/v2/shell/use-tool-panels.js';
import { toolPanelOpenMessage } from '../toolbars/tool-panel.ts';

const ORIGIN = 'http://canvas.test';
const activeWin = { name: 'active' } as unknown as Window;
const backgroundWin = { name: 'background' } as unknown as Window;
const siblingWin = { name: 'sibling' } as unknown as Window;

/** An iframe at (100, 50) in the shell, 1000 × 800, painted 1:1. */
const frameEl = (win: Window, scale = 1) => ({
  contentWindow: win,
  clientWidth: 1000,
  clientHeight: 800,
  getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000 * scale, height: 800 * scale }),
});

const ev = (data: unknown, source: unknown, origin = ORIGIN) =>
  ({ data, source, origin }) as unknown as MessageEvent;

// toolbar island at the bottom of the iframe; the Stickers button 40 px wide inside it
const BAR = { x: 300, y: 720, w: 400, h: 44 };
const BUTTON = { x: 600, y: 724, w: 36, h: 36 };

function makeLane(opts: { activePath?: string | null; canEdit?: boolean } = {}) {
  const opened: Array<{ canvas: string; anchor: unknown }> = [];
  const components: Array<{ canvas: string; anchor: unknown }> = [];
  let assets = 0;
  let denied = 0;
  let clock = 0;
  const frames = new Map<string, ReturnType<typeof frameEl>>([
    ['a.tsx', frameEl(activeWin)],
    ['b.tsx', frameEl(backgroundWin)],
  ]);
  const lane = createToolPanelLane({
    canvasOrigin: () => ORIGIN,
    activePath: () => (opts.activePath === undefined ? 'a.tsx' : opts.activePath),
    frameOf: (p: string) => frames.get(p),
    viewport: () => ({ w: 1280, h: 900 }),
    openStickers: (r: { canvas: string; anchor: unknown }) => opened.push(r),
    openComponents: (r: { canvas: string; anchor: unknown }) => components.push(r),
    openAssets: () => {
      assets++;
    },
    canEdit: () => opts.canEdit !== false,
    deny: () => {
      denied++;
    },
    // S4.3 (EH-P4-2): the lane asks whether the canvas has focus and rate-limits opens; these tests are
    // about placement and roles, so the canvas is focused and each message lands a second apart.
    hasFocus: () => true,
    now: () => {
      clock += 1000;
      return clock;
    },
  });
  return { lane, opened, components, assets: () => assets, denied: () => denied };
}

describe('toShellRect / placePanel (pure)', () => {
  test('an iframe rect is translated by the frame origin and its paint scale', () => {
    expect(toShellRect(frameEl(activeWin), BAR)).toEqual({ x: 400, y: 770, w: 400, h: 44 });
    expect(toShellRect(frameEl(activeWin, 0.5), BAR)).toEqual({ x: 250, y: 410, w: 200, h: 22 });
    expect(toShellRect(null, BAR)).toBeNull();
    expect(toShellRect(frameEl(activeWin), null)).toBeNull();
  });

  test('a low toolbar gets the panel ABOVE it, centred on the button; a high one gets it below', () => {
    const viewport = { w: 1280, h: 900 };
    const low = placePanel({ toolbar: { x: 400, y: 770, w: 400, h: 44 }, anchor: null }, viewport);
    expect(low).toMatchObject({ placement: 'above', width: 640, bottom: 900 - 770 + 10 });
    expect(low?.left).toBe(Math.round(600 - 320)); // centred on the toolbar
    const onButton = placePanel(
      { toolbar: { x: 400, y: 770, w: 400, h: 44 }, anchor: { x: 700, y: 774, w: 36, h: 36 } },
      viewport
    );
    expect(onButton?.left).toBe(Math.round(718 - 320)); // centred on the button
    const high = placePanel({ toolbar: { x: 400, y: 20, w: 400, h: 44 }, anchor: null }, viewport);
    expect(high).toMatchObject({ placement: 'below', top: 20 + 44 + 10 });
    expect(high?.maxHeight).toBeGreaterThanOrEqual(160);
  });

  test('clamped inside a narrow window; nothing to anchor to = null (the centred dialog)', () => {
    const edge = placePanel(
      { toolbar: { x: 0, y: 800, w: 40, h: 44 }, anchor: null },
      { w: 500, h: 900 }
    );
    expect(edge?.left).toBeGreaterThanOrEqual(8);
    expect((edge?.left ?? 0) + (edge?.width ?? 0)).toBeLessThanOrEqual(500 - 8);
    expect(placePanel({ toolbar: null, anchor: null }, { w: 500, h: 900 })).toBeNull();
    expect(placePanel({ toolbar: BAR, anchor: null }, { w: 0, h: 0 })).toBeNull();
  });
});

describe('the lane: toolbar-rect + tool-panel-open', () => {
  test('a viewing role asking for Stickers or Assets gets the denial line, not a panel (V2-4.5b Q2)', () => {
    const { lane, opened, assets, denied } = makeLane({ canEdit: false });
    lane.onMessage(ev({ dgn: 'tool-panel-open', panel: 'stickers', anchor: null }, activeWin));
    lane.onMessage(ev({ dgn: 'tool-panel-open', panel: 'assets', anchor: null }, activeWin));
    expect(opened).toHaveLength(0);
    expect(assets()).toBe(0);
    expect(denied()).toBe(2);
  });

  test('stickers opens anchored to the last toolbar-rect (shell coordinates)', () => {
    const { lane, opened } = makeLane();
    lane.onMessage(ev({ dgn: 'toolbar-rect', mode: 'preview', rect: BAR }, activeWin));
    lane.onMessage(ev({ dgn: 'tool-panel-open', panel: 'stickers', anchor: BUTTON }, activeWin));
    expect(opened).toHaveLength(1);
    expect(opened[0].canvas).toBe('a.tsx');
    // bar in shell px = (400, 770, 400, 44) → above; centred on the button (618 + 100 + 18)
    expect(opened[0].anchor).toMatchObject({
      placement: 'above',
      width: 440,
      bottom: 900 - 770 + 10,
      left: 100 + 600 + 18 - 220, // the Stickers island is 440 wide
    });
  });

  test('the newest toolbar-rect wins (a mode change re-reports)', () => {
    const { lane, opened } = makeLane();
    lane.onMessage(ev({ dgn: 'toolbar-rect', mode: 'edit', rect: BAR }, activeWin));
    lane.onMessage(
      ev({ dgn: 'toolbar-rect', mode: 'preview', rect: { x: 0, y: 0, w: 400, h: 44 } }, activeWin)
    );
    lane.onMessage(ev({ dgn: 'tool-panel-open', panel: 'stickers', anchor: null }, activeWin));
    expect(opened[0].anchor).toMatchObject({ placement: 'below' });
  });

  test('no toolbar-rect and no anchor: the centred dialog (anchor null)', () => {
    const { lane, opened } = makeLane();
    lane.onMessage(ev({ dgn: 'tool-panel-open', panel: 'stickers', anchor: null }, activeWin));
    expect(opened).toEqual([{ canvas: 'a.tsx', anchor: null }]);
  });

  test('a background canvas, a sibling frame and a foreign origin open nothing', () => {
    const { lane, opened, assets } = makeLane();
    const open = { dgn: 'tool-panel-open', panel: 'stickers', anchor: null };
    lane.onMessage(ev(open, backgroundWin));
    lane.onMessage(ev(open, siblingWin));
    lane.onMessage(ev(open, activeWin, 'http://evil.example'));
    lane.onMessage(ev({ ...open, panel: 'assets' }, backgroundWin));
    expect(opened).toEqual([]);
    expect(assets()).toBe(0);
    // and their toolbar-rect is not remembered either
    lane.onMessage(ev({ dgn: 'toolbar-rect', mode: 'preview', rect: BAR }, backgroundWin));
    expect(lane.rects.get('a.tsx')).toBeNull();
  });

  test('no active canvas: nothing opens (not null === null)', () => {
    const { lane, opened } = makeLane({ activePath: null });
    lane.onMessage(ev({ dgn: 'tool-panel-open', panel: 'stickers', anchor: null }, null));
    expect(opened).toEqual([]);
  });

  test('a malformed payload is dropped by the one parser', () => {
    const { lane, opened } = makeLane();
    lane.onMessage(ev({ dgn: 'tool-panel-open', panel: 'rocket', anchor: null }, activeWin));
    lane.onMessage(
      ev({ dgn: 'tool-panel-open', panel: 'stickers', anchor: { x: 'a' } }, activeWin)
    );
    expect(opened).toEqual([]);
  });

  test('assets opens the left panel; templates has no opener wired here', () => {
    const { lane, opened, assets } = makeLane();
    lane.onMessage(ev({ dgn: 'tool-panel-open', panel: 'assets', anchor: null }, activeWin));
    expect(assets()).toBe(1);
    lane.onMessage(ev({ dgn: 'tool-panel-open', panel: 'templates', anchor: null }, activeWin));
    expect(assets()).toBe(1);
    expect(opened).toEqual([]);
  });

  test('components opens the Component picker (S2.16), anchored above the reported toolbar, never the Stickers', () => {
    const { lane, opened, components } = makeLane();
    lane.onMessage(ev({ dgn: 'toolbar-rect', mode: 'edit', rect: BAR }, activeWin));
    lane.onMessage(ev({ dgn: 'tool-panel-open', panel: 'components', anchor: BUTTON }, activeWin));
    expect(opened).toEqual([]);
    expect(components.length).toBe(1);
    expect(components[0]?.canvas).toBe('a.tsx');
    expect(components[0]?.anchor).toMatchObject({ placement: 'above', width: 300 });
  });

  test('a viewing role asking for the picker gets the denial line, not a panel', () => {
    const { lane, components, denied } = makeLane({ canEdit: false });
    lane.onMessage(ev({ dgn: 'tool-panel-open', panel: 'components', anchor: null }, activeWin));
    expect(components).toEqual([]);
    expect(denied()).toBe(1);
  });
});

describe('the bridge table', () => {
  test('tool-panel-open is live and active-gated; open-sticker-picker is gone; toolbar-rect has a handler', () => {
    const c2s = DGN_TABLE.c2s as Record<string, { status: string; gate: string; orphan?: string }>;
    expect(c2s['tool-panel-open']).toMatchObject({ status: 'live', gate: 'active' });
    expect(c2s['toolbar-rect']?.orphan).toBeUndefined();
    expect(c2s['open-sticker-picker']).toBeUndefined();
  });

  test('the canvas message is the table’s payload', () => {
    expect(toolPanelOpenMessage('stickers')).toEqual({
      dgn: 'tool-panel-open',
      panel: 'stickers',
      anchor: null,
    });
    const el = { getBoundingClientRect: () => ({ left: 600.4, top: 724, width: 36, height: 36 }) };
    expect(toolPanelOpenMessage('stickers', el as unknown as Element)).toMatchObject({
      anchor: { x: 600, y: 724, w: 36, h: 36 },
    });
  });
});

describe('the Stickers gallery hosted as a shell panel', () => {
  async function mount(anchor: unknown) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <StickersGallery onPick={() => {}} onClose={() => {}} anchor={anchor as never} />
      );
    });
    return { host, root };
  }

  test('anchored: pinned with the placement’s px, scrim does not tint; keeps the dialog role and label', async () => {
    const { host, root } = await mount({
      left: 280,
      width: 640,
      bottom: 140,
      maxHeight: 700,
      placement: 'above',
    });
    const dlg = host.querySelector('[data-testid="tool-panel-stickers"]') as HTMLElement;
    expect(dlg).not.toBeNull();
    expect(dlg.getAttribute('role')).toBe('dialog');
    expect(dlg.getAttribute('aria-label')).toBe('Stickers');
    expect(dlg.getAttribute('data-placement')).toBe('above');
    expect(dlg.style.left).toBe('280px');
    expect(dlg.style.bottom).toBe('140px');
    expect(dlg.style.top).toBe('');
    expect(host.querySelector('.sh-scrim--anchored')).not.toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });

  test('no anchor: today’s centred dialog, no inline placement', async () => {
    const { host, root } = await mount(null);
    const dlg = host.querySelector('[data-testid="tool-panel-stickers"]') as HTMLElement;
    expect(dlg.getAttribute('data-placement')).toBeNull();
    expect(dlg.getAttribute('style')).toBeNull();
    expect(host.querySelector('.sh-scrim--anchored')).toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });
});

describe('a tool key pressed with the shell focused is replayed in the canvas (V2-4.5b)', () => {
  test('only tool.key with a bare letter (or ⇧ + letter) dispatches; anything else is swallowed', async () => {
    const { replayToolKey } = await import('../canvas-replay-keys.ts');
    const seen: Array<{ key: string; code: string; shift: boolean }> = [];
    const doc = {
      body: {
        dispatchEvent: (e: KeyboardEvent) => {
          seen.push({ key: e.key, code: e.code, shift: e.shiftKey });
          return true;
        },
      },
    } as unknown as Document;
    expect(replayToolKey('select.all', { key: 'N' }, doc)).toBe(false);
    expect(replayToolKey('tool.key', { key: 'N' }, doc)).toBe(true);
    expect(replayToolKey('tool.key', { key: '⇧I' }, doc)).toBe(true);
    for (const bad of ['⌘N', 'NN', 'n', '', 7, null])
      expect(replayToolKey('tool.key', { key: bad }, doc)).toBe(true);
    expect(replayToolKey('tool.key', null, doc)).toBe(true);
    expect(seen).toEqual([
      { key: 'n', code: 'KeyN', shift: false },
      { key: 'I', code: 'KeyI', shift: true },
    ]);
  });

  test('every tool.<id> action has a shell handler that posts tool.key to the active canvas', async () => {
    const { SHELL_KEY_HANDLERS } = await import('../client/actions/shell-key-handlers.js');
    const { ACTIONS } = await import('../actions/index.ts');
    const tools = ACTIONS.filter((a) => a.id.startsWith('tool.')).map((a) => a.id);
    expect(tools.length).toBeGreaterThan(5);
    for (const id of tools) expect(typeof SHELL_KEY_HANDLERS[id], id).toBe('function');
    const posted: unknown[] = [];
    let prevented = 0;
    SHELL_KEY_HANDLERS['tool.sticky'](
      { postToActiveCanvas: (m: unknown) => posted.push(m) },
      { event: { key: 'n', code: 'KeyN', preventDefault: () => prevented++ } }
    );
    expect(prevented).toBe(1);
    expect(posted).toEqual([{ dgn: 'run-action', v: 1, id: 'tool.key', params: { key: 'N' } }]);
  });
});
