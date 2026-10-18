// S10.4 wiring (A6b-3) — the shell's side of a design system's revision, per canvas frame: the helpers
// (pins.js, follower-swap.js) were pure and unit-tested; this pins how the shell uses them. A frame's
// `ds-pins-want` is answered into THAT frame; a head that moves does not reload an open canvas, it is
// queued and lands at the NEXT LOOK (visible again · canvas switch · artboard move), and Present holds it.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { canvasFrameCfg, canvasUrl } from '../client/canvas-url.js';
import { dsFrameState, framePair, useDsFrames } from '../client/v2/ds/use-ds-frames.js';
import { createMenuHandlers } from '../client/v2/shell/menu-runner.js';

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

const R1 = 'a'.repeat(64);
const R2 = 'b'.repeat(64);
const R3 = 'c'.repeat(64);
const ORIGIN = 'http://canvas.test';
const PRICING = '.design/ui/Pricing.tsx';
const LANDING = '.design/ui/Landing.tsx';

const cfgOf = (head: string, extra: Record<string, unknown> = {}) => ({
  designRel: '.design',
  canvasOrigin: ORIGIN,
  designSystems: [
    {
      name: 'studio-site',
      path: 'system/studio-site',
      rootClass: 'app',
      tokensCssRel: 'system/studio-site/colors_and_type.css',
    },
  ],
  dsConverted: { 'studio-site': true },
  systemHeads: { 'studio-site': head },
  canvasDesignSystems: { [PRICING]: 'studio-site', [LANDING]: 'studio-site' },
  // Landing was left on R1 (an unticked follower); Pricing follows the head
  canvasDsRevs: { [LANDING]: R1 },
  ...extra,
});
const sib = (rev: string) => ({
  tokens: `system/studio-site/revisions/${rev}.tokens.css`,
  components: `system/studio-site/revisions/${rev}.components.css`,
});

type Win = {
  postMessage: (m: unknown, o?: string) => void;
  sent: Array<[any, string | undefined]>;
};
const fakeWin = (): Win => {
  const sent: Array<[any, string | undefined]> = [];
  return { sent, postMessage: (m, o) => void sent.push([m, o]) };
};
const frameFor = (cfg: any, path: string) => {
  const win = fakeWin();
  const src = canvasUrl(path, cfg);
  return {
    win,
    frame: { src: `http://localhost:4399/_canvas-shell?${src.split('?')[1]}`, contentWindow: win },
  };
};
const say = (source: Win, data: Record<string, unknown>) => {
  const ev = new MessageEvent('message', { data, origin: ORIGIN });
  Object.defineProperty(ev, 'source', { value: source });
  window.dispatchEvent(ev);
};
const setVisible = () => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

type Props = {
  cfg: any;
  frames: Map<string, any>;
  activePath: string | null;
  presentMode?: boolean;
  canvasActiveArtboard?: unknown;
};
let lastFrames: ReturnType<typeof useDsFrames> | null = null;
function Harness(p: Props) {
  lastFrames = useDsFrames({
    cfg: p.cfg,
    iframesRef: { current: p.frames },
    activePath: p.activePath,
    presentMode: p.presentMode === true,
    canvasActiveArtboard: p.canvasActiveArtboard,
  });
  return null;
}
async function mount(p: Props) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(createElement(Harness, p)));
  return async (next: Partial<Props>) =>
    act(async () => root.render(createElement(Harness, { ...p, ...next })));
}

describe('the pure parts the wiring leans on', () => {
  test('dsFrameState: a follower of a converted system has a state; the Design system canvas and an unconverted system do not', () => {
    const cfg = cfgOf(R2);
    expect(dsFrameState(PRICING, cfg)).toEqual({
      ds: { path: 'system/studio-site', rootClass: 'app' },
      head: R2,
      canvasRev: R2,
      gaps: {},
    });
    expect(dsFrameState(LANDING, cfg)?.canvasRev).toBe(R1); // left on R1
    expect(dsFrameState('.design/system/studio-site/design-system.tsx', cfg)).toBeNull();
    expect(dsFrameState(PRICING, { ...cfg, dsConverted: { 'studio-site': false } })).toBeNull();
  });

  test('framePair reads the two files the frame was built showing', () => {
    const { frame } = frameFor(cfgOf(R2), PRICING);
    expect(framePair(frame)).toEqual([sib(R2).tokens, sib(R2).components]);
    expect(framePair({ src: 'not a url at all' })).toEqual([null, null]);
  });

  test('canvasFrameCfg: an open frame keeps its identity when the head moves (no reload); a changed system does reload', () => {
    const a = canvasUrl(PRICING, canvasFrameCfg(cfgOf(R2)));
    expect(canvasUrl(PRICING, canvasFrameCfg(cfgOf(R3)))).toBe(a);
    expect(canvasUrl(PRICING, canvasFrameCfg(cfgOf(R2, { dsRevGaps: { [R2]: 'jonas' } })))).toBe(a);
    // …whereas a frame that is (re)created is built with the live head
    expect(canvasUrl(PRICING, cfgOf(R3))).not.toBe(canvasUrl(PRICING, cfgOf(R2)));
    // and the capability / converted-ness still are part of it
    expect(canvasUrl(PRICING, canvasFrameCfg(cfgOf(R2, { dsConverted: {} })))).not.toBe(a);
  });
});

