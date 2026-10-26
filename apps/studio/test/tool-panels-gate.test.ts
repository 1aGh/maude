// S4.3 — EH-P4-2 (Phase 4 security, low): the shell's tool panels are a TRUSTED surface that the
// (untrusted) canvas can ask to open. A planted canvas must not be able to pop the Stickers/Templates
// panel (a) while it does not have focus, (b) faster than once per 500 ms, or (c) at an anchor it
// chooses — over the top chrome band where warn/error callouts live. The predicate is pure; each
// test turns one clause red.
import { describe, expect, test } from 'bun:test';
import {
  anchorWithinToolbar,
  createPanelGate,
  PANEL_MIN_GAP_MS,
  placePanel,
  TOP_CHROME_BAND,
} from '../client/v2/shell/tool-panels.js';
import { createToolPanelLane } from '../client/v2/shell/use-tool-panels.js';

const ORIGIN = 'http://canvas.test';
const activeWin = { name: 'active' } as unknown as Window;
const frameEl = (win: Window) => ({
  contentWindow: win,
  clientWidth: 1000,
  clientHeight: 800,
  getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000, height: 800 }),
});
const ev = (data: unknown, source: unknown, origin = ORIGIN) =>
  ({ data, source, origin }) as unknown as MessageEvent;

const BAR = { x: 300, y: 720, w: 400, h: 44 };
const OPEN = (anchor: unknown = null, panel = 'stickers') => ({
  dgn: 'tool-panel-open',
  panel,
  anchor,
});

function makeLane(opts: { focused?: () => boolean; canEdit?: boolean } = {}) {
  const opened: Array<{ canvas: string; anchor: any; replace?: string }> = [];
  let closed = 0;
  const templates: Array<{ canvas: string; anchor: any }> = [];
  let denied = 0;
  let t = 10_000;
  const clock = { advance: (d: number) => (t += d) };
  const frames = new Map([['a.tsx', frameEl(activeWin)]]);
  const lane = createToolPanelLane({
    canvasOrigin: () => ORIGIN,
    activePath: () => 'a.tsx',
    frameOf: (p: string) => frames.get(p),
    viewport: () => ({ w: 1280, h: 900 }),
    openStickers: (r: any) => opened.push(r),
    closeStickers: () => {
      closed++;
    },
    openTemplates: (r: any) => templates.push(r),
    openAssets: () => {},
    canEdit: () => opts.canEdit !== false,
    deny: () => {
      denied++;
    },
    hasFocus: opts.focused ?? (() => true),
    now: () => t,
  });
  lane.onMessage(ev({ dgn: 'toolbar-rect', mode: 'preview', rect: BAR }, activeWin));
  return { lane, opened, templates, denied: () => denied, clock, closed: () => closed };
}

describe('EH-P4-2: the panel opens only for a canvas that has focus', () => {
  test('an unprompted tool-panel-open from an unfocused canvas opens nothing and says nothing', () => {
    const { lane, opened, templates, denied } = makeLane({ focused: () => false });
    lane.onMessage(ev(OPEN(), activeWin));
    lane.onMessage(ev(OPEN(null, 'templates'), activeWin));
    expect(opened).toEqual([]);
    expect(templates).toEqual([]);
    expect(denied()).toBe(0); // a refusal is silent: no toast for a page the user is not driving
  });

  test('focus is asked about once per message, and a focused canvas opens', () => {
    let asked = 0;
    const { lane, opened } = makeLane({
      focused: () => {
        asked++;
        return true;
      },
    });
    lane.onMessage(ev(OPEN(), activeWin));
    expect(asked).toBe(1);
    expect(opened).toHaveLength(1);
  });

  test('templates opens on its own host when one is wired', () => {
    const { lane, templates } = makeLane();
    lane.onMessage(ev(OPEN(null, 'templates'), activeWin));
    expect(templates).toHaveLength(1);
  });
});

