import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';

import {
  enterCanvasFrame,
  exitToTop,
  focusCanvasFrame,
  waitForCanvasOpened,
} from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';
import { focusTab, labels, openTab } from '../helpers/windows';

/**
 * #122 122-C — a paste between two projects on this Mac (contract 122-cross-canvas-clipboard.md §5.6).
 *
 * source = MAUDE_PROJECT_ROOT: `ui/Home.tsx`, artboard "Hero" reading `W`, an imported `<Card>` and a picture.
 * target = MAUDE_E2E_SECONDARY_ROOT: `ui/About.tsx`, the same `components/Card.tsx`, no picture.
 *
 * Copy Hero in the source tab, ⌘V on About in the target tab: nothing is pasted until the target shell's own toast
 * ("Paste the artboard copied in Home · clip-source?") is clicked; then the artboard lands with its import and its
 * constant, the picture arrives in the target's `assets/` under the same content-addressed name, and the canvas
 * renders without an error card. ⌘Z on About takes the paste back; the picture stays (like an import).
 *
 * Written for the `clip` lane (wdio.clip.conf.ts). Every key goes to a FOCUSED tab's focused canvas frame:
 * a background tab is `document.hidden`, and a canvas-origin key needs the frame to hold focus.
 */
const SOURCE = process.env.MAUDE_PROJECT_ROOT as string;
const TARGET = process.env.MAUDE_E2E_SECONDARY_ROOT as string;
const src = (root: string, rel: string) => readFileSync(join(root, '.design', rel), 'utf8');
const boards = (s: string) => s.match(/<DCArtboard\b/g)?.length ?? 0;
const pictureIn = (root: string) =>
  existsSync(join(root, '.design', 'assets'))
    ? readdirSync(join(root, '.design', 'assets')).filter((f) => f.endsWith('.png'))
    : [];

async function openCanvas(row: string): Promise<void> {
  const el = await canvasRow(row);
  await el.waitForDisplayed({ timeout: 120_000 });
  await el.click();
  await waitForCanvasOpened();
}

/** Click an artboard's name strip inside the canvas frame (selects the artboard), keyboard focus in the frame. */
async function selectArtboard(id: string): Promise<void> {
  await focusCanvasFrame();
  await enterCanvasFrame();
  const label = await $(`[data-dc-screen="${id}"] .dc-artboard-label`);
  await label.waitForDisplayed({ timeout: 30_000 });
  await label.click();
  await browser.pause(300);
}

describe('#122 122-C — paste between two project tabs', () => {
  let report: ReturnType<typeof startReport>;
  let sourceTab = '';
  let targetTab = '';

  before(async () => {
    report = startReport('clipboard-cross-project');
    await waitForSidecar();
    sourceTab = (await labels()).find((l) => l.startsWith('p-')) ?? '';
    expect(sourceTab).not.toBe('');
    targetTab = (await openTab(TARGET)).label;
    await waitForSidecar();
  });

  it('copies Hero in the source project (nothing written there)', async () => {
    await focusTab(sourceTab);
    await openCanvas('canvas-row-ui-home');
    const before = src(SOURCE, 'ui/Home.tsx');
    await selectArtboard('hero');
    await browser.keys(['Meta', 'c']);
    await browser.pause(800);
    await exitToTop();
    expect(src(SOURCE, 'ui/Home.tsx')).toBe(before);
    await capture(report, 'copied-in-source');
  });

  it('⌘V on About in the other project waits for the shell’s own toast', async () => {
    await focusTab(targetTab);
    await openCanvas('canvas-row-ui-about');
    await selectArtboard('about');
    await browser.keys(['Meta', 'v']);
    await exitToTop();
    const ask = await $('//*[contains(normalize-space(.), "Paste the artboard copied in Home")]');
    await ask.waitForDisplayed({ timeout: 15_000 });
    // nothing crosses before the click: no paste, no picture
    expect(boards(src(TARGET, 'ui/About.tsx'))).toBe(1);
    expect(pictureIn(TARGET)).toEqual([]);
    await capture(report, 'asked-in-target');
  });

  it('Paste brings the artboard, its import, its constant and its picture', async () => {
    const paste = await $('//button[normalize-space(.)="Paste"]');
    await paste.waitForClickable({ timeout: 10_000 });
    await paste.click();
    await browser.waitUntil(() => boards(src(TARGET, 'ui/About.tsx')) === 2, {
      timeout: 30_000,
      timeoutMsg: 'the artboard never landed in About',
    });
    const out = src(TARGET, 'ui/About.tsx');
    expect(out).toContain("import { Card } from '../components/Card';");
    expect(out).toContain('const W = 640;');
    const sent = readFileSync(join(SOURCE, '.design', 'assets', pictureIn(SOURCE)[0] as string));
    const name = `${createHash('sha256').update(sent).digest('hex').slice(0, 8)}.png`;
    expect(pictureIn(TARGET)).toEqual([name]);
    expect(readFileSync(join(TARGET, '.design', 'assets', name)).equals(sent)).toBe(true);
    // it renders: the pasted card's text is on the canvas and no error card replaced it
    await enterCanvasFrame();
    await $('//*[normalize-space(.)="Carried across"]').waitForDisplayed({ timeout: 30_000 });
    await exitToTop();
    expect(await $('[data-testid="canvas-error-card"]').isExisting()).toBe(false);
    await capture(report, 'pasted-in-target');
  });

  it('⌘Z on About takes the paste back; the picture stays', async () => {
    await selectArtboard('about');
    await browser.keys(['Meta', 'z']);
    await exitToTop();
    await browser.waitUntil(() => boards(src(TARGET, 'ui/About.tsx')) === 1, {
      timeout: 20_000,
      timeoutMsg: 'the paste was not undone',
    });
    expect(src(TARGET, 'ui/About.tsx')).not.toContain('components/Card');
    expect(pictureIn(TARGET).length).toBe(1);
    await capture(report, 'undone-in-target');
  });
});
