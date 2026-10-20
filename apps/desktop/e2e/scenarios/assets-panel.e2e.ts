import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
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
 *   Part 2 (S8.13, 12 · ia-assets-browse, ia-assets-tidy):
 *   5. "Photos N ›" widens into the Browse view; ⇧-click picks a range; esc clears the pick, then goes back.
 *   6. with an artboard of two picture frames selected, ↵ on two picked pictures fills the frames in reading order
 *      (the file on disk is the assertion).
 *   7. Not used lists what no canvas needs; "Move N to the trash…" asks, then the pictures AND their sidecars are
 *      in `_trash/` (not in `assets/`), and Undo brings them all back.
 *   8. Move to trash refuses a picture a canvas uses — the picture stays on disk and the tab says why.
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

// ── Part 2 (S8.13) ───────────────────────────────────────────────────────────────────────────────────────────────
const DESIGN = join(HERE, '../fixtures/project/.design');
const ASSETS = join(DESIGN, 'assets');
const PIC_FILE = join(ASSETS, 'pic.png');
const MADE = [
  'brw-a.png',
  'brw-b.png',
  'brw-c.png',
  'tidy-a.png',
  'tidy-a.photo.json',
  'tidy-b.png',
];
const TWO_FRAMES = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function Smoke() {
  return (
    <DesignCanvas>
      <DCArtboard id="smoke" label="SMOKE/01 · ASSETS" width={480} height={320}>
        <img data-cd-id="slot-1" src="assets/pic.png" alt="" style={{ width: 100, height: 100 }} />
        <img data-cd-id="slot-2" src="assets/pic.png" alt="" style={{ width: 100, height: 100 }} />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const tileOf = (name: string) => $(`[data-testid="assets-browse"] [data-asset="assets/${name}"]`);
// a ⇧-click is a click whose event says so: WebDriver cannot hold a key across an element click reliably, and the
// shell's handler reads only `event.shiftKey`
const shiftClick = (el: WebdriverIO.Element) =>
  browser.execute(
    (node) =>
      node.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true })
      ),
    el as never
  );
const trashed = () => {
  const root = join(DESIGN, '_trash');
  return existsSync(root) ? readdirSync(root).filter((d) => d.includes('__asset-')) : [];
};

describe('the Browse view and Not used (S8.13)', () => {
  before(async () => {
    await waitForSidecar();
    writeFileSync(CANVAS, TWO_FRAMES);
    writeFileSync(META, '{}\n');
    // three pictures with known ages (newest first = brw-c, brw-b, brw-a) plus two to tidy, one with a sidecar
    const t0 = Date.now() / 1000;
    for (const [i, n] of ['brw-a.png', 'brw-b.png', 'brw-c.png'].entries()) {
      copyFileSync(PIC_FILE, join(ASSETS, n));
      utimesSync(join(ASSETS, n), t0 - 100 + i, t0 - 100 + i);
    }
    copyFileSync(PIC_FILE, join(ASSETS, 'tidy-a.png'));
    copyFileSync(PIC_FILE, join(ASSETS, 'tidy-b.png'));
    writeFileSync(join(ASSETS, 'tidy-a.photo.json'), '{"v":1}\n');
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await waitForEditChrome();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    await (await $('[data-testid="panel-tab-assets"]')).click();
    await (await $('[data-testid="assets-panel"]')).waitForExist({ timeout: 10_000 });
  });
  after(() => {
    for (const n of MADE) rmSync(join(ASSETS, n), { force: true });
    fixtures.restore();
  });

  it('Photos N › widens into big pictures; ⇧ picks a range; esc clears, then goes back', async () => {
    const report = startReport('assets-browse');
    await (await $('[data-testid="assets-group-image"]')).click();
    const view = await $('[data-testid="assets-browse"]');
    await view.waitForExist({ timeout: 10_000 });
    await (await tileOf('brw-c.png')).waitForExist({ timeout: 10_000 });
    await (await tileOf('brw-c.png')).click();
    await shiftClick(await tileOf('brw-a.png'));
    expect(await (await $('[data-testid="assets-browse-count"]')).getText()).toContain('selected');
    await capture(report, 'picked');
    await browser.keys(['Escape']);
    await (await $('[data-testid="assets-browse-bar"]')).waitForExist({
      reverse: true,
      timeout: 5000,
    });
    expect(await view.isExisting()).toBe(true);
    await browser.keys(['Escape']);
    await view.waitForExist({ reverse: true, timeout: 5000 });
  });

  it('↵ with two pictures picked fills the two frames in reading order', async () => {
    const report = startReport('assets-browse-fill');
    await selectArtboard();
    await browser.pause(700);
    await (await $('[data-testid="assets-group-image"]')).click();
    // newest first: brw-c, brw-b, brw-a — pick c then b, so reading order is c, b
    await (await tileOf('brw-c.png')).click();
    await shiftClick(await tileOf('brw-b.png'));
    await browser.keys(['Enter']);
    await browser.waitUntil(async () => source().includes('assets/brw-c.png'), {
      timeout: 8000,
      timeoutMsg: '↵ on two picked pictures never wrote',
    });
    const src = source();
    expect(src.indexOf('assets/brw-c.png')).toBeGreaterThan(-1);
    expect(src.indexOf('assets/brw-c.png')).toBeLessThan(src.indexOf('assets/brw-b.png'));
    expect(src.split('<img').length).toBe(3); // still two frames: filled, not added
    await capture(report, 'filled');
    await browser.keys(['Escape', 'Escape']);
  });

  it('Not used lists what nothing needs; Move N to the trash takes the sidecars, and Undo brings them back', async () => {
    const report = startReport('assets-tidy');
    await (await $('[data-testid="assets-chip-notused"]')).click();
    const button = await $('[data-testid="assets-tidy-trash"]');
    await button.waitForEnabled({ timeout: 30_000 }); // waits for the older versions to be read
    // pic.png is placed? no: the two frames now show brw-c / brw-b, so brw-a, tidy-a, tidy-b, pic.png are free
    await capture(report, 'not-used');
    await button.click();
    await (await $('[data-testid="assets-trash-dialog"]')).waitForExist({ timeout: 5000 });
    await (await $('[data-testid="assets-trash-confirm"]')).click();
    await (await $('[data-testid="assets-trashed"]')).waitForExist({ timeout: 10_000 });
    expect(existsSync(join(ASSETS, 'tidy-a.png'))).toBe(false);
    expect(existsSync(join(ASSETS, 'tidy-a.photo.json'))).toBe(false); // the sidecar went with its picture
    expect(trashed().length).toBeGreaterThan(0);
    // the picture a canvas uses was never offered, and is still there
    expect(existsSync(join(ASSETS, 'brw-c.png'))).toBe(true);
    await (await $('[data-testid="assets-trashed-undo"]')).click();
    await browser.waitUntil(async () => existsSync(join(ASSETS, 'tidy-a.png')), {
      timeout: 10_000,
      timeoutMsg: 'Undo did not bring the picture back',
    });
    expect(existsSync(join(ASSETS, 'tidy-a.photo.json'))).toBe(true);
    await capture(report, 'undone');
  });

  it('a picture a canvas uses is refused: it stays on disk and the tab says why', async () => {
    await (await $('[data-testid="assets-chip-notused"]')).click(); // back to everything
    const t = await $('[data-testid="assets-tile"][data-asset="assets/brw-c.png"]');
    await t.click({ button: 'right' });
    await (await $('[data-testid="assets-menu-trash"]')).click();
    const line = await $('[data-testid="assets-panel"] [role="alert"]');
    await line.waitForExist({ timeout: 10_000 });
    expect(await line.getText()).toContain('is used on a canvas');
    expect(existsSync(join(ASSETS, 'brw-c.png'))).toBe(true);
  });
});

