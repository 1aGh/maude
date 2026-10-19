import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { waitForEditChrome } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 14 Editing — shapes (S2.13, ed-shape): R and a drag draws a rectangle with its live tag, the dot inside a corner
 * rounds it (one write), More › Export area opens the sheet and writes NOTHING. WRITTEN, NOT RUN in the S2.13
 * hand-back (the lead runs the desktop lane).
 *
 * Driving model: same as edit-artboards.e2e.ts — MAUDE_CANVAS_ORIGIN_SPLIT=0, so the canvas iframe is same-origin
 * and pointer events are dispatched synthetically inside it, on the overlay `[data-testid="edit-draw-input"]` the
 * armed tool puts over the canvas and on the corner dots. The scenario writes through to disk, so the fixture is
 * snapshotted and restored byte-exact by the fixture guard.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SMOKE = join(HERE, '../fixtures/project/.design/ui/Smoke.tsx');
const fixtures = createFixtureGuard('edit-shapes', [SMOKE]);
const ARTBOARD = 'smoke';

/** Run `fn` inside the canvas frame with its window; coordinates are frame-local. */
function inFrame<T>(fn: string, ...args: unknown[]): Promise<T> {
  return browser.execute(
    (src, a) => {
      const iframe = document.querySelector(
        '[data-testid="canvas-frame"]'
      ) as HTMLIFrameElement | null;
      const doc = iframe?.contentDocument;
      const win = iframe?.contentWindow;
      if (!doc || !win) return null as never;
      // biome-ignore lint/security/noGlobalEval: test-only DOM probe inside the canvas frame
      return new (win as unknown as { Function: FunctionConstructor }).Function(
        'doc',
        'win',
        'args',
        src
      )(doc, win, a);
    },
    fn,
    args
  ) as Promise<T>;
}

const fire = (type: string, x: number, y: number, target: string, mods = '{}') =>
  inFrame<boolean>(
    `const t = args[3] === 'window' ? win : doc.querySelector(args[3]);
     if (!t) return false;
     t.dispatchEvent(new win.MouseEvent(args[0], { bubbles: true, cancelable: true, clientX: args[1], clientY: args[2], button: 0, ...JSON.parse(args[4]) }));
     return true;`,
    type,
    x,
    y,
    target,
    mods
  );

/** The artboard body's screen box inside the frame, and its zoom. */
const body = () =>
  inFrame<{ x: number; y: number; w: number; h: number; zoom: number }>(
    `const b = doc.querySelector('[data-dc-screen="' + args[0] + '"] .dc-artboard-body');
     const r = b.getBoundingClientRect();
     return { x: r.left, y: r.top, w: r.width, h: r.height, zoom: r.width / b.offsetWidth };`,
    ARTBOARD
  );

const OVERLAY = '[data-testid="edit-draw-input"]';

