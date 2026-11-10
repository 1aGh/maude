// #217 — the canvas's Light | Dark pill overlapped the shell's top islands (2.1.0 native, report r-cbf1db3d): it was
// centred on the frame (`left: 50%`) and knew nothing about the project pill (top left) or the Share cluster (top
// right). At 1436 px with a cloud project's wider cluster it ran ~40 px under the cluster; on a local project 89 px at
// 1100 and 139 px at 1000. Now the shell reports the free top band with its `occluded-insets` (`topBand`) and the pill
// is a two-line "dynamic island" centred in it, never wider than it; short of room the path line goes first.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

type Box = { left: number; top: number; right: number; bottom: number };

/** The shell's top row at a window width, as measured in the real shell (W6, WebKit): the project pill at 16 px from
 *  the left, the Share cluster 16 px from the right — ~380 px wide on a local project, ~500 px on a cloud one. */
function topRow(width: number, clusterWidth: number) {
  const frame: Box = { left: 0, top: 0, right: width, bottom: 900 };
  const projectPill: Box = { left: 16, top: 16, right: 264, bottom: 60 };
  const cluster: Box = {
    left: width - 16 - clusterWidth,
    top: 16,
    right: width - 16,
    bottom: 60,
  };
  return { frame, projectPill, cluster };
}

const CASES = [
  { width: 1436, cluster: 500, what: 'cloud project' },
  { width: 1280, cluster: 380, what: 'local project' },
  { width: 1100, cluster: 380, what: 'local project' },
  { width: 1000, cluster: 380, what: 'local project' },
];

/** The pill as the frame draws it: centred on `left`, as wide as its content up to `maxWidth`. */
const pillBox = (left: number, maxWidth: number, natural: number): Box => {
  const w = Math.min(natural, maxWidth);
  return { left: left - w / 2, right: left + w / 2, top: 16, bottom: 60 };
};
const intersects = (a: Box, b: Box) =>
  Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
  Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);

// the old pill's natural width with a path and Canvas | Pages beside Light | Dark (W6: ~560 px)
const NATURAL = 560;

describe('the shell measures the free top band', () => {
  for (const c of CASES)
    test(`${c.width} px, ${c.what}: the band runs from the project pill to the cluster`, async () => {
      const { topBandFromIslands } = await import('../bridge/occlusion.ts');
      const { frame, projectPill, cluster } = topRow(c.width, c.cluster);
      const band = topBandFromIslands(frame, [
        { rect: projectPill, edge: 'top' },
        { rect: cluster, edge: 'top' },
        // a floating side panel (edge left) below the top row never narrows the band
        { rect: { left: 16, top: 72, right: 316, bottom: 880 }, edge: 'left' },
      ]);
      expect(band).toEqual({ left: projectPill.right, right: cluster.left });
    });

  test('no top islands: the whole frame; a docked (off-frame) island counts for nothing; no room: null', async () => {
    const { topBandFromIslands } = await import('../bridge/occlusion.ts');
    const frame = { left: 300, top: 0, right: 1300, bottom: 900 };
    expect(topBandFromIslands(frame, [])).toEqual({ left: 0, right: 1000 });
    expect(
      topBandFromIslands(frame, [
        { rect: { left: 16, top: 16, right: 280, bottom: 60 }, edge: 'top' },
      ])
    ).toEqual({ left: 0, right: 1000 });
    expect(
      topBandFromIslands(frame, [
        { rect: { left: 300, top: 16, right: 820, bottom: 60 }, edge: 'top' },
        { rect: { left: 790, top: 16, right: 1300, bottom: 60 }, edge: 'top' },
      ])
    ).toBeNull();
  });

  test('measureShellTopBand reads the [data-occludes] islands against the frame', async () => {
    const { measureShellTopBand } = await import('../client/v2/shell/occlusion-insets.js');
    const el = (r: Box, attrs: Record<string, string> = {}) => ({
      getBoundingClientRect: () => ({ ...r, width: r.right - r.left, height: r.bottom - r.top }),
      getAttribute: (k: string) => attrs[k] ?? null,
    });
    const { frame, projectPill, cluster } = topRow(1100, 380);
    const root = {
      querySelectorAll: () => [
        el(projectPill, { 'data-occludes': 'top' }),
        el(cluster, { 'data-occludes': 'top' }),
      ],
    };
    expect(measureShellTopBand(el(frame), root)).toEqual({ left: 264, right: 704 });
    expect(measureShellTopBand(el(frame), root, { presenting: true })).toBeNull();
    expect(measureShellTopBand(null, root)).toBeNull();
  });
});

