import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, expect } from '@wdio/globals';
import { waitForEditChrome } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * S8.12 (12 Import and Assets · ia-assets-panel, ia-assets-keys) — the Assets tab.
 *
 *   1. the tab lists the project's pictures first, and a tile carries its name and where it is used (the hover tip,
 *      which is in the DOM and shown on hover / keyboard focus), named the same way for a screen reader.
 *   2. select an artboard, then a tile, and ↵ places it there: ONE `image.place` write, the same `<img>` a drop makes
 *      (UI vs file-edit parity: the file on disk is the assertion, not the toast).
 *   3. right-click on a tile opens Place / Show details; ⌘I opens the plain details of the picked tile.
 *   4. with no artboard selected, ↵ writes nothing and the tab says what to do.
 *
 * The canvas iframe is unreachable by DOM selectors once the origin split is on (memory): the artboard is picked by
 * its label's pointer events, everything else is the shell's own DOM or the file on disk.
 *
 * Written, not run, by the slice (the lane has no unlocked screen); run with the `desktop-e2e` skill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CANVAS = join(HERE, '../fixtures/project/.design/ui/Smoke.tsx');
const META = join(HERE, '../fixtures/project/.design/ui/Smoke.meta.json');
const fixtures = createFixtureGuard('assets-panel', [CANVAS, META]);
const source = () => readFileSync(CANVAS, 'utf8');

const HOME = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function Smoke() {
  return (
    <DesignCanvas>
      <DCArtboard id="smoke" label="SMOKE/01 · ASSETS" width={480} height={320}>
        <div data-cd-id="title" style={{ width: 200, height: 40 }}>Hello</div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

const PIC = 'assets/pic.png';
const tile = () => $(`[data-testid="assets-tile"][data-asset="${PIC}"]`);

/** Select the artboard the way a person does: its name, in the canvas. */
const selectArtboard = () =>
  browser.execute(() => {
    const iframe = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const label = iframe.contentDocument?.querySelector(
      '[data-dc-screen="smoke"] .dc-artboard-label'
    ) as HTMLElement;
    const win = iframe.contentWindow as Window & typeof globalThis;
    const r = label.getBoundingClientRect();
    const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    for (const t of ['pointerdown', 'pointerup', 'click'])
      label.dispatchEvent(
        new win.MouseEvent(t, { bubbles: true, cancelable: true, button: 0, ...at })
      );
  });

describe('the Assets tab (S8.12)', () => {
  before(async () => {
    await waitForSidecar();
    writeFileSync(CANVAS, HOME);
    writeFileSync(META, '{}\n');
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await waitForEditChrome();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    await (await $('[data-testid="panel-tab-assets"]')).click();
    await (await $('[data-testid="assets-panel"]')).waitForExist({ timeout: 10_000 });
  });
  after(() => fixtures.restore());

  it('lists pictures first; a tile is named with where it is used', async () => {
    const report = startReport('assets-panel-list');
    const t = await tile();
    await t.waitForExist({ timeout: 15_000 });
    const heads = await $$('.lp-group');
    expect(await heads[0].getText()).toContain('Photos');
    // the index names usage; the fixture's canvas does not use pic.png, so it reads one of the plain words
    expect(await t.getAttribute('aria-label')).toMatch(
      /^pic\.png\. (Not used|Used in \d+ canvas|Checking)/
    );
    await capture(report, 'tab');
  });

  it('with no artboard selected, ↵ writes nothing and the tab says what to do', async () => {
    const before = source();
    await (await tile()).click();
    await browser.keys(['Enter']);
    const line = await $('[data-testid="assets-panel"] [role="alert"]');
    await line.waitForExist({ timeout: 5000 });
    expect(await line.getText()).toBe('Select an artboard first, then press ↵ on a picture.');
    expect(source()).toBe(before);
  });

  it('select an artboard, then a tile: ↵ places it there — one write, the same <img> a drop makes', async () => {
    const report = startReport('assets-panel-place');
    await selectArtboard();
    await browser.pause(700);
    await (await tile()).click();
    await browser.keys(['Enter']);
    await browser.waitUntil(async () => source().includes('<img'), {
      timeout: 8000,
      timeoutMsg: '↵ on a tile never wrote the picture',
    });
    expect(source().split('<img').length).toBe(2);
    expect(source()).toContain(`src="${PIC}"`);
    await capture(report, 'placed');
  });

  it('right-click opens Place and Show details; ⌘I opens the details of the picked tile', async () => {
    const t = await tile();
    await t.click({ button: 'right' });
    const menu = await $('[data-testid="assets-tile-menu"]');
    await menu.waitForExist({ timeout: 5000 });
    expect(await (await $('[data-testid="assets-menu-place"]')).getText()).toContain('Place');
    expect(await (await $('[data-testid="assets-menu-details"]')).getText()).toContain(
      'Show details'
    );
    await browser.keys(['Escape']);
    await menu.waitForExist({ reverse: true, timeout: 5000 });
    await t.click();
    await browser.keys(['Meta', 'i']);
    const card = await $('[data-testid="assets-details"]');
    await card.waitForExist({ timeout: 5000 });
    expect(await card.getText()).toContain('pic.png');
    await (await $('[data-testid="assets-details-close"]')).click();
  });
});
