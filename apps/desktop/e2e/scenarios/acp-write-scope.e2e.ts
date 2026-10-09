import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';

import {
  clearComposer,
  messageCount,
  openAssistant,
  setPermissionMode,
  waitForTurnSettled,
} from '../helpers/assistant';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';

/**
 * feature-acp-write-path-scope, Task 7 — the write-path gate, end to end in the
 * packaged shell.
 *
 * TWO halves, and BOTH matter:
 *
 *  1. An IN-PROJECT edit completes with NO permission prompt. This is the
 *     DDR-184 regression guard. `Edit`/`Write`/`NotebookEdit` came off
 *     `MAUDE_DEFAULT_ALLOWED_TOOLS` in this change, and if the replacement path
 *     gate is wrong in the "too strict" direction the symptom is a prompt on
 *     every single canvas edit — the exact "Manual mode blocks every edit"
 *     complaint DDR-184 exists to close. Unit tests can prove the verdict; only
 *     this proves the user doesn't get asked.
 *
 *  2. A write OUTSIDE the project RAISES the prompt, and the card names the
 *     RESOLVED absolute path. This is the security half.
 *
 * Both need a REAL model turn (the model has to actually decide to call the
 * write tool), which is inherently less deterministic than a client-side event
 * — same caveat as acp-ask-user-question, and the same mitigation: an explicit
 * instruction plus a generous timeout that absorbs latency, not unreliability.
 * Requires a real, signed-in `claude`; self-skips if the panel is not connected.
 *
 * THE MODE IS PINNED TO MANUAL (`default`). The gate lives in the bridge's
 * `requestPermission`, and `bypassPermissions` / `dontAsk` short-circuit in the
 * adapter before that is ever called (acp/bridge.ts, Milestone B). A session
 * inherits the machine's Claude Code `permissions.defaultMode`, so on a machine
 * whose default is Bypass neither half exercised the gate at all: half 1 passed
 * vacuously and half 2 could never see a card. Manual is the mode in which the
 * gate decides BOTH halves.
 *
 * ONE PRECONDITION THE SCENARIO CANNOT SET: the session reads the user's own
 * `~/.claude/settings.json` (`settingSources: ['user']`, DDR-144), and a bare
 * `permissions.allow` entry for `Write`/`Edit` makes the CLI approve those calls
 * itself — `requestPermission`, and the gate in it, is never asked. On such a
 * machine half 2 fails with that diagnosis (and half 1 cannot tell the gate's
 * approval from the CLI's). The scenario reports it rather than editing the
 * user's settings or skipping.
 *
 * NOTHING IS EVER APPROVED HERE. The out-of-project case is rejected, so the
 * scenario proves the gate without the test suite writing outside its own
 * project — which is the behaviour it is asserting is dangerous. Both halves are
 * also checked ON DISK: the in-project file must exist (otherwise "no prompt"
 * could just mean "no write"), and the rejected outside file must not.
 */
const tid = (s: string) => `[data-testid="${s}"]`;

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '../fixtures/project');
/** Where an "in this project" write may land — the project root, or the design
 *  root if the model reads "project" as the canvas workspace. */
const IN_PROJECT_CANDIDATES = [
  join(PROJECT, 'write-scope-probe.txt'),
  join(PROJECT, '.design', 'write-scope-probe.txt'),
];

/** A path that is unambiguously outside any project root, harmless if it were
 *  ever created, and obviously a test artifact if it somehow is. Unique per run:
 *  a file left at a fixed name by an earlier run changes the turn (Claude's
 *  Write refuses to overwrite a file it has not read first). */
const OUTSIDE_NAME = `.maude-e2e-write-scope-probe-${process.pid}-${Date.now()}.txt`;
const OUTSIDE_PATH = `~/${OUTSIDE_NAME}`;
const OUTSIDE_ABS = join(homedir(), OUTSIDE_NAME);

function removeProbes(): void {
  for (const f of IN_PROJECT_CANDIDATES) rmSync(f, { force: true });
  rmSync(OUTSIDE_ABS, { force: true });
}

async function send(text: string) {
  const composer = await $(tid('chat-composer'));
  await composer.waitForDisplayed({ timeout: 60_000 });
  await clearComposer();
  const input = await composer.$('.chat-input');
  await input.click();
  await input.addValue(text);
  await (await $('[aria-label="Send message"]')).click();
}