describe('the pill fits the band at the report widths', () => {
  for (const c of CASES)
    test(`${c.width} px, ${c.what}: the pill box misses both islands`, async () => {
      const { topBandFromIslands } = await import('../bridge/occlusion.ts');
      const { pillPlacement } = await import('../canvas-theme-pill.tsx');
      const { frame, projectPill, cluster } = topRow(c.width, c.cluster);
      const band = topBandFromIslands(frame, [
        { rect: projectPill, edge: 'top' },
        { rect: cluster, edge: 'top' },
      ]);
      const place = pillPlacement(band, c.width);
      expect(place.banded).toBe(true);
      const box = pillBox(place.left, place.maxWidth, NATURAL);
      expect(intersects(box, projectPill)).toBe(false);
      expect(intersects(box, cluster)).toBe(false);
    });

  test('no band (an older shell): the frame centre, as before', async () => {
    const { pillPlacement } = await import('../canvas-theme-pill.tsx');
    expect(pillPlacement(null, 1200)).toEqual({ left: 600, maxWidth: 1176, banded: false });
    // a band past the frame is clamped to it; one wholly outside falls back
    expect(pillPlacement({ left: 200, right: 5000 }, 1000)).toMatchObject({
      left: 600,
      banded: true,
    });
    expect(pillPlacement({ left: 1200, right: 1300 }, 1000).banded).toBe(false);
  });

  test('the path line goes first, then the name truncates', async () => {
    const { showPathLine, PATH_MIN_PX } = await import('../canvas-theme-pill.tsx');
    // room for both → both
    expect(showPathLine(300, 80, 240)).toBe(true);
    // the path may lose its middle down to PATH_MIN_PX, the name stays whole
    expect(showPathLine(PATH_MIN_PX, 80, 240)).toBe(true);
    // less than that → the path goes, while the name still fits
    expect(showPathLine(PATH_MIN_PX - 1, 80, 240)).toBe(false);
    // a name that no longer fits whole never shares the column with the path
    expect(showPathLine(150, 160, 120)).toBe(false);
    // no path at all → nothing to show
    expect(showPathLine(500, 80, 0)).toBe(false);
  });
});

describe('the occluded-insets row carries an optional topBand', () => {
  const parse = async (raw: Record<string, unknown>) => {
    const { DGN_TABLE } = await import('../bridge/dgn-protocol.ts');
    return DGN_TABLE.s2c['occluded-insets'].parse(raw) as {
      seq: number;
      insets: unknown;
      topBand?: unknown;
    } | null;
  };
  const INS = { top: 68, right: 0, bottom: 0, left: 0 };

  test('valid: kept, rounded', async () => {
    const out = await parse({ seq: 2, insets: INS, topBand: { left: 264.4, right: 703.6 } });
    expect(out?.topBand).toEqual({ left: 264, right: 704 });
    expect(out?.insets).toEqual(INS);
  });

  test('absent (an older shell): no topBand, the insets apply', async () => {
    const out = await parse({ seq: 2, insets: INS });
    expect(out).not.toBeNull();
    expect(out && 'topBand' in out).toBe(false);
  });

  test('invalid: the band is dropped, never the insets the camera needs', async () => {
    for (const topBand of [
      { left: 500, right: 500 },
      { left: 600, right: 500 },
      { left: -1, right: 500 },
      { left: 0, right: 1e9 },
      { left: Number.NaN, right: 500 },
      { left: 0, right: Number.POSITIVE_INFINITY },
      { left: '0', right: 500 },
      [0, 500],
      'wide',
      null,
    ]) {
      const out = await parse({ seq: 2, insets: INS, topBand });
      expect(out, JSON.stringify(topBand)).not.toBeNull();
      expect(out?.insets).toEqual(INS);
      expect(out && 'topBand' in out, JSON.stringify(topBand)).toBe(false);
    }
  });
});

describe('the shell pump sends the band', () => {
  test('a band change alone is a send; the band rides along, and a seed carries it', async () => {
    const { createInsetsPump } = await import('../client/v2/shell/occlusion-insets.js');
    const ins = { top: 68, right: 0, bottom: 0, left: 0 };
    let band: { left: number; right: number } | null = { left: 264, right: 704 };
    const sent: Array<{ seq: number; to: unknown; band: unknown }> = [];
    const frames: Array<() => void> = [];
    const pump = createInsetsPump({
      measure: () => ins,
      measureBand: () => band,
      send: (seq: number, _i: unknown, to: unknown, b: unknown) => sent.push({ seq, to, band: b }),
      schedule: (fn: () => void) => {
        frames.push(fn);
      },
    });
    const tick = () => {
      for (const fn of frames.splice(0)) fn();
    };
    pump.request();
    tick();
    pump.request();
    tick(); // unchanged → nothing
    band = { left: 264, right: 584 }; // the cluster grew (a cloud project signed in)
    pump.request();
    tick();
    pump.seed('frame-a');
    expect(sent.map((s) => s.band)).toEqual([
      { left: 264, right: 704 },
      { left: 264, right: 584 },
      { left: 264, right: 584 },
    ]);
    expect(sent[2]?.to).toBe('frame-a');
  });
});

