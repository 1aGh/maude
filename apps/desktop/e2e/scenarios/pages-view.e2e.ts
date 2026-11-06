import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { pressMenuRow } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 2.0.7 B2 — `pages-view`: Canvas | Pages (decision `v2-207-pages-view`). A six-artboard canvas: Menu › View › Pages
 * shows one artboard at a time in the Present order, Preview and Present grey out with the reason, Next page steps,
 * the pick lands in the view file (never the versioned meta), and Pages again goes back to Canvas.
 *
 * Driven through the SHELL (the menu, the Share cluster) and a structural route (`/_api/canvas-meta`) — the canvas
 * iframe is not reachable by DOM selectors (memory maude-canvas-iframe-unreachable-by-dom). The one read inside the
 * frame is its own `__maudeCanvasRects` / document, through `contentWindow`, as waitForCanvasRects already does
 * (the lane runs with the origin split off). Lane: `e2e:pages-view`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const UI = join(HERE, '../fixtures/project/.design/ui');
const CANVAS = join(UI, 'Pages.tsx');
const META = join(UI, 'Pages.meta.json');
const fixtures = createFixtureGuard('pages-view', [CANVAS, META]);
const REL = '.design/ui/Pages.tsx';
const IDS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
/** The Present order the canvas sets: p4 first, then p2; the rest follow in layout order. */
const ORDER = ['p4', 'p2', 'p1', 'p3', 'p5', 'p6'];
const META_TEXT = `${JSON.stringify({ title: 'Pages', present: { order: ['p4', 'p2'] } }, null, 2)}\n`;
const PAGES_REASON = 'Switch to Canvas to preview or present.';

const tid = (id: string) => `[data-testid="${id}"]`;

function writeCanvas() {
  const boards = IDS.map(
    (id, i) =>
      `      <DCArtboard id="${id}" label="Page ${i + 1}" width={640} height={400}>\n` +
      `        <div style={{ padding: 32, fontSize: 48, fontFamily: 'system-ui' }}>Page ${i + 1}</div>\n` +
      '      </DCArtboard>'
  ).join('\n');
  writeFileSync(
    CANVAS,
    `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';\n\nexport default function Pages() {\n  return (\n    <DesignCanvas>\n${boards}\n    </DesignCanvas>\n  );\n}\n`
  );
  writeFileSync(META, META_TEXT);
}

/** What the canvas frame shows: Pages on, the page counter, the page left in sight. */
const frameState = () =>
  browser.execute(() => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="canvas-frame"]');
    const doc = frame?.contentDocument;
    if (!doc) return null;
    const visible = Array.from(doc.querySelectorAll<HTMLElement>('.dc-canvas .dc-artboard'))
      .filter((el) => getComputedStyle(el).visibility !== 'hidden')
      .map((el) => el.getAttribute('data-dc-screen'));
    return {
      pages: doc.documentElement.hasAttribute('data-maude-pages'),
      count: doc.querySelector('[data-testid="canvas-pages-count"]')?.textContent ?? null,
      pressed:
        doc
          .querySelector('[data-testid^="canvas-view-"][aria-pressed="true"]')
          ?.getAttribute('data-testid') ?? null,
      visible,
    };
  });

/** A control of the Share cluster's mode switch: disabled, and why. */
const modeButton = (id: string) =>
  browser.execute((sel) => {
    const el = document.querySelector<HTMLButtonElement>(sel);
    return el ? { disabled: el.disabled, title: el.getAttribute('title') } : null;
  }, tid(id));

const viewFile = () =>
  browser.execute(async (rel) => {
    const r = await fetch(`/_api/canvas-meta?file=${encodeURIComponent(rel)}`);
    return (await r.json()) as { canvasView?: string };
  }, REL);

async function until(pred: () => Promise<boolean>, msg: string, timeout = 8000) {
  await browser.waitUntil(pred, { timeout, interval: 150, timeoutMsg: msg });
}

describe('pages-view (2.0.7 B2)', () => {
  before(async () => {
    fixtures.snapshot();
    writeCanvas();
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-pages');
    await row.waitForExist({ timeout: 30_000 });
    await row.click();
    await waitForCanvasRects();
  });
  after(() => fixtures.restore());

  it('Canvas by default: every artboard in sight, Preview and Present on', async () => {
    startReport('pages-view');
    const s = await frameState();
    expect(s?.pages).toBe(false);
    expect(s?.pressed).toBe('canvas-view-canvas');
    expect(s?.visible).toHaveLength(6);
    expect((await modeButton('palette-mode-preview'))?.disabled).toBe(false);
    expect((await modeButton('palette-mode-present'))?.disabled).toBe(false);
  });

  it('Menu › View › Pages: the first page in the Present order; Preview and Present say why they are off', async () => {
    const report = startReport('pages-view');
    await pressMenuRow('view.pages', 'view');
    await until(async () => (await frameState())?.count === '1 / 6', 'Pages never showed 1 / 6');
    const s = await frameState();
    expect(s?.pages).toBe(true);
    expect(s?.pressed).toBe('canvas-view-pages');
    expect(s?.visible).toEqual([ORDER[0]]);
    await until(
      async () => (await modeButton('palette-mode-preview'))?.disabled === true,
      'Preview never greyed out'
    );
    expect(await modeButton('palette-mode-preview')).toEqual({
      disabled: true,
      title: PAGES_REASON,
    });
    expect(await modeButton('palette-mode-present')).toEqual({
      disabled: true,
      title: PAGES_REASON,
    });
    expect((await modeButton('mode-present-menu'))?.disabled).toBe(true);
    await capture(report, '01-pages');
  });

  it('Next page steps in the Present order (the shell runs pages.next in the canvas)', async () => {
    const report = startReport('pages-view');
    // ⌘K / the menu reach paging through the same run-action lane the canvas keys resolve to
    await browser.execute(() => {
      const frame = document.querySelector<HTMLIFrameElement>('[data-testid="canvas-frame"]');
      frame?.contentWindow?.postMessage({ dgn: 'run-action', v: 1, id: 'pages.next' }, '*');
    });
    // a postMessage from the shell's own window is `e.source === window.parent` inside the frame
    await until(async () => (await frameState())?.count === '2 / 6', 'Next page never stepped');
    expect((await frameState())?.visible).toEqual([ORDER[1]]);
    await capture(report, '02-next');
  });

  it('the pick is in the view file, the versioned meta is untouched', async () => {
    expect((await viewFile()).canvasView).toBe('pages');
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(META, 'utf8')).toBe(META_TEXT);
  });

  it('Pages again: back to Canvas, Preview and Present on', async () => {
    const report = startReport('pages-view');
    await pressMenuRow('view.pages', 'view');
    await until(async () => (await frameState())?.pages === false, 'Canvas never came back');
    expect((await frameState())?.visible).toHaveLength(6);
    await until(
      async () => (await modeButton('palette-mode-preview'))?.disabled === false,
      'Preview never came back'
    );
    expect((await viewFile()).canvasView).toBe('canvas');
    await capture(report, '03-canvas');
  });
});
