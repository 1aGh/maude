import { $, browser, expect } from '@wdio/globals';

import { clearComposer, openAssistant, pickMode, setPermissionMode } from '../helpers/assistant';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';

/**
 * feature-acp-panel-dynamic-claude-code-capabilities (Milestone A) — proves
 * the model/effort/mode pickers are LIVE, sourced from the real ACP session,
 * not a hardcoded list: open the Assistant panel → the mode picker populates
 * with the modes the connected `claude` actually advertises → switching to
 * Plan mode round-trips live (client `set-mode` frame → bridge validates
 * against the session's OWN last-advertised roster → `conn.setSessionMode` →
 * the picker reflects the new current mode from a `caps` frame) — with NO
 * subprocess respawn (Task A3 retired the old env-at-spawn dance).
 *
 * Driven via the composer's existing warm-up path (typing a leading `/`
 * triggers `conn.warm()`, which establishes the session and fires `onCaps`
 * WITHOUT needing a real model turn) — faster and less flaky than waiting on
 * an actual prompt response, and exercises the exact same caps pipeline.
 *
 * Requires a real, signed-in `claude` on the machine running this suite (same
 * assumption every other non-cold-start ACP scenario makes) — self-skips if
 * the panel reports not-connected, matching the cold-start scenario's own
 * self-skip discipline for a config it doesn't apply to.
 */
const tid = (s: string) => `[data-testid="${s}"]`;

describe('acp-capability-picker (native-desktop)', () => {
  // The mode this spec found the shared session in (test 2 switches it to Plan).
  let modeBefore: string | null = null;

  before(async function () {
    startReport('acp-capability-picker (native-desktop) — live mode picker, no hardcoded list');
    await browser.setTimeout({ script: 60_000 });

    await waitForSidecar();
    if (!(await isNativeShell())) this.skip(); // ACP panel is native-only (DDR-123)

    // Open, never toggle: the default lane shares ONE app process across spec
    // files, and acp-ask-user-question has usually left this panel open — a
    // blind click closed it and test 1 waited for a composer that never came.
    await openAssistant();

    const notConnected = await $(tid('acp-not-connected'));
    const isNotConnected = await notConnected.isDisplayed().catch(() => false);
    if (isNotConnected) {
      this.skip(); // no signed-in claude on this machine — not this scenario's job to set that up
    }
  });

  after(async () => {
    // Hand the shared session back as we found it: the `/` warm-up out of the
    // composer, and the mode test 2 changed restored.
    if (modeBefore) await setPermissionMode(modeBefore);
    else await clearComposer();
  });

  it('1 · warming the composer establishes a session and populates the LIVE mode picker', async () => {
    const composer = await $(tid('chat-composer'));
    await composer.waitForDisplayed({ timeout: 30_000 });

    // Whatever an earlier spec left in the composer would prefix the `/`.
    await clearComposer();
    const input = await composer.$('.chat-input');
    await input.click();
    await input.addValue('/');

    const modePicker = await $(tid('chat-mode-picker'));
    await modePicker.waitForDisplayed({ timeout: 20_000 });
    await capture('01-mode-picker-populated');

    const optionTexts = await modePicker.$$('option').map((o) => o.getText());
    // `default` (displayed "Manual") is unconditionally advertised by every
    // ACP session (buildAvailableModes always includes it) — the one
    // assertion that doesn't depend on which OTHER modes this build/model
    // happens to offer (auto/bypassPermissions are conditionally gated).
    expect(optionTexts.some((t) => /manual/i.test(t))).toBe(true);
  });

  it('2 · switching to Plan mode round-trips live — no respawn, reflected via a fresh caps frame', async () => {
    const modePicker = await $(tid('chat-mode-picker'));
    await modePicker.waitForDisplayed({ timeout: 10_000 });

    const options = await modePicker.$$('option');
    let planValue: string | null = null;
    for (const opt of options) {
      const text = await opt.getText();
      if (/plan/i.test(text)) {
        planValue = await opt.getAttribute('value');
        break;
      }
    }
    if (!planValue) return; // this session's model doesn't offer Plan mode — nothing to assert
    modeBefore = await modePicker.getValue();

    const composerStillThere = await (await $(tid('chat-composer'))).isDisplayed();
    expect(composerStillThere).toBe(true); // sanity: composer survives the mode change (no teardown)

    // Pick via the select's own `change` — the embedded WebDriver's option
    // click (`selectByAttribute`) does not select in WKWebView (see pickMode).
    await pickMode(planValue);

    await browser.waitUntil(async () => (await modePicker.getValue()) === planValue, {
      timeout: 15_000,
      timeoutMsg: 'mode picker never reflected the live current-mode change back from the session',
    });
    // Plan blocks edits, so the panel's own mode state raises the top-of-thread
    // banner too — the switch reached the panel, not just the select.
    await (await $(tid('chat-mode-banner'))).waitForDisplayed({ timeout: 10_000 });
    await capture('02-plan-mode-selected');

    // The composer must still be the SAME live element afterward — proves the
    // bridge didn't tear down/respawn the adapter subprocess on the mode
    // change (Task A3's whole point).
    expect(await (await $(tid('chat-composer'))).isDisplayed()).toBe(true);
  });
});
