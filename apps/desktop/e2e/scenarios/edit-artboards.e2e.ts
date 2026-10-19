import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { waitForEditChrome } from '../helpers/canvas-frame';
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
    await waitForEditChrome();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    // select the artboard the way a person does: its name, in the canvas
    await browser.execute((id) => {
      const iframe = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const label = iframe.contentDocument?.querySelector(
        `[data-dc-screen="${id}"] .dc-artboard-label`
      ) as HTMLElement;
      const win = iframe.contentWindow as Window & typeof globalThis;
      // the router picks its target by the pointer's POSITION, not by where the event was fired
      const r = label.getBoundingClientRect();
      const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      for (const t of ['pointerdown', 'pointerup', 'click'])
        label.dispatchEvent(
          new win.MouseEvent(t, { bubbles: true, cancelable: true, button: 0, ...at })
        );
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
    // test 2's write re-rendered the frame and the new DOM starts with nothing selected: pick the board
    // by its name again, as a person would, until the handles are back
    await browser.waitUntil(
      async () => {
        const h = await hud();
        if (h.east) return true;
        // a second click on a selected board's name would toggle it off: pick it only when it is not
        if (!h.selected) await onLabel(ARTBOARD, ['pointerdown', 'pointerup', 'click']);
        await browser.pause(400);
        return !!(await hud()).east;
      },
      { timeout: 15_000, timeoutMsg: 'no east handle' }
    );
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
      // the router picks its target by the pointer's POSITION, not by where the event was fired
      const { dx = 0, dy = 0, ...rest } = m as Record<string, number | boolean>;
      const r = label.getBoundingClientRect();
      const at = {
        clientX: r.left + r.width / 2 + (dx as number),
        clientY: r.top + r.height / 2 + (dy as number),
      };
      for (const t of ts)
        label.dispatchEvent(
          new win.MouseEvent(t, { bubbles: true, cancelable: true, button: 0, ...at, ...rest })
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
    await waitForEditChrome();
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
    await onLabel('four', ['pointerdown']);
    await onLabel('four', ['pointermove'], { dx: 40, dy: 8 });
    const bubble = await inFrame(
      (d) => d.querySelector('[data-testid="edit-ab-bubble"]')?.textContent ?? null
    );
    expect(bubble).toMatch(/^X -?\d+ · Y -?\d+$/);
    await capture('artboard-drag-bubble');
    await browser.keys('Escape');
  });
});

/**
 * 14 Editing — artboards, part 3 (S2.10): the artboard's own menu, ⌘D at the row's gap, rename in place with Tab.
 * Right-click the name: Ask AI (greyed), Duplicate ⌘D, Duplicate at another width ▸, Rename, Export…, Advanced ▸,
 * Move to trash. ⌘D lands "Příběh 2" to the right at the gap the row uses, selected, positions in the layout lane;
 * ⌘Z takes the copy back. Double-click a name: the field is as wide as the whole name, ↵ saves, Tab opens the next
 * artboard's name. WRITTEN, NOT RUN (the lead runs the desktop lane); the canvas is written at run time and removed.
 */
const MENU_TSX = join(HERE, '../fixtures/project/.design/ui/ArtboardMenu.tsx');
const MENU_META = join(HERE, '../fixtures/project/.design/ui/ArtboardMenu.meta.json');
const MENU_START: Array<[string, string, number]> = [
  ['a', 'Příběh', 0],
  ['b', 'Druhá', 360],
];
const menuSource = () => `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function ArtboardMenu() {
  return (
    <DesignCanvas>
      <DCSection id="menu" title="Menu" subtitle="S2.10">
${MENU_START.map(([id, label]) => `        <DCArtboard id="${id}" label="${label}" width={240} height={320} fixed>\n          <div data-cd-id="${id}-body" style={{ padding: 16 }}>{"${id}"}</div>\n        </DCArtboard>`).join('\n')}
      </DCSection>
    </DesignCanvas>
  );
}
`;
const menuMeta = () =>
  JSON.stringify(
    {
      title: 'ArtboardMenu',
      layout: { artboards: MENU_START.map(([id, , x]) => ({ id, x, y: 0 })) },
    },
    null,
    2
  );
