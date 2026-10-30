import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { $, $$, browser, expect } from '@wdio/globals';
import type {} from '@wdio/tauri-service';

import { openVersionHistory } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';
import { pinCurrentWindow } from '../helpers/windows';

/**
 * S1.14 — Version history, DOM-driven (V2-1.9 §5.4–§5.8, 11 · pn-history):
 *   name the current version → change the canvas → look at the named version (the Viewing bar, the canvas
 *   frame at `?sha=`, esc returns) → Restore this version → the toast "Restored “…” · Undo" → Undo.
 * S1.15 — Compare (11 · pn-compare, V2-1.9 §5.7–§5.8): the named version is A and Now is B → two read-only frames,
 *   the changes in words with who made them → Restore only <artboard> puts one artboard back as a new version.
 *
 * Not run in CI by this slice (the lead runs desktop e2e at the Phase 5 gate). The change in step 2 is an
 * outside write to the canvas file — Maude records it as a version of its own ("changed outside Maude"),
 * which is exactly what makes the named version worth restoring.
 */
const tid = (id: string) => `[data-testid="${id}"]`;
const CANVAS_ROW = 'canvas-row-ui-smoke';
const CANVAS_PATH = '.design/ui/Smoke.tsx';
const NAME = 'Before the outside edit';
// The spec edits the canvas from outside, and restoring a version rewrites it from inside.
const FIXTURE_DIR = join(process.env.MAUDE_PROJECT_ROOT as string, '.design', 'ui');
const fixtures = createFixtureGuard('version-history', [
  join(FIXTURE_DIR, 'Smoke.tsx'),
  join(FIXTURE_DIR, 'Smoke.meta.json'),
]);

/** The toast stack renders the message and, when it has one, its action button. */
const toastText = (text: string) => `//*[contains(normalize-space(.), "${text}")]`;

async function canvasSrc(): Promise<string> {
  return (await $(tid('canvas-frame'))).getAttribute('src');
}

