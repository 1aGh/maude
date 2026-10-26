import { $, browser } from '@wdio/globals';

import { onFakeAi } from './fake-ai';

/**
 * The Assistant (ACP chat) panel, driven the way the ACP scenarios need it.
 *
 * WHY THESE ARE HELPERS AND NOT INLINE CLICKS. The default lane runs every
 * spec file against ONE app process — @wdio/tauri-service's embedded provider
 * spawns the app in `onPrepare` and only restarts it if it crashed. So the shell
 * a spec meets is whatever the previous spec left: the panel open, a `/` still in
 * the composer, a session already switched to Plan mode. Each helper below
 * reaches a known state from ANY starting state instead of assuming a fresh boot
 * (a blind `assistant-toggle` click CLOSED the panel acp-ask-user-question had
 * opened, and acp-capability-picker then waited 30 s for a composer that was
 * never coming).
 */

const tid = (s: string) => `[data-testid="${s}"]`;

/** Open the Assistant panel if it is closed — never toggles an open one shut.
 *  V2-4.8a: the panel's own open state is its island — `ai-chat-header` is on screen while it shows, and
 *  the spark corner icon `panel-icon-assistant` stands in its place while it is folded (⌘\ hides every
 *  panel, which also shows the icon). The menubar's `assistant-toggle` is gone. */
export async function openAssistant(): Promise<void> {
  const header = await $(tid('ai-chat-header'));
  const shown = async () => header.isDisplayed().catch(() => false);
  if (!(await shown())) {
    const icon = await $(tid('panel-icon-assistant'));
    await icon.waitForDisplayed({ timeout: 30_000 });
    await icon.click();
  }
  await browser.waitUntil(shown, {
    timeout: 10_000,
    timeoutMsg: 'the Assistant panel never opened',
  });
}

/** Open the panel's "Advanced" fold if it is closed — never toggles an open one shut. The "Ask before" picker
 *  (`chat-mode-picker`), Model, Effort and the rest live inside it (V2-4.8 S5.12): a closed fold has no body in the
 *  DOM at all, so a spec that reads the picker without this finds nothing. The fold is remembered per Mac. */
export async function openAdvanced(): Promise<void> {
  const body = await $(tid('fold-ai.chat-body'));
  if (await body.isDisplayed().catch(() => false)) return;
  const toggle = await $(tid('ai-advanced'));
  await toggle.waitForDisplayed({ timeout: 30_000 });
  await toggle.click();
  await body.waitForDisplayed({ timeout: 10_000 });
}

/** The lane's AI gate. On the fake-AI lanes a missing connection is a FAILURE (the stub was meant to supply it);
 *  on any other lane it is a quiet skip, as before. Call from a `before` with `this`. */
export async function requireAi(ctx: { skip(): void }): Promise<void> {
  if (await aiConnected()) return;
  if (onFakeAi()) {
    throw new Error(
      'the fake AI lane is not connected: /_api/acp/status says unavailable — check MAUDE_CLAUDE_BIN / MAUDE_ACP_ADAPTER_ENTRY in the lane conf'
    );
  }
  ctx.skip();
}

/** Is a signed-in Claude connected? gate-b-polish2 (CONTRACT §7): the panel looks the same either way (the
 *  v1 `acp-not-connected` body is gone), so ask the bridge itself — the probe the panel runs. */
export async function aiConnected(): Promise<boolean> {
  const available = await browser.execute(async () => {
    try {
      const r = await fetch('/_api/acp/status');
      return (await r.json())?.available === true;
    } catch {
      return false;
    }
  });
  return available === true;
}

/** Empty the composer textarea the way React sees it (native value setter +
 *  `input`), so leftover text from an earlier spec cannot prefix the next
 *  message — a stray `/` would turn a prompt into a slash command. */
