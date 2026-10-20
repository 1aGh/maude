import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, expect } from '@wdio/globals';
import { waitForEditChrome } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * S8.21 (12 Import and Assets · ia-asset-details, ia-advanced) — the Assets tab's details per kind, Advanced, and the
 * "Generated" group.
 *
 *   1. media that has a `.gen.json` sits in "Generated", one block per run, takes in the order they were made, and is not
 *      repeated under Photos (the toast after Generate says "The other three are in Assets › Generated").
 *   2. ⌘I on a generated picture opens "Made by AI": the prompt, who made it with what, and the ONE licence line.
 *      The details replace the list; "‹ Assets" goes back.
 *   3. a photo's details name where it is used and the artboard; a row opens that artboard (the canvas stays open).
 *   4. Advanced starts closed; open, it shows "Stored as" and — only when THIS Mac remembers the import path — "Original".
 *      The path comes from `_canvas-state/asset-origins.json`, a per-Mac file that is never in a versioned file.
 *
 * The canvas iframe is unreachable by DOM selectors once the origin split is on (memory): everything here is the shell's own
 * DOM or a file on disk.
 *
 * Written, not run, by the slice (the lane has no unlocked screen); run with the `desktop-e2e` skill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DESIGN = join(HERE, '../fixtures/project/.design');
const ASSETS = join(DESIGN, 'assets');
const CANVAS = join(DESIGN, 'ui/Smoke.tsx');
const META = join(DESIGN, 'ui/Smoke.meta.json');
const ORIGINS = join(DESIGN, '_canvas-state/asset-origins.json');
const fixtures = createFixtureGuard('assets-details', [CANVAS, META]);

