// Where the v1 status bar's controls went (V2-4.8b), as scenario helpers.
//
//   Changes chip (`open-changes`)   → Menu › Version history  → `git-panel` is its root
//   hub sync chip (`open-sync`)     → Menu › Diagnostics › Sync (the Sync panel, whole)
//   chip text (`.st-sb-sync`)       → the Share cluster word `share-cluster-status`
//   theme toggle (`.st-sb-theme`)   → Settings › General › Look › Theme
//
// A scenario that needs one of them goes through these, so the path lives in one place.

import { $, browser } from '@wdio/globals';

const tid = (s: string) => `[data-testid="${s}"]`;

/** The one menu: project pill → (a submenu, by its slug) → the row for an action id. */
export async function pressMenuRow(actionId: string, submenu?: string): Promise<void> {
  await (await $(tid('project-pill'))).click();
  if (submenu) {
    const sub = await $(tid(`project-menu-row-sub-${submenu}`));
    await sub.waitForDisplayed({ timeout: 10_000 });
    await sub.click();
  }
  const row = await $(tid(`project-menu-row-${actionId}`));
  await row.waitForDisplayed({ timeout: 10_000 });
  await row.click();
}

/** Is Version history (S1.14: `vh-panel`, the dock's `changes` slot) showing? */
export async function historyShowing(): Promise<boolean> {
  return (
    (await $(tid('vh-panel'))
      .isDisplayed()
      .catch(() => false)) === true
  );
}

/** Menu › Version history, unless the panel is already up. Waits for the panel itself (`vh-panel`). */
export async function openVersionHistory(): Promise<void> {
  if (await historyShowing()) return;
  await pressMenuRow('history.open');
  await (await $(tid('vh-panel'))).waitForDisplayed({ timeout: 30_000 });
}

/**
 * Menu › Version history › Advanced: today's source-control body (`git-panel`) lives in the panel's Advanced
 * fold until S1.15 / S11 re-home it, so a scenario that drives it opens the fold too (a fold the Mac
 * remembers open is left open).
 */
export async function openHistory(): Promise<void> {
  await openVersionHistory();
  if (
    await $(tid('git-panel'))
      .isDisplayed()
      .catch(() => false)
  )
    return;
  const toggle = await $(tid('fold-history-toggle'));
  await toggle.waitForDisplayed({ timeout: 10_000 });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await (await $(tid('git-panel'))).waitForDisplayed({ timeout: 30_000 });
}

/** Menu › Version history again closes it (the action toggles). */
export async function closeHistory(): Promise<void> {
  if (await historyShowing()) await pressMenuRow('history.open');
}

/** Menu › Diagnostics › Sync: today's Sync panel, inside the Diagnostics sheet. */
export async function openSyncDetails(): Promise<void> {
  if (
    await $(tid('diag-sync'))
      .isDisplayed()
      .catch(() => false)
  )
    return;
  await pressMenuRow('diag.sync', 'diagnostics');
  await (await $(tid('diag-sync'))).waitForDisplayed({ timeout: 20_000 });
}

/**
 * What the sync chip used to say: the Share cluster's word, its short label ("3 to review",
 * "1 refused", "12/40", "offline · 2 ↑") and the tooltip sentence. null when the cluster is absent.
 */
export async function syncStatusText(): Promise<string | null> {
  return (await browser.execute(() => {
    const el = document.querySelector('[data-testid="share-cluster-status"]');
    if (!el) return null;
    return [el.textContent, el.getAttribute('data-sync-label'), el.getAttribute('title')]
      .filter(Boolean)
      .join(' · ');
  })) as string | null;
}

/** Settings › General › Look › Theme: flip light ↔ dark (the old status-bar toggle). */
export async function toggleTheme(): Promise<void> {
  const current = await browser.execute(() => document.documentElement.getAttribute('data-theme'));
  const next = current === 'dark' ? 'light' : 'dark';
  if (!(await $(tid('settings-sheet')).isExisting())) await pressMenuRow('settings.open');
  await (await $(tid('settings-sheet'))).waitForDisplayed({ timeout: 10_000 });
  await browser.execute((value: string) => {
    (
      document.querySelector(
        `[data-testid="settings-theme"] input[value="${value}"]`
      ) as HTMLInputElement | null
    )?.click();
  }, next);
  await (await $(tid('settings-close'))).click();
}
