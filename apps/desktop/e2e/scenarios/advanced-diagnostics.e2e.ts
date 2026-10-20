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

  // S11.19 (written, not run: needs an unlocked screen and the lane — run once alone after merge).
  // Each leg also asserts the G1/G2 class of defect: nothing inside an Advanced body reaches past the
  // body's right edge, so nothing is clipped out of its panel. (Edges, not scrollWidth: scrollWidth also
  // counts the body's own offset.)
  const fitsItsPanel = async (testid: string) =>
    browser.execute((t) => {
      const body = document.querySelector(`[data-testid="${t}"]`) as HTMLElement | null;
      if (!body) return false;
      const edge = body.getBoundingClientRect().right + 0.5;
      return [...body.querySelectorAll('*')].every((e) => {
        const r = e.getBoundingClientRect();
        return !r.width || r.right <= edge;
      });
    }, testid);

  it('5 · Settings › Advanced: this Mac, Claude Code, Decision memory, Reset', async () => {
    await (await $(tid('project-pill'))).click();
    await (await $(tid('project-menu-row-settings.open'))).click();
    await (await $(tid('settings-tab-advanced'))).click();
    for (const id of [
      'settings-server-port',
      'settings-runtime',
      'settings-own-plugin-copy',
      'settings-decision-memory',
      'settings-reset-folds',
    ]) {
      expect({ id, shown: await (await $(tid(id))).isDisplayed() }).toEqual({ id, shown: true });
    }
    await capture('05-settings-advanced');
    await (await $(tid('settings-close'))).click();
  });

  it('6 · Canvases › Advanced: the folder path and the switches all fit the panel', async () => {
    const toggle = await $(tid('canvases-advanced'));
    await toggle.waitForDisplayed({ timeout: 10_000 });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    // the fold opens on the next render, not inside the click
    await (await $(tid('canvases-folder'))).waitForDisplayed({ timeout: 5000 });
    for (const id of ['canvases-folder', 'canvases-folder-copy', 'canvases-refresh']) {
      expect({ id, shown: await (await $(tid(id))).isDisplayed() }).toEqual({ id, shown: true });
    }
    expect(await fitsItsPanel('fold-left.canvases-body')).toBe(true);
    await capture('06-canvases-advanced');
  });

  it('7 · Version history › Advanced: project, branch and versions fit the panel', async () => {
    await (await $(tid('project-pill'))).click();
    await (await $(tid('project-menu-row-history.open'))).click();
    const toggle = await $(tid('fold-history-toggle'));
    await toggle.waitForDisplayed({ timeout: 10_000 });
    // folds are remembered per Mac: open it only when it is closed
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    expect(await (await $(tid('vh-advanced'))).isDisplayed()).toBe(true);
    expect(await fitsItsPanel('fold-history-body')).toBe(true);
    await capture('07-history-advanced');
  });
});
