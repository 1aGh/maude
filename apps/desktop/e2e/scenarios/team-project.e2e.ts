import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, $$, browser, expect } from '@wdio/globals';

import {
  closeHistory,
  openHistory,
  openSyncDetails,
  syncStatusText,
  toggleTheme,
} from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';
import { activeTab, HOME, labels, pinCurrentWindow, waitWindow } from '../helpers/windows';

/**
 * Plan T21/T22 — a designer who was added to a project opens the desktop app,
 * picks the project and works. On a clean install, through the real wizard DOM:
 *
 *   1. first run → "Open a project you were invited to"
 *   2. the team server's address + email + password — no token, no folder
 *   3. the app opens the project's OWN copy (keyed by server + project) and the
 *      teammate's canvases arrive
 *   4. a teammate's change reaches the designer's copy; the designer's change
 *      reaches the teammate — both ways, no sync vocabulary anywhere
 *   5. the switcher names the project and offers the team projects again
 *   6. keyboard + dark theme on the picker
 *   7. the server goes away: no "synced" claim, the edit is kept and delivered
 *      when it returns
 *   8. access removed: the app says to sign in again (not "check your
 *      connection"), and signing in again delivers the change it kept
 *
 * Only runs under wdio.team-project.conf.ts (real hub + seeding teammate).
 */
const tid = (s: string) => `[data-testid="${s}"]`;

/**
 * S6.9 — "hub from Home": the same designer, the same hub, but entering through Home's Advanced options
 * (card → Advanced options → Use a self-hosted hub) instead of the v1 first-run wizard door. Legs 1h–3h
 * replace legs 1–3; legs 4+ then run unchanged in the project's tab. Run with MAUDE_E2E_TEAM_FROM=home
 * (the wizard legs stay for the lane that still boots the wizard until S6.15 retires it).
 */
const FROM_HOME = process.env.MAUDE_E2E_TEAM_FROM === 'home';
const wizardIt = FROM_HOME ? it.skip : it;
const homeIt = FROM_HOME ? it : it.skip;

/**
 * Settle entry animations. WKWebView does not advance a CSS animation while
 * its window is occluded (a test window behind the editor), so a dialog that
 * fades in from opacity 0 stays invisible — present, focused, laid out, and
 * "not displayed". The shipped reduced-motion rule already turns the dialog
 * animation off; this is the same, for every element, in this page only.
 */
async function settleMotion() {
  await browser.execute(() => {
    if (document.getElementById('e2e-settle-motion')) return;
    const s = document.createElement('style');
    s.id = 'e2e-settle-motion';
    s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
    document.head.append(s);
  });
}
const TEAM = process.env.MAUDE_E2E_TEAM
  ? (JSON.parse(process.env.MAUDE_E2E_TEAM) as {
      hub: string;
      teammate: string;
      managedDir: string;
      password: string;
      hubPid: number;
      adminSecret: string;
    })
  : null;

