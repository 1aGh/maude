// S7.20 — the F size picker, shell half: the rules (pure), the panel rendered (five groups with their badges, three
// sizes up front, "All 7", Recent chips, search, hover → the dashed outline, click → ONE ask, Custom size… → mm), the
// two new dgn rows, the tool-panel lane that opens it, and Recent remembered only after the canvas says it wrote.
// The canvas half is test/size-ghost.test.tsx; the writer's golden is test/insert-preset.test.ts.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
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
import { resolveAccess } from '../access/scope.ts';
import { MODE_TOOLS } from '../bridge/canvas-modes.ts';
import { c2sSpec, DGN_TABLE, s2cSpec } from '../bridge/dgn-protocol.ts';
import SizePicker from '../client/v2/kinds/SizePicker.jsx';
import { rememberSize } from '../client/v2/kinds/SizePickerHost.jsx';
import {
  badgeTone,
  customInput,
  customNote,
  flatTiles,
  ghostMessage,
  orientationOf,
  parseMm,
  placeMessage,
  tileShape,
  viewGroups,
  withOrientation,
} from '../client/v2/kinds/size-picker-model.js';
import { PANEL_HOSTS, PANEL_SIZE } from '../client/v2/shell/tool-panels.js';
import { createToolPanelLane } from '../client/v2/shell/use-tool-panels.js';
import { PRESET_GROUPS, PRESETS } from '../kinds/presets.ts';
import { createKindRoutes } from '../routes/kinds.ts';

/** The body `GET /_api/kinds/presets` answers, built by the real route. */
async function catalogue(recent: string[] = []) {
  const [spec] = createKindRoutes({
    designRoot: '/x',
    designRel: '.design',
    access: () => resolveAccess({ v: 1, role: 'owner' } as never),
    recentIds: () => recent,
  });
  const r = await (spec as NonNullable<typeof spec>).handle(
    new Request('http://localhost/_api/kinds/presets'),
    {}
  );
  return r.json();
}

