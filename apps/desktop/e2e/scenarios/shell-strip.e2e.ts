import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $, $$, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import {
  focusTab,
  labels,
  menuState,
  openTab,
  pinCurrentWindow,
  strip,
  waitWindow,
} from '../helpers/windows';

/**
 * 11 Projects and Navigation — the tab strip, as contract V2-3.7 builds it (decision `v2-3.7-own-tab-bar`: ONE
 * native window, our own strip; the Mac's native tabs the boards A/`pn-tab-a` draw are not what ships).
 *
 *   pn-tab-a      Home first and icon-only ("Home"), then a square + the name per project, the active one marked
 *   pn-tab-menu   the right-click menu's rows are the registry's (cargo: tab_menu_rows_use_the_registry_labels);
 *                 the NATIVE popup is not reachable from WebDriver, so its rows are clicked by id through the same
 *                 `on_menu` path (e2e_menu_state `click: tabmenu:<row>:<label>`): Rename… edits the name in place
 *                 and keeps it, Close tab closes the tab
 *   pn-windows    one window, open once: opening an open project again brings its tab forward and says so
 *                 ("<name> is open in this window."); there is no second window to drag out or merge back
 *   pn-tab-a20    twenty tabs: the row keeps a square + short name per tab, "N more" holds the rest, the active tab
 *                 stays in the row, and the list opens and picks
 */
const PRIMARY = process.env.MAUDE_PROJECT_ROOT as string;
const SECONDARY = process.env.MAUDE_E2E_SECONDARY_ROOT as string;
const tid = (s: string) => `[data-testid="${s}"]`;

function makeProject(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `maude-e2e-${name}-`));
  mkdirSync(join(dir, '.design', 'ui'), { recursive: true });
  mkdirSync(join(dir, '.design', 'system'), { recursive: true });
  writeFileSync(
    join(dir, '.design', 'config.json'),
    JSON.stringify({ name, designRoot: '.design', designSystems: [] }, null, 2)
  );
  return dir;
}

type StripTab = {
  label: string;
  name: string;
  selected: boolean;
  square: boolean;
  closeable: boolean;
  resting: boolean;
};
/** What the strip draws, read in the strip's own webview. */
async function drawn(): Promise<{
  tabs: StripTab[];
  home: { aria: string | null; text: string; selected: boolean };
  more: { hidden: boolean; text: string };
}> {
  const back = await browser.getWindowHandle().catch(() => null);
  await browser.switchToWindow('strip');
  const out = await browser.execute(() => {
    const tabs = Array.from(document.querySelectorAll('#tabs [role="tab"][data-label]')).map((el) => ({
      label: el.getAttribute('data-label') ?? '',
      name: (el.querySelector('.name')?.textContent ?? '').trim(),
      selected: el.getAttribute('aria-selected') === 'true',
      square: !!el.querySelector('[data-testid="tab-square"]'),
      closeable: !!el.querySelector('.close'),
      resting: !!el.querySelector('[data-testid="tab-rest"]'),
    }));
    const home = document.querySelector('[data-testid="tab-home"]');
    const more = document.getElementById('more') as HTMLElement | null;
    return {
      tabs,
      home: {
        aria: home?.getAttribute('aria-label') ?? null,
        text: (home?.textContent ?? '').trim(),
        selected: home?.getAttribute('aria-selected') === 'true',
      },
      more: { hidden: !more || more.hidden, text: (more?.textContent ?? '').trim() },
    };
  });
  if (back && back !== 'strip') await browser.switchToWindow(back).catch(() => undefined);
  return out as Awaited<ReturnType<typeof drawn>>;
}

