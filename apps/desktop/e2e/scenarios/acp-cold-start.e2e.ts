import { $, browser, expect } from '@wdio/globals';
import { aiConnected, openAssistant } from '../helpers/assistant';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';

/**
 * DDR-166 Phase 0 / T0f — the ZERO-TERMINAL ACP COLD START. Proves a person who
 * has never touched a terminal can go from "no `claude` installed" to "AI
 * editing connected" purely by clicking buttons in the app:
 *   1. Open the Assistant panel → it looks the same as always (CONTRACT §7, gate-b-polish2): the composer,
 *      no setup list, though claude is "missing".
 *   2. Send a prompt → it is kept and the one Connect sheet asks.
 *   3. Connect → the guided install runs (stubbed, see wdio config) → flips straight into sign-in →
 *      sign-in completes (stubbed) → the panel connects IN PLACE, no restart.
 *
 * Only runs under wdio.acp-cold-start.conf.ts, which sets the three debug-only
 * stub envs (force-missing + fake install + a disposable install path — never
 * touches a real `~/.local/bin/claude`). Under any other config it self-skips.
 */
const tid = (s: string) => `[data-testid="${s}"]`;
const COLD_START = process.env.MAUDE_E2E_FAKE_CLAUDE_INSTALL === '1';

describe('acp-cold-start (native-desktop)', () => {
  before(async function () {
    if (!COLD_START) this.skip(); // wrong config — not applicable
    startReport(
      'acp-cold-start (native-desktop) — guided install → sign-in → connected, zero terminal'
    );
    await browser.setTimeout({ script: 60_000 });
  });

  it('1 · the Assistant panel looks the same as always: the composer, no setup list', async () => {
    await waitForSidecar();
    expect(await isNativeShell()).toBe(true);
    // V2-4.8a: the menubar's Assistant toggle is the AI chat's own island (its header, or the spark
    // corner icon when it is folded) — reach "open" from either start.
    await openAssistant();
    // gate-b-polish2 (CONTRACT §7): no v1 "AI editing isn't ready yet" body — Ask AI looks the same
    const composer = await $(tid('chat-composer'));
    await composer.waitForDisplayed({ timeout: 30_000 });
    expect(await aiConnected()).toBe(false);
    expect(await $(tid('acp-not-connected')).isExisting()).toBe(false);
    await capture('01-composer-claude-missing');
  });

  it('2 · the first send is kept and the one Connect sheet asks', async () => {
    const input = await (await $(tid('chat-composer'))).$('.chat-input');
    await input.click();
    await input.addValue('Say hello.');
    await (await $('[aria-label="Send message"]')).click();
    const sheet = await $(tid('ai-connect-sheet'));
    await sheet.waitForDisplayed({ timeout: 15_000 });
    await capture('02-connect-sheet');
  });

  it('3 · Connect runs the guided install, then sign-in, and the panel connects in place', async () => {
    await (await $(tid('ai-connect-go'))).click();
    // One click covers both steps (connect-flow.js: install when missing → browser sign-in → wait). The
    // stubbed install (~1.2 s) + sign-in (~1 s) are fast, so the intermediate phases are best-effort only.
    await browser.waitUntil(
      async () => {
        const err = await $(tid('ai-connect-error'));
        if (await err.isDisplayed().catch(() => false)) {
          throw new Error(`connect reported an error: ${await err.getText().catch(() => '?')}`);
        }
        return aiConnected();
      },
      { timeout: 60_000, interval: 1_000, timeoutMsg: 'never connected after Connect' }
    );
    await capture('03-connected');
    const composer = await $(tid('chat-composer'));
    await composer.waitForDisplayed({ timeout: 15_000 });
    await capture('05-chat-composer-connected');
  });
});