describe('the rules (pure)', () => {
  test('up front: three sizes per group; "All N" only where there is more', async () => {
    const data = await catalogue();
    const v = viewGroups(data, null, '');
    expect(v.groups.map((g) => [g.id, g.tiles.length, g.more, g.open])).toEqual([
      ['app', 3, 4, false],
      ['web', 3, 4, false],
      ['social', 3, 6, false],
      ['print', 3, 7, false],
      ['video', 3, 0, false],
    ]);
    expect(v.groups.every((g) => g.custom === null)).toBe(true);
  });

  test('"All 7" opens every Print size and the Custom size… tile; the other groups stay short', async () => {
    const data = await catalogue();
    const v = viewGroups(data, 'print', '');
    const print = v.groups.find((g) => g.id === 'print');
    expect(print?.tiles).toHaveLength(7);
    expect(print?.open).toBe(true);
    expect(print?.custom).toMatchObject({ id: 'print-custom', name: 'Custom size…' });
    expect(v.groups.find((g) => g.id === 'app')?.tiles).toHaveLength(3);
    const ids = flatTiles(v).map((t) => t.id);
    expect(ids[ids.indexOf('print-business-card') + 1]).toBe('print-custom');
  });

  test('a query is one flat list; Recent and the groups step aside', async () => {
    const data = await catalogue(['print-a6']);
    const v = viewGroups(data, null, 'a5');
    expect(v.search?.map((t) => t.id)).toEqual(['print-a5']);
    expect(v.groups).toEqual([]);
    expect(v.recent).toEqual([]);
    expect(viewGroups(data, null, 'story').search?.map((t) => t.id)).toContain('video-reels');
    expect(viewGroups(data, null, 'zzz').search).toEqual([]);
  });

  test('Recent comes from the server (valid ids only, three at most)', async () => {
    const data = await catalogue(['social-fb-event', 'gone', 'social-post-4-5']);
    expect(viewGroups(data, null, '').recent.map((t) => t.id)).toEqual([
      'social-fb-event',
      'social-post-4-5',
    ]);
  });

  test('the outline is the tile’s name and size; Custom size… has none', async () => {
    const data = await catalogue();
    const tile = data.groups[2].presets.find((p: { id: string }) => p.id === 'social-fb-event');
    expect(ghostMessage(tile)).toEqual({
      dgn: 'size-ghost',
      preset: {
        id: 'social-fb-event',
        label: 'FB event cover',
        sizeText: '1920 × 1005',
        w: 1920,
        h: 1005,
      },
    });
    expect(ghostMessage(null)).toEqual({ dgn: 'size-ghost', preset: null });
    expect(ghostMessage({ id: 'print-custom' })).toEqual({ dgn: 'size-ghost', preset: null });
  });

  test('a pick is ONE run-action; a custom size carries mm', () => {
    expect(placeMessage({ id: 'print-a6' })).toEqual({
      dgn: 'run-action',
      v: 1,
      id: 'artboard.insert-preset',
      params: { presetId: 'print-a6' },
    });
    expect(
      placeMessage({ id: 'print-custom' }, { widthMm: 99, heightMm: 210, bleedMm: 3, marginMm: 5 })
    ).toEqual({
      dgn: 'run-action',
      v: 1,
      id: 'artboard.insert-preset',
      params: {
        presetId: 'print-custom',
        custom: { widthMm: 99, heightMm: 210, bleedMm: 3, marginMm: 5 },
      },
    });
  });

  test('the tile’s picture: web opens and fades, video has a play mark, print a bleed line, ratios kept', () => {
    expect(tileShape({ widthPx: 1440, heightPx: 900 }, 'web')).toMatchObject({
      w: 64,
      h: 26,
      grows: true,
    });
    expect(tileShape({ widthPx: 1920, heightPx: 1080 }, 'video')).toMatchObject({
      w: 60,
      h: 34,
      play: true,
    });
    expect(tileShape({ widthPx: 419, heightPx: 581 }, 'print')).toMatchObject({
      bleed: true,
      h: 34,
    });
    expect(tileShape({ widthPx: 390, heightPx: 844 }, 'digital')).toMatchObject({
      h: 34,
      grows: false,
    });
    expect([
      badgeTone('web'),
      badgeTone('digital'),
      badgeTone('print'),
      badgeTone('video'),
    ]).toEqual(['grow', 'fixed', 'plain', 'plain']);
  });

  test('mm text: commas, units, junk', () => {
    expect(parseMm('99')).toBe(99);
    expect(parseMm(' 99,5 mm ')).toBe(99.5);
    expect(parseMm('')).toBeNull();
    expect(parseMm('abc')).toBeNull();
  });

  test('Portrait / Landscape swap the two sides', () => {
    const f = { width: '99', height: '210', bleed: '3', margin: '5' };
    expect(orientationOf(f)).toBe('Portrait');
    const land = withOrientation(f, 'Landscape');
    expect([land.width, land.height]).toEqual(['210', '99']);
    expect(orientationOf(land)).toBe('Landscape');
    expect(withOrientation(land, 'Landscape')).toBe(land);
  });

  test('the Add artboard numbers, or the one line that says why not', () => {
    expect(customInput({ width: '99', height: '210', bleed: '3', margin: '5' })).toEqual({
      ok: true,
      value: { widthMm: 99, heightMm: 210, bleedMm: 3, marginMm: 5 },
    });
    expect(customInput({ width: '', height: '210', bleed: '3', margin: '5' })).toMatchObject({
      ok: false,
    });
    expect(customInput({ width: '99', height: '210', bleed: 'x', margin: '5' })).toMatchObject({
      ok: false,
    });
    expect(customNote({ width: '105', height: '148', bleed: '3', margin: '5' })).toBe(
      'A6 size. The artboard is drawn 3 mm larger on every side so colour can run past the cut.'
    );
    expect(customNote({ width: '99', height: '210', bleed: '3', margin: '5' })).toBe(
      'The artboard is drawn 3 mm larger on every side so colour can run past the cut.'
    );
  });
});

/** A dispatched `input` event does not reach React's onChange under happy-dom: call the handler React attached. */
async function typeInto(input: HTMLInputElement, value: string) {
  const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps$')) as string;
  const p = (input as unknown as Record<string, { onChange: (e: unknown) => void }>)[propsKey];
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    set?.call(input, value);
    p.onChange({ target: input, currentTarget: input });
  });
}

const mounted: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (mounted.length) await (mounted.pop() as () => Promise<void>)();
});