export async function clearComposer(): Promise<void> {
  await browser.execute(() => {
    const ta = document.querySelector(
      '[data-testid="chat-composer"] .chat-input'
    ) as HTMLTextAreaElement | null;
    if (!ta) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    setter?.set?.call(ta, '');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const input = await $(tid('chat-composer')).$('.chat-input');
  await browser.waitUntil(async () => (await input.getValue()) === '', {
    timeout: 5_000,
    timeoutMsg: 'the composer would not clear',
  });
}

/**
 * Choose `value` in the permission-mode picker the way the UI receives a pick:
 * set the `<select>`'s value and fire `change`.
 *
 * NOT `selectByAttribute`: the embedded WebDriver (tauri-plugin-wdio-webdriver
 * in WKWebView) clicks the `<option>` element, which does not select it — the
 * picker stayed on `bypassPermissions` with no error (measured). export-formats
 * drives the Export dialog's scope `<select>` the same way, for the same reason.
 *
 * The picker is React-controlled (`value = modes.currentModeId`): after the
 * `change`, React puts the DOM back to the session's current mode until a
 * `caps` frame reports the new one. So the value only STAYS changed once the
 * session itself has switched — reading it back is the round-trip check.
 */
export async function pickMode(value: string): Promise<void> {
  await openAdvanced();
  await browser.execute((v: string) => {
    const sel = document.querySelector(
      '[data-testid="chat-mode-picker"]'
    ) as HTMLSelectElement | null;
    if (!sel) throw new Error('no chat-mode-picker');
    sel.value = v;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

/**
 * Switch the live session to permission mode `id` (an ACP mode id, e.g.
 * `default` = "Manual") and wait for the session to report it back.
 *
 * Opens the Advanced fold (the picker lives in it) and waits for the session's roster — the visible chat warms its
 * session on its own, no `/` needed. Returns the mode the session was in before, so a spec can hand the shared
 * session back unchanged.
 */
export async function setPermissionMode(id: string): Promise<string> {
  const composer = await $(tid('chat-composer'));
  await composer.waitForDisplayed({ timeout: 60_000 });
  // The panel warms its session when it is on screen, and the picker sits in the Advanced fold.
  await openAdvanced();
  const picker = await $(tid('chat-mode-picker'));
  await picker.waitForDisplayed({ timeout: 30_000 });
  const previous = await picker.getValue();
  if (previous !== id) await pickMode(id);
  await browser.waitUntil(async () => (await picker.getValue()) === id, {
    timeout: 15_000,
    timeoutMsg: `the session never reported permission mode "${id}"`,
  });
  await clearComposer();
  return previous;
}

/** One sample of the panel's turn state, from hooks the product already has:
 *  the header's running-chats count (and the folded icon's dot), the composer's Stop button (rendered only while the
 *  thread is running) and the per-message action rows (one per message, user
 *  AND assistant). */
async function turnState() {
  return browser.execute(() => ({
    busy:
      !!document.querySelector('[data-testid="ai-chat-count"]') ||
      !!document.querySelector('[data-testid="panel-icon-assistant"] .sh-corner-dot'),
    stop: !!document.querySelector('[data-testid="chat-composer"] [aria-label="Stop"]'),
    messages: document.querySelectorAll('[data-testid="chat-msg-actions"]').length,
  }));
}

/** How many messages the thread shows now — pass it to `waitForTurnSettled`. */
export async function messageCount(): Promise<number> {
  return (await turnState()).messages;
}

/**
 * Wait until the turn started after `messagesBefore` has STARTED and then
 * SETTLED, calling `onSample` on every poll (so a caller can watch for a card
 * that must never appear).
 *
 * Started = the thread ran (busy pulse or Stop button seen) or the reply
 * message exists (`messagesBefore + 2`: the sent message plus the reply).
 * Settled = started, and neither the busy pulse nor the Stop button is up.
 *
 * Replaces polling `chat-msg-actions` for visibility: that row is emitted on
 * the USER message too (it exists the moment you hit Send) and is hover-revealed
 * (`opacity: 0`), so `isDisplayed()` never reports it — the turn "never settled"
 * however long it was given.
 */
export async function waitForTurnSettled(
  messagesBefore: number,
  opts: { timeout?: number; timeoutMsg?: string; onSample?: () => Promise<boolean> } = {}
): Promise<void> {
  let started = false;
  await browser.waitUntil(
    async () => {
      if (opts.onSample && (await opts.onSample())) return true;
      const s = await turnState();
      if (s.busy || s.stop || s.messages >= messagesBefore + 2) started = true;
      return started && !s.busy && !s.stop;
    },
    {
      timeout: opts.timeout ?? 120_000,
      interval: 500,
      timeoutMsg: opts.timeoutMsg ?? 'the assistant turn never settled',
    }
  );
}
