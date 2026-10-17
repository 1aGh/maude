import { $, browser, expect } from '@wdio/globals';
import { openAssistant } from '../helpers/assistant';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';

/**
 * DDR-166 Phase 0 / T0f — the ZERO-TERMINAL ACP COLD START. Proves a person who
 * has never touched a terminal can go from "no `claude` installed" to "AI
 * editing connected" purely by clicking buttons in the app:
 *   1. Open the Assistant panel → not-connected → claude reads "missing" with
 *      an "Install Claude Code" / "Set up AI editing" action.
 *   2. Click it → the guided install runs (stubbed, see wdio config) → flips
 *      straight into sign-in.
 *   3. Sign-in completes (stubbed) → the panel reconnects IN PLACE, no restart
 *      → the real chat composer renders.
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

  it('1 · opens to a not-connected Assistant panel with an install action', async () => {
    await waitForSidecar();
    expect(await isNativeShell()).toBe(true);

    // V2-4.8a: the menubar's Assistant toggle is the AI chat's own island (its header, or the spark
    // corner icon when it is folded) — reach "open" from either start.
    await openAssistant();

    const notConnected = await $(tid('acp-not-connected'));
    await notConnected.waitForDisplayed({ timeout: 30_000 });
    await capture('01-not-connected-claude-missing');

    const claudeRow = await $(tid('rdy-row-claude'));
    await claudeRow.waitForDisplayed({ timeout: 10_000 });
    expect(await claudeRow.getAttribute('class')).toContain('rdy-row--missing');

    const installBtn = await $(tid('acp-setup-install'));
    await installBtn.waitForDisplayed({ timeout: 10_000 });
  });

  it('2 · clicking install runs the guided installer, then chains into sign-in', async () => {
    await (await $(tid('acp-setup-install'))).click();
    // The stubbed installer takes ~1.2s before writing the fake binary — the
    // "Installing…" text is a real (if brief) intermediate render.
    try {
      await browser.waitUntil(
        async () =>
          (await $('.rdy-fix-tx'))
            .getText()
            .then((t) => t.includes('Installing'))
            .catch(() => false),
        { timeout: 4_000, interval: 200 }
      );
      await capture('02-installing');
    } catch {
      /* best-effort — a fast poll tick can miss this transient state */
    }
    // One click covers both steps (login-state.ts's pollForInstall → runSignin
    // chain) — once the fake install verifies fresh, sign-in starts on its own
    // with no second click. The fake install (~1.2s) + fake sign-in (~1s) +
    // poll ticks are fast enough that the whole chain can finish inside this
    // step's own wait window — so "the waiting-for-signin state was visible"
    // is NOT asserted as a hard requirement (step 3 is the real, unambiguous
    // proof the chain reached connected); this only checks it never landed on
    // an error state, whichever intermediate state it's caught in.
    await browser.waitUntil(
      async () => {
        const errorTx = await $('.rdy-fix-tx--err');
        if (await errorTx.isDisplayed().catch(() => false)) {
          throw new Error(
            `install/sign-in reported an error: ${await errorTx.getText().catch(() => '?')}`
          );
        }
        const cancel = await $('.rdy-copy');
        const notConnected = await $(tid('acp-not-connected'));
        const stillWaiting = await cancel.isDisplayed().catch(() => false);
        const alreadyConnected = !(await notConnected.isDisplayed().catch(() => false));
        return stillWaiting || alreadyConnected;
      },
      { timeout: 15_000, timeoutMsg: 'never reached the waiting-for-signin state nor connected' }
    );
    await capture('03-waiting-for-signin-or-already-connected');
  });

  it('3 · the panel reconnects in place — no restart — and the composer renders', async () => {
    // The fake claude script's `auth login` sleeps 1s then marks itself signed
    // in; the next 2s poll tick picks it up, resolveClaudePath's verified-
    // override takes precedence over the force-missing stub, and
    // probeAcpAvailabilityAuthed flips available:true.
    const notConnected = await $(tid('acp-not-connected'));
    await browser.waitUntil(async () => !(await notConnected.isDisplayed().catch(() => false)), {
      timeout: 30_000,
      timeoutMsg: 'still showing the not-connected panel after sign-in should have completed',
    });
    await capture('04-not-connected-panel-gone');

    const composer = await $(tid('chat-composer'));
    await composer.waitForDisplayed({ timeout: 15_000 });
    await capture('05-chat-composer-connected');
  });
});