describe('edit-shapes — draw a rectangle, round a corner, Export area writes nothing', () => {
  before(() => {
    rmSync(join(HERE, '../fixtures/project/.design/_canvas-state'), {
      recursive: true,
      force: true,
    });
    fixtures.snapshot();
    startReport('edit-shapes');
  });
  after(() => fixtures.restore());

  it('R arms the Shape tool and a drag draws a rectangle with the live tag "Rectangle · 216 × 216"', async () => {
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-smoke');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await waitForEditChrome();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    await inFrame(
      `doc.querySelector('[data-testid="toolbar-slot-el-shape"]').click(); return true;`
    );
    await browser.waitUntil(
      async () => await inFrame<boolean>(`return !!doc.querySelector('${OVERLAY}');`),
      {
        timeout: 15_000,
        timeoutMsg: 'the draw overlay never appeared',
      }
    );
    const b = await body();
    const x0 = b.x + 24 * b.zoom;
    const y0 = b.y + 24 * b.zoom;
    await fire('pointerdown', x0, y0, OVERLAY);
    await fire('pointermove', x0 + 216 * b.zoom, y0 + 216 * b.zoom, OVERLAY);
    const tag = await inFrame<string | null>(
      `return doc.querySelector('[data-testid="edit-draw-tag"]')?.textContent ?? null;`
    );
    expect(tag).toBe('Rectangle · 216 × 216');
    await capture('shape-drag-live-tag');
    await fire('pointerup', x0 + 216 * b.zoom, y0 + 216 * b.zoom, OVERLAY);
    await browser.waitUntil(() => /data-shape="rectangle"/.test(readFileSync(SMOKE, 'utf8')), {
      timeout: 15_000,
      timeoutMsg: 'the rectangle never reached the file',
    });
    const src = readFileSync(SMOKE, 'utf8');
    expect(src).toMatch(/data-cd-id="rectangle"/);
    expect(src).toMatch(/background: "var\(--accent\)"/);
  });

  it('shows a dot in each corner of the new shape; dragging one rounds it and the chip says the radius', async () => {
    await browser.waitUntil(
      async () =>
        await inFrame<boolean>(`return !!doc.querySelector('[data-testid="edit-corner-dot-bl"]');`),
      { timeout: 15_000, timeoutMsg: 'no corner dots on the selected shape' }
    );
    const dots = await inFrame<string[]>(
      `return [...doc.querySelectorAll('[data-testid^="edit-corner-dot-"]')].map((d) => d.getAttribute('data-testid'));`
    );
    expect(dots.sort()).toEqual([
      'edit-corner-dot-bl',
      'edit-corner-dot-br',
      'edit-corner-dot-tl',
      'edit-corner-dot-tr',
    ]);
    const dot = await inFrame<{ x: number; y: number; zoom: number }>(
      `const r = doc.querySelector('[data-testid="edit-corner-dot-tl"]').getBoundingClientRect();
       const b = doc.querySelector('[data-dc-screen="' + args[0] + '"] .dc-artboard-body');
       return { x: r.left + r.width / 2, y: r.top + r.height / 2, zoom: b.getBoundingClientRect().width / b.offsetWidth };`,
      ARTBOARD
    );
    await fire('pointerdown', dot.x, dot.y, '[data-testid="edit-corner-dot-tl"]');
    await fire('pointermove', dot.x + 16 * dot.zoom, dot.y + 16 * dot.zoom, 'window');
    const chip = await inFrame<string | null>(
      `return doc.querySelector('[data-testid="edit-corner-chip"]')?.textContent ?? null;`
    );
    expect(chip).toMatch(/^\d+$/);
    await capture('corner-dot-drag-chip');
    await fire('pointerup', dot.x + 16 * dot.zoom, dot.y + 16 * dot.zoom, 'window');
    await browser.waitUntil(() => /borderRadius/.test(readFileSync(SMOKE, 'utf8')), {
      timeout: 15_000,
      timeoutMsg: 'the corner radius never reached the file',
    });
  });

  it('More › Export area opens the sheet with the rectangle and the file does not change', async () => {
    const before = readFileSync(SMOKE, 'utf8');
    await inFrame(`doc.querySelector('[data-testid="toolbar-slot-more"]').click(); return true;`);
    await inFrame(`doc.querySelector('[data-testid="toolbar-more-slice"]').click(); return true;`);
    const b = await body();
    const x0 = b.x + 40 * b.zoom;
    const y0 = b.y + 40 * b.zoom;
    await fire('pointerdown', x0, y0, OVERLAY);
    await fire('pointermove', x0 + 160 * b.zoom, y0 + 90 * b.zoom, OVERLAY);
    expect(
      await inFrame<string | null>(
        `return doc.querySelector('[data-testid="edit-draw-tag"]')?.textContent ?? null;`
      )
    ).toMatch(/^Export area · \d+ × \d+$/);
    await fire('pointerup', x0 + 160 * b.zoom, y0 + 90 * b.zoom, OVERLAY);
    await capture('export-area-opens-the-sheet');
    expect(readFileSync(SMOKE, 'utf8')).toBe(before);
  });
});
