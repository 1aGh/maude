import { browser } from '@wdio/globals';

import { invokeTauri } from './native';

/**
 * Multi-window (tab) helpers — V2-3.2, contract V2-1.1 §5.2. Every window is
 * Rust-created and labelled `p-<pid>` (no `main`), and the embedded provider
 * (`tauri-plugin-wdio-webdriver`) uses those labels AS the W3C window handles,
 * so `switchToWindow(label)` is the whole switching API (e2e spike note
 * `apps/studio/client/v2/contracts/V2-3.2-e2e-multiwindow.md`).
 *
 * Two rules from the spike:
 *  - A background tab is `document.hidden` and gets 0 rAF/s. Select it
 *    (`focusTab`) before any animation-, motion- or layout-gated check, or the
 *    run is a false red — the same failure class as a locked screen.
 *  - After any close, `switchToWindow` before the next command: the session's
 *    current window may be dangling.
 */

type TauriService = { tauri?: { switchWindow(label: string): Promise<void> } };

/** Every window handle (= label), sorted. */
export async function labels(): Promise<string[]> {
  return (await browser.getWindowHandles()).sort();
}

/**
 * Pin @wdio/tauri-service to the session's CURRENT window. The session starts on
 * the first window that exists (no `windowLabel` capability is sent), which is
 * the boot project's `p-<pid>`. The explicit switch is also what stops the
 * service's per-command auto-focus probe (it waits 5 s for a bridge this app
 * does not ship) — see `beforeSuite` in wdio.conf.ts. Returns the label.
 */
export async function pinCurrentWindow(): Promise<string> {
  const label = await browser.getWindowHandle();
  await (browser as unknown as TauriService).tauri?.switchWindow(label);
  return label;
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

/** `open_project({root})` from the current window: a new tab after it, or the
 *  existing one focused (open once). Returns what the shell answered. */
export async function openTab(
  root: string
): Promise<{ label: string; opened: 'new' | 'existing' }> {
  return invokeTauri('open_project', { root });
}

/**
 * Close a tab, then continue in `next`. `userPath: true` goes through the user
 * close path (⌘W / the tab's ×: `CloseRequested` → close guard → `Destroyed`);
 * `false` is WebDriver's DELETE /window (= `destroy()`, no `CloseRequested`).
 * Both reach the shell's per-window `Destroyed` bookkeeping.
 */
export async function closeTab(label: string, next: string, userPath = true): Promise<void> {
  if (userPath) {
    await browser.switchToWindow(next);
    await invokeTauri('e2e_close_window', { label, destroy: false });
  } else {
    await browser.switchToWindow(label);
    await browser.closeWindow();
  }
  await waitWindow(label, false);
  await focusTab(next);
}