describe('EH-P4-2: at most one open per 500 ms', () => {
  test('a burst opens once; the next one after the gap opens again', () => {
    const { lane, opened, clock } = makeLane();
    for (let i = 0; i < 20; i++) {
      lane.onMessage(ev(OPEN(), activeWin));
      clock.advance(10); // 200 ms for the whole burst
    }
    expect(opened).toHaveLength(1);
    clock.advance(PANEL_MIN_GAP_MS);
    lane.onMessage(ev(OPEN(), activeWin));
    expect(opened).toHaveLength(2);
  });

  test('a refused message does not extend the quiet period', () => {
    const g = createPanelGate();
    expect(g.admit(0)).toBe(true);
    expect(g.admit(100)).toBe(false);
    expect(g.admit(499)).toBe(false);
    expect(g.admit(500)).toBe(true);
  });

  test('a viewer role pressing E in a burst gets one denial line, not a toast flood', () => {
    const { lane, denied, clock } = makeLane({ canEdit: false });
    for (let i = 0; i < 10; i++) {
      lane.onMessage(ev(OPEN(), activeWin));
      clock.advance(20);
    }
    expect(denied()).toBe(1);
  });
});

describe('EH-P4-2: the anchor must lie on the reported toolbar', () => {
  test('anchorWithinToolbar: inside the rect ± 16 px', () => {
    expect(anchorWithinToolbar({ x: 600, y: 724, w: 36, h: 36 }, BAR)).toBe(true);
    expect(anchorWithinToolbar({ x: 300, y: 704, w: 36, h: 16 }, BAR)).toBe(true); // 16 above
    expect(anchorWithinToolbar({ x: 300, y: 702, w: 36, h: 16 }, BAR)).toBe(false); // 18 above
    expect(anchorWithinToolbar({ x: 0, y: 0, w: 36, h: 36 }, BAR)).toBe(false);
    expect(anchorWithinToolbar({ x: 600, y: 724, w: 36, h: 36 }, null)).toBe(false); // no toolbar
  });

  test('an anchor over the top chrome band is ignored: the panel is placed from the toolbar', () => {
    const { lane, opened } = makeLane();
    lane.onMessage(ev(OPEN({ x: 10, y: 4, w: 36, h: 36 }), activeWin));
    expect(opened).toHaveLength(1);
    // toolbar in shell px = (400, 770, 400, 44): above it, centred on the toolbar (600), not on x=10
    expect(opened[0].anchor).toMatchObject({ placement: 'above', bottom: 900 - 770 + 10 });
    expect(opened[0].anchor.left).toBe(600 - 220);
  });

  test('an anchor with no toolbar-rect reported is ignored: the centred dialog', () => {
    const { lane, opened } = makeLane();
    lane.onMessage(ev({ dgn: 'toolbar-rect', mode: 'preview', rect: null }, activeWin));
    lane.onMessage(ev(OPEN({ x: 10, y: 4, w: 36, h: 36 }), activeWin));
    expect(opened).toHaveLength(1);
    expect(opened[0].anchor).toBeNull();
  });

  test('an anchor on the toolbar still centres the panel on its button', () => {
    const { lane, opened } = makeLane();
    lane.onMessage(ev(OPEN({ x: 600, y: 724, w: 36, h: 36 }), activeWin));
    expect(opened[0].anchor.left).toBe(100 + 600 + 18 - 220);
  });
});

describe('EH-P4-2: placePanel never reaches into the top chrome band', () => {
  const vp = { w: 1280, h: 900 };

  test('a toolbar the canvas reports at the very top: the panel starts below the band', () => {
    const r = placePanel({ toolbar: { x: 400, y: 0, w: 400, h: 20 }, anchor: null }, vp);
    expect(r?.placement).toBe('below');
    expect(r?.top).toBeGreaterThanOrEqual(TOP_CHROME_BAND);
  });

  test('a toolbar reported above the window still clears the band', () => {
    const r = placePanel({ toolbar: { x: 400, y: -200, w: 400, h: 44 }, anchor: null }, vp);
    expect(r?.top).toBeGreaterThanOrEqual(TOP_CHROME_BAND);
  });

  test('an "above" panel is capped so its top edge stays under the band', () => {
    const r = placePanel({ toolbar: { x: 400, y: 450, w: 400, h: 44 }, anchor: null }, vp);
    expect(r?.placement).toBe('above');
    const top = vp.h - (r?.bottom ?? 0) - (r?.maxHeight ?? 0);
    expect(top).toBeGreaterThanOrEqual(TOP_CHROME_BAND);
  });
});

