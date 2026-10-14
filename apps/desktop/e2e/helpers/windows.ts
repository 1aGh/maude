import { browser } from '@wdio/globals';

import { invokeTauri } from './native';

/**
 * Tab helpers — V2-3.2, contract V2-1.1 §5.2; V2-3.7 own tab bar (contract
 * `apps/studio/client/v2/contracts/V2-3.7-own-tab-bar.md` §7). There is ONE
 * native window, `shell`; every tab is a CHILD WEBVIEW of it, labelled `home`
 * (pinned, always there) or `p-<pid>`, plus the tab strip `strip`. The embedded
 * provider (vendored `tauri-plugin-wdio-webdriver`, retargeted to webviews) uses
 * those webview labels AS the W3C window handles, so `switchToWindow(label)` is
 * the whole switching API.
 *
 * Rules:
 *  - A background tab is a hidden child webview: `document.hidden`, 0 rAF/s.
 *    Select it (`focusTab`) before any animation-, motion- or layout-gated
 *    check, or the run is a false red — the same failure class as a locked
 *    screen.
 *  - Close a tab only through `closeTab` (`e2e_close_window` → the shell's one
 *    close path). WebDriver's DELETE /window would close the webview behind
 *    the shell's back (no grace, no reap, no strip update).
 *  - After any close, `switchToWindow` before the next command: the session's
 *    current handle may be dangling.
 */

type TauriService = { tauri?: { switchWindow(label: string): Promise<void> } };

/** The pinned Home tab and the strip: handles that are never project tabs. */
export const HOME = 'home';
export const STRIP = 'strip';

/** Every webview handle (= label), sorted: `home`, `strip` and the tabs. */
export async function handles(): Promise<string[]> {
  return (await browser.getWindowHandles()).sort();
}

/** The project (and cell) tab handles, sorted — `home` and `strip` left out. */
export async function labels(): Promise<string[]> {
  return (await handles()).filter((l) => l !== HOME && l !== STRIP);
}

/** The label of the tab the shell shows: the one webview whose document is
 *  visible (every other tab is a hidden child webview). `null` while none is. */
export async function activeTab(): Promise<string | null> {
  const before = await browser.getWindowHandle().catch(() => null);
  let found: string | null = null;
  for (const h of await handles()) {
    if (h === STRIP) continue;
    try {
      await browser.switchToWindow(h);
      if (await browser.execute(() => !document.hidden)) {
        found = h;
        break;
      }
    } catch {
      // closed meanwhile
    }
  }
  if (before && before !== found) await browser.switchToWindow(before).catch(() => {});
  return found;
}

/**
 * Pin @wdio/tauri-service to the ACTIVE tab and return its label. The session
 * starts on whichever webview the provider lists first (a hash map: `strip`,
 * `home` or the boot project), so this waits for the visible tab — the boot
 * project's `p-<pid>` when MAUDE_PROJECT_ROOT names one, else `home`. The
 * explicit switch is also what stops the service's per-command auto-focus probe
 * (it waits 5 s for a bridge this app does not ship) — see `beforeSuite` in
 * wdio.conf.ts.
 */
export async function pinCurrentWindow(): Promise<string> {
  let label: string | null = null;
  await browser.waitUntil(async () => (label = await activeTab()) !== null, {
    timeout: 30_000,
    interval: 200,
    timeoutMsg: 'no visible tab after 30 s',
  });
  await browser.switchToWindow(label!);
  await (browser as unknown as TauriService).tauri?.switchWindow(label!);
  return label!;
}

/** What the strip draws: its tabs' labels in strip order (`tab-home` is not
 *  one), the active label, and Home's accessible name + text. */