/**
 * Part 3 (S8.20, 12 · ia-assets-find) — search in pictures, opt-in.
 *   9. a search offers it once (Turn on…, or Connect… with no AI); the sheet sends nothing until Describe pictures,
 *      and the answer is this Mac's runtime file `_canvas-state/_describe.json` (never versioned, never synced).
 *  10. with the sidecar on the stub describer (`MAUDE_DESCRIBE_STUB=1`, every picture reads "A picture"), "picture"
 *      finds pic.png under "Seen in the picture" — its name does not say it — with the word marked.
 * No real AI: without the stub, step 10 is skipped (the studio has no describer until S12.13).
 */
describe('search in pictures (S8.20)', () => {
  const CONSENT = join(DESIGN, '_canvas-state', '_describe.json');
  const restoreConsent = existsSync(CONSENT) ? readFileSync(CONSENT, 'utf8') : null;
  after(() => {
    if (restoreConsent === null) rmSync(CONSENT, { force: true });
    else writeFileSync(CONSENT, restoreConsent);
  });

  it('asked once: the sheet sends nothing until Describe pictures', async () => {
    const report = startReport('assets-describe');
    rmSync(CONSENT, { force: true });
    const search = await $('[data-testid="assets-search"]');
    await search.setValue('picture');
    const offer = await $('[data-testid="assets-describe-offer"]');
    await offer.waitForExist({ timeout: 10_000 });
    await capture(report, 'offer');
    if ((await offer.getAttribute('data-kind')) === 'connect') {
      expect(await (await $('[data-testid="assets-search-foot"]')).getText()).toContain(
        'names only'
      );
      return; // no AI on this machine: names only, and the answer is never asked for
    }
    await (await $('[data-testid="assets-describe-turn-on"]')).click();
    await (await $('[data-testid="assets-describe-sheet"]')).waitForExist({ timeout: 5000 });
    expect(existsSync(CONSENT)).toBe(false); // opening the sheet sends nothing
    await capture(report, 'sheet');
    await (await $('[data-testid="assets-describe-confirm"]')).click();
    await browser.waitUntil(async () => existsSync(CONSENT), { timeout: 5000 });
    expect(JSON.parse(readFileSync(CONSENT, 'utf8'))).toMatchObject({ v: 1, on: true });
  });

  it('with the stub describer, "picture" finds pic.png by what AI saw, marked', async function () {
    if (process.env.MAUDE_DESCRIBE_STUB !== '1') this.skip();
    const report = startReport('assets-describe-seen');
    const search = await $('[data-testid="assets-search"]');
    await browser.waitUntil(
      async () => {
        await search.setValue('');
        await search.setValue('picture');
        return (await $('[data-testid="assets-group-seen"]')).isExisting();
      },
      {
        timeout: 90_000,
        interval: 5000,
        timeoutMsg: 'nothing was described (budget: one batch per 20 s)',
      }
    );
    const line = await $('[data-testid="assets-seen-line"] mark');
    expect(await line.getText()).toBe('picture');
    await capture(report, 'seen');
  });
});
