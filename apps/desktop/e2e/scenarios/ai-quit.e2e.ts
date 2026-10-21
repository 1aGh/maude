import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';

import { aiConnected, clearComposer, openAssistant, setPermissionMode } from '../helpers/assistant';
import { capture, startReport } from '../helpers/evidence';
import { invokeTauri, isNativeShell } from '../helpers/native';
import { appPid, isAlive, startApp, waitGone } from '../helpers/session';
import { readServerInfo, waitForSidecar } from '../helpers/sidecar';
import { focusTab, menuState, waitWindow } from '../helpers/windows';

/**
 * S5.14 — quitting while AI works, and Needs you out of sight (03 `ai-quit`, `ai-needs-tab`,
 * `ai-needs-away`; V2-1.15 §5.8–§5.9, R10). DOM-driven, two projects (wdio.ai-quit.conf.ts):
 *
 *   1. ai-needs-away: a chat in A waits on a permission while B is in front → A's tab shows the
 *      azure "?", the Dock counts 1 and stays at 1 when A comes to the front, 0 once answered.
 *      The OS notification's words ("AI needs you on <canvas>" + "<project>", never the
 *      question) are pinned by `cargo test notify::` — a notification is not DOM-reachable.
 *   2. R10: 2 chats running + 1 ask waiting → ⌘Q asks once, "2 chats"; Cancel keeps them.
 *   3. Quit → the app is gone ≤ 5 s after the click with its sidecar; every run is stopped
 *      `quit`, no lease left; the running two published their partial work.
 *   4. Relaunch → the chat ends "Stopped when the app quit · …" + Keep going, which asks again.
 *   5. A second ⌘Q while the dialog is open quits.
 *
 * Needs a real, signed-in `claude` (the ACP scenarios' assumption) — self-skips when the panel
 * says it is not connected — and an unlocked screen with the test window on top (memory
 * `maude-webkit-locked-screen-invalid`). Run: `pnpm test:e2e:desktop -- --spec ai-quit` with
 * wdio.ai-quit.conf.ts.
 */
const A = process.env.MAUDE_PROJECT_ROOT as string;
const B = process.env.MAUDE_E2E_SECONDARY_ROOT as string;
const tid = (s: string) => `[data-testid="${s}"]`;

// Staged edits, one per step, so a stop mid-run has partial work to publish (V2-1.5 `stopped`).
const EDITING =
  'Open the canvas file under .design and change one visible heading text 40 times in a row: ' +
  "'Step 1', then 'Step 2', and so on up to 'Step 40' — one separate edit per step, no other changes.";
const SLOW = 'Write every whole number from 1 to 4000, comma separated, in one reply. No tools.';
const NEEDS = 'Run the shell command `date` with the Bash tool right now, then tell me the output.';

interface Runs {
  live: number;
  needsYou: number;
  mine: Array<{ runId: string; chatId: string | null; state: string; outcome?: string }>;
}

async function runs(): Promise<Runs> {
  return browser.execute(async () => {
    const r = await fetch('/_api/ai/runs', { cache: 'no-store' });
    return (await r.json()) as Runs;
  });
}

async function send(text: string): Promise<void> {
  const composer = await $(tid('chat-composer'));
  await composer.waitForDisplayed({ timeout: 30_000 });
  await clearComposer();
  const input = await composer.$('.chat-input');
  await input.click();
  await input.addValue(text);
  await (await $('[aria-label="Send message"]')).click();
}

async function quitKey(): Promise<void> {
  // ⌘Q = the native Maude ▸ Quit item (quit.rs MENU_QUIT); the debug menu click runs on_menu.
  await menuState('quit').catch(() => {});
}

/** `<root>/.design/_state/runs/*.json` — this Mac's run records (never synced). */
function records(root: string): Array<Record<string, unknown>> {
  const dir = join(root, '.design', '_state', 'runs');
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>);
  } catch {
    return [];
  }
}

async function until<T>(what: string, ms: number, fn: () => Promise<T | false | null | undefined>) {
  let got: T | false | null | undefined;
  await browser.waitUntil(
    async () => {
      got = await fn();
      return Boolean(got);
    },
    { timeout: ms, interval: 500, timeoutMsg: what }
  );
  return got as T;
}

