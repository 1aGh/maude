import { $, browser, expect } from '@wdio/globals';

import { currentBranch } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { invokeTauri } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';

/**
 * DDR-133 — switch repos through the desktop app's project picker, driven via the
 * native `open_local_project` Tauri command (DOM-driven). Isolated from the main
 * git-lifecycle scenario because the command RESPAWNS the dev-server sidecar on the
 * new --root and re-navigates the WKWebView — under the embedded WebDriver that's
 * flaky (the execute/async response is interrupted; occasionally the switch doesn't
 * take), so this scenario RETRIES the switch rather than chaining it inline.
 *
 * primary  = the github-backed clone (boots on `main`).
 * secondary = the offline make-git-fixture repo (current branch feat/nav-redesign).
 */
const PRIMARY = process.env.MAUDE_PROJECT_ROOT as string;
const SECONDARY = process.env.MAUDE_E2E_SECONDARY_ROOT as string;
const tid = (s: string) => `[data-testid="${s}"]`;

/** The branch HEAD is on — Version history › Advanced › Branch (S11.10); the dock names the project only. */
async function triggerText(): Promise<string> {
  const t = await $(tid('repo-switcher-trigger'));
  await t.waitForDisplayed({ timeout: 120_000 });
  return currentBranch();
}
const triggerHas = (s: string) => async () => {
  try {
    return (await triggerText()).includes(s);
  } catch {
    return false; // element stale mid-reload / re-navigation — keep polling
  }
};
async function switchTo(path: string, expectBranch: string, pick = false): Promise<void> {
  // V2-3.6 M3: a project page may only switch to a registered project or the
  // folder its last picker returned — "Open another folder…" is pick, then
  // open. The conf points MAUDE_E2E_PICK_DIR at the secondary repo.
  if (pick) expect(await invokeTauri('pick_directory')).toBe(path);
  // The respawn interrupts the execute/async response, so the invoke may reject even
  // though the switch succeeds — swallow it, then reconnect to the re-navigated webview.
  await invokeTauri('open_local_project', { path }).catch(() => undefined);
  await browser.pause(8_000);
  await waitForSidecar();
  await browser.waitUntil(triggerHas(expectBranch), {
    timeout: 90_000,
    timeoutMsg: `switch to ${path} (expecting "${expectBranch}") never took`,
  });
}

describe('git-switch-repos (native-desktop)', function () {
  // open_local_project sidecar-respawn under WebDriver is flaky — retry the switch.
  this.retries(2);
  before(async () => {
    startReport('git-switch-repos (native-desktop)');
    await browser.setTimeout({ script: 60_000 });
  });

  it('switches between two local repos via open_local_project', async () => {
    await waitForSidecar();
    await browser.waitUntil(triggerHas('main'), { timeout: 120_000 });
    await capture('1-on-primary-repo-main');

    // V2-3.6 M3: a folder that is neither registered nor picked is refused.
    const refused = await invokeTauri('open_local_project', { path: '/tmp' }).then(
      () => 'opened',
      (e: unknown) => String(e)
    );
    expect(refused).toContain('Open another folder');

    await switchTo(SECONDARY, 'feat/nav-redesign', true);
    expect(await triggerText()).toContain('feat/nav-redesign');
    await capture('2-switched-to-secondary-repo');

    await switchTo(PRIMARY, 'main');
    expect(await triggerText()).toContain('main');
    await capture('3-switched-back-to-primary-repo');
  });
});