describe('S4.3 protocol: replace? and sticker{pack,id}', () => {
  const ctx = { canvasOrigin: ORIGIN, active: activeWin };
  test('tool-panel-open carries an optional replace id; a non-string is dropped whole', async () => {
    const { acceptFromCanvas } = await import('../bridge/dgn-protocol.ts');
    const ok = acceptFromCanvas(ev({ ...OPEN(), replace: 'img-7' }, activeWin), ctx) as any;
    expect(ok?.replace).toBe('img-7');
    expect(acceptFromCanvas(ev(OPEN(), activeWin), ctx)).not.toBeNull();
    expect(acceptFromCanvas(ev({ ...OPEN(), replace: 7 }, activeWin), ctx)).toBeNull();
  });

  test('the lane hands replace to the Stickers opener', () => {
    const { lane, opened } = makeLane();
    lane.onMessage(ev({ ...OPEN(), replace: 'img-7' }, activeWin));
    expect(opened[0].replace).toBe('img-7');
  });

  test('insert-sticker parses sticker{pack,id,flip?}; path-only still parses', async () => {
    const { DGN_TABLE } = await import('../bridge/dgn-protocol.ts');
    const spec = (DGN_TABLE.s2c as any)['insert-sticker'];
    const good = spec.parse({
      dgn: 'insert-sticker',
      path: 'assets/a.png',
      sticker: { pack: 'life-style', id: 'best.png' },
    });
    expect(good).toMatchObject({
      path: 'assets/a.png',
      sticker: { pack: 'life-style', id: 'best.png' },
    });
    expect(spec.parse({ dgn: 'insert-sticker', path: 'assets/a.png' })).not.toBeNull();
    expect(
      spec.parse({ dgn: 'insert-sticker', path: 'assets/a.png', sticker: { pack: 1 } })
    ).toBeNull();
  });
});

// 15 an-stamps — "Esc lets go": a person stamps by clicking the canvas, so their Esc reaches the CANVAS, which drops
// the armed stamp (PlacementGhost onCancel). The Stamps row is the shell's; it hears `stamp-disarmed` and folds away,
// or it stays up showing a stamp the canvas no longer holds (the desktop e2e red: the row never went).
describe('stamp-disarmed: the canvas let go of its stamp, the shell puts the Stamps row away', () => {
  test('from the active canvas it closes the Stickers panel — focus or quiet period aside (closing is never a pop)', () => {
    const { lane, closed } = makeLane({ focused: () => false });
    lane.onMessage(ev({ dgn: 'stamp-disarmed' }, activeWin));
    lane.onMessage(ev({ dgn: 'stamp-disarmed' }, activeWin));
    expect(closed()).toBe(2);
  });

  test('a background frame or a foreign origin closes nothing', () => {
    const { lane, closed } = makeLane();
    lane.onMessage(ev({ dgn: 'stamp-disarmed' }, { name: 'sibling' }));
    lane.onMessage(ev({ dgn: 'stamp-disarmed' }, activeWin, 'http://evil.test'));
    expect(closed()).toBe(0);
  });

  test('the canvas side posts it to its parent when a stamp pick is let go, and only then', async () => {
    const { postStampDisarmed } = await import('../annotations/ui/placement.tsx');
    const sent: unknown[] = [];
    const parent = { postMessage: (m: unknown) => sent.push(m) };
    postStampDisarmed({ kind: 'stamp' }, { parent } as unknown as Window);
    postStampDisarmed({ kind: 'sticker' }, { parent } as unknown as Window);
    postStampDisarmed(null, { parent } as unknown as Window);
    const top = {} as { parent?: unknown };
    top.parent = top;
    postStampDisarmed({ kind: 'stamp' }, top as unknown as Window); // not framed: no shell to tell
    expect(sent).toEqual([{ dgn: 'stamp-disarmed' }]);
  });
});