describe('the canvas pill', () => {
  let root: { unmount(): void } | null = null;
  afterEach(async () => {
    const { act } = await import('react');
    await act(async () => {
      root?.unmount();
    });
    root = null;
    document.body.innerHTML = '';
    const { __resetCanvasTheme } = await import('../canvas-theme.ts');
    __resetCanvasTheme();
  });

  const mount = async () => {
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { CanvasThemePill } = await import('../canvas-theme-pill.tsx');
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    const host = document.createElement('div');
    document.body.append(host);
    const r = createRoot(host);
    root = r;
    act(() => r.render(<CanvasThemePill bothThemes={() => true} />));
    const pill = document.querySelector<HTMLElement>('[data-testid="canvas-theme-pill"]');
    if (!pill) throw new Error('no pill');
    return pill;
  };

  test('two lines: the path on top (smaller, grey, the text-safe grade), the name and Light | Dark under it', async () => {
    const { registerCanvasThemeSystem } = await import('../canvas-theme.ts');
    registerCanvasThemeSystem({ name: 'StudyFi v3', themeDefault: null });
    (window as unknown as { __canvas_meta_file__: string }).__canvas_meta_file__ =
      '.design/ui/studyfi/Team/team-structure.tsx';
    const pill = await mount();
    // Michal: the path is its own line ABOVE the buttons — never beside them
    const lines = [...pill.children].map((c) => c.getAttribute('data-testid'));
    expect(lines).toEqual(['canvas-theme-path', 'canvas-theme-row']);
    const row = pill.querySelector('[data-testid="canvas-theme-row"]');
    expect(row?.querySelector('[data-testid="canvas-theme-title"]')?.textContent).toBe(
      'StudyFi v3'
    );
    expect(row?.querySelector('[data-testid="canvas-theme-mode-light"]')).not.toBeNull();
    expect(row?.querySelector('[data-testid="canvas-theme-path"]')).toBeNull();
    const css = document.querySelector('style[data-dc-theme-pill-css]')?.textContent ?? '';
    expect(css).toMatch(/\.dc-theme-pill\{[^}]*flex-direction:column/);
    const pathRule = css.match(/\.dc-theme-pill-path\{[^}]*\}/)?.[0] ?? '';
    expect(pathRule).toContain('color:var(--maude-chrome-fg-2)');
    expect(pathRule).toContain('font-size:var(--maude-hud-type-2xs,10px)');
    expect(pathRule).toContain('text-overflow:ellipsis');
    // the path line can step aside without leaving the flow wide
    expect(css).toMatch(/\[data-path="hidden"\] \.dc-theme-pill-path\{[^}]*visibility:hidden/);
  });

  test('a canvas with no design system: the path still on its own line above the buttons', async () => {
    (window as unknown as { __canvas_meta_file__: string }).__canvas_meta_file__ =
      '.design/ui/2026/dresy/Uniformy-2027.tsx';
    const pill = await mount();
    const lines = [...pill.children].map((c) => c.getAttribute('data-testid'));
    expect(lines).toEqual(['canvas-theme-path', 'canvas-theme-row']);
    const row = pill.querySelector('[data-testid="canvas-theme-row"]');
    expect(row?.querySelector('[data-testid="canvas-theme-path"]')).toBeNull();
  });

  test('centred in the band the shell sends, never wider than it; an older shell centres on the frame', async () => {
    const { act } = await import('react');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1100 });
    const pill = await mount();
    expect(pill.getAttribute('data-band')).toBe('frame');
    expect(pill.style.left).toBe('550px');
    const { canvasModeStore } = await import('../bridge/canvas-mode-store.ts');
    const seq = canvasModeStore(window).get().insetsSeq + 1;
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window.parent,
          data: {
            dgn: 'occluded-insets',
            seq,
            insets: { top: 68, right: 0, bottom: 0, left: 0 },
            topBand: { left: 264, right: 704 },
          },
        })
      );
    });
    expect(canvasModeStore(window).get().topBand).toEqual({ left: 264, right: 704 });
    expect(pill.getAttribute('data-band')).toBe('band');
    expect(pill.style.left).toBe('484px');
    expect(pill.style.maxWidth).toBe(`${704 - 264 - 24}px`);
    // the next insets without a band (an older shell, Present) put it back on the frame
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window.parent,
          data: {
            dgn: 'occluded-insets',
            seq: seq + 1,
            insets: { top: 0, right: 0, bottom: 0, left: 0 },
          },
        })
      );
    });
    expect(canvasModeStore(window).get().topBand).toBeNull();
    expect(pill.style.left).toBe('550px');
  });
});