describe('ds-pins-want → ds-pins, into the frame that asked', () => {
  test('the active canvas is answered with the sibling files of what it asked for; another window is not', async () => {
    const cfg = cfgOf(R2);
    const { win, frame } = frameFor(cfg, LANDING); // renders R1; asks for head (R2) and R1 (its own)
    const other = frameFor(cfg, PRICING);
    const frames = new Map<string, any>([
      [LANDING, frame],
      [PRICING, other.frame],
    ]);
    await mount({ cfg, frames, activePath: LANDING });
    // a canvas that is not the active one cannot ask (the dgn table's `active` gate)
    say(other.win, { dgn: 'ds-pins-want', revs: ['head'] });
    expect(other.win.sent.filter(([m]) => m.dgn === 'ds-pins')).toHaveLength(0);
    say(win, { dgn: 'ds-pins-want', revs: ['head', R1, 'ftp://evil', '../x'] });
    const reply = win.sent.find(([m]) => m.dgn === 'ds-pins');
    expect(reply?.[1]).toBe(ORIGIN);
    expect(reply?.[0]).toEqual({
      dgn: 'ds-pins',
      // R1 is what the canvas itself renders → no sheet of its own; head (R2) is listed; junk never is
      revs: { head: sib(R2) },
      rootClass: 'app',
    });
  });

  test('a head that moves answers again for what the frame asked', async () => {
    const cfg = cfgOf(R2);
    const { win, frame } = frameFor(cfg, LANDING);
    const frames = new Map<string, any>([[LANDING, frame]]);
    const rerender = await mount({ cfg, frames, activePath: LANDING });
    say(win, { dgn: 'ds-pins-want', revs: ['head'] });
    win.sent.length = 0;
    await rerender({ cfg: cfgOf(R3) });
    const again = win.sent.find(([m]) => m.dgn === 'ds-pins');
    expect(again?.[0].revs).toEqual({ head: sib(R3) });
  });
});

describe('the follower swap: a head that moved lands at the next look, never under the eyes', () => {
  async function loadedPricing(presentMode = false) {
    const cfg = cfgOf(R2);
    const { win, frame } = frameFor(cfg, PRICING);
    const frames = new Map<string, any>([[PRICING, frame]]);
    const rerender = await mount({ cfg, frames, activePath: PRICING, presentMode });
    say(win, { dgn: 'loaded', file: PRICING }); // seeds: the frame shows R2's two files
    return { win, rerender };
  }
  const swaps = (w: Win) => w.sent.filter(([m]) => m.dgn === 'ds-css');

  test('nothing is sent when the head moves; the next visible look sends the two new links once', async () => {
    const { win, rerender } = await loadedPricing();
    await rerender({ cfg: cfgOf(R3) });
    expect(swaps(win)).toHaveLength(0);
    await act(async () => setVisible());
    expect(swaps(win)).toHaveLength(1);
    expect(swaps(win)[0]?.[0]).toEqual({ dgn: 'ds-css', ...sib(R3) });
    expect(swaps(win)[0]?.[1]).toBe(ORIGIN);
    await act(async () => setVisible());
    expect(swaps(win)).toHaveLength(1); // landed; a second look has nothing to do
  });

  test('an artboard move is a look too', async () => {
    const { win, rerender } = await loadedPricing();
    await rerender({ cfg: cfgOf(R3) });
    expect(swaps(win)).toHaveLength(0);
    await rerender({ cfg: cfgOf(R3), canvasActiveArtboard: 'mobile' });
    expect(swaps(win)).toHaveLength(1);
  });

  test('Present holds the swap until it ends', async () => {
    const { win, rerender } = await loadedPricing(true);
    await rerender({ cfg: cfgOf(R3), presentMode: true });
    await act(async () => setVisible());
    await rerender({ cfg: cfgOf(R3), presentMode: true, canvasActiveArtboard: 'next' });
    expect(swaps(win)).toHaveLength(0); // the audience sees no canvas change under them
    await rerender({ cfg: cfgOf(R3), presentMode: false, canvasActiveArtboard: 'next' });
    expect(swaps(win)).toHaveLength(1);
    expect(swaps(win)[0]?.[0]).toEqual({ dgn: 'ds-css', ...sib(R3) });
  });

  test('a head that moves back to what the frame shows swaps nothing', async () => {
    const { win, rerender } = await loadedPricing();
    await rerender({ cfg: cfgOf(R3) });
    await rerender({ cfg: cfgOf(R2) });
    await act(async () => setVisible());
    expect(swaps(win)).toHaveLength(0);
  });
});

describe('ds.set-theme-preview → the active canvas, once, in its own origin', () => {
  test('the runner hands the mode to the shell; the shell posts it to the ACTIVE frame only', async () => {
    const cfg = cfgOf(R2);
    const a = frameFor(cfg, PRICING);
    const b = frameFor(cfg, LANDING);
    const frames = new Map<string, any>([
      [PRICING, a.frame],
      [LANDING, b.frame],
    ]);
    await mount({ cfg, frames, activePath: PRICING });
    const asked: unknown[] = [];
    const handlers = createMenuHandlers({
      onDsThemePreview: (mode: unknown) => {
        asked.push(mode);
        lastFrames?.postThemePreview(mode);
      },
    });
    handlers['ds.set-theme-preview']?.({ mode: 'dark' });
    expect(asked).toEqual(['dark']);
    expect(a.win.sent.filter(([m]) => m.type === 'maude:ds-theme-preview')).toEqual([
      [{ type: 'maude:ds-theme-preview', mode: 'dark' }, ORIGIN],
    ]);
    expect(b.win.sent).toHaveLength(0);
    // a mode that is not Light or Dark posts nothing
    handlers['ds.set-theme-preview']?.({ mode: 'sepia' });
    handlers['ds.set-theme-preview']?.(undefined);
    expect(a.win.sent.filter(([m]) => m.type === 'maude:ds-theme-preview')).toHaveLength(1);
  });
});
