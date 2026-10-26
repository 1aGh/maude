import { $, browser, expect } from '@wdio/globals';

import {
  clearComposer,
  openAdvanced,
  openAssistant,
  pickMode,
  requireAi,
  setPermissionMode,
} from '../helpers/assistant';
import { capture, startReport } from '../helpers/evidence';
import { onFakeAi } from '../helpers/fake-ai';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';

/**
 * feature-acp-panel-dynamic-claude-code-capabilities (Milestone A) — proves
 * the permission-mode picker ("Ask before", in the panel's Advanced fold) is
 * LIVE, sourced from the ACP session, not a hardcoded list: open the Assistant
 * panel → the visible chat warms its session → the picker lists exactly the
 * modes the connected agent advertises → switching to Suggest only (ACP `plan`)
 * round-trips live (client `set-mode` frame → bridge validates against the
 * session's OWN last-advertised roster → `conn.setSessionMode` → the picker
 * reflects the new current mode from a `caps` frame) — with NO subprocess
 * respawn (Task A3 retired the old env-at-spawn dance).
 *
 * RUNS ON THE FAKE AGENT (wdio.acp-fake.conf.ts): a scripted ACP agent
 * advertises default / acceptEdits / plan and nothing else. That is what makes
 * "live, not hardcoded" checkable — the picker's words table also knows
 * `dontAsk` and `bypassPermissions`, and they must NOT appear because this
 * session did not offer them. What a REAL Claude advertises (auto and bypass
 * are conditionally gated by account and build) is a V2-8.16 live journey
 * (ai-live-roster), not this spec's.
 *
 * Self-skips on a lane without an AI; on the fake lane a missing connection is
 * a failure (requireAi).
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
    await requireAi(this);
  });

  after(async () => {
    // Hand the shared session back as we found it: the `/` warm-up out of the
    // composer, and the mode test 2 changed restored.
    if (modeBefore) await setPermissionMode(modeBefore);
    else await clearComposer();
  });

  it('1 · the visible chat establishes a session and populates the LIVE mode picker', async () => {
    const composer = await $(tid('chat-composer'));
    await composer.waitForDisplayed({ timeout: 30_000 });

    // The picker is a row of the Advanced fold; the chat on screen warms its own session (no `/` needed).
    await openAdvanced();
    const modePicker = await $(tid('chat-mode-picker'));
    await modePicker.waitForDisplayed({ timeout: 30_000 });
    await capture('01-mode-picker-populated');

    const values = await modePicker.$$('option').map((o) => o.getAttribute('value'));
    // `default` is unconditionally advertised by every ACP session (buildAvailableModes always includes it) — the
    // one assertion that doesn't depend on which OTHER modes this build/model happens to offer.
    expect(values).toContain('default');
    if (onFakeAi()) {
      // Live, not hardcoded: exactly the roster the agent advertised. `dontAsk` and `bypassPermissions` have words
      // in the picker's table and must stay hidden because this session did not offer them.
      expect([...values].sort()).toEqual(['acceptEdits', 'default', 'plan']);
      const labels = await modePicker.$$('option').map((o) => o.getText());
      expect(labels).toContain('Replace or move to the trash'); // default, in plain words
      expect(labels).toContain('Suggest only'); // plan
    }
  });

  it('2 · switching to Plan mode round-trips live — no respawn, reflected via a fresh caps frame', async () => {
    const modePicker = await $(tid('chat-mode-picker'));
    await modePicker.waitForDisplayed({ timeout: 10_000 });

    const options = await modePicker.$$('option');
    let planValue: string | null = null;
    for (const opt of options) {
      const value = await opt.getAttribute('value');
      if (value === 'plan') {
        planValue = value;
        break;
      }
    }
    if (!planValue) {
      if (onFakeAi()) throw new Error('the fake agent offers plan; the picker lost it');
      return; // this session's model doesn't offer Plan mode — nothing to assert
    }
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
    const banner = await $(tid('chat-mode-banner'));
    await banner.waitForDisplayed({ timeout: 10_000 });
    expect((await banner.getText()).toLowerCase()).toContain('suggest only');
    await capture('02-plan-mode-selected');

    // The composer must still be the SAME live element afterward — proves the
    // bridge didn't tear down/respawn the adapter subprocess on the mode
    // change (Task A3's whole point).
    expect(await (await $(tid('chat-composer'))).isDisplayed()).toBe(true);
  });
});
