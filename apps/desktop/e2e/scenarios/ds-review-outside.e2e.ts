import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, $$, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { waitForCanvasOpened } from '../helpers/canvas-frame';
import { waitForSidecar } from '../helpers/sidecar';
import { dsRow } from '../helpers/tree';

/**
 * 13 · ds-truth-outside, part 3 of the ds-review story (S10.11) — a file of the design system changes behind the
 * app's back: Claude Code edits colors_and_type.css. It arrives as a review ("1 token changed outside the app"),
 * never silently; Keep makes the new value part of the system, Undo writes the old bytes back.
 * WRITTEN, NOT RUN in the S10.11 hand-back (the lead runs the desktop lane, under the lock).
 *
 * Lives in its own file (not ds-review.e2e.ts) so the parts built in parallel never collide; it shares that
 * scenario's harness (wdio.ds-outside.conf.ts → fixtures/seed-ds-outside.ts: system `acme` converted, nothing
 * waiting). The edit is made from the test process the way the agent's hook would leave it: the file changes and
 * the hook's `_runs/<session>/touched.json` names it, so the card says "Claude Code".
 */
const ROOT = process.env.MAUDE_E2E_DS_OUTSIDE_ROOT ?? '';
const DESIGN = join(ROOT, '.design');
const CSS = join(DESIGN, 'system', 'acme', 'colors_and_type.css');
const HEAD = join(DESIGN, 'system', 'acme', 'revisions', 'head.json');
const headDoc = (): { head: string; base: string } => JSON.parse(readFileSync(HEAD, 'utf8'));

/** What Claude Code does: change the file, and let the post-edit hook say it did. */
function agentEdits(text: string): void {
  writeFileSync(CSS, text);
  const runs = join(DESIGN, '_runs', 'e2e');
  mkdirSync(runs, { recursive: true });
  writeFileSync(
    join(runs, 'touched.json'),
    JSON.stringify({ 'system/acme/colors_and_type.css': { at: Date.now(), by: 'Claude Code' } })
  );
}

const card = () => $('[data-testid="ds-outside"]');

describe('ds-review (part 3) — an agent edit arrives as a review, Keep and Undo', () => {
  let original = '';
  let kept = '';

  before(() => {
    startReport('ds-review (part 3)');
    original = readFileSync(CSS, 'utf8');
  });

  it('opens the Design system canvas: nothing is waiting, the inspector keeps its hint', async () => {
    await waitForSidecar();
    const row = await dsRow('acme');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    await waitForCanvasOpened();
    expect(await (await card()).isExisting()).toBe(false);
  });

  it('Claude Code changes the accent in the CSS: ≤ 5.3 s later the card says so, attributed', async () => {
    agentEdits(original.replace('--accent: oklch(0.55 0.2 255);', '--accent: oklch(0.5 0.2 255);'));
    await (await card()).waitForExist({
      timeout: 25_000,
      timeoutMsg: 'the outside-change card never arrived',
    });
    expect(await (await $('[data-testid="ds-outside-title"]')).getText()).toBe(
      '1 token changed outside the app'
    );
    expect(await (await $('[data-testid="ds-outside-source"]')).getText()).toContain(
      'colors_and_type.css was edited by Claude Code'
    );
    expect((await $$('[data-testid="ds-outside-change"]')).length).toBe(1);
    await capture('ds-outside-card');
  });

  it('the swatch on the canvas wears the same news, and nothing was kept silently', async () => {
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
          return !!f?.contentDocument?.querySelector('style[data-ds-marks]');
        }),
      { timeout: 15_000, timeoutMsg: 'the canvas never marked the changed swatch' }
    );
    const doc = headDoc();
    expect(doc.base).toBe(doc.head); // a Keep has not happened
  });

  it('Keep: the new value becomes the system’s base; head stays until an update', async () => {
    const before = headDoc();
    await (await $('[data-testid="ds-outside-keep"]')).click();
    await (await card()).waitForExist({ reverse: true, timeout: 20_000 });
    const after = headDoc();
    expect(after.base).not.toBe(before.base);
    expect(after.head).toBe(before.head);
    kept = readFileSync(CSS, 'utf8');
    expect(kept).toContain('oklch(0.5 0.2 255)'); // Keep never rewrites the file
    await capture('ds-outside-kept');
  });

  it('a second edit, then Undo: the file gets its old bytes back', async () => {
    agentEdits(kept.replace('--fg-0: #111111;', '--fg-0: #222222;'));
    await (await card()).waitForExist({ timeout: 25_000 });
    await (await $('[data-testid="ds-outside-undo"]')).click();
    await (await card()).waitForExist({ reverse: true, timeout: 20_000 });
    await browser.waitUntil(() => readFileSync(CSS, 'utf8') === kept, {
      timeout: 15_000,
      timeoutMsg: 'Undo never wrote the old bytes back',
    });
    await capture('ds-outside-undone');
  });
});
