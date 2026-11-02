import { $ } from '@wdio/globals';

const tid = (s: string) => `[data-testid="${s}"]`;

/**
 * Open the project switcher. P8 C4 (lead call v2-p8-lead-canvases-header-and-switcher): the dock at the foot
 * of the Canvases panel is gone and the project pill IS the switcher — `repo-switcher-trigger` is the pill's
 * wrapper, and the recents / Open a team project… / Open another folder… are its "Switch project" submenu
 * (`repo-switcher-popup`). Returns the submenu once it shows.
 */
export async function openSwitcher(): Promise<WebdriverIO.Element> {
  const trigger = await $(tid('repo-switcher-trigger'));
  await trigger.waitForDisplayed({ timeout: 30_000 });
  await (await $(tid('project-pill'))).click();
  await (await $(tid('project-menu-row-sub-switch-project'))).click();
  const popup = await $(tid('repo-switcher-popup'));
  await popup.waitForDisplayed({ timeout: 10_000 });
  return popup;
}