describe('ai-quit (native-desktop)', () => {
  let labelA = '';

  before(async function () {
    startReport('ai-quit (native-desktop) — quit while AI works, Needs you out of sight');
    await browser.setTimeout({ script: 90_000 });
    await waitForSidecar();
    if (!(await isNativeShell())) this.skip();
    await openAssistant();
    if (!(await aiConnected())) this.skip();
    labelA = (await browser.getWindowHandle()) as string;
  });

  it('1 · ai-needs-away: a waiting chat in a background tab shows "?" and the Dock counts it', async () => {
    await setPermissionMode('default');
    await send(NEEDS);
    await until(
      'the chat never asked for permission',
      90_000,
      async () => (await runs()).needsYou > 0
    );
    await (await $(tid('chat-permission-prompt'))).waitForDisplayed({ timeout: 10_000 });

    const b = await invokeTauri<{ label: string }>('open_project', { root: B });
    await waitWindow(b.label);
    await focusTab(b.label);
    // One poll tick (6 s) later: A's tab mark is the azure "?", and the Dock counts 1.
    await browser.switchToWindow('strip');
    const mark = await $(`${tid(`tab-${labelA}`)} ${tid('tab-dot')}`);
    await mark.waitForExist({ timeout: 20_000 });
    expect(await mark.getAttribute('data-dot')).toBe('needs-you');
    expect(await mark.getText()).toBe('?');
    expect(await invokeTauri<number>('e2e_dock_badge')).toBe(1);
    await capture('01-needs-you-background-tab');

    // Looking at it does not clear the count — answering does.
    await focusTab(labelA);
    await browser.pause(7_000);
    expect(await invokeTauri<number>('e2e_dock_badge')).toBe(1);
    const card = await $(tid('chat-permission-prompt'));
    await card.click();
    await browser.keys('Escape'); // reject
    await until('the Dock badge never cleared', 20_000, async () => {
      await browser.switchToWindow(labelA);
      return (await invokeTauri<number>('e2e_dock_badge')) === 0;
    });
  });

  it('2 · R10: 2 chats running + 1 ask waiting → ⌘Q asks once, naming 2 chats; Cancel keeps them', async () => {
    await browser.switchToWindow(labelA);
    await setPermissionMode('acceptEdits');
    await send(EDITING);
    await (await $(tid('ai-chat-new'))).click();
    await send(SLOW);
    await send(SLOW); // the same chat is busy: this ask waits behind its own run
    const live = await until('two chats never ran with one ask waiting', 120_000, async () => {
      const r = await runs();
      const working = r.mine.filter((m) => m.state === 'running' || m.state === 'starting');
      const waiting = r.mine.filter((m) => m.state === 'waiting');
      return working.length >= 2 && waiting.length >= 1 ? r : null;
    });
    expect(live.live).toBeGreaterThanOrEqual(3);

    await quitKey();
    const dialog = await $(tid('ai-quit-dialog'));
    await dialog.waitForDisplayed({ timeout: 10_000 });
    expect(await dialog.getText()).toContain('Quit while AI is working?');
    expect(await dialog.getText()).toContain('2 chats stop where they are');
    await capture('02-quit-dialog');

    await browser.pause(800); // a person's pace: a too-fast Cancel makes the next ask native
    await (await $(tid('ai-quit-cancel'))).click();
    await dialog.waitForDisplayed({ reverse: true, timeout: 5_000 });
    expect((await runs()).live).toBeGreaterThanOrEqual(3);
  });

  it('3 · Quit: gone ≤ 5 s with its sidecar, every run stopped by quit, no lease, partial work kept', async () => {
    const appBefore = appPid();
    const server = readServerInfo(A);
    const before = new Set(
      (await runs()).mine.filter((m) => m.state !== 'ended').map((m) => m.runId)
    );

    await quitKey();
    const dialog = await $(tid('ai-quit-dialog'));
    await dialog.waitForDisplayed({ timeout: 10_000 });
    await browser.pause(800);
    await (await $(tid('ai-quit-confirm'))).click();

    const took = await waitGone(appBefore, 10_000);
    expect(took).toBeLessThanOrEqual(6_000); // the 5 s stop-all budget + the exit itself
    expect(isAlive(server.pid)).toBe(false);

    const stopped = records(A).filter((r) => before.has(r.runId as string));
    expect(stopped.length).toBe(before.size);
    for (const r of stopped) {
      expect(r.state).toBe('ended');
      expect(r.outcome).toBe('stopped');
      expect(r.stoppedBy).toBe('quit');
      expect((r.leases as unknown[] | undefined) ?? []).toEqual([]);
    }
    // The two that had started published their partial work (V2-1.5 `stopped`, S5.5).
    const started = stopped.filter((r) => typeof r.startedAt === 'number');
    expect(started.length).toBe(2);
  });

  it('4 · relaunch: the chat ends "Stopped when the app quit · …" with Keep going', async () => {
    await startApp();
    await waitForSidecar();
    await openAssistant();
    const divider = await $(tid('ai-stopped-divider'));
    await divider.waitForDisplayed({ timeout: 30_000 });
    expect(await divider.getText()).toMatch(
      /Stopped when the app quit · \d{1,2} \w{3}, \d{2}:\d{2}/
    );
    await capture('04-stopped-divider');

    const stoppedRun = await divider.getAttribute('data-run');
    await (await $(tid('ai-keep-going'))).click();
    const resumed = await until('Keep going asked nothing', 30_000, async () =>
      (await runs()).mine.find(
        (m) => (m as { resumeOf?: string }).resumeOf === stoppedRun && m.state !== 'ended'
      )
    );
    expect(resumed).toBeTruthy();
    await divider.waitForDisplayed({ reverse: true, timeout: 10_000 });
  });

  it('5 · a second ⌘Q while the dialog is open quits', async () => {
    await until('the resumed run never went live', 60_000, async () => (await runs()).live > 0);
    const appBefore = appPid();
    await quitKey();
    await (await $(tid('ai-quit-dialog'))).waitForDisplayed({ timeout: 10_000 });
    await quitKey();
    const took = await waitGone(appBefore, 10_000);
    expect(took).toBeLessThanOrEqual(6_000);
    expect(records(A).every((r) => r.state === 'ended')).toBe(true);
  });
});