export async function strip(): Promise<{
  tabs: string[];
  active: string | null;
  home: { label: string | null; text: string };
  dots: Record<string, string>;
}> {
  const back = await browser.getWindowHandle().catch(() => null);
  await browser.switchToWindow(STRIP);
  const s = await browser.execute(() => {
    // A tab is `[data-testid="tab-<label>"][data-label]` (its × is `tab-close-<label>`).
    const tabs = Array.from(document.querySelectorAll('#tabs [role="tab"][data-label]')).map(
      (el) => el.getAttribute('data-label') || ''
    );
    const dots: Record<string, string> = {};
    document.querySelectorAll('#tabs [data-label]').forEach((el) => {
      const d = el.querySelector('[data-testid="tab-dot"]');
      if (d) dots[el.getAttribute('data-label') || ''] = d.getAttribute('data-dot') || '';
    });
    const home = document.querySelector('[data-testid="tab-home"]');
    return {
      tabs,
      active: document.body.getAttribute('data-active'),
      home: {
        label: home?.getAttribute('aria-label') ?? null,
        text: (home?.textContent || '').trim(),
      },
      dots,
    };
  });
  if (back && back !== STRIP) await browser.switchToWindow(back).catch(() => {});
  return s;
}

/** What `e2e_menu_state` answers: the active tab and AppKit's enablement of the role items
 *  (menu.rs `ROLE_ITEMS`: new_canvas, new_project, open_project_folder, show_home, close_tab,
 *  next_tab, prev_tab). */
export interface MenuState {
  active: string | null;
  enabled: Record<string, boolean | null>;
}

/** Read the native menu's state — after clicking the menu item `click` (its id, e.g.
 *  `select_tab_1`, `close_tab`, `show_home`) through the same handler AppKit's click runs.
 *  WebDriver keys never reach the menu bar, so this is how a scenario presses ⌘W / ⌃⌘1. */
export async function menuState(click?: string): Promise<MenuState> {
  return invokeTauri<MenuState>('e2e_menu_state', click ? { click } : {});
}

/** Wait until `label` is (or, with `present: false`, is no longer) a window. */
export async function waitWindow(label: string, present = true, timeout = 10_000): Promise<void> {
  await browser.waitUntil(
    async () => (await browser.getWindowHandles()).includes(label) === present,
    { timeout, interval: 50, timeoutMsg: `window ${label} present=${present} after ${timeout} ms` }
  );
}

/** Select a tab AND drive it: switch the session, bring the tab to the front, and
 *  wait until its document is visible (rAF running again). */
export async function focusTab(label: string): Promise<void> {
  await browser.switchToWindow(label);
  await invokeTauri('e2e_focus_window', { label });
  await browser.waitUntil(async () => browser.execute(() => !document.hidden), {
    timeout: 5_000,
    interval: 50,
    timeoutMsg: `tab ${label} stayed hidden after e2e_focus_window`,
  });
}

/** Open a project folder from the current window: a new tab after it, or the
 *  existing one focused (open once). Returns what the shell answered. Since
 *  V2-3.3 `open_project({root})` is Home-only (contract V2-1.1 §5.8 item 3), so
 *  a project window goes through the debug-only `e2e_open_root`, which runs the
 *  same open path (registry upsert, open once, tab after the caller). */
export async function openTab(
  root: string
): Promise<{ label: string; opened: 'new' | 'existing' }> {
  return invokeTauri('e2e_open_root', { root });
}

/** `new_home_tab()` from the current window (⌘T): activate the pinned Home tab
 *  (V2-3.7: Home always exists). */
export async function newHomeTab(): Promise<void> {
  await invokeTauri('new_home_tab', {});
}

/**
 * Close a tab, then continue in `next`. Always the shell's one close path
 * (`e2e_close_window` → `tabs::close_tab`): `userPath: true` goes through the
 * "Stop AI in …?" guard first (the strip's ×); `false` skips it.
 */
export async function closeTab(label: string, next: string, userPath = true): Promise<void> {
  await browser.switchToWindow(next);
  await invokeTauri('e2e_close_window', { label, destroy: !userPath });
  await waitWindow(label, false);
  await focusTab(next);
}
