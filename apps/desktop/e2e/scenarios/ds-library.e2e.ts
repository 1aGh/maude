import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, $$, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 13 · ds-many-library, ds-many-linked (S10.18c) — a project that links a team library reads it here and takes its
 * updates as a review, never silently. On open the app asks the library's hub once (the 30-minute check); the card
 * in the inspector says "Team library · <hub>" and "2 updates waiting"; Update… opens "Update from gator? 2 changes";
 * Update goes on to this project's own review (each canvas with a tick); its Update is ONE action and the library is
 * up to date. Unlink makes the copy an own system. The banner says "Linked from <home>." with the view-only line.
 * WRITTEN, NOT RUN in the S10.18c hand-back (the lead runs the desktop lane, under the lock).
 *
 * Harness: wdio.ds-library.conf.ts → fixtures/seed-ds-library.ts (a loopback stand-in hub, system `gator` linked at V1
 * and the hub moved on to V2; the grant is in a scratch grants file this app is started with).
 * The board's own "Linked library — view only" bar lives in the canvas iframe, which the DOM cannot reach
 * (the origin split); the unit test ds-library-board-bar.test.tsx owns it.
 */
const ROOT = process.env.MAUDE_E2E_DS_LIBRARY_ROOT ?? '';
const HEAD = join(ROOT, '.design', 'system', 'gator', 'revisions', 'head.json');
const readHead = () => JSON.parse(readFileSync(HEAD, 'utf8'));

describe('ds-library — a linked team library: the card, the review, Update, Unlink', () => {
  let linkedHead = '';

  before(() => {
    startReport('ds-library');
  });

  it('opens the linked system: the card names the library and says 2 updates wait', async () => {
    await waitForSidecar();
    linkedHead = readHead().head;
    const row = await canvasRow('canvas-row-system-gator-design-system');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    const card = await $('[data-testid="ds-library-card"]');
    await card.waitForExist({ timeout: 25_000, timeoutMsg: 'the library card never appeared' });
    expect(await card.getAttribute('data-system')).toBe('gator');
    expect(await (await $('[data-testid="ds-library-kind"]')).getText()).toContain(
      'Team library · 127.0.0.1'
    );
    await browser.waitUntil(
      async () =>
        (await (await $('[data-testid="ds-library-waiting"]')).getText()) === '2 updates waiting',
      { timeout: 25_000, timeoutMsg: 'the card never said 2 updates waiting' }
    );
    await capture('ds-library-card');
  });

  it('the banner: Linked from <home>. — and view only', async () => {
    expect(await (await $('[data-testid="ds-library-banner-title"]')).getText()).toContain(
      'Linked from 127.0.0.1'
    );
    expect(await (await $('[data-testid="ds-library-banner-sub"]')).getText()).toBe(
      'View only here — every update arrives as a review.'
    );
    // a loopback hub is not a home this app opens: no "Open in …" button, still the words
    expect(await (await $('[data-testid="ds-library-open"]')).isExisting()).toBe(false);
    await capture('ds-library-banner');
  });

  it('Update… asks "Update from gator? 2 changes" and Cancel changes nothing', async () => {
    await (await $('[data-testid="ds-library-update"]')).click();
    const title = await $('[data-testid="ds-library-title"]');
    await title.waitForExist({ timeout: 15_000, timeoutMsg: 'the update question never opened' });
    expect(await title.getText()).toBe('Update from gator? 2 changes');
    expect(await (await $('[data-testid="ds-library-fine"]')).getText()).toContain('By Tereza');
    await capture('ds-library-dialog');
    await (await $('[data-testid="ds-library-cancel"]')).click();
    expect(await (await $('[data-testid="ds-library-dialog"]')).isExisting()).toBe(false);
    expect(readHead().head).toBe(linkedHead);
  });

  it('Update goes on to this project’s own review; its Update is one action and the card is up to date', async () => {
    await (await $('[data-testid="ds-library-update"]')).click();
    await (await $('[data-testid="ds-library-go"]')).waitForExist({ timeout: 15_000 });
    await (await $('[data-testid="ds-library-go"]')).click();
    await (await $('[data-testid="ds-review"]')).waitForExist({
      timeout: 15_000,
      timeoutMsg: 'the review sheet never opened',
    });
    expect((await $$('[data-testid="ds-review-row"]')).length).toBe(2);
    await capture('ds-library-review');
    await (await $('[data-testid="ds-review-update"]')).click();
    await browser.waitUntil(
      async () => !(await (await $('[data-testid="ds-review"]')).isExisting()),
      {
        timeout: 25_000,
        timeoutMsg: 'the review never closed',
      }
    );
    await browser.waitUntil(
      async () =>
        (await (await $('[data-testid="ds-library-waiting"]')).getText()) === 'Up to date',
      { timeout: 25_000, timeoutMsg: 'the card never said Up to date' }
    );
    const head = readHead();
    expect(head.head).not.toBe(linkedHead);
    expect(head.log[0].action).toBe('library');
    await capture('ds-library-updated');
  });

  it('Unlink… asks first; Unlink makes the copy an own system and the card goes', async () => {
    await (await $('[data-testid="ds-library-unlink"]')).click();
    await (await $('[data-testid="ds-library-unlink-ask"]')).waitForExist({ timeout: 10_000 });
    await (await $('[data-testid="ds-library-unlink-cancel"]')).click();
    expect(readHead().library).toBeTruthy();
    await (await $('[data-testid="ds-library-unlink"]')).click();
    await (await $('[data-testid="ds-library-unlink-go"]')).click();
    await browser.waitUntil(
      async () => !(await (await $('[data-testid="ds-library-card"]')).isExisting()),
      {
        timeout: 25_000,
        timeoutMsg: 'the card never went',
      }
    );
    expect(readHead().library).toBeNull();
    await capture('ds-library-unlinked');
  });
});
