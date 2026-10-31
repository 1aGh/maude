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

/** The artboard body once the camera has stopped moving (fit/zoom animate): two reads 250 ms apart agree. A box
 * measured mid-move puts the drag off from where the tag is computed. */
async function stableBody() {
  let prev = '';
  await browser
    .waitUntil(
      async () => {
        const b = await body();
        const cur = `${Math.round(b.x)}:${Math.round(b.y)}:${Math.round(b.w)}:${Math.round(b.h)}`;
        const same = cur === prev && b.w > 0;
        prev = cur;
        return same;
      },
      { timeout: 8_000, interval: 250 }
    )
    .catch(() => undefined);
  return body();
}

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
    const b = await stableBody();
    const x0 = b.x + 24 * b.zoom;
    const y0 = b.y + 24 * b.zoom;
    await fire('pointerdown', x0, y0, OVERLAY);
    await fire('pointermove', x0 + 216 * b.zoom, y0 + 216 * b.zoom, OVERLAY);
    // the move renders on the next frame: wait for the tag to say the size; a wrong size is still red
    const readTag = () =>
      inFrame<string | null>(
        `return doc.querySelector('[data-testid="edit-draw-tag"]')?.textContent ?? null;`
      );
    await browser
      .waitUntil(async () => (await readTag()) === 'Rectangle · 216 × 216', {
        timeout: 4_000,
        interval: 100,
      })
      .catch(() => undefined);
    const tag = await readTag();
    expect(tag).toBe('Rectangle · 216 × 216');
    await capture('shape-drag-live-tag');
    await fire('pointerup', x0 + 216 * b.zoom, y0 + 216 * b.zoom, OVERLAY);
    await browser.waitUntil(() => /data-shape="rectangle"/.test(readFileSync(SMOKE, 'utf8')), {
      timeout: 15_000,
      timeoutMsg: 'the rectangle never reached the file',
    });
    const src = readFileSync(SMOKE, 'utf8');
    expect(src).toMatch(/data-cd-id="rectangle"/);
    expect(src).toMatch(/background: "var\(--accent, currentColor\)"/);
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
    const readChip = () =>
      inFrame<string | null>(
        `return doc.querySelector('[data-testid="edit-corner-chip"]')?.textContent ?? null;`
      );
    await browser
      .waitUntil(async () => /^\d+$/.test((await readChip()) ?? ''), {
        timeout: 4_000,
        interval: 100,
      })
      .catch(() => undefined);
    const chip = await readChip();
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
    // p8-e2e-fix-r11: the corner radius reached the file a moment ago, and the canvas re-renders on its own source
    // change — once (r10 f2) the More menu a click had opened was gone by the next call, so `toolbar-more-slice`
    // was null. Open More until it OFFERS Export area (a re-click only while it reads collapsed), then pick it.
    let opens = 0;
    await browser.waitUntil(
      async () => {
        const r = await inFrame<'ready' | 'clicked' | 'waiting' | null>(
          `if (doc.querySelector('[data-testid="toolbar-more-slice"]')) return 'ready';
           const more = doc.querySelector('[data-testid="toolbar-slot-more"]');
           if (!more || more.getAttribute('aria-expanded') === 'true') return 'waiting';
           more.click();
           return 'clicked';`
        );
        if (r === 'clicked') opens++;
        return r === 'ready';
      },
      { timeout: 10_000, interval: 150, timeoutMsg: 'More never offered Export area' }
    );
    if (opens > 1)
      console.warn(`[edit-shapes] More had to be opened ${opens} times after the corner edit`);
    await inFrame(`doc.querySelector('[data-testid="toolbar-more-slice"]').click(); return true;`);
    // the tool arms on the next render: the overlay has to be there before the drag
    await browser
      .waitUntil(async () => await inFrame<boolean>(`return !!doc.querySelector('${OVERLAY}');`), {
        timeout: 5_000,
        interval: 100,
      })
      .catch(() => undefined);
    const b = await stableBody();
    const x0 = b.x + 40 * b.zoom;
    const y0 = b.y + 40 * b.zoom;
    await fire('pointerdown', x0, y0, OVERLAY);
    await fire('pointermove', x0 + 160 * b.zoom, y0 + 90 * b.zoom, OVERLAY);
    const readTag = () =>
      inFrame<string | null>(
        `return doc.querySelector('[data-testid="edit-draw-tag"]')?.textContent ?? null;`
      );
    await browser
      .waitUntil(async () => /^Export area · \d+ × \d+$/.test((await readTag()) ?? ''), {
        timeout: 4_000,
        interval: 100,
      })
      .catch(() => undefined);
    expect(await readTag()).toMatch(/^Export area · \d+ × \d+$/);
    await fire('pointerup', x0 + 160 * b.zoom, y0 + 90 * b.zoom, OVERLAY);
    await capture('export-area-opens-the-sheet');
    expect(readFileSync(SMOKE, 'utf8')).toBe(before);
  });
});
