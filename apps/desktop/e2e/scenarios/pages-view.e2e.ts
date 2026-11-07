import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { pressMenuRow } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow, dsRow } from '../helpers/tree';

/**
 * 2.0.7 B2 — `pages-view`: Canvas | Pages (decision `v2-207-pages-view`). A six-artboard canvas: Menu › View › Pages
 * shows one artboard at a time in the Present order, Preview and Present grey out with the reason, Next page steps,
 * the pick lands in the view file (never the versioned meta), and Pages again goes back to Canvas.
 *
 * 2.0.7 polish (Michal's hands-on test): the canvas row's artboard list marks the artboard on the page and follows
 * Next page (`v2-207-pages-left-panel-follows`); a pick in that list turns to the page instead of an empty frame
 * (`v2-207-pages-pick-turns-page`); the Design system canvas has Canvas | Pages on its own bar
 * (`v2-207-pages-on-ds-canvas`).
 *
 * Driven through the SHELL (the menu, the Share cluster, the left panel) and a structural route
 * (`/_api/canvas-meta`) — the canvas iframe is not reachable by DOM selectors (memory
 * maude-canvas-iframe-unreachable-by-dom). The reads (and the one press on the Design system bar) inside the frame
 * go through its own document via `contentWindow`, as waitForCanvasRects already does (the lane runs with the origin
 * split off). Project: fixtures/seed-pages-view.ts. Lane: `e2e:pages-view`.
 */

const ROOT = process.env.MAUDE_E2E_PAGES_VIEW_ROOT ?? '';
const META = join(ROOT, '.design', 'ui', 'Pages.meta.json');
const REL = '.design/ui/Pages.tsx';
const DS_REL = '.design/system/acme/design-system.tsx';
const DS_SLUG = 'system-acme-design-system';
/** The Present order the canvas sets: p4 first, then p2; the rest follow in layout order. */
const ORDER = ['p4', 'p2', 'p1', 'p3', 'p5', 'p6'];
const META_TEXT = `${JSON.stringify({ title: 'Pages', present: { order: ['p4', 'p2'] } }, null, 2)}\n`;
const PAGES_REASON = 'Switch to Canvas to preview or present.';

const tid = (id: string) => `[data-testid="${id}"]`;

/** What the canvas frame shows: Pages on, the page counter, the page left in sight, where the switch sits. */
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
      dsBar: !!doc.querySelector('[data-testid="ds-bar"]'),
      switchOnDsBar: !!doc.querySelector(
        '[data-testid="ds-bar"] [data-testid="canvas-view-pages"]'
      ),
      pill: !!doc.querySelector('[data-testid="canvas-theme-pill"]'),
    };
  });

/** A control of the Share cluster's mode switch: disabled, and why. */
const modeButton = (id: string) =>
  browser.execute((sel) => {
    const el = document.querySelector<HTMLButtonElement>(sel);
    return el ? { disabled: el.disabled, title: el.getAttribute('title') } : null;
  }, tid(id));

const viewFile = (rel = REL) =>
  browser.execute(async (r) => {
    const res = await fetch(`/_api/canvas-meta?file=${encodeURIComponent(r)}`);
    return (await res.json()) as { canvasView?: string };
  }, rel);

/** ⌘K / the menu reach paging through the same run-action lane the canvas keys resolve to. */
const nextPage = () =>
  browser.execute(() => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="canvas-frame"]');
    // a postMessage from the shell's own window is `e.source === window.parent` inside the frame
    frame?.contentWindow?.postMessage({ dgn: 'run-action', v: 1, id: 'pages.next' }, '*');
  });

/** The artboard row the left panel marks as the one in view (`aria-current`), or null. */
const markedRow = () =>
  browser.execute(
    () =>
      document
        .querySelector('[data-testid^="jump-artboard-"][aria-current="true"]')
        ?.getAttribute('data-testid') ?? null
  );

