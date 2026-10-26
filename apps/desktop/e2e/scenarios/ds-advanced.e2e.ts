import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, $$, expect } from '@wdio/globals';
import { waitForCanvasOpened } from '../helpers/canvas-frame';
import { openInspector } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { dsRow } from '../helpers/tree';

/**
 * 13 · ds-advanced (S10.19) — with nothing selected on a system's own Design system canvas the inspector shows
 * the SYSTEM: how many canvases follow it, its modes, "Check the system", and one fold down the files behind it
 * (tokens as CSS | JSON, the folder, Hand off tokens, Reveal in Finder), plus which way changes flow and the
 * system's own version history. "Check the system" is deterministic: the lines are computed from the files and
 * kept in `_state/ds-check/<ds>.json`.
 * WRITTEN, NOT RUN in the S10.19 hand-back (the lead runs the desktop lane, under the lock).
 *
 * Harness: wdio.ds-advanced.conf.ts → fixtures/seed-ds-outside.ts (system `acme`, converted, nothing waiting).
 * Reveal in Finder is only asserted to be there: pressing it opens Finder on the machine running the test.
 */
const ROOT = process.env.MAUDE_E2E_DS_ADVANCED_ROOT ?? '';
const KEPT = join(ROOT, '.design', '_state', 'ds-check', 'acme.json');

describe('ds-advanced — the system panel, Check the system, the files behind it', () => {
  before(() => {
    startReport('ds-advanced');
  });

  it('opens the Design system canvas: the inspector shows the system, not the hint', async () => {
    await waitForSidecar();
    const row = await dsRow('acme');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    await waitForCanvasOpened();
    await openInspector();
    const panel = await $('[data-testid="ds-advanced"]');
    await panel.waitForExist({ timeout: 25_000, timeoutMsg: 'the system panel never appeared' });
    expect(await panel.getAttribute('data-system')).toBe('acme');
    expect(await (await $('[data-testid="ds-check-button"]')).getText()).toContain(
      'Check the system'
    );
    expect(await (await $('[data-testid="ds-check-card"]')).isExisting()).toBe(false);
    await capture('ds-advanced-panel');
  });

  it('Check the system: the card arrives with computed lines and the answer is kept on disk', async () => {
    await (await $('[data-testid="ds-check-button"]')).click();
    const card = await $('[data-testid="ds-check-card"]');
    await card.waitForExist({ timeout: 25_000, timeoutMsg: 'the check card never arrived' });
    expect(await (await $('[data-testid="ds-check-ran"]')).getText()).toBe('ran just now');
    const rows = await $$('[data-testid^="ds-check-row-"]');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    // `rows` is a WebdriverIO ElementArray, whose own `map` is not an Array's: walk it
    const kinds: string[] = [];
    for (const r of rows) kinds.push(await r.getAttribute('data-kind'));
    for (const k of ['contrast', 'complete', 'schema']) expect(kinds).toContain(k);
    expect(await (await $('[data-testid="ds-check-ask-ai"]')).isExisting()).toBe(true);
    expect(existsSync(KEPT)).toBe(true);
    const kept = JSON.parse(readFileSync(KEPT, 'utf8'));
    expect(kept.format).toBe('maude.ds-system-check');
    expect(kept.ds).toBe('acme');
    await capture('ds-advanced-check');
  });

  it('the fold: the folder path heads the files, CSS shows the tokens, JSON switches the file', async () => {
    // The fold comes up open (S10.19, `<details open>`) — a click on a fold that is already open would close it.
    const fold = await $('[data-testid="ds-advanced-fold"]');
    if ((await fold.getAttribute('open')) === null) await (await fold.$('summary')).click();
    const folder = await $('[data-testid="ds-advanced-folder"]');
    await folder.waitForDisplayed({ timeout: 10_000 });
    expect(await folder.getText()).toContain('system/acme/');
    const code = await $('[data-testid="ds-advanced-code"]');
    expect(await code.getAttribute('data-file')).toBe('colors_and_type.css');
    expect(await code.getText()).toContain('--accent');
    await (await $('[data-testid="ds-advanced-seg-json"]')).click();
    expect(await (await $('[data-testid="ds-advanced-code"]')).getAttribute('data-file')).toBe(
      'tokens.json'
    );
    expect(await (await $('[data-testid="ds-handoff-tokens"]')).getText()).toContain(
      'Hand off tokens'
    );
    expect(await (await $('[data-testid="ds-reveal-files"]')).isExisting()).toBe(true);
    await capture('ds-advanced-fold');
  });

  it('which way changes flow, and a system with nothing published says so', async () => {
    expect(await (await $('[data-testid="ds-flow"]')).getText()).toContain(
      'Which way changes flow'
    );
    expect(await (await $('[data-testid="ds-history"]')).getText()).toContain(
      'Nothing published yet.'
    );
  });

  it('Hand off tokens opens the handoff sheet', async () => {
    await (await $('[data-testid="ds-handoff-tokens"]')).click();
    await (await $('[role="dialog"]')).waitForExist({
      timeout: 10_000,
      timeoutMsg: 'the handoff sheet never opened',
    });
    await capture('ds-advanced-handoff');
  });
});
