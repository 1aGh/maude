import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 14 Editing — artboards, part 1 (S2.8): select an artboard, resize it from a handle onto a preset, and the long
 * page. WRITTEN, NOT RUN in the S2.8 hand-back (the lead runs the desktop lane).
 *
 * Driving model: same as canvas-text-editing.e2e.ts — the pilot runs with MAUDE_CANVAS_ORIGIN_SPLIT=0, so the
 * canvas iframe is same-origin and events are dispatched synthetically inside it. Coordinates come from the
 * canvas's own `window.__maudeCanvasRects()` manifest (world px) and the live DOM rects (frame-local px), never
 * from a selector that has to cross the origin split.
 *
 * The scenario WRITES through to disk (the `artboard.resize` edit-op rewrites the JSX width), so the committed
 * fixture file is snapshotted and restored byte-exact by the fixture guard.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SMOKE = join(HERE, '../fixtures/project/.design/ui/Smoke.tsx');
const fixtures = createFixtureGuard('edit-artboards', [SMOKE]);
const ARTBOARD = 'smoke'; // <DCArtboard id="smoke" ... width={480} height={320}>

type Hud = {
  selected: boolean;
  size: string | null;
  handles: string[];
  bubble: string | null;
  litTick: string | null;
  ghost: boolean;
  east: { x: number; y: number } | null;
  zoom: number;
};

/** Everything the scenario asserts about the selected artboard, read inside the canvas frame. */
function hud(): Promise<Hud> {
  return browser.execute((id) => {
    const iframe = document.querySelector(
      '[data-testid="canvas-frame"]'
    ) as HTMLIFrameElement | null;
    const doc = iframe?.contentDocument;
    const empty = {
      selected: false,
      size: null,
      handles: [],
      bubble: null,
      litTick: null,
      ghost: false,
      east: null,
      zoom: 1,
    };
    if (!doc) return empty as never;
    const art = doc.querySelector(`[data-dc-screen="${id}"]`) as HTMLElement | null;
    const body = art?.querySelector('.dc-artboard-body') as HTMLElement | null;
    const e = doc.querySelector('[data-testid="ed-ab-handle-e"]') as HTMLElement | null;
    const er = e?.getBoundingClientRect();
    const br = body?.getBoundingClientRect();
    return {
      selected: !!art?.hasAttribute('data-ed-selected'),
      size: art?.querySelector('.dc-artboard-label')?.getAttribute('data-ed-size') ?? null,
      handles: [...doc.querySelectorAll('[data-testid^="ed-ab-handle-"]')]
        .filter((h) => (h as HTMLElement).style.display !== 'none')
        .map((h) => h.getAttribute('data-h') as string),
      bubble: doc.querySelector('[data-testid="ed-ab-bubble"]')?.textContent ?? null,
      litTick:
        doc
          .querySelector('[data-testid^="ed-ab-tick-"][data-on="true"]')
          ?.getAttribute('data-testid') ?? null,
      ghost: !!doc.querySelector('[data-testid="ed-ab-ghost"]'),
      east: er ? { x: er.left + er.width / 2, y: er.top + er.height / 2 } : null,
      zoom: br && body ? br.width / body.offsetWidth : 1,
    };
  }, ARTBOARD) as Promise<Hud>;
}

/** A synthetic pointer event on the canvas window (frame-local coords) — drives the handle's own listeners. */
function pointer(
  type: string,
  x: number,
  y: number,
  target: 'handle-e' | 'window',
  mods: Record<string, boolean> = {}
) {
  return browser.execute(
    (t, px, py, which, m) => {
      const iframe = document.querySelector(
        '[data-testid="canvas-frame"]'
      ) as HTMLIFrameElement | null;
      const doc = iframe?.contentDocument;
      const win = iframe?.contentWindow as (Window & typeof globalThis) | null;
      if (!doc || !win) return false;
      const ev = new win.MouseEvent(t, {
        bubbles: true,
        cancelable: true,
        clientX: px,
        clientY: py,
        button: 0,
        ...m,
      });
      (which === 'window'
        ? win
        : (doc.querySelector('[data-testid="ed-ab-handle-e"]') as HTMLElement)
      ).dispatchEvent(ev);
      return true;
    },
    type,
    x,
    y,
    target,
    mods
  );
}