const menuLayout = () =>
  (
    JSON.parse(readFileSync(MENU_META, 'utf8')) as {
      layout: { artboards: Array<{ id: string; x: number; y: number }> };
    }
  ).layout.artboards;

describe('edit-artboards (part 3) — the artboard menu, ⌘D, rename in place', () => {
  before(() => {
    fixtures.snapshot();
    writeFileSync(MENU_TSX, menuSource());
    writeFileSync(MENU_META, menuMeta());
    startReport('edit-artboards (part 3)');
  });
  after(() => {
    rmSync(MENU_TSX, { force: true });
    rmSync(MENU_META, { force: true });
    fixtures.restore();
  });

  it('right-click the name: the menu rows in the design’s order', async () => {
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-artboardmenu');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await waitForEditChrome();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    await inFrame((d) => {
      const win = d.defaultView as Window & typeof globalThis;
      const label = d.querySelector('[data-dc-screen="a"] .dc-artboard-label') as HTMLElement;
      label.dispatchEvent(
        new win.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: label.getBoundingClientRect().left + label.getBoundingClientRect().width / 2,
          clientY: label.getBoundingClientRect().top + label.getBoundingClientRect().height / 2,
        })
      );
      return true;
    });
    const rows = await inFrame((d) =>
      [...d.querySelectorAll('[data-testid^="canvas-menu-item-"]')].map((n) =>
        (n.getAttribute('data-testid') ?? '').replace('canvas-menu-item-', '')
      )
    );
    expect(rows.slice(0, 3)).toEqual(['ask-ai', 'duplicate-artboard', 'duplicate-at-width']);
    expect(rows).toContain('rename-artboard');
    expect(rows).toContain('delete-artboard');
    await capture('artboard-menu');
    await browser.keys('Escape');
  });

  it('⌘D: “Příběh 2” lands to the right at the row’s gap; positions in the layout lane; ⌘Z takes it back', async () => {
    await onLabel('a', ['pointerdown', 'pointerup', 'click']);
    await inFrame((d) => {
      const win = d.defaultView as Window & typeof globalThis;
      d.dispatchEvent(
        new win.KeyboardEvent('keydown', {
          key: 'd',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
      return true;
    });
    await browser.waitUntil(() => readFileSync(MENU_TSX, 'utf8').includes('id="a-2"'), {
      timeout: 15_000,
      timeoutMsg: '⌘D never wrote the copy',
    });
    expect(readFileSync(MENU_TSX, 'utf8')).toContain('label="Příběh 2"');
    const copy = menuLayout().find((b) => b.id === 'a-2');
    expect(copy?.y).toBe(0);
    // b stands where the copy would first go (x 240 + 120): the copy is pushed past it, at the same gap
    expect(copy?.x).toBeGreaterThanOrEqual(360 + 240);
    await capture('artboard-duplicate-selected');
    await browser.keys(['Meta', 'z']);
    await browser.waitUntil(() => !readFileSync(MENU_TSX, 'utf8').includes('id="a-2"'), {
      timeout: 15_000,
      timeoutMsg: 'one ⌘Z did not take the copy back',
    });
  });

  it('double-click the name, Tab: the next artboard’s name opens', async () => {
    await onLabel('a', ['dblclick']);
    expect(await inFrame((d) => !!d.querySelector('[data-testid="artboard-rename-a"]'))).toBe(true);
    await inFrame((d) => {
      const win = d.defaultView as Window & typeof globalThis;
      const input = d.querySelector('[data-testid="artboard-rename-a"]') as HTMLInputElement;
      input.dispatchEvent(
        new win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      );
      return true;
    });
    await browser.waitUntil(
      async () => inFrame((d) => !!d.querySelector('[data-testid="artboard-rename-b"]')),
      { timeout: 10_000, timeoutMsg: 'Tab never opened the next name' }
    );
    await capture('artboard-rename-tab');
    await browser.keys('Escape');
  });
});
