import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';

import { closeSettings, openSettings } from '../helpers/accounts';
import {
  clearComposer,
  messageCount,
  openAssistant,
  requireAi,
  waitForTurnSettled,
} from '../helpers/assistant';
import { capture, startReport } from '../helpers/evidence';
import { agentDropDir, installFakeOpencode, OTHER_AGENT_BINS } from '../helpers/fake-agents';
import { isNativeShell } from '../helpers/native';
import { relaunchApp } from '../helpers/session';
import { waitForSidecar } from '../helpers/sidecar';
import { pinCurrentWindow } from '../helpers/windows';

/**
 * Universal ACP — the agents UI in the packaged shell (.ai/scenarios/universal-acp-agents-desktop/spec.md;
 * feature-universal-acp-and-codex, Design Decisions (UI) 1–6). Lane: wdio.agents.conf.ts.
 *
 *   1  World A (Claude only): no offer, no picker; Settings › Connections › AI agents says "No other AI agents on this Mac"
 *   2  World B (a fake opencode dropped on PATH + Look again): the empty chat offers it in one line; Not now → gone,
 *      and still gone after a reload and after a relaunch
 *   3  a fresh agents record: the offer again → Connect → Settings › AI agents → Connect (the REAL conformance probe
 *      runs against the fake) → Connected; the offer line is gone
 *   4  Claude + opencode connected: the composer's agent picker; a NEW chat on opencode answers with the vendor badge;
 *      the chat's picker is read-only after the first message
 *   5  opencode asks for a write outside the project: the card offers once-only answers (no "always"); Reject → the
 *      card closes, nothing is written
 *   6  opencode fails the turn: the notice reads "opencode reported: …"
 *
 * DOM-driven by data-testid. The agent list is also read from `/_api/agents` (the route every surface reads) to tell
 * "not loaded yet" from "not offered" — an absence asserted before the list arrived would prove nothing.
 */
const tid = (s: string) => `[data-testid="${s}"]`;
const LABEL = 'opencode';
const OUTSIDE_NAME = `.maude-e2e-agents-outside-${process.pid}-${Date.now()}.txt`;
const OUTSIDE_ABS = join(homedir(), OUTSIDE_NAME);
const agentsJson = () => join(process.env.XDG_CONFIG_HOME as string, 'maude', 'agents.json');

type Row = { id: string; installed: boolean; connected: boolean; offer: boolean; state: string };