describe('shell-strip (11 pn-tab-a, pn-tab-menu, pn-windows, pn-tab-a20)', () => {
  let tabA = '';
  let tabB = '';

  before(async () => {
    startReport('shell-strip');
    await browser.setTimeout({ script: 60_000 });
    await waitForSidecar();
    tabA = await pinCurrentWindow();
    const opened = await openTab(SECONDARY);
    tabB = opened.label;
    await waitWindow(tabB);
    await focusTab(tabB);
    await waitForSidecar();
  });

  it('pn-tab-a: Home first and icon-only, a square and a name per project, the active one marked', async () => {
    const s = await strip();
    expect(s.order).toEqual(['home', tabA, tabB]);
    const d = await drawn();
    expect(d.home.aria).toBe('Home');
    expect(d.home.text).toBe(''); // icon-only
    expect(d.tabs.map((t) => t.label)).toEqual([tabA, tabB]);
    for (const t of d.tabs) {
      expect(t.name).not.toBe('');
      expect(t.square).toBe(true);
    }
    expect(d.tabs.filter((t) => t.selected).map((t) => t.label)).toEqual([tabB]);
    expect(d.home.selected).toBe(false);
    expect(d.more.hidden).toBe(true); // two tabs fit: no "N more"
    await capture('pn-tab-a strip');
  });

  it('pn-windows: opening an open project again brings its tab forward and says so — one window, nothing to merge', async () => {
    const before = await labels();
    await focusTab(tabA);
    const again = await openTab(SECONDARY);
    expect(again).toEqual({ label: tabB, opened: 'existing' });
    expect(await labels()).toEqual(before); // no third window
    const name = (await drawn()).tabs.find((t) => t.label === tabB)?.name ?? '';
    expect(name).not.toBe('');
    await focusTab(tabB);
    // 11 pn-windows frame 4: "<name> is open in this window." (shell://opened-existing → client/shell-events.js)
    await browser.waitUntil(
      async () =>
        browser.execute(
          (want: string) =>
            Array.from(document.querySelectorAll('[data-testid^="notice-"]')).some((el) =>
              (el.textContent ?? '').includes(want)
            ),
          `${name} is open in this window.`
        ),
      { timeout: 8_000, interval: 150, timeoutMsg: `no "${name} is open in this window." notice` }
    );
    await capture('pn-windows open once');
    // the strip is the ONLY tab bar: one shell window, so there is nothing for a drag-out or a Merge All Windows
    expect(await browser.getWindowHandles()).toHaveLength(4); // home, strip, A, B
  });

  it('pn-tab-menu: Rename… edits the name in place and keeps it; Close tab closes the tab', async () => {
    await menuState(`tabmenu:rename:${tabB}`);
    await browser.switchToWindow('strip');
    const input = await $(tid('tab-rename-input'));
    await input.waitForExist({ timeout: 8_000, timeoutMsg: 'Rename… drew no in-place edit field' });
    await input.setValue('Renamed by e2e');
    await browser.keys('Enter');
    await browser.waitUntil(
      async () => (await drawn()).tabs.find((t) => t.label === tabB)?.name === 'Renamed by e2e',
      { timeout: 8_000, interval: 150, timeoutMsg: 'the tab did not take the new name' }
    );
    await capture('pn-tab-menu renamed');
    await browser.switchToWindow(tabA);
    await menuState(`tabmenu:close:${tabB}`);
    await waitWindow(tabB, false);
    expect((await drawn()).tabs.map((t) => t.label)).toEqual([tabA]);
  });

  it('pn-tab-a20: twenty tabs — a square and a short name each, "N more" holds the rest, the active tab stays in the row', async () => {
    // open the rest from Home: a project tab we hold may rest (cap 2) and then is not showing its project
    await browser.switchToWindow('home');
    const roots = Array.from({ length: 19 }, (_, i) => makeProject(`proj${String(i + 1).padStart(2, '0')}`));
    let last = '';
    for (const root of roots) {
      const o = await openTab(root);
      expect(o.opened).toBe('new');
      last = o.label;
    }
    await waitWindow(last);
    await focusTab(last);
    // twenty project tabs = twenty webviews besides `home` and `strip` (the row draws only what fits)
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 22, {
      timeout: 60_000,
      interval: 500,
      timeoutMsg: 'the shell never held twenty project tabs',
    });
    const d = await browser.waitUntil(
      async () => {
        const x = await drawn();
        return x.more.hidden ? false : x;
      },
      { timeout: 15_000, interval: 250, timeoutMsg: '"N more" never showed at twenty tabs' }
    );
    const row = (d as Awaited<ReturnType<typeof drawn>>).tabs;
    const hidden = Number(/^(\d+) more$/.exec((d as Awaited<ReturnType<typeof drawn>>).more.text)?.[1] ?? Number.NaN);
    expect(row.length + hidden).toBe(20);
    expect(hidden).toBeGreaterThan(0);
    for (const t of row) {
      expect(t.square).toBe(true);
      expect(t.name).not.toBe('');
    }
    expect(row.some((t) => t.label === last && t.selected)).toBe(true); // the active tab is in the row
    await capture('pn-tab-a20 row');
    // "N more" lists exactly the rest, and picking one opens it
    await browser.switchToWindow('strip');
    await $('#more').click();
    await browser.waitUntil(async () => (await $$('[data-testid^="tab-overview-row-"]')).length === hidden, {
      timeout: 8_000,
      interval: 150,
      timeoutMsg: `the "${hidden} more" list is not ${hidden} rows`,
    });
    await capture('pn-tab-a20 more list');
    const pick = await $$('[data-testid^="tab-overview-row-"]')[0];
    const pickLabel = (await pick.getAttribute('data-testid')).replace('tab-overview-row-', '');
    // a row takes the person on mousedown (strip.js `rowEl`); the driver's click is a bare `click`, so send the press
    await browser.execute((label: string) => {
      document
        .querySelector(`[data-testid="tab-overview-row-${label}"]`)
        ?.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    }, pickLabel);
    await browser.waitUntil(async () => (await strip()).active === pickLabel, {
      timeout: 15_000,
      interval: 250,
      timeoutMsg: 'picking a row of the list did not open that tab',
    });
  });
});