/** Open a row's artboard list (its twisty), if it is not open yet. */
async function openList(toggleId: string) {
  const t = await $(tid(toggleId));
  await t.waitForExist({ timeout: 30_000 });
  if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click();
}

async function until(pred: () => Promise<boolean>, msg: string, timeout = 8000) {
  await browser.waitUntil(pred, { timeout, interval: 150, timeoutMsg: msg });
}

describe('pages-view (2.0.7 B2)', () => {
  before(async () => {
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-pages');
    await row.waitForExist({ timeout: 30_000 });
    await row.click();
    await waitForCanvasRects();
  });

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
    await nextPage();
    await until(async () => (await frameState())?.count === '2 / 6', 'Next page never stepped');
    expect((await frameState())?.visible).toEqual([ORDER[1]]);
    await capture(report, '02-next');
  });

  it('polish: the canvas row’s artboard list marks the page and follows Next page', async () => {
    const report = startReport('pages-view');
    await openList('canvas-jump-toggle-ui-pages');
    await until(
      async () => (await markedRow()) === `jump-artboard-ui-pages-${ORDER[1]}`,
      `the list never marked ${ORDER[1]} (the page on screen)`
    );
    await nextPage();
    await until(async () => (await frameState())?.count === '3 / 6', 'Next page never stepped');
    await until(
      async () => (await markedRow()) === `jump-artboard-ui-pages-${ORDER[2]}`,
      `the mark never followed the page to ${ORDER[2]}`
    );
    await capture(report, '03-list-follows');
  });

  it('polish: a pick in the list turns to that page — the artboard shows, never an empty frame', async () => {
    const report = startReport('pages-view');
    await (await $(tid('jump-artboard-ui-pages-p6'))).click();
    await until(
      async () => (await frameState())?.count === '6 / 6',
      'the pick never turned the page'
    );
    expect((await frameState())?.visible).toEqual(['p6']);
    await until(
      async () => (await markedRow()) === 'jump-artboard-ui-pages-p6',
      'the picked row was never marked'
    );
    await capture(report, '04-pick-turns-page');
  });

  it('the pick is in the view file, the versioned meta is untouched', async () => {
    expect((await viewFile()).canvasView).toBe('pages');
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
    await capture(report, '05-canvas');
  });

  it('polish: the Design system canvas has Canvas | Pages on its own bar, and its list follows the page', async () => {
    const report = startReport('pages-view');
    await dsRow('acme');
    await openList(`canvas-jump-toggle-${DS_SLUG}`);
    await (await $(tid(`jump-artboard-${DS_SLUG}-ds-colour`))).click();
    await until(
      async () => (await frameState())?.switchOnDsBar === true,
      'the Design system bar never showed Canvas | Pages',
      60_000
    );
    expect((await frameState())?.pill).toBe(false);
    // the one press inside the frame: the bar's own Pages button
    await browser.execute(() => {
      const frame = document.querySelector<HTMLIFrameElement>('[data-testid="canvas-frame"]');
      frame?.contentDocument
        ?.querySelector<HTMLButtonElement>(
          '[data-testid="ds-bar"] [data-testid="canvas-view-pages"]'
        )
        ?.click();
    });
    await until(async () => (await frameState())?.pages === true, 'Pages never came on');
    const s = await frameState();
    expect(s?.visible).toHaveLength(1);
    await until(
      async () => (await modeButton('palette-mode-preview'))?.disabled === true,
      'Preview never greyed out on the Design system canvas'
    );
    await nextPage();
    await until(async () => {
      const v = (await frameState())?.visible ?? [];
      return v.length === 1 && v[0] !== s?.visible[0];
    }, 'Next page never stepped on the Design system canvas');
    const shown = (await frameState())?.visible[0];
    await until(
      async () => (await markedRow()) === `jump-artboard-${DS_SLUG}-${shown}`,
      `the Design system row's list never marked ${shown}`
    );
    expect((await viewFile(DS_REL)).canvasView).toBe('pages');
    await capture(report, '06-ds-pages');
  });
});