describe('edit-artboards (part 1) — select, resize onto a preset, long page', () => {
  before(() => {
    rmSync(join(HERE, '../fixtures/project/.design/_canvas-state'), {
      recursive: true,
      force: true,
    });
    fixtures.snapshot();
    startReport('edit-artboards (part 1)');
  });
  after(() => fixtures.restore());

  it('opens the canvas and selects the artboard: name goes azure with its size, eight handles show', async () => {
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-smoke');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    // select the artboard the way a person does: its name, in the canvas
    await browser.execute((id) => {
      const iframe = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const label = iframe.contentDocument?.querySelector(
        `[data-dc-screen="${id}"] .dc-artboard-label`
      ) as HTMLElement;
      const win = iframe.contentWindow as Window & typeof globalThis;
      for (const t of ['pointerdown', 'pointerup', 'click'])
        label.dispatchEvent(new win.MouseEvent(t, { bubbles: true, cancelable: true, button: 0 }));
    }, ARTBOARD);
    await browser.waitUntil(async () => (await hud()).selected, {
      timeout: 15_000,
      timeoutMsg: 'artboard never selected',
    });
    const h = await hud();
    expect(h.size).toBe('480 × 320');
    expect(h.handles.sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
    await capture('artboard-selected-eight-handles');
  });

  it('drags the east edge: the ruler lights the nearest preset, the bubble names it, release writes the JSX width', async () => {
    const before = await hud();
    if (!before.east) throw new Error('no east handle');
    // 480 → 390 is the Mobile stop of the ruler: travel 90 world px = 90 × zoom screen px
    const dx = -90 * before.zoom;
    await pointer('pointerdown', before.east.x, before.east.y, 'handle-e');
    await pointer('pointermove', before.east.x + dx, before.east.y, 'window');
    const during = await hud();
    expect(during.bubble).toBe('Mobile · 390 × 320');
    expect(during.litTick).toBe('ed-ab-tick-390');
    expect(during.ghost).toBe(true);
    await capture('artboard-resize-snaps-to-mobile');
    await pointer('pointerup', before.east.x + dx, before.east.y, 'window');
    await browser.waitUntil(() => /width=\{390\}/.test(readFileSync(SMOKE, 'utf8')), {
      timeout: 15_000,
      timeoutMsg: 'the JSX width never became 390',
    });
    // size is in the JSX; position/camera did not leak into it
    expect(readFileSync(SMOKE, 'utf8')).not.toMatch(/viewport/);
  });

  it('⌘ ignores presets (the width stays where the pointer put it)', async () => {
    const before = await hud();
    if (!before.east) throw new Error('no east handle');
    await pointer('pointerdown', before.east.x, before.east.y, 'handle-e');
    await pointer('pointermove', before.east.x + 37 * before.zoom, before.east.y, 'window', {
      metaKey: true,
    });
    expect((await hud()).bubble).toMatch(/^4\d\d × 320$/); // 427, no preset name
    await pointer('pointerup', before.east.x + 37 * before.zoom, before.east.y, 'window', {
      metaKey: true,
    });
    await browser.keys('Escape');
  });

  // TODO(S2.8 part 2, needs a 6000 px fixture board): the sticky name rides the window top, the contextual minimap
  // lists the sections, a click on one pans there, and the inspector line says "You're looking at 1727–5636 of 6000."
  it.skip('a 6000 px page keeps its name stuck, shows the minimap, and says where you are', async () => {});
});

/**
 * 14 Editing — artboards, part 2 (S2.9): ⇧-click four boards, the align bar says "4 artboards" and has Tidy up; the
 * pointer on it shows dashed outlines of one even row; the click moves the boards in ONE commit (positions in the
 * `.meta.json` layout lane, never the camera file); ⌘Z puts them back. Also the bubble while one board is dragged.
 * WRITTEN, NOT RUN (the lead runs the desktop lane). The canvas is written at run time and removed after, so the
 * committed fixture set — and the other scenarios' canvas counts — stay as they are.
 */
const ARRANGE_TSX = join(HERE, '../fixtures/project/.design/ui/Arrange.tsx');
const ARRANGE_META = join(HERE, '../fixtures/project/.design/ui/Arrange.meta.json');
const BOARDS = ['one', 'two', 'three', 'four'];
const START: Array<[number, number]> = [
  [0, 40],
  [300, 90],
  [620, 0],
  [930, 120],
];

const arrangeSource =
  () => `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Arrange() {
  return (
    <DesignCanvas>
      <DCSection id="arrange" title="Arrange" subtitle="S2.9">
${BOARDS.map((id) => `        <DCArtboard id="${id}" label="Board ${id}" width={240} height={320} fixed>\n          <div data-cd-id="${id}-body" style={{ padding: 16 }}>{"${id}"}</div>\n        </DCArtboard>`).join('\n')}
      </DCSection>
    </DesignCanvas>
  );
}
`;
const arrangeMeta = () =>
  JSON.stringify(
    {
      title: 'Arrange',
      sections: [
        {
          id: 'arrange',
          title: 'Arrange',
          artboards: BOARDS.map((id) => ({ id, label: `Board ${id}`, width: 240, height: 320 })),
        },
      ],
      layout: { artboards: BOARDS.map((id, i) => ({ id, x: START[i]?.[0], y: START[i]?.[1] })) },
    },
    null,
    2
  );

const layoutOf = () =>
  (
    JSON.parse(readFileSync(ARRANGE_META, 'utf8')) as {
      layout: { artboards: Array<{ id: string; x: number; y: number }> };
    }
  ).layout.artboards;

/** Dispatch pointer/click events on a board's name inside the canvas frame. */
function onLabel(id: string, types: string[], mods: Record<string, number | boolean> = {}) {
  return browser.execute(
    (bid, ts, m) => {
      const iframe = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const win = iframe.contentWindow as Window & typeof globalThis;
      const label = iframe.contentDocument?.querySelector(
        `[data-dc-screen="${bid}"] .dc-artboard-label`
      ) as HTMLElement;
      for (const t of ts)
        label.dispatchEvent(
          new win.MouseEvent(t, { bubbles: true, cancelable: true, button: 0, ...m })
        );
    },
    id,
    types,
    mods
  );
}

/** Run a small read inside the canvas frame (the function text is evaluated there, with its document). */
const inFrame = <T>(fn: (doc: Document) => T) =>
  browser.execute((src) => {
    const iframe = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    return new Function('doc', `return (${src})(doc)`)(iframe.contentDocument);
  }, fn.toString()) as Promise<T>;

describe('edit-artboards (part 2) — arrange: Tidy up', () => {
  before(() => {
    fixtures.snapshot();
    writeFileSync(ARRANGE_TSX, arrangeSource());
    writeFileSync(ARRANGE_META, arrangeMeta());
    startReport('edit-artboards (part 2)');
  });
  after(() => {
    rmSync(ARRANGE_TSX, { force: true });
    rmSync(ARRANGE_META, { force: true });
    fixtures.restore();
  });

  it('⇧-click four boards: the align bar says "4 artboards" and offers Tidy up', async () => {
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-arrange');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    await onLabel('one', ['pointerdown', 'pointerup', 'click']);
    for (const id of BOARDS.slice(1))
      await onLabel(id, ['pointerdown', 'pointerup', 'click'], { shiftKey: true });
    await browser.waitUntil(
      async () =>
        (await inFrame((d) => d.querySelector('[data-testid="edit-align-count"]')?.textContent)) ===
        '4 artboards',
      { timeout: 15_000, timeoutMsg: 'the align bar never said "4 artboards"' }
    );
    expect(await inFrame((d) => d.querySelector('[data-testid="edit-tidy"]')?.textContent)).toBe(
      'Tidy up'
    );
    await capture('artboards-selected-align-bar-tidy');
  });

  it('the pointer on Tidy up shows four dashed outlines in one row and writes nothing', async () => {
    const before = readFileSync(ARRANGE_META, 'utf8');
    await inFrame((d) => {
      const b = d.querySelector('[data-testid="edit-tidy"]') as HTMLElement;
      const win = d.defaultView as Window & typeof globalThis;
      b.dispatchEvent(new win.PointerEvent('pointerover', { bubbles: true }));
      return true;
    });
    const tops = await inFrame((d) =>
      [...d.querySelectorAll('[data-testid="edit-tidy-ghost"]')].map(
        (g) => (g as HTMLElement).style.top
      )
    );
    expect(tops.length).toBe(4);
    expect(new Set(tops).size).toBe(1); // one line
    await capture('tidy-preview-one-row-even-gaps');
    expect(readFileSync(ARRANGE_META, 'utf8')).toBe(before);
  });

  it('Tidy up: one row on the lowest board’s line, even gaps — positions in the layout lane, one ⌘Z back', async () => {
    await inFrame((d) => {
      (d.querySelector('[data-testid="edit-tidy"]') as HTMLElement).click();
      return true;
    });
    await browser.waitUntil(() => new Set(layoutOf().map((b) => b.y)).size === 1, {
      timeout: 15_000,
      timeoutMsg: 'the boards never landed on one line',
    });
    const row = layoutOf();
    expect(row[0]?.y).toBe(120); // the lowest board's top
    const gaps = row.slice(1).map((b, i) => b.x - ((row[i]?.x ?? 0) + 240));
    expect(new Set(gaps).size).toBe(1);
    // the camera is per user: nothing about the tidy reaches the versioned file
    expect(readFileSync(ARRANGE_META, 'utf8')).not.toMatch(/viewport|zoom/);
    await browser.keys(['Meta', 'z']);
    await browser.waitUntil(
      () => JSON.stringify(layoutOf().map((b) => [b.x, b.y])) === JSON.stringify(START),
      { timeout: 15_000, timeoutMsg: 'one ⌘Z did not put all four boards back' }
    );
  });

  it('dragging one board shows its place beside the pointer: "X … · Y …"', async () => {
    await onLabel('four', ['pointerdown'], { clientX: 0 });
    await onLabel('four', ['pointermove'], { clientX: 40, clientY: 8 });
    const bubble = await inFrame(
      (d) => d.querySelector('[data-testid="edit-ab-bubble"]')?.textContent ?? null
    );
    expect(bubble).toMatch(/^X -?\d+ · Y -?\d+$/);
    await capture('artboard-drag-bubble');
    await browser.keys('Escape');
  });
});
