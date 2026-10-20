import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, expect } from '@wdio/globals';
import { waitForEditChrome } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * S8.16 (12 Import and Assets · ia-gen-ask, ia-gen-placed) — Generate with N takes, on the stub provider
 * (`MAUDE_GENERATE_STUB=1`, set by wdio.generate-takes.conf.ts: solid PNGs, no network).
 *
 *   1. select a 4:5 artboard, Assets › Generate: before anything is sent the ask shows the shape ("4:5 · from …"),
 *      how long and who pays, and the licence line.
 *   2. Generate: four takes come back, the best (the first good one) lands on the artboard — the file on disk is the
 *      assertion — every take has its `.gen.json`, and the toast says where the others are, with Undo.
 *   3. the placed picture is selected and carries "Picture made by AI" and "Take 1 of 4"; the › (the same function as
 *      →) swaps the next take in — ONE src rewrite — and ⌘Z puts the first one back.
 *
 * The canvas iframe is unreachable by DOM selectors once the origin split is on (memory): the artboard is picked by
 * its label's pointer events, everything else is the shell's own DOM or the file on disk.
 *
 * Written, not run, by the slice (the lane has no unlocked screen); run with
 * `pnpm --filter @maude/desktop-e2e e2e:generate-takes` (the `desktop-e2e` skill).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DESIGN = join(HERE, '../fixtures/project/.design');
const CANVAS = join(DESIGN, 'ui/Smoke.tsx');
const META = join(DESIGN, 'ui/Smoke.meta.json');
const fixtures = createFixtureGuard('generate-takes', [CANVAS, META]);
const source = () => readFileSync(CANVAS, 'utf8');
const srcOf = (s: string) => /src="(assets\/[0-9a-f]{8}\.png)"/.exec(s)?.[1] ?? null;

const POST = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function Smoke() {
  return (
    <DesignCanvas>
      <DCArtboard id="post" label="Gameweek 5" width={400} height={500}>
        <div data-cd-id="title" style={{ width: 200, height: 40 }}>Gameweek 5</div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

const selectArtboard = () =>
  browser.execute(() => {
    const iframe = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const label = iframe.contentDocument?.querySelector(
      '[data-dc-screen="post"] .dc-artboard-label'
    ) as HTMLElement;
    const win = iframe.contentWindow as Window & typeof globalThis;
    const r = label.getBoundingClientRect();
    const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    for (const t of ['pointerdown', 'pointerup', 'click'])
      label.dispatchEvent(
        new win.MouseEvent(t, { bubbles: true, cancelable: true, button: 0, ...at })
      );
  });

describe('Generate with N takes (S8.16)', () => {
  before(async () => {
    await waitForSidecar();
    writeFileSync(CANVAS, POST);
    writeFileSync(META, '{}\n');
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await waitForEditChrome();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    await (await $('[data-testid="panel-tab-assets"]')).click();
    await (await $('[data-testid="assets-panel"]')).waitForExist({ timeout: 10_000 });
  });
  after(() => fixtures.restore());

  it('the ask says the shape, the time, who pays and the licence before anything is sent', async () => {
    const report = startReport('generate-takes-ask');
    await selectArtboard();
    await browser.pause(700);
    await (await $('[data-testid="assets-generate"]')).click();
    const time = await $('[data-testid="generate-ask-time"]');
    await time.waitForExist({ timeout: 10_000 });
    expect(await time.getText()).toMatch(/^About \d+ (s|min) · nothing is billed$/);
    expect(await (await $('[data-testid="generate-ask-licence"]')).getText()).toBe(
      'Test pictures, free to use.'
    );
    expect(await (await $('[data-testid="generate-ask-shape"]')).getText()).toBe(
      '4:5 · from Gameweek 5'
    );
    expect(source()).not.toContain('<img');
    await capture(report, 'ask');
  });

  it('Generate places the best take, writes a .gen.json per take and says where the others are', async () => {
    const report = startReport('generate-takes-placed');
    await (await $('[data-testid="generate-ask-prompt"]')).setValue('a touchdown at night');
    await (await $('[data-testid="generate-ask-go"]')).click();
    await browser.waitUntil(() => srcOf(source()) !== null, {
      timeout: 60_000,
      timeoutMsg: 'the best take never landed in the file',
    });
    expect(source().split('<img').length).toBe(2);
    const best = srcOf(source()) as string;
    const gen = JSON.parse(
      readFileSync(join(DESIGN, `${best.replace(/\.png$/, '')}.gen.json`), 'utf8')
    );
    expect(gen.takes.length).toBe(4);
    for (const sha of gen.takes)
      expect(existsSync(join(DESIGN, `assets/${sha}.gen.json`))).toBe(true);
    const toast = await $('*=The other three are in Assets › Generated.');
    await toast.waitForExist({ timeout: 10_000 });
    expect(await toast.getText()).toContain('Placed take 1 in Gameweek 5.');
    await capture(report, 'placed');
  });

  it('the picture carries Made by AI; › swaps the next take in (one write) and ⌘Z puts it back', async () => {
    const report = startReport('generate-takes-step');
    const label = await $('[data-testid="takes-label"]');
    await label.waitForExist({ timeout: 10_000 });
    expect(await label.getText()).toBe('Take 1 of 4');
    expect(await (await $('[data-testid="takes-made-by-ai"]')).getText()).toBe(
      'Picture made by AI'
    );
    const first = srcOf(source());
    await (await $('[data-testid="takes-next"]')).click();
    await browser.waitUntil(() => srcOf(source()) !== first, {
      timeout: 10_000,
      timeoutMsg: '› never swapped the take',
    });
    expect(source().split('<img').length).toBe(2);
    await browser.waitUntil(async () => (await label.getText()) === 'Take 2 of 4', {
      timeout: 5000,
    });
    await capture(report, 'take-2');
    await browser.keys(['Meta', 'z']);
    await browser.waitUntil(() => srcOf(source()) === first, {
      timeout: 10_000,
      timeoutMsg: '⌘Z did not put the first take back',
    });
  });
});