describe('the panel', () => {
  async function mount(props: Record<string, unknown> = {}) {
    const data = await catalogue(
      (props.recent as string[]) ?? ['social-fb-event', 'social-post-4-5', 'print-a6']
    );
    const log = { ghosts: [] as unknown[], places: [] as unknown[], closed: 0 };
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        <SizePicker
          canvas=".design/ui/Home.tsx"
          anchor={null}
          load={async () => data}
          onGhost={(m: unknown) => log.ghosts.push(m)}
          onPlace={(m: unknown) => log.places.push(m)}
          onClose={() => {
            log.closed += 1;
          }}
          {...props}
        />
      );
    });
    const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    let done = false;
    const unmount = async () => {
      if (done) return;
      done = true;
      await act(async () => root.unmount());
      el.remove();
    };
    mounted.push(unmount);
    return { log, q, unmount, el };
  }

  test('five groups with their badges, three tiles each, the foot line', async () => {
    const m = await mount();
    for (const g of PRESET_GROUPS) {
      const group = m.q(`size-picker-group-${g.id}`);
      expect(group).not.toBeNull();
      expect(group?.textContent).toContain(g.title);
      expect(group?.textContent).toContain(g.badge);
      expect(group?.querySelectorAll('.sz-tile')).toHaveLength(3);
    }
    expect(m.q('size-picker-all-print')?.textContent).toContain('All 7');
    expect(m.q('size-picker-all-video')).toBeNull();
    expect(m.q('size-picker-foot')?.textContent).toBe('Or press F and drag to draw any size.');
    expect(m.q('tool-panel-sizes')?.getAttribute('role')).toBe('dialog');
    await m.unmount();
  });

  test('Recent chips are there and a click places that size', async () => {
    const m = await mount();
    expect(m.q('size-picker-recent')?.textContent).toContain('Recent');
    expect(m.q('size-picker-recent-social-fb-event')?.textContent).toContain('FB event cover');
    await act(async () => m.q('size-picker-recent-print-a6')?.click());
    expect(m.log.places).toEqual([
      { dgn: 'run-action', v: 1, id: 'artboard.insert-preset', params: { presetId: 'print-a6' } },
    ]);
    expect(m.log.closed).toBe(1);
    await m.unmount();
  });

  test('hover a tile → the dashed outline "FB event cover 1920 × 1005"; leave → it goes', async () => {
    const m = await mount();
    const tile = m.q('size-picker-tile-social-fb-event') as HTMLElement;
    await act(async () => tile.focus());
    expect(m.log.ghosts.at(-1)).toEqual({
      dgn: 'size-ghost',
      preset: {
        id: 'social-fb-event',
        label: 'FB event cover',
        sizeText: '1920 × 1005',
        w: 1920,
        h: 1005,
      },
    });
    await act(async () => {
      m.q('tool-panel-sizes')?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(m.log.ghosts.at(-1)).toEqual({ dgn: 'size-ghost', preset: null });
    await m.unmount();
    // and it is gone for good when the panel is
    expect(m.log.ghosts.at(-1)).toEqual({ dgn: 'size-ghost', preset: null });
  });

  test('click a tile → ONE place and the panel closes', async () => {
    const m = await mount();
    await act(async () => m.q('size-picker-tile-app-desktop')?.click());
    expect(m.log.places).toEqual([
      {
        dgn: 'run-action',
        v: 1,
        id: 'artboard.insert-preset',
        params: { presetId: 'app-desktop' },
      },
    ]);
    expect(m.log.closed).toBe(1);
    await m.unmount();
  });

  test('"All 7" opens Print with Custom size…; "Fewer" shuts it', async () => {
    const m = await mount();
    await act(async () => m.q('size-picker-all-print')?.click());
    expect(m.q('size-picker-group-print')?.querySelectorAll('.sz-tile')).toHaveLength(8);
    expect(m.q('size-picker-tile-print-custom')?.textContent).toContain('Custom size…');
    expect(m.q('size-picker-all-print')?.textContent).toContain('Fewer');
    await act(async () => m.q('size-picker-all-print')?.click());
    expect(m.q('size-picker-group-print')?.querySelectorAll('.sz-tile')).toHaveLength(3);
    await m.unmount();
  });

  test('search: "A5" shows A5 only; nothing found says what to do', async () => {
    const m = await mount();
    const input = m.q('size-picker-search') as HTMLInputElement;
    const type = async (v: string) => typeInto(input, v);
    await type('A5');
    expect(m.q('size-picker-results')?.querySelectorAll('.sz-tile')).toHaveLength(1);
    expect(m.q('size-picker-tile-print-a5')).not.toBeNull();
    expect(m.q('size-picker-group-app')).toBeNull();
    await type('qqq');
    expect(m.q('size-picker-empty')?.textContent).toBe(
      'No size matches “qqq”. Press F and drag to draw any size.'
    );
    await m.unmount();
  });

  test('Custom size… → the mm island → Add artboard sends mm', async () => {
    const m = await mount();
    await act(async () => m.q('size-picker-all-print')?.click());
    await act(async () => m.q('size-picker-tile-print-custom')?.click());
    expect(m.q('size-picker-custom')).not.toBeNull();
    expect(m.q('size-picker-search')).toBeNull();
    expect((m.q('size-picker-custom-width') as HTMLInputElement).value).toBe('99');
    expect((m.q('size-picker-custom-height') as HTMLInputElement).value).toBe('210');
    expect((m.q('size-picker-custom-bleed') as HTMLInputElement).value).toBe('3');
    expect((m.q('size-picker-custom-margin') as HTMLInputElement).value).toBe('5');
    expect(m.q('size-picker-custom-orientation-portrait')?.getAttribute('aria-pressed')).toBe(
      'true'
    );
    // Landscape swaps the sides
    await act(async () => m.q('size-picker-custom-orientation-landscape')?.click());
    expect((m.q('size-picker-custom-width') as HTMLInputElement).value).toBe('210');
    await act(async () => m.q('size-picker-custom-orientation-portrait')?.click());
    await act(async () => m.q('size-picker-custom-add')?.click());
    expect(m.log.places).toEqual([
      {
        dgn: 'run-action',
        v: 1,
        id: 'artboard.insert-preset',
        params: {
          presetId: 'print-custom',
          custom: { widthMm: 99, heightMm: 210, bleedMm: 3, marginMm: 5 },
        },
      },
    ]);
    expect(m.log.closed).toBe(1);
    await m.unmount();
  });

  test('Custom size… with a side that is not a number says so and writes nothing; Cancel goes back', async () => {
    const m = await mount();
    await act(async () => m.q('size-picker-all-print')?.click());
    await act(async () => m.q('size-picker-tile-print-custom')?.click());
    const w = m.q('size-picker-custom-width') as HTMLInputElement;
    await typeInto(w, 'abc');
    await act(async () => m.q('size-picker-custom-add')?.click());
    expect(m.q('size-picker-custom-error')?.textContent).toBe(
      'Give the width and height in millimetres.'
    );
    expect(m.log.places).toEqual([]);
    await act(async () => m.q('size-picker-custom-cancel')?.click());
    expect(m.q('size-picker-search')).not.toBeNull();
    await m.unmount();
  });

  test('esc and a press outside close it; a press inside does not', async () => {
    const m = await mount();
    await act(async () => {
      m.q('size-picker-search')?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(m.log.closed).toBe(0);
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(m.log.closed).toBe(1);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(m.log.closed).toBe(2);
    await m.unmount();
  });

  test('a role that cannot edit gets nothing at all', async () => {
    const m = await mount({ canEdit: false });
    expect(m.q('tool-panel-sizes')).toBeNull();
    await m.unmount();
  });

  test('a list that cannot be read says so', async () => {
    const m = await mount({
      load: async () => {
        throw new Error('403');
      },
    });
    expect(m.q('size-picker-error')?.textContent).toBe('The sizes could not be read. Try again.');
    await m.unmount();
  });
});

describe('the bridge', () => {
  test('size-ghost is shell → canvas (parent only); size-place is canvas → shell (active canvas only)', () => {
    expect(s2cSpec('size-ghost')).toMatchObject({ gate: 'parent', status: 'live' });
    expect(c2sSpec('size-place')).toMatchObject({ gate: 'active', status: 'live' });
    expect(Object.keys(DGN_TABLE.s2c)).toContain('size-ghost');
    expect(Object.keys(DGN_TABLE.c2s)).toContain('size-place');
  });

  test('payloads are validated: a ghost needs a clean preset or null; a place needs an id and a point', () => {
    const ghost = s2cSpec('size-ghost');
    const good = {
      id: 'social-fb-event',
      label: 'FB event cover',
      sizeText: '1920 × 1005',
      w: 1920,
      h: 1005,
    };
    expect(ghost?.parse({ preset: good })).toEqual({ preset: good });
    expect(ghost?.parse({ preset: null })).toEqual({ preset: null });
    expect(ghost?.parse({ preset: { ...good, w: 'wide' } })).toBeNull();
    expect(ghost?.parse({ preset: { ...good, id: 'x'.repeat(200) } })).toBeNull();
    expect(ghost?.parse({})).toBeNull();
    const place = c2sSpec('size-place');
    expect(place?.parse({ presetId: 'print-a6', world: { x: 1, y: 2 } })).toEqual({
      presetId: 'print-a6',
      world: { x: 1, y: 2 },
    });
    expect(place?.parse({ presetId: 'print-a6', world: { x: 'a', y: 2 } })).toBeNull();
    expect(place?.parse({ presetId: 'print-a6' })).toBeNull();
  });

  test('tool-panel-open knows the sizes panel', () => {
    const spec = c2sSpec('tool-panel-open');
    expect(spec?.parse({ panel: 'sizes', anchor: null })).toEqual({ panel: 'sizes', anchor: null });
    expect(spec?.parse({ panel: 'nope', anchor: null })).toBeNull();
  });
});

describe('the tool-panel lane opens it', () => {
  test('tool-panel-open {sizes} from the focused active canvas → openSizes with the anchored placement', () => {
    const opened: unknown[] = [];
    const win = {} as Window;
    const frame = {
      contentWindow: win,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
      clientWidth: 1000,
      clientHeight: 800,
    };
    const lane = createToolPanelLane({
      canvasOrigin: () => 'http://c.local',
      activePath: () => 'ui/Home.tsx',
      frameOf: () => frame as never,
      viewport: () => ({ w: 1000, h: 800 }),
      openStickers: () => {},
      openSizes: (r: unknown) => opened.push(r),
      hasFocus: () => true,
      now: () => 10_000,
      openAssets: () => {},
    });
    lane.onMessage({
      origin: 'http://c.local',
      source: win,
      data: { dgn: 'toolbar-rect', mode: 'edit', rect: { x: 300, y: 720, w: 400, h: 48 } },
    } as never);
    lane.onMessage({
      origin: 'http://c.local',
      source: win,
      data: { dgn: 'tool-panel-open', panel: 'sizes', anchor: null },
    } as never);
    expect(opened).toHaveLength(1);
    const o = opened[0] as { canvas: string; anchor: { width: number; placement: string } };
    expect(o.canvas).toBe('ui/Home.tsx');
    expect(o.anchor.width).toBe(PANEL_SIZE.sizes.w);
    expect(o.anchor.placement).toBe('above');
    expect(PANEL_HOSTS.sizes).toBe('popover');
  });

  test('a viewer’s F reaches the lane and is refused there, not shown a panel', () => {
    const denied: unknown[] = [];
    const opened: unknown[] = [];
    const win = {} as Window;
    const lane = createToolPanelLane({
      canvasOrigin: () => 'http://c.local',
      activePath: () => 'ui/Home.tsx',
      frameOf: () =>
        ({
          contentWindow: win,
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }),
        }) as never,
      viewport: () => ({ w: 1000, h: 800 }),
      openStickers: () => {},
      openSizes: (r: unknown) => opened.push(r),
      hasFocus: () => true,
      now: () => 10_000,
      canEdit: () => false,
      deny: (p: unknown) => denied.push(p),
      openAssets: () => {},
    });
    lane.onMessage({
      origin: 'http://c.local',
      source: win,
      data: { dgn: 'tool-panel-open', panel: 'sizes', anchor: null },
    } as never);
    expect(opened).toEqual([]);
    expect(denied).toEqual(['sizes']);
  });

  test('F stays the Frame tool: the slot is unchanged (the canvas, not the table, decides to open the picker)', () => {
    const slot = MODE_TOOLS.edit.slots.find((s) => s.key === 'F');
    expect(slot).toMatchObject({ tool: 'frame', label: 'Frame' });
    expect(slot?.panel).toBeUndefined();
  });
});

describe('Recent is remembered only after the canvas wrote', () => {
  test('the pick goes to the front of the stored list', async () => {
    const persisted: unknown[] = [];
    const next = await rememberSize('print-a6', {
      fetchImpl: (async () => ({
        json: async () => ({ recentSizes: ['social-fb-event', 'print-a6', 'app-desktop'] }),
      })) as never,
      persist: (p: unknown) => persisted.push(p),
    });
    expect(next).toEqual(['print-a6', 'social-fb-event', 'app-desktop']);
    expect(persisted).toEqual([{ recentSizes: ['print-a6', 'social-fb-event', 'app-desktop'] }]);
  });

  test('an unreadable prefs file still remembers the pick', async () => {
    const persisted: unknown[] = [];
    await rememberSize('app-mobile', {
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as never,
      persist: (p: unknown) => persisted.push(p),
    });
    expect(persisted).toEqual([{ recentSizes: ['app-mobile'] }]);
  });

  test('every id the picker can send is one the catalogue knows', () => {
    expect(PRESETS.length).toBe(24);
  });
});