const canvas = (
  title: string
) => `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection id="main" title="Team project">
        <DCArtboard id="main" label="MAIN" width={480} height={320}>
          <h1 style={{ padding: 32, fontFamily: "system-ui", color: "#111" }}>${title}</h1>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

async function eventually(what: string, fn: () => boolean | Promise<boolean>, timeout = 60_000) {
  await browser.waitUntil(async () => (await fn()) === true, {
    timeout,
    interval: 500,
    timeoutMsg: `timed out: ${what}`,
  });
}

describe('team-project (native-desktop)', () => {
  before(async function () {
    if (!TEAM) this.skip();
    startReport('team-project (native-desktop) — invited designer opens the project, no folder');
    await browser.setTimeout({ script: 60_000 });
    // @wdio/tauri-service re-checks window focus before every command through
    // a Tauri global the studio page does not carry, so each command waits out
    // a 5 s timeout — a menu opened by one command has closed by the next.
    // This app has one window: name it once (an explicit switch stops the
    // per-command focus probe).
    await pinCurrentWindow().catch((error: unknown) =>
      console.warn(`[team-project] window pin failed: ${String(error)}`)
    );
  });

  homeIt('1h · Home: Advanced options → Use a self-hosted hub opens the sheet', async () => {
    await waitWindow(HOME);
    await browser.switchToWindow(HOME);
    await (
      browser as unknown as { tauri?: { switchWindow(l: string): Promise<unknown> } }
    ).tauri?.switchWindow(HOME);
    expect(await isNativeShell()).toBe(true);
    await (await $(tid('signin-card'))).waitForDisplayed({ timeout: 180_000 });
    await (await $(tid('signin-advanced'))).click();
    const row = await $(tid('signin-adv-hub'));
    await row.waitForDisplayed({ timeout: 5_000 });
    expect(await row.getAttribute('aria-disabled')).toBeNull();
    await row.click();
    const sheet = await $(tid('onb-hub'));
    await sheet.waitForDisplayed({ timeout: 10_000 });
    expect(await (await sheet.$('h2')).getText()).toBe('Connect to your own hub');
    expect(await (await $(tid('onb-hub-go'))).getText()).toBe('Connect');
    await capture('01h-home-hub-sheet');
  });

  homeIt(
    '2h · Test connection reads Reachable; a wrong password says so and nothing opens',
    async () => {
      const t = TEAM as NonNullable<typeof TEAM>;
      await (await $(tid('onb-hub-url'))).setValue(t.hub);
      await (await $(tid('onb-hub-test'))).click();
      const ok = await $(tid('onb-hub-reachable'));
      await ok.waitForDisplayed({ timeout: 20_000 });
      expect(await ok.getText()).toContain('Reachable');
      await (await $(tid('onb-hub-email'))).setValue('designer@x.test');
      await (await $(tid('onb-hub-password'))).setValue('not-the-password');
      await (await $(tid('onb-hub-go'))).click();
      const err = await $(tid('onb-hub-error'));
      await err.waitForDisplayed({ timeout: 20_000 });
      expect((await err.getText()).toLowerCase()).not.toContain('token');
      // the field was emptied the moment Connect was pressed
      expect(await (await $(tid('onb-hub-password'))).getValue()).toBe('');
      expect(existsSync(t.managedDir)).toBe(false);
      await capture('02h-home-wrong-password');
    }
  );

  homeIt(
    '3h · the right password opens the project’s own copy as a tab with the teammate’s canvases',
    async () => {
      const t = TEAM as NonNullable<typeof TEAM>;
      const before = await labels();
      await (await $(tid('onb-hub-password'))).setValue(t.password);
      await (await $(tid('onb-hub-go'))).click();
      await browser.waitUntil(async () => (await labels()).length === before.length + 1, {
        timeout: 60_000,
        interval: 250,
        timeoutMsg: 'no project tab after Connect',
      });
      const created = (await labels()).find((l) => !before.includes(l)) as string;
      await browser.waitUntil(async () => (await activeTab()) === created, { timeout: 15_000 });
      await browser.switchToWindow(created);
      await pinCurrentWindow();
      await waitForSidecar();
      await (await canvasRow('canvas-row-ui-welcome')).waitForDisplayed({ timeout: 120_000 });
      await (await canvasRow('canvas-row-screens-home')).waitForDisplayed({ timeout: 60_000 });
      await capture('03h-home-project-open');
      const copy = join(t.managedDir, '.design', 'ui', 'welcome.tsx');
      await eventually('the welcome canvas on disk in the managed copy', () => read(copy) !== null);
      expect(read(copy)).toContain('Welcome, team');
      const cfg = JSON.parse(read(join(t.managedDir, '.design', 'config.json')) ?? '{}');
      expect(cfg.linkedHub?.url).toBe(t.hub);
      // The password was never written anywhere; only the minted credential.
      const hubs = read(process.env.HUBS_CONFIG_PATH ?? '') ?? '';
      expect(hubs).toContain(t.hub);
      expect(hubs).not.toContain(t.password);
    }
  );

  wizardIt('1 · first run offers the invited-project door', async () => {
    await waitForSidecar();
    expect(await isNativeShell()).toBe(true);
    const door = await $(tid('ob-door-team'));
    await door.waitForDisplayed({ timeout: 180_000 });
    expect(await door.getText()).toContain('invited');
    await capture('01-first-run-team-door');
    await door.click();
    await (await $(tid('team-projects'))).waitForDisplayed({ timeout: 15_000 });
    await capture('02-team-projects');
  });

  wizardIt('2 · a wrong password says so, and nothing opens', async () => {
    const t = TEAM as NonNullable<typeof TEAM>;
    await (await $(tid('team-hub-url'))).setValue(t.hub);
    await (await $(tid('team-hub-email'))).setValue('designer@x.test');
    await (await $(tid('team-hub-password'))).setValue('not-the-password');
    await (await $(tid('team-hub-open'))).click();
    const err = await $(tid('team-error'));
    await err.waitForDisplayed({ timeout: 20_000 });
    const text = (await err.getText()).toLowerCase();
    expect(text).not.toContain('token');
    expect(existsSync(t.managedDir)).toBe(false);
    await capture('03-wrong-password');
  });

  wizardIt(
    '3 · email + password opens the project’s own copy with the teammate’s canvases',
    async () => {
      const t = TEAM as NonNullable<typeof TEAM>;
      const pw = await $(tid('team-hub-password'));
      await pw.clearValue();
      await pw.setValue(t.password);
      await (await $(tid('team-hub-open'))).click();
      // The shell switches the sidecar and the webview reloads onto the project.
      await browser.pause(6_000);
      await waitForSidecar();
      const welcome = await canvasRow('canvas-row-ui-welcome');
      await welcome.waitForDisplayed({ timeout: 120_000 });
      await (await canvasRow('canvas-row-screens-home')).waitForDisplayed({ timeout: 60_000 });
      await capture('04-project-open-with-canvases');

      // The copy lives where the app keeps team projects — nobody chose a folder.
      const copy = join(t.managedDir, '.design', 'ui', 'welcome.tsx');
      await eventually('the welcome canvas on disk in the managed copy', () => read(copy) !== null);
      expect(read(copy)).toContain('Welcome, team');
      const cfg = JSON.parse(read(join(t.managedDir, '.design', 'config.json')) ?? '{}');
      expect(cfg.managed?.projectId).toBe('local');
      expect(cfg.linkedHub?.url).toBe(t.hub);
      // The password was never written anywhere; only the minted credential.
      const hubs = read(process.env.HUBS_CONFIG_PATH ?? '') ?? '';
      expect(hubs).toContain(t.hub);
      expect(hubs).not.toContain(t.password);
    }
  );

  it('4 · changes travel both ways', async () => {
    const t = TEAM as NonNullable<typeof TEAM>;
    const mine = join(t.managedDir, '.design', 'ui', 'welcome.tsx');
    const theirs = join(t.teammate, '.design', 'ui', 'welcome.tsx');

    writeFileSync(theirs, canvas('Welcome, edited by a teammate'));
    await eventually('the teammate’s edit in the designer’s copy', () =>
      (read(mine) ?? '').includes('edited by a teammate')
    );
    await capture('05-teammate-edit-arrived');

    // The designer edits too (as their editor or an agent would write it).
    await browser.pause(1_500);
    writeFileSync(mine, canvas('Welcome, edited by the designer'));
    await eventually('the designer’s edit at the teammate', () =>
      (read(theirs) ?? '').includes('edited by the designer')
    );
    await capture('06-designer-edit-arrived');
  });

  it('4b · the menu offers a way into the project’s history', async () => {
    // The designer's own history — and the Undo on their own actions — lives
    // in this panel. A managed team copy is NOT a Git repository, and the
    // status-bar chip that opened the panel used to be gated on one, so on the
    // single surface an invited designer uses there was no visible way in at
    // all (found running S20 against a live deployment). The chip is gone
    // (V2-4.8b): Menu › Version history is the way in, ungated.
    await settleMotion();
    await openHistory();
    await capture('06b-history-from-the-menu');
    await closeHistory();
  });

  it('4c · Settings › Connections: the team server reads like the cloud; its token only as the last four', async () => {
    // S11.14 (06 ad-edge-hub) — the server-add leg's other end: the folder this copy syncs is the
    // team server's row, "Connected …" with Sign out, and its Advanced names the address, the access
    // token as •••• •••• <last 4> (never more) and Replace…. Read-only here: nothing is replaced.
    const t = TEAM as NonNullable<typeof TEAM>;
    await settleMotion();
    await (await $(tid('project-pill'))).click();
    const row = await $(tid('project-menu-row-settings.open'));
    await row.waitForDisplayed({ timeout: 10_000 });
    await row.click();
    await (await $(tid('settings-tab-connections'))).click();
    const status = await $(tid('settings-conn-hub-status'));
    await status.waitForDisplayed({ timeout: 15_000 });
    expect(await status.getText()).toMatch(/^Connected/);
    expect(await (await $(tid('settings-hub-sign-out'))).isDisplayed()).toBe(true);
    const fold = await $(tid('fold-connections.hub-toggle'));
    if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
    const token = await $(tid('settings-hub-token'));
    await token.waitForDisplayed({ timeout: 10_000 });
    expect(await token.getText()).toMatch(/•••• •••• (\S{4}|••••)/);
    expect(await (await $(tid('settings-hub-address'))).getText()).toContain(t.hub);
    expect(await (await $(tid('settings-hub-token-replace'))).isDisplayed()).toBe(true);
    // the stored credential's body never reaches the page
    const hubs = read(process.env.HUBS_CONFIG_PATH ?? '') ?? '';
    const stored = (JSON.parse(hubs || '{}').hubs?.[t.hub]?.token as string | undefined) ?? '';
    if (stored.length > 8)
      expect(await browser.execute(() => document.body.innerHTML)).not.toContain(
        stored.slice(0, -4)
      );
    await capture('06c-connections-team-server');
    await fold.click(); // remembered per Mac: leave it as it was
    const close = await $(tid('settings-close'));
    if (await close.isExisting()) await close.click();
  });

  it('5 · the switcher names the project and offers team projects again', async () => {
    await settleMotion();
    const trigger = await $(tid('repo-switcher-trigger'));
    await trigger.waitForDisplayed({ timeout: 30_000 });
    await trigger.click();
    const popup = await $(tid('repo-switcher-popup'));
    await popup.waitForDisplayed({ timeout: 10_000 });
    expect(await popup.getText()).not.toContain('--local');
    await (await $(tid('switcher-open-team'))).click();
    const dialog = await $(tid('team-projects-dialog'));
    await dialog.waitForDisplayed({ timeout: 10_000 }).catch(async (error) => {
      await capture('07-switcher-no-dialog');
      const seen = await browser.execute(() => {
        const d = document.querySelector('[data-testid="team-projects-dialog"]');
        const r = d?.getBoundingClientRect();
        return {
          dialog: !!d,
          rect: r ? [r.x, r.y, r.width, r.height] : null,
          popup: !!document.querySelector('[data-testid="repo-switcher-popup"]'),
          item: !!document.querySelector('[data-testid="switcher-open-team"]'),
          active: document.activeElement?.outerHTML.slice(0, 160) ?? null,
        };
      });
      throw new Error(`${String(error)} — ${JSON.stringify(seen)}`);
    });
    await capture('07-switcher-team-projects');
    expect(await dialog.getText()).toContain('On this computer');
    await (await $(tid('team-projects-close'))).click();
  });

  it('6 · keyboard and dark mode: Escape closes the picker, focus returns, dark theme renders', async () => {
    await settleMotion();
    const trigger = await $(tid('repo-switcher-trigger'));
    await trigger.click();
    await (await $(tid('switcher-open-team'))).click();
    const dialog = await $(tid('team-projects-dialog'));
    await dialog.waitForDisplayed({ timeout: 10_000 });
    // Focus moved INTO the dialog (the first control), not left on the page.
    const inside = await browser.execute(
      () => !!document.activeElement?.closest('[data-testid="team-projects-dialog"]')
    );
    expect(inside).toBe(true);
    await browser.keys('Escape');
    await browser.waitUntil(async () => !(await dialog.isExisting()), {
      timeout: 5_000,
      timeoutMsg: 'Escape did not close the team projects dialog',
    });
    // Dark theme: the same dialog, legible.
    await toggleTheme();
    await trigger.click();
    await (await $(tid('switcher-open-team'))).click();
    await (await $(tid('team-projects-dialog'))).waitForDisplayed({ timeout: 10_000 });
    const theme = await browser.execute(() => document.documentElement.getAttribute('data-theme'));
    await capture(`07-team-projects-${theme ?? 'theme'}`);
    await browser.keys('Escape');
    await toggleTheme();
  });

  it('7 · the server goes away: the app stops claiming "synced", keeps the edit, delivers it on return', async () => {
    const t = TEAM as NonNullable<typeof TEAM>;
    const mine = join(t.managedDir, '.design', 'ui', 'welcome.tsx');
    const theirs = join(t.teammate, '.design', 'ui', 'welcome.tsx');
    process.kill(t.hubPid, 'SIGSTOP');
    try {
      writeFileSync(mine, canvas('Welcome, written while the server was away'));
      await eventually(
        'the Share cluster to say the change is not shared yet',
        async () => {
          const text = ((await syncStatusText()) ?? '').toLowerCase();
          return /offline|reconnect|saving|pending|waiting|not shared|unsaved/.test(text);
        },
        60_000
      );
      await capture('08-server-away-edit-pending');
      expect(read(theirs) ?? '').not.toContain('written while the server was away');
    } finally {
      process.kill(t.hubPid, 'SIGCONT');
    }
    await eventually(
      'the edit made while the server was away at the teammate',
      () => (read(theirs) ?? '').includes('written while the server was away'),
      120_000
    );
    await capture('09-server-back-edit-delivered');
  });

  it('7b · a project switch while work is still pending does not drop it', async () => {
    // T22's Validate names this cell and nothing ran it. Step 7 proves the app
    // keeps an edit when the SERVER goes away; this is the other half — the
    // app tears its sidecar down and reopens the project while that edit is
    // still queued on this machine, which is the moment a durable outbox is
    // easiest to lose.
    const t = TEAM as NonNullable<typeof TEAM>;
    const mine = join(t.managedDir, '.design', 'ui', 'welcome.tsx');
    const theirs = join(t.teammate, '.design', 'ui', 'welcome.tsx');
    process.kill(t.hubPid, 'SIGSTOP');
    try {
      writeFileSync(mine, canvas('Welcome, written before the switch'));
      await eventually(
        'the change to be waiting on this machine',
        async () => {
          const text = ((await syncStatusText()) ?? '').toLowerCase();
          return /offline|reconnect|saving|pending|waiting|not shared|unsaved/.test(text);
        },
        60_000
      );
      expect(read(theirs) ?? '').not.toContain('written before the switch');

      // Reopen the project through the picker, exactly as a person would.
      await settleMotion();
      await (await $(tid('repo-switcher-trigger'))).click();
      await (await $(tid('switcher-open-team'))).click();
      await (await $(tid('team-projects-dialog'))).waitForDisplayed({ timeout: 10_000 });
      const recent = await $$('[data-testid^="team-recent-"]');
      expect(recent.length).toBeGreaterThan(0);
      await recent[0].click();
      await browser.pause(6_000);
      await waitForSidecar();
      await capture('09b-switched-with-work-pending');
      // The bytes are still the ones this machine wrote, not a pull over them.
      expect(read(mine) ?? '').toContain('written before the switch');
    } finally {
      process.kill(t.hubPid, 'SIGCONT');
    }
    await eventually(
      'the pending edit at the teammate after the switch',
      () => (read(theirs) ?? '').includes('written before the switch'),
      180_000
    );
    await capture('09c-pending-edit-survived-the-switch');
  });

  it('8 · access removed: nothing more is shared, the app asks to sign in again, and signing in resumes it', async () => {
    const t = TEAM as NonNullable<typeof TEAM>;
    const mine = join(t.managedDir, '.design', 'ui', 'welcome.tsx');
    const theirs = join(t.teammate, '.design', 'ui', 'welcome.tsx');
    const admin = (path: string) =>
      fetch(`${t.hub}/admin/api${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${t.adminSecret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'designer@x.test' }),
      });
    expect((await admin('/users/disable')).status).toBe(200);
    writeFileSync(mine, canvas('Welcome, after access was removed'));
    // Menu › Diagnostics › Sync shows the Sync panel (the status bar's chip is gone — V2-4.8b).
    await openSyncDetails();
    await settleMotion();
    const again = await $(tid('sync-signin-again'));
    await again.waitForDisplayed({ timeout: 90_000 }).catch(async (error) => {
      await capture('10-access-removed-no-sign-in-again');
      const seen = await browser.execute(() => ({
        note: document.querySelector('.sp-note')?.textContent ?? null,
        status: document.querySelector('[data-testid="share-cluster-status"]')?.textContent ?? null,
        panel: !!document.querySelector('.sp-note, [data-testid="sync-panel"]'),
      }));
      throw new Error(`${String(error)} — ${JSON.stringify(seen)}`);
    });
    await capture('10-access-removed-sign-in-again');
    expect(read(theirs) ?? '').not.toContain('after access was removed');

    // The owner lets them back in; the designer signs in with their password.
    expect((await admin('/users/enable')).status).toBe(200);
    await again.click();
    await (await $(tid('team-hub-email'))).waitForDisplayed({ timeout: 10_000 });
    const url = await $(tid('team-hub-url'));
    if (!(await url.getValue())) await url.setValue(t.hub);
    await (await $(tid('team-hub-email'))).setValue('designer@x.test');
    await (await $(tid('team-hub-password'))).setValue(t.password);
    await (await $(tid('team-hub-open'))).click();
    await eventually(
      'the edit held while access was removed, at the teammate after signing in again',
      () => (read(theirs) ?? '').includes('after access was removed'),
      180_000
    );
    await capture('11-signed-in-again-edit-delivered');
  });
});