/** The list the panel and Settings read (`GET /_api/agents`), from the page. */
async function agentsList(): Promise<{ agents: Row[]; offerAgents: string[] } | null> {
  return browser.execute(async () => {
    try {
      const r = await fetch('/_api/agents', { cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  });
}

/** The AI panel on screen, on an EMPTY chat (the empty state's hint is up), with the agent list answered. */
async function emptyChat(): Promise<void> {
  await openAssistant();
  await (await $(tid('ai-hint'))).waitForDisplayed({ timeout: 60_000 });
  await browser.waitUntil(async () => (await agentsList()) !== null, {
    timeout: 30_000,
    timeoutMsg: '/_api/agents never answered',
  });
  // the store reads the same route on mount; give its answer a beat to render before asserting an absence
  await browser.pause(1_500);
}

/** Settings › Connections with the AI agents card open. */
async function agentsCard(): Promise<void> {
  await openSettings('connections');
  const card = await $(tid('settings-agents-card'));
  await card.waitForDisplayed({ timeout: 15_000 });
  const toggle = await $(tid('settings-card-agents-toggle'));
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await (await $(tid('settings-card-agents-body'))).waitForDisplayed({ timeout: 10_000 });
}

async function lookAgain(want: (summary: string) => boolean, what: string): Promise<string> {
  await agentsCard();
  await (await $(tid('settings-agents-refresh'))).click();
  const summary = await $(tid('settings-conn-agents-status'));
  await browser.waitUntil(async () => want(await summary.getText()), {
    timeout: 30_000,
    timeoutMsg: `Look again never showed ${what} (summary: ${await summary.getText().catch(() => '?')})`,
  });
  return summary.getText();
}

async function send(text: string): Promise<void> {
  const composer = await $(tid('chat-composer'));
  await composer.waitForDisplayed({ timeout: 60_000 });
  await clearComposer();
  const input = await composer.$('.chat-input');
  await input.click();
  await input.addValue(text);
  await (await $('[aria-label="Send message"]')).click();
}

/** The text of the last assistant message. */
async function lastReply(): Promise<string> {
  return browser.execute(() => {
    const all = document.querySelectorAll('.chat-msg--assistant');
    return (all[all.length - 1]?.textContent ?? '').trim();
  });
}

describe('universal-acp agents UI (native-desktop)', () => {
  before(async function () {
    startReport(
      'universal-acp-agents-desktop — offer, Settings › AI agents, picker, badge, card, attribution'
    );
    await browser.setTimeout({ script: 120_000 });
    rmSync(OUTSIDE_ABS, { force: true });
    expect(process.env.XDG_CONFIG_HOME ?? '').toContain('maude-e2e-'); // never the person's own agents.json
    await waitForSidecar();
    if (!(await isNativeShell())) throw new Error('the agents lane needs the native shell');
    await openAssistant();
    await requireAi(this);
  });

  after(() => {
    rmSync(OUTSIDE_ABS, { force: true });
  });

  it('1 · World A (Claude only): no offer, no picker; Settings says no other agents', async () => {
    // the lane's PATH holds no catalog agent: a leak here would make every later assertion meaningless
    for (const dir of (process.env.PATH ?? '').split(':')) {
      for (const b of OTHER_AGENT_BINS) expect(existsSync(join(dir, b))).toBe(false);
    }
    await emptyChat();
    const list = await agentsList();
    expect(list?.agents.filter((a) => a.id !== 'claude' && a.installed).map((a) => a.id)).toEqual(
      []
    );
    expect(list?.offerAgents).toEqual([]);
    expect(await (await $(tid('ai-agent-offer'))).isExisting()).toBe(false);
    expect(await (await $(tid('ai-agent-picker'))).isExisting()).toBe(false);
    await capture('01-world-a-empty-chat-no-offer');

    await agentsCard();
    const summary = await (await $(tid('settings-conn-agents-status'))).getText();
    expect(summary).toContain('No other AI agents on this Mac');
    await capture('01-world-a-settings-no-other-agents');
    await closeSettings();
  });

  it('2 · World B: the empty chat offers opencode; Not now is permanent (reload, relaunch)', async () => {
    installFakeOpencode(agentDropDir());
    const summary = await lookAgain((s) => s.includes(LABEL), 'opencode');
    expect(summary).toContain(`${LABEL} on this Mac`);
    await capture('02-settings-opencode-on-this-mac');
    await closeSettings();

    await emptyChat();
    const offer = await $(tid('ai-agent-offer'));
    await offer.waitForDisplayed({ timeout: 15_000 });
    expect(await offer.getText()).toContain(`${LABEL} is on this Mac. Use it in Maude too?`);
    await capture('02-offer-line');

    await (await $(tid('ai-agent-offer-dismiss'))).click();
    await browser.waitUntil(async () => !(await offer.isExisting()), {
      timeout: 10_000,
      timeoutMsg: 'the offer line stayed after Not now',
    });
    const rec = JSON.parse(readFileSync(agentsJson(), 'utf8'));
    expect(rec.offerDismissed?.opencode).toBe(true);
    await capture('02-not-now-gone');

    await browser.execute(() => location.reload());
    await waitForSidecar();
    await emptyChat();
    expect(await (await $(tid('ai-agent-offer'))).isExisting()).toBe(false);
    await capture('02-still-gone-after-reload');

    const pids = await relaunchApp();
    expect(pids.after).not.toBe(pids.before);
    await pinCurrentWindow();
    await waitForSidecar();
    await emptyChat();
    const after = await agentsList();
    expect(after?.agents.find((a) => a.id === 'opencode')?.installed).toBe(true); // found again, still silenced
    expect(after?.offerAgents).toEqual([]);
    expect(await (await $(tid('ai-agent-offer'))).isExisting()).toBe(false);
    await capture('02-still-gone-after-relaunch');
  });

  it('3 · a fresh record: offer → Connect → the real probe → Connected in Settings; the offer is gone', async () => {
    rmSync(agentsJson(), { force: true }); // a fresh agents record: the dismissal is forgotten
    await lookAgain((s) => s.includes(LABEL), 'opencode');
    await closeSettings();
    await emptyChat();
    const offer = await $(tid('ai-agent-offer'));
    await offer.waitForDisplayed({ timeout: 15_000 });
    await capture('03-offer-again');

    // opencode carries a connect note (its free hosted model), so Connect opens Settings › AI agents to show it
    await (await $(tid('ai-agent-offer-connect'))).click();
    await (await $(tid('settings-sheet'))).waitForDisplayed({ timeout: 15_000 });
    await capture('03-connect-opened-settings');
    const row = await $(tid('settings-agent-row-opencode'));
    if (!(await row.isDisplayed().catch(() => false))) await agentsCard(); // the card may open folded
    await row.waitForDisplayed({ timeout: 15_000 });
    expect(await (await $(tid('settings-agent-note-opencode'))).getText()).toContain(
      'free hosted model'
    );
    await capture('03-settings-row-before-connect');

    await (await $(tid('settings-agent-connect-opencode'))).click();
    await browser.waitUntil(async () => (await row.getAttribute('data-state')) === 'connected', {
      timeout: 120_000,
      interval: 500,
      timeoutMsg: `opencode never read Connected (state ${await row.getAttribute('data-state')}, error: ${await $(
        tid('settings-agent-error-opencode')
      )
        .getText()
        .catch(() => 'none')})`,
    });
    expect(await (await $(tid('settings-agent-state-opencode'))).getText()).toContain('Connected');
    await capture('03-settings-connected');
    const rec = JSON.parse(readFileSync(agentsJson(), 'utf8'));
    expect(rec.connected?.opencode?.version).toBe('1.18.40');
    await closeSettings();

    await emptyChat();
    expect(await (await $(tid('ai-agent-offer'))).isExisting()).toBe(false);
    await capture('03-offer-gone-after-connect');
  });

  it('4 · Claude + opencode: the picker; a new chat on opencode answers with the vendor badge; then read-only', async () => {
    await emptyChat();
    const picker = await $(tid('ai-agent-picker'));
    await picker.waitForDisplayed({ timeout: 15_000 });
    expect(await picker.getTagName()).toBe('select');
    const options = await browser.execute(() =>
      Array.from(document.querySelectorAll('[data-testid="ai-agent-picker"] option')).map(
        (o) => (o as HTMLOptionElement).value
      )
    );
    expect(options.sort()).toEqual(['claude', 'opencode']);
    // the embedded WebDriver cannot select an <option> by clicking it (helpers/assistant.ts pickMode): set + change
    await browser.execute(() => {
      const sel = document.querySelector('[data-testid="ai-agent-picker"]') as HTMLSelectElement;
      sel.value = 'opencode';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await browser.waitUntil(async () => (await picker.getAttribute('data-agent')) === 'opencode', {
      timeout: 10_000,
      timeoutMsg: 'the picker never took opencode',
    });
    await capture('04-picker-opencode');

    const before = await messageCount();
    await send('Say hello.');
    await waitForTurnSettled(before, {
      timeout: 90_000,
      timeoutMsg: 'the opencode turn never settled',
    });
    expect(await lastReply()).toContain('Hello from the fake opencode.');
    const badge = await $(tid('ai-agent-badge'));
    await badge.waitForDisplayed({ timeout: 10_000 });
    expect(await badge.getText()).toBe(LABEL);
    expect(await badge.getAttribute('title')).toContain('opencode by opencode');
    const locked = await $(tid('ai-agent-picker'));
    await browser.waitUntil(async () => (await locked.getTagName()) === 'span', {
      timeout: 10_000,
      timeoutMsg: 'the picker stayed a <select> after the first message',
    });
    expect(await locked.getAttribute('data-agent')).toBe('opencode');
    expect(await locked.getAttribute('title')).toContain('Start a new chat to use another agent');
    await capture('04-reply-badge-picker-locked');
  });

  it('5 · a write outside the project: once-only card; Reject → closed, nothing written', async () => {
    const before = await messageCount();
    await send(`E2E_OUTSIDE_WRITE ${OUTSIDE_ABS}`);
    const card = await $(tid('chat-permission-prompt'));
    let sawCard = false;
    await waitForTurnSettled(before, {
      timeout: 90_000,
      timeoutMsg: 'the outside write neither raised a card nor ended',
      onSample: async () => {
        if (await card.isDisplayed().catch(() => false)) sawCard = true;
        return sawCard;
      },
    });
    expect(sawCard ? 'card' : existsSync(OUTSIDE_ABS) ? 'WRITTEN with no card' : 'no card').toBe(
      'card'
    );
    await (await $(tid('chat-perm-outside'))).waitForDisplayed({ timeout: 5_000 });
    expect(await (await $(tid('chat-perm-paths'))).getText()).toContain(OUTSIDE_NAME);
    const text = (await card.getText()).toLowerCase();
    expect(text).not.toContain('always');
    // Design Decision 5: the card says who asks (the first run of this lane caught "Claude wants…" here)
    expect(text).toContain('opencode wants to write a file outside this project');
    expect(text).not.toContain('claude wants'); // (the project path itself may hold `.claude/`)
    await capture('05-outside-write-card');

    const reject = await card.$('.btn--danger');
    await reject.waitForDisplayed({ timeout: 10_000 });
    await reject.click();
    await browser.waitUntil(async () => !(await card.isDisplayed().catch(() => false)), {
      timeout: 20_000,
      timeoutMsg: 'the card never closed after Reject',
    });
    await waitForTurnSettled(0, {
      timeout: 60_000,
      timeoutMsg: 'the turn never settled after Reject',
    });
    const refused = await (await $(tid('ai-agent-refused'))).isExisting();
    const reply = await lastReply();
    expect(refused || reply.includes('refused')).toBe(true);
    expect(existsSync(OUTSIDE_ABS)).toBe(false);
    await capture('05-rejected-nothing-written');
  });

  it('6 · an agent error reads "opencode reported: …"', async () => {
    const before = await messageCount();
    await send('E2E_AGENT_ERROR');
    const notice = await $(tid('ai-agent-error'));
    await browser
      .waitUntil(async () => notice.isDisplayed().catch(() => false), { timeout: 60_000 })
      .catch(() => undefined);
    await capture('06-agent-error');
    const shown = (await notice.isDisplayed().catch(() => false))
      ? await (await $(tid('ai-agent-error-text'))).getText()
      : `(no ai-agent-error; last reply: ${await lastReply()}; messages ${before}→${await messageCount()})`;
    expect(shown).toContain(`${LABEL} reported: `);
    expect(shown).toContain('the e2e quota is used up');
  });
});
