import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';

import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';

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
    await (browser as unknown as { tauri?: { switchWindow(label: string): Promise<void> } }).tauri
      ?.switchWindow('main')
      .catch((error: unknown) =>
        console.warn(`[team-project] window pin failed: ${String(error)}`)
      );
  });

  it('1 · first run offers the invited-project door', async () => {
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

  it('2 · a wrong password says so, and nothing opens', async () => {
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

  it('3 · email + password opens the project’s own copy with the teammate’s canvases', async () => {
    const t = TEAM as NonNullable<typeof TEAM>;
    const pw = await $(tid('team-hub-password'));
    await pw.clearValue();
    await pw.setValue(t.password);
    await (await $(tid('team-hub-open'))).click();
    // The shell switches the sidecar and the webview reloads onto the project.
    await browser.pause(6_000);
    await waitForSidecar();
    const welcome = await $(tid('canvas-row-ui-welcome'));
    await welcome.waitForDisplayed({ timeout: 120_000 });
    await (await $(tid('canvas-row-screens-home'))).waitForDisplayed({ timeout: 60_000 });
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
  });

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

  it('4b · the status bar offers a way into the project’s history', async () => {
    // The designer's own history — and the Undo on their own actions — lives
    // in this panel. A managed team copy is NOT a Git repository, and the
    // chip that opens the panel used to be gated on one, so on the single
    // surface an invited designer uses there was no visible way in at all
    // (found running S20 against a live deployment). The menu entry and ⌘⇧G
    // still worked, which is why it stayed invisible rather than broken.
    await settleMotion();
    const changes = await $(tid('open-changes'));
    await changes.waitForDisplayed({ timeout: 30_000 });
    if ((await changes.getAttribute('aria-pressed')) !== 'true') await changes.click();
    await (await $(tid('git-panel'))).waitForDisplayed({ timeout: 30_000 });
    await capture('06b-history-from-the-status-bar');
    await (await $(tid('open-changes'))).click();
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
    await (await $('.st-sb-theme')).click();
    await trigger.click();
    await (await $(tid('switcher-open-team'))).click();
    await (await $(tid('team-projects-dialog'))).waitForDisplayed({ timeout: 10_000 });
    const theme = await browser.execute(() => document.documentElement.getAttribute('data-theme'));
    await capture(`07-team-projects-${theme ?? 'theme'}`);
    await browser.keys('Escape');
    await (await $('.st-sb-theme')).click();
  });

  it('7 · the server goes away: the app stops claiming "synced", keeps the edit, delivers it on return', async () => {
    const t = TEAM as NonNullable<typeof TEAM>;
    const mine = join(t.managedDir, '.design', 'ui', 'welcome.tsx');
    const theirs = join(t.teammate, '.design', 'ui', 'welcome.tsx');
    process.kill(t.hubPid, 'SIGSTOP');
    try {
      writeFileSync(mine, canvas('Welcome, written while the server was away'));
      await eventually(
        'the status bar to say the change is not shared yet',
        async () => {
          const text = ((await (await $('.st-sb-sync')).getText()) ?? '').toLowerCase();
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
    // The status bar's sync slot opens the Sync panel (unless it already is).
    const openSync = await $(tid('open-sync'));
    if ((await openSync.getAttribute('aria-pressed')) !== 'true') await openSync.click();
    await settleMotion();
    const again = await $(tid('sync-signin-again'));
    await again.waitForDisplayed({ timeout: 90_000 }).catch(async (error) => {
      await capture('10-access-removed-no-sign-in-again');
      const seen = await browser.execute(() => ({
        note: document.querySelector('.sp-note')?.textContent ?? null,
        status: document.querySelector('.st-sb-sync')?.textContent ?? null,
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
