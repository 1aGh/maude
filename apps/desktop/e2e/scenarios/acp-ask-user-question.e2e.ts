import { $, $$, browser, expect } from '@wdio/globals';

import { clearComposer, openAssistant } from '../helpers/assistant';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';

/**
 * feature-acp-ask-user-question — proves the `AskUserQuestion` tool works
 * end-to-end through the ACP chat panel, DOM-driven (native-only, DDR-123):
 * a scripted prompt that asks Claude to call the tool → the elicitation form
 * card renders with real options (proving `elicitation:{form:{}}` reached the
 * adapter and the tool wasn't stripped — see DDR-180) → picking an option and
 * clicking Submit resolves the turn.
 *
 * Unlike acp-capability-picker's warm-up trick (typing `/` deterministically
 * fires `caps` with no model call), THIS scenario needs a real model turn —
 * the model has to actually decide to call the tool, which is inherently less
 * deterministic than a client-side-only event. The prompt is written to make
 * that as close to certain as a model instruction can get; a generous timeout
 * absorbs normal latency, not model unreliability. Requires a real, signed-in
 * `claude` on the machine running this suite (same assumption every other
 * non-cold-start ACP scenario makes) — self-skips if the panel reports
 * not-connected.
 */
const tid = (s: string) => `[data-testid="${s}"]`;

describe('acp-ask-user-question (native-desktop)', () => {
  before(async function () {
    startReport('acp-ask-user-question (native-desktop) — AskUserQuestion elicitation form');
    await browser.setTimeout({ script: 90_000 });

    await waitForSidecar();
    if (!(await isNativeShell())) this.skip(); // ACP panel is native-only (DDR-123)

    // Open, never toggle — the default lane shares one app process across
    // spec files, so the panel may already be open (see helpers/assistant.ts).
    await openAssistant();

    const notConnected = await $(tid('acp-not-connected'));
    const isNotConnected = await notConnected.isDisplayed().catch(() => false);
    if (isNotConnected) {
      this.skip(); // no signed-in claude on this machine — not this scenario's job to set that up
    }
  });

  it('1 · a scripted prompt asking Claude to use AskUserQuestion renders the elicitation form card', async () => {
    const composer = await $(tid('chat-composer'));
    await composer.waitForDisplayed({ timeout: 30_000 });

    await clearComposer();
    const input = await composer.$('.chat-input');
    await input.click();
    await input.addValue(
      'Use the AskUserQuestion tool right now to ask me exactly one question: ' +
        '"Which color do you like?" with options Red and Blue. ' +
        'Do not do anything else first — call the tool immediately.'
    );
    await (await $('[aria-label="Send message"]')).click();

    const prompt = await $(tid('chat-elicit-prompt'));
    await prompt.waitForDisplayed({ timeout: 60_000 });
    await capture('01-elicitation-form-rendered');

    // At least one real option rendered (proves the schema round-tripped
    // through parseElicitationSchema, not just an empty/broken card).
    const options = await $$('[data-testid^="chat-elicit-option-"]');
    expect(options.length).toBeGreaterThan(0);
  });

  it('2 · picking an option and Submit resolves the turn', async () => {
    const firstOption = await $('[data-testid^="chat-elicit-option-"] input');
    await firstOption.waitForDisplayed({ timeout: 10_000 });
    await firstOption.click();

    const submit = await $(tid('chat-elicit-submit'));
    await submit.waitForEnabled({ timeout: 5_000 });
    await submit.click();
    await capture('02-submitted');

    // The card must disappear once the response is sent — mutually exclusive
    // with the same thread-level slot ErrorCard/PermissionPrompt occupy.
    const prompt = await $(tid('chat-elicit-prompt'));
    await browser.waitUntil(async () => !(await prompt.isDisplayed().catch(() => false)), {
      timeout: 15_000,
      timeoutMsg: 'the elicitation card never cleared after Submit',
    });

    // The composer must still be usable — the turn resolved, not hung.
    const composer = await $(tid('chat-composer'));
    await composer.waitForDisplayed({ timeout: 60_000 });
    await capture('03-turn-resolved');
  });
});