describe('version-history — name, look, restore, undo', () => {
  before(async () => {
    startReport('version-history');
    await waitForSidecar();
    await pinCurrentWindow();
    await (await canvasRow(CANVAS_ROW)).click();
    await browser.waitUntil(
      async () => (await (await $(tid('canvas-frame'))).getAttribute('data-path')) === CANVAS_PATH,
      { timeout: 30_000, timeoutMsg: `Expected ${CANVAS_PATH} to be the active canvas` }
    );
  });

  after(() => fixtures.restore());

  it('names the current version from the Now row', async () => {
    await openVersionHistory();
    await (await $(tid('vh-now'))).waitForDisplayed({ timeout: 30_000 });
    // "Name this version…" is enabled once the canvas has a saved version and nothing is unsent
    const name = await $(tid('vh-name'));
    await browser.waitUntil(
      async () => (await name.getText()) === 'Name this version…' && (await name.isEnabled()),
      {
        timeout: 30_000,
        timeoutMsg: 'the Now row never offered "Name this version…"',
      }
    );
    await name.click();
    const input = await $(tid('vh-name-input'));
    await input.waitForDisplayed({ timeout: 10_000 });
    await input.setValue(NAME);
    await (await $(tid('vh-name-save'))).click();
    await (await $(tid('vh-name-dialog'))).waitForDisplayed({ reverse: true, timeout: 10_000 });
    // the named version shows at the top of the list with its chip
    await browser.waitUntil(
      async () => (await $$(`${tid('vh-list')} .chip`).map((c) => c.getText())).includes('Named'),
      { timeout: 30_000, timeoutMsg: 'no row carries the Named chip' }
    );
    await capture('named');
  });

  it('shows a later change as a version of its own', async () => {
    const root = process.env.MAUDE_PROJECT_ROOT as string;
    appendFileSync(join(root, CANVAS_PATH), '\n// edited outside Maude\n');
    await browser.waitUntil(async () => (await $$('[data-testid^="vh-row-"]')).length >= 2, {
      timeout: 30_000,
      timeoutMsg: 'the outside edit never became a row',
    });
    await capture('two versions');
  });

  it('looks at the named version: the Viewing bar, the frame at ?sha=, esc back to now', async () => {
    const named = await $(
      `//*[@data-testid and starts-with(@data-testid, "vh-row-")][.//*[contains(@class, "chip") and normalize-space()="Named"]]`
    );
    await named.click();
    const bar = await $(tid('vh-viewbar'));
    await bar.waitForDisplayed({ timeout: 10_000 });
    expect(await (await $(tid('vh-viewbar-text'))).getText()).toContain(`Viewing “${NAME}”`);
    expect(await (await $(tid('vh-viewbar-back'))).getText()).toContain('back to now');
    await browser.waitUntil(async () => /[?&]sha=r\d+/.test(await canvasSrc()), {
      timeout: 15_000,
      timeoutMsg: 'the canvas frame never loaded the past version',
    });
    expect(await canvasSrc()).toContain('ro=1');
    await capture('viewing');
    // esc returns to now
    await browser.keys(['Escape']);
    await bar.waitForDisplayed({ reverse: true, timeout: 10_000 });
    await browser.waitUntil(async () => !/[?&]sha=/.test(await canvasSrc()), {
      timeout: 15_000,
      timeoutMsg: 'esc did not bring the canvas back to now',
    });
  });

  it('compares the named version with Now, then restores only the artboard that changed', async () => {
    const root = process.env.MAUDE_PROJECT_ROOT as string;
    const file = join(root, CANVAS_PATH);
    // an outside edit to the artboard's own style: a change with words, on an artboard A holds. A row is named
    // by its LAST revision (`vh-row-r<n>`), so a new first row — merged into the one before or not — is the sign.
    const newest = async () =>
      (await $$('[data-testid^="vh-row-"]'))[0]?.getAttribute('data-testid');
    const before = await newest();
    writeFileSync(file, readFileSync(file, 'utf8').replace('color: "#111"', 'color: "#c00"'));
    await browser.waitUntil(async () => (await newest()) !== before, {
      timeout: 30_000,
      timeoutMsg: 'the style edit never became a version',
    });
    const named = await $(
      `//*[@data-testid and starts-with(@data-testid, "vh-row-")][.//*[contains(@class, "chip") and normalize-space()="Named"]]`
    );
    await named.click();
    await (await $(tid('vh-viewbar'))).waitForDisplayed({ timeout: 10_000 });
    await (await $(tid('vh-compare'))).click();
    // A and B are marked; two read-only frames; the changes are in words
    await (await $(tid('cmp-view'))).waitForDisplayed({ timeout: 15_000 });
    await (await $(tid('vh-mark-A'))).waitForDisplayed({ timeout: 10_000 });
    await (await $(`${tid('vh-now')} ${tid('vh-mark-B')}`)).waitForDisplayed({ timeout: 10_000 });
    const frameA = await (await $(tid('cmp-frame-a'))).getAttribute('src');
    const frameB = await (await $(tid('cmp-frame-b'))).getAttribute('src');
    expect(frameA).toMatch(/[?&]sha=r\d+/);
    expect(frameA).toContain('ro=1');
    expect(frameB).not.toMatch(/[?&]sha=/);
    expect(frameB).toContain('ro=1');
    await browser.waitUntil(
      async () => /change(s)? between A and B/.test(await (await $(tid('cmp-summary'))).getText()),
      { timeout: 30_000, timeoutMsg: 'Compare never said what changed' }
    );
    await (await $(tid('cmp-line-0'))).waitForDisplayed({ timeout: 10_000 });
    await capture('comparing');
    // Overlay keeps both frames
    await (await $(tid('cmp-mode-overlay'))).click();
    await (await $(tid('cmp-wipe'))).waitForDisplayed({ timeout: 10_000 });
    await (await $(tid('cmp-mode-side'))).click();
    // Restore only <artboard>: the style is back, the outside comment from before stays
    const only = await $(tid('vh-restore-only'));
    await only.waitForDisplayed({ timeout: 10_000 });
    expect(await only.getText()).toMatch(/^Restore only /);
    await only.click();
    await (await $(tid('cmp-view'))).waitForDisplayed({ reverse: true, timeout: 15_000 });
    await (await $(toastText('Restored SMOKE/01'))).waitForDisplayed({ timeout: 15_000 });
    await browser.waitUntil(() => readFileSync(file, 'utf8').includes('color: "#111"'), {
      timeout: 30_000,
      timeoutMsg: 'Restore only did not put the artboard back',
    });
    expect(readFileSync(file, 'utf8')).toContain('// edited outside Maude');
    await capture('restored-only');
    await (await $(`//button[normalize-space()="Undo"]`)).click();
    await (await $(toastText('Restore undone.'))).waitForDisplayed({ timeout: 15_000 });
  });

  it('restores it as a new version and takes the restore back with Undo', async () => {
    const named = await $(
      `//*[@data-testid and starts-with(@data-testid, "vh-row-")][.//*[contains(@class, "chip") and normalize-space()="Named"]]`
    );
    await named.click();
    await (await $(tid('vh-viewbar'))).waitForDisplayed({ timeout: 10_000 });
    await (await $(tid('vh-restore'))).click();
    // the hold is released and the toast names what came back, with its one action
    await (await $(tid('vh-viewbar'))).waitForDisplayed({ reverse: true, timeout: 15_000 });
    await (await $(toastText(`Restored “${NAME}”`))).waitForDisplayed({ timeout: 15_000 });
    await capture('restored');
    // the restore is a version of its own, in the list
    await browser.waitUntil(
      async () =>
        (await $$(`${tid('vh-list')} strong`).map((s) => s.getText())).some((t) =>
          t.startsWith('Restored')
        ),
      { timeout: 30_000, timeoutMsg: 'the restore never became a row' }
    );
    await (await $(`//button[normalize-space()="Undo"]`)).click();
    await (await $(toastText('Restore undone.'))).waitForDisplayed({ timeout: 15_000 });
    await capture('undone');
  });
});
