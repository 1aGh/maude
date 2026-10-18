import { browser, expect } from '@wdio/globals';

import { capture, startReport } from '../helpers/evidence';
import { invokeTauri } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';
import { focusTab, labels, openTab, pinCurrentWindow, strip, waitWindow } from '../helpers/windows';

/**
 * S9.17 — the browser door as a tab, and mentions on the Dock badge.
 *
 * A Can view account gets `409 {reason:'browser-door', url}` from the mint door (no peer token, no
 * local copy). The page relays that URL to `open_cell_tab`; Rust opens the cell as a `c-*` tab:
 * once per (account, cell), pinned to the cell's https origin, in no capability. The cell itself is
 * not reachable from the e2e machine, so the scenario asserts the TAB (strip, label, open-once,
 * refusals), not the cell's page.
 *
 * Mentions: a project tab reports its unread mentioned threads (`mention_notice`); the count joins
 * the Dock badge (`e2e_dock_badge`) and leaves with the read.
 */
const SECONDARY = process.env.MAUDE_E2E_SECONDARY_ROOT as string;
const DOOR = 'https://e2e-cell.cloud.maude.sh/c/ui/Poster.tsx';

describe('cell-tab-browser-door (native-desktop)', () => {
  let tabA = '';
  let cell = '';

  before(async () => {
    startReport('cell-tab-browser-door (native-desktop)');
    await browser.setTimeout({ script: 60_000 });
    await waitForSidecar();
    tabA = await pinCurrentWindow();
  });

  it('a foreign or malformed door is refused and opens nothing', async () => {
    const before = await labels();
    for (const url of [
      'https://evil.example/',
      'https://view-e2e-cell.cloud.maude.sh/',
      'https://e2e-cell.cloud.maude.sh/?next=https://evil.example',
      'http://e2e-cell.cloud.maude.sh/',
      'https://e2e-cell.cloud.maude.sh/c/../secret',
    ]) {
      await expect(invokeTauri('open_cell_tab', { url })).rejects.toThrow();
    }
    // A project tab names only its own account.
    await expect(
      invokeTauri('open_cell_tab', { url: DOOR, profile: 'someone-else' })
    ).rejects.toThrow();
    expect(await labels()).toEqual(before);
  });

  it('a browser door opens one cell tab, and the same door again focuses it', async () => {
    let first: { label: string; opened: string };
    try {
      first = await invokeTauri<{ label: string; opened: string }>('open_cell_tab', { url: DOOR });
    } catch (e) {
      // macOS < 14 / not macOS: no per-account cookie store — the page falls back to the browser.
      expect(String(e)).toContain('Open this project in your browser.');
      return;
    }
    cell = first.label;
    expect(cell).toMatch(/^c-[0-9a-f]{16}$/);
    expect(first.opened).toBe('new');
    await waitWindow(cell);
    const s = await strip();
    expect(s.tabs).toContain(cell);
    expect(s.active).toBe(cell);
    await capture('1-cell-tab-open');

    await focusTab(tabA);
    const again = await invokeTauri<{ label: string; opened: string }>('open_cell_tab', {
      url: 'https://e2e-cell.cloud.maude.sh/',
    });
    expect(again).toEqual({ label: cell, opened: 'existing' });
    expect((await strip()).tabs.filter((l) => l === cell)).toHaveLength(1);
  });

  it('the cell tab has no IPC', async () => {
    if (!cell) return;
    await browser.switchToWindow(cell);
    const hasTauri = await browser
      .execute(() => typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__)
      .catch(() => 'unreachable');
    expect(hasTauri).not.toBe('object');
    await focusTab(tabA);
  });

  it("a project's unread mentions join the Dock badge and leave when read", async () => {
    const opened = await openTab(SECONDARY);
    await waitWindow(opened.label);
    await focusTab(opened.label);
    await waitForSidecar();
    const base = await invokeTauri<number>('e2e_dock_badge');
    await invokeTauri('mention_notice', {
      count: 2,
      latest: {
        key: 'cm-mention:t1:root',
        from: 'Jonas Novák',
        where: 'A4 · plakát',
        canvas: 'ui/Poster.tsx',
        thread: 't1',
      },
    });
    expect(await invokeTauri<number>('e2e_dock_badge')).toBe(base + 2);
    // A canvas outside the project is refused (the thread target is validated).
    await expect(
      invokeTauri('mention_notice', {
        count: 2,
        latest: { key: 'k2', from: 'J', canvas: '../etc/passwd', thread: 't1' },
      })
    ).rejects.toThrow();
    await invokeTauri('mention_notice', { count: 0, latest: null });
    expect(await invokeTauri<number>('e2e_dock_badge')).toBe(base);
    await capture('2-mentions-badge');
  });
});