const SRC = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function Smoke() {
  return (
    <DesignCanvas>
      <DCArtboard id="smoke" label="SMOKE/01 · ASSETS" width={480} height={320}>
        <img data-cd-id="slot" src="assets/pic.png" alt="" style={{ width: 100, height: 100 }} />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

// two takes of one run + a plain photo
const TAKES = ['0a1b2c3d', '5e6f7a8b'];
const GEN = (self: string) =>
  JSON.stringify({
    format: 'maude.gen',
    v: 1,
    prompt: 'night touchdown, stadium lights, 4:5',
    provider: 'stub',
    model: 'stub-1',
    at: '2026-10-18T09:12:00Z',
    licence: 'You own the output; provider terms apply.',
    group: 'g_e2e_run_1',
    takes: TAKES,
    by: self === TAKES[0] ? 'Tereza' : 'Tereza',
  });
const MADE = [...TAKES.flatMap((t) => [`${t}.png`, `${t}.gen.json`])];

const tile = (rel: string) => $(`[data-testid="assets-tile"][data-asset="${rel}"]`);

describe('Asset details and the Generated group (S8.21)', () => {
  before(async () => {
    await waitForSidecar();
    writeFileSync(CANVAS, SRC);
    writeFileSync(META, '{}\n');
    for (const t of TAKES) {
      copyFileSync(join(ASSETS, 'pic.png'), join(ASSETS, `${t}.png`));
      writeFileSync(join(ASSETS, `${t}.gen.json`), GEN(t));
    }
    mkdirSync(dirname(ORIGINS), { recursive: true });
    writeFileSync(
      ORIGINS,
      JSON.stringify({
        v: 1,
        origins: { [TAKES[0]]: { path: '/Users/e2e/Pictures/night.png', importedAt: 1 } },
      })
    );
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await waitForEditChrome();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    await (await $('[data-testid="panel-tab-assets"]')).click();
    await (await $('[data-testid="assets-panel"]')).waitForExist({ timeout: 10_000 });
  });
  after(() => {
    fixtures.restore();
    for (const f of MADE) rmSync(join(ASSETS, f), { force: true });
    rmSync(ORIGINS, { force: true });
  });

  it('Generated is a group of its own: one block per run, not repeated under Photos', async () => {
    const report = startReport('assets-details-generated');
    await (await $('[data-testid="assets-group-generated"]')).waitForExist({ timeout: 15_000 });
    const runs = await $$('[data-testid="assets-gen-run"]');
    expect(runs.length).toBe(1);
    expect(await runs[0].getText()).toContain('night touchdown');
    expect(await runs[0].getText()).toContain('2 takes');
    const tiles = await runs[0].$$('[data-testid="assets-tile"]');
    expect(await tiles.map((t) => t.getAttribute('data-asset'))).toEqual(
      TAKES.map((t) => `assets/${t}.png`)
    );
    expect(
      (await $$(`[data-testid="assets-tile"][data-asset="assets/${TAKES[0]}.png"]`)).length
    ).toBe(1);
    await capture(report, 'generated');
  });

  it('⌘I on a generated picture says Made by AI: the prompt, who made it, one licence line; back returns', async () => {
    const report = startReport('assets-details-made');
    await (await tile(`assets/${TAKES[0]}.png`)).click();
    await browser.keys(['Meta', 'i']);
    const card = await $('[data-testid="assets-details"]');
    await card.waitForExist({ timeout: 5000 });
    await browser.waitUntil(async () => (await card.getAttribute('data-kind')) === 'made', {
      timeout: 8000,
      timeoutMsg: 'the details never read the generation record',
    });
    expect(await (await $('[data-testid="assets-details-prompt"]')).getText()).toContain(
      'night touchdown, stadium lights, 4:5'
    );
    expect((await $$('[data-testid="assets-details-licence"]')).length).toBe(1);
    expect(await (await $('[data-testid="assets-details-licence"]')).getText()).toBe(
      'You own the output; provider terms apply.'
    );
    await capture(report, 'made-by-ai');
    // the details replace the list
    expect(await (await $('.lp-assets-list')).isDisplayed()).toBe(false);
    await (await $('[data-testid="assets-details-close"]')).click();
    await card.waitForExist({ reverse: true, timeout: 5000 });
    expect(await (await $('.lp-assets-list')).isDisplayed()).toBe(true);
  });

  it('Advanced is closed until asked; Original is shown only where this Mac remembers the import', async () => {
    await (await tile(`assets/${TAKES[0]}.png`)).click();
    await browser.keys(['Meta', 'i']);
    await (await $('[data-testid="assets-details"]')).waitForExist({ timeout: 5000 });
    expect(await (await $('[data-testid="assets-details-adv-stored"]')).isExisting()).toBe(false);
    await (await $('[data-testid="fold-assets.details-toggle"]')).click();
    expect(await (await $('[data-testid="assets-details-adv-stored"]')).getText()).toContain(
      `assets/${TAKES[0]}.png`
    );
    await browser.waitUntil(
      async () => (await $('[data-testid="assets-details-adv-original"]')).isExisting(),
      { timeout: 8000, timeoutMsg: 'the Original this Mac remembers never showed' }
    );
    expect(await (await $('[data-testid="assets-details-adv-original"]')).getText()).toContain(
      '/Users/e2e/Pictures/night.png'
    );
    // the per-Mac record is the only place that path lives: not in the canvas, not in any versioned sidecar
    expect(readFileSync(CANVAS, 'utf8')).not.toContain('night.png');
    expect(readFileSync(join(ASSETS, `${TAKES[0]}.gen.json`), 'utf8')).not.toContain('Pictures');
    await (await $('[data-testid="assets-details-close"]')).click();

    // the other take was never imported from a path: no Original row
    await (await tile(`assets/${TAKES[1]}.png`)).click();
    await browser.keys(['Meta', 'i']);
    await (await $('[data-testid="assets-details"]')).waitForExist({ timeout: 5000 });
    await (await $('[data-testid="assets-details-adv-stored"]')).waitForExist({ timeout: 5000 });
    expect(await (await $('[data-testid="assets-details-adv-original"]')).isExisting()).toBe(false);
    await (await $('[data-testid="assets-details-close"]')).click();
  });

  it('a photo’s details name where it is used; the row opens that artboard', async () => {
    expect(existsSync(join(ASSETS, 'pic.png'))).toBe(true);
    await (await tile('assets/pic.png')).click();
    await browser.keys(['Meta', 'i']);
    await (await $('[data-testid="assets-details"]')).waitForExist({ timeout: 5000 });
    // the fixture's Export and VideoFormats canvases use pic.png too: the row that is THIS canvas's artboard is the one under test
    const mine = () => $('[data-testid="assets-details-use"][data-board="smoke"]');
    await browser.waitUntil(async () => (await mine()).isExisting(), {
      timeout: 10_000,
      timeoutMsg: 'the details never named where pic.png is used',
    });
    const use = await mine();
    expect(await use.getAttribute('data-board')).toBe('smoke');
    await use.click();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 10_000 });
    // the canvas file is untouched by a look
    expect(readFileSync(CANVAS, 'utf8')).toBe(SRC);
    await (await $('[data-testid="assets-details-close"]')).click();
  });
});