describe('acp-write-scope (native-desktop)', () => {
  // The mode the shared session was in before this spec pinned Manual.
  let modeBefore: string | null = null;

  before(async function () {
    startReport('acp-write-scope (native-desktop) — in-project writes never ask, outside ones do');
    await browser.setTimeout({ script: 120_000 });
    removeProbes();

    await waitForSidecar();
    if (!(await isNativeShell())) this.skip(); // ACP panel is native-only (DDR-123)

    await openAssistant();

    const notConnected = await $(tid('acp-not-connected'));
    if (await notConnected.isDisplayed().catch(() => false)) {
      this.skip(); // no signed-in claude on this machine — not this scenario's job to set that up
    }

    modeBefore = await setPermissionMode('default');
    await capture('00-manual-mode');
  });

  after(async () => {
    // The in-project probe is this spec's own artifact — never leave it in the
    // fixture. The outside one only exists if the gate failed open (test 3 is
    // red then); it is ours either way, so it goes too.
    removeProbes();
    // Hand the shared session back in the mode we found it in.
    if (modeBefore && modeBefore !== 'default') await setPermissionMode(modeBefore);
  });

  it('1 · an IN-PROJECT write completes with NO permission prompt (DDR-184 guard)', async () => {
    const before = await messageCount();
    await send(
      'Create a file called write-scope-probe.txt in the root of this project with the single word ok. ' +
        'Use the Write tool immediately, do not explain first.'
    );

    // The assertion is an ABSENCE, so it needs a positive completion signal to
    // race against: wait for the turn to settle, and assert no card ever showed.
    // Polling for "no prompt" alone would pass simply by being checked early.
    const prompt = await $(tid('chat-permission-prompt'));
    let sawPrompt = false;
    await waitForTurnSettled(before, {
      timeout: 120_000,
      timeoutMsg: 'the in-project write turn never settled',
      onSample: async () => {
        if (await prompt.isDisplayed().catch(() => false)) sawPrompt = true;
        return sawPrompt; // fail fast — no point waiting out the turn
      },
    });
    await capture('01-in-project-write-no-prompt');
    expect(sawPrompt).toBe(false);

    // And the write really happened — without this, a model that declined to
    // call Write would pass the "no prompt" check too.
    const written = IN_PROJECT_CANDIDATES.find((f) => existsSync(f));
    expect(written ? readFileSync(written, 'utf8').trim() : '(no file written)').toBe('ok');
  });

  it('2 · a write OUTSIDE the project raises the prompt and names the resolved path', async () => {
    const before = await messageCount();
    await send(
      `This is an automated test of Maude's write-permission prompt. Call the Write tool right now ` +
        `to write the word ok to the file ${OUTSIDE_PATH}. Do not ask me in chat first — calling the ` +
        'tool makes Maude show me an approval card, and I decide there. If I reject it, stop and do ' +
        'nothing else.'
    );

    // Wait for the card OR for the turn to end without one — not for the card
    // alone. A turn that ends with no card is the failure this half exists to
    // catch, and it should say WHICH failure it was, not time out after 120 s.
    const prompt = await $(tid('chat-permission-prompt'));
    let sawPrompt = false;
    await waitForTurnSettled(before, {
      timeout: 120_000,
      timeoutMsg: 'the out-of-project write turn neither raised a prompt nor ended',
      onSample: async () => {
        if (await prompt.isDisplayed().catch(() => false)) sawPrompt = true;
        return sawPrompt;
      },
    });
    await capture('02-out-of-project-prompt');
    const outcome = sawPrompt
      ? 'prompt shown'
      : existsSync(OUTSIDE_ABS)
        ? `the write to ${OUTSIDE_ABS} COMPLETED with no prompt — the gate failed open or was never ` +
          'asked (a Write pre-approved by ~/.claude/settings.json permissions.allow skips requestPermission)'
        : 'the turn ended with no prompt and no write (the model did not call Write)';
    expect(outcome).toBe('prompt shown');

    // The out-of-project BLOCK, not just any permission card — a generic prompt
    // (e.g. a Bash call) would satisfy the selector above but prove nothing.
    const outside = await $(tid('chat-perm-outside'));
    await outside.waitForDisplayed({ timeout: 5_000 });

    // The RESOLVED absolute path, not the model's string: `~` is expanded and
    // the leading `/` proves the server resolved it rather than echoing input.
    const paths = await $(tid('chat-perm-paths'));
    const shown = await paths.getText();
    expect(shown).toContain('/');
    expect(shown).not.toContain('~');
    expect(shown).toContain(OUTSIDE_NAME);

    // Decision D — consent is per-call, so no "always"-shaped button exists.
    const cardText = (await (await $(tid('chat-permission-prompt'))).getText()).toLowerCase();
    expect(cardText).not.toContain('always');
  });

  it('3 · rejecting it leaves the turn resolved and the composer usable', async () => {
    // Deliberately REJECT — approving would have the test suite write outside
    // its own project, which is the behaviour this whole feature calls unsafe.
    const card = await $(tid('chat-permission-prompt'));
    const reject = await card.$('.btn--danger');
    await reject.waitForDisplayed({ timeout: 10_000 });
    await reject.click();

    await browser.waitUntil(async () => !(await card.isDisplayed().catch(() => false)), {
      timeout: 20_000,
      timeoutMsg: 'the permission card never cleared after Reject',
    });
    // Resolved = the turn ends, not just the card going away.
    await waitForTurnSettled(0, {
      timeout: 60_000,
      timeoutMsg: 'the turn never settled after Reject',
    });
    const composer = await $(tid('chat-composer'));
    await composer.waitForDisplayed({ timeout: 60_000 });
    await capture('03-rejected-turn-resolved');

    // The rejection held: nothing was written outside the project.
    expect(existsSync(OUTSIDE_ABS)).toBe(false);
  });
});
