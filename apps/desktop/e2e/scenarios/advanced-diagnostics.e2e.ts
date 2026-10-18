import { $, $$, browser, expect } from '@wdio/globals';

import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';

/**
 * S11.11 (part 1) — Menu › Diagnostics, DOM-driven (06 ad-diag · ad-logs).
 *
 * Project pill → Diagnostics → Logs opens the sheet on the Logs tab: a filter by source, a search, Copy
 * all, Show in Finder (the desktop app only). Server shows the live connection; AI setup answers in rows;
 * Esc closes the sheet and gives focus back to the pill.
 *
 * Part 2 (the Resync trace: "Resyncing… 1 204 of 1 318" → the result sentence → the log line) needs a
 * project linked to a hub; it joins team-project.e2e.ts's conflict leg with S11.12.
 */
const tid = (s: string) => `[data-testid="${s}"]`;

async function openDiagnosticsRow(row: string) {
  const pill = await $(tid('project-pill'));
  await pill.waitForDisplayed({ timeout: 30_000 });
  await pill.click();
  await (await $(tid('project-menu-row-sub-diagnostics'))).click();
  const item = await $(tid(`project-menu-row-${row}`));
  await item.waitForDisplayed({ timeout: 5_000 });
  await item.click();
}

describe('advanced-diagnostics', () => {
  before(async () => {
    startReport('advanced-diagnostics — Menu › Diagnostics › Logs · Server · AI setup');
    await waitForSidecar();
  });

  it('1 · Diagnostics › Logs opens the sheet with the source filter, search, Copy all and Show in Finder', async () => {
    await openDiagnosticsRow('diag.logs');
    const sheet = await $(tid('diagnostics-sheet'));
    await sheet.waitForDisplayed({ timeout: 5_000 });
    expect(await sheet.getAttribute('data-view')).toBe('logs');
    for (const id of [
      'diag-logs-filter-all',
      'diag-logs-filter-sync',
      'diag-logs-filter-server',
      'diag-logs-filter-ai',
      'diag-logs-filter-export',
      'diag-logs-search',
      'diag-logs-copy-all',
      'diag-logs-show-in-finder',
    ]) {
      expect({ id, shown: await (await $(tid(id))).isDisplayed() }).toEqual({ id, shown: true });
    }
    await capture('01-logs');
  });

  it('2 · a source filter narrows the tail; the foot names the retention', async () => {
    const sync = await $(tid('diag-logs-filter-sync'));
    await sync.click();
    expect(await sync.getAttribute('aria-pressed')).toBe('true');
    const lines = await $$(`${tid('diag-logs-lines')} li`);
    for (const li of lines) expect(await li.getAttribute('data-source')).toBe('sync');
    await (await $(tid('diag-logs-filter-all'))).click();
    expect(await (await $(tid('diagnostics-sheet'))).getText()).toContain(
      'Kept 7 days on this Mac'
    );
  });

  it('3 · Server shows the live connection; AI setup answers in rows', async () => {
    await (await $(tid('diag-tab-server'))).click();
    const live = await $(tid('diag-live'));
    await live.waitForDisplayed({ timeout: 5_000 });
    expect(await live.getText()).toBe('Connected');
    await (await $(tid('diag-tab-ai'))).click();
    await (await $(tid('diag-ai'))).waitForDisplayed({ timeout: 5_000 });
    // the probe may still be running; once it answers there are four rows (or the unreachable line)
    await browser.waitUntil(
      async () =>
        (await $$(`${tid('diag-ai-rows')} li`)).length === 4 ||
        (await (await $(tid('diag-ai'))).getText()).includes('Couldn’t reach'),
      { timeout: 30_000, timeoutMsg: 'AI setup never answered' }
    );
    await capture('03-ai-setup');
  });

  it('4 · Esc closes the sheet', async () => {
    await browser.keys('Escape');
    await (await $(tid('diagnostics-sheet'))).waitForExist({ reverse: true, timeout: 5_000 });
  });
});
