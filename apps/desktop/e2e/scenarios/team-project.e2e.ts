import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, $$, browser, expect } from '@wdio/globals';
import { type LocalHub, startLocalHub } from '../fixtures/local-hub.mjs';
import { openAssistant } from '../helpers/assistant';
import {
  closeDiagnostics,
  closeHistory,
  openHistory,
  openSyncDetails,
  pressDiagnosticsAdvancedRow,
  syncStatusText,
  toggleTheme,
} from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';
import { openSwitcher } from '../helpers/switcher';
import { canvasRow } from '../helpers/tree';
import { activeTab, HOME, labels, pinCurrentWindow, waitWindow } from '../helpers/windows';

/**
 * Plan T21/T22 — a designer who was added to a project opens the desktop app,
 * picks the project and works. On a clean install, through Home's DOM:
 *
 *   1. Home → Advanced options → "Use a self-hosted hub"
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
 *  9a. (S11.12, accepted revisions) the save queued while the server was away is accepted first;
 *      a LATER overlapping save is the one refused - held on its author's side with the notice
 *      `source-conflict-<slug>`, a conflict record and the project's version as a recovery copy.
 *      Here: this Mac saves offline, the teammate right after - the teammate holds it, nothing here.
 *   9. the same race the other way round, so the held side is THIS Mac: the teammate saved while
 *      the server was away, this Mac right after. Diagnostics > Sync > Sync details holds both
 *      versions, Compare shows what differs, and Keep both makes the project's version the canvas
 *      and this Mac's a sibling canvas "<name> this Mac" - on BOTH copies
 *  9b. the reverse race: the teammate is the one who loses - no card, nothing held here
 *  10. (S11.11) Resync from Diagnostics > Advanced: the trace "Resyncing... n of m", then the
 *      result sentence, then the log line in Diagnostics > Logs
 *
 * Only runs under wdio.team-project.conf.ts (real hub + seeding teammate).
 */
const tid = (s: string) => `[data-testid="${s}"]`;

/**
 * S6.9 / S6.15 — the designer enters through Home's Advanced options (card → Advanced options → Use a
 * self-hosted hub); legs 1h–3h are the way in and legs 4+ run unchanged in the project's tab. The v1
 * first-run wizard door ("Open a project you were invited to", `ob-door-team`) is retired with the wizard;
 * its job is Home's "Use a self-hosted hub" (nothing-deleted row A-your-team-s-own-server-email-password).
 */

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
      /** P8 G1b: the in-process hub's data dir + port (absent when the hub is a container) */
      hubDir?: string;
      hubPort?: number;
      /** V2-8.18: the hub is a container (wdio.team-project.conf.ts MAUDE_E2E_HUB_TARGET) */
      hubContainer?: string;
      hubAway?: 'kill' | 'pause';
    })
  : null;

/**
 * The server goes away: SIGSTOP the in-process hub, or kill / pause its container (same volume).
 * The offline-race steps (9a, 9) pass 'pause': they depend on WHICH save reaches the hub first, which a held
 * connection keeps (as SIGSTOP does) and a restart does not — after a kill each peer reconnects on its own
 * backoff. The crash on the same volume is steps 7 and 7b.
 */
function hubAway(t: NonNullable<typeof TEAM>, mode = t.hubAway) {
  if (!t.hubContainer) return void process.kill(hubProcess(t), 'SIGSTOP');
  execFileSync(
    'docker',
    mode === 'pause' ? ['pause', t.hubContainer] : ['kill', '--signal', 'KILL', t.hubContainer]
  );
}
/** …and comes back. */
function hubBack(t: NonNullable<typeof TEAM>, mode = t.hubAway) {
  if (!t.hubContainer) return void process.kill(hubProcess(t), 'SIGCONT');
  execFileSync('docker', [mode === 'pause' ? 'unpause' : 'start', t.hubContainer]);
}
/**
 * The in-process hub's pid — never 0. Against a container hub the conf sets `hubPid: 0`, and
 * `process.kill(0, 'SIGSTOP')` stops this whole process GROUP (wdio, the Docker gate, the test lane),
 * so the SIGCONT after it never runs and the lane hangs. Every signal to the hub goes through here.
 */
function hubProcess(t: NonNullable<typeof TEAM>): number {
  if (!Number.isInteger(t.hubPid) || t.hubPid <= 0)
    throw new Error(`no in-process hub to signal (hubPid ${t.hubPid}) — use hubAway/hubBack`);
  return t.hubPid;
}

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

/** A studio's own sync status file (`.design/_sync.json`): its queued saves and the conflicts it holds. */
function syncFileOf(root: string): {
  accepted?: { pending?: number };
  conflicts?: { slug?: string }[];
  notices?: { id?: string }[];
} | null {
  try {
    return JSON.parse(readFileSync(join(root, '.design', '_sync.json'), 'utf8'));
  } catch {
    return null;
  }
}

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

/** The Share cluster's save word (CONTRACT §6): its kind, its exact words, and whether it is a control. */
async function statusWord(): Promise<{
  status: string | null;
  text: string;
  control: boolean;
} | null> {
  return (await browser.execute(() => {
    const el = document.querySelector('[data-testid="share-cluster-status"]') as HTMLElement | null;
    if (!el) return null;
    const w = el.querySelector('.sh-saved-w') ?? el;
    return {
      status: el.getAttribute('data-status'),
      text: (w.textContent ?? '').trim(),
      control: !!el.closest('button, [role="button"], a[href]'),
    };
  })) as { status: string | null; text: string; control: boolean } | null;
}

/** Every versioned `.tsx` under a copy's design root (runtime `_*` dirs skipped), as design-relative paths. */
function canvasesIn(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const n of readdirSync(dir)) {
      if (n.startsWith('_') || n.startsWith('.')) continue;
      const abs = join(dir, n);
      const r = rel ? `${rel}/${n}` : n;
      if (statSync(abs).isDirectory()) walk(abs, r);
      else if (n.endsWith('.tsx')) out.push(r);
    }
  };
  walk(join(root, '.design'), '');
  return out.sort();
}

/** The outbox's intents on disk (`_state/outbox/intents/*.json`, V2-1.14 §5.2). */
function intentsOf(
  root: string
): { kind?: string; state?: string; gates?: string[]; label?: string }[] {
  const dir = join(root, '.design', '_state', 'outbox', 'intents');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => {
      try {
        return JSON.parse(readFileSync(join(dir, n), 'utf8'));
      } catch {
        return {};
      }
    });
}

/**
 * Does the hub itself answer (connection refused = no). Only a 2xx counts: behind the self-host
 * workspace's Caddy (the Docker gate's target) a stopped hub container still gets a 502 from the
 * proxy, which is the proxy answering, not the hub.
 */
async function hubAnswers(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2_000) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * The one part of "this Mac has no internet" a local run cannot do for real: the page's own network signal. The
 * hub is REALLY gone (stopped, connection refused) when this is used; this tells the page what macOS would —
 * `navigator.onLine` false and an `offline` event — so the client surfaces that read it (the empty canvas line,
 * the Advanced rows) answer as on an offline Mac. `false` puts it back.
 */
async function pageOffline(on: boolean): Promise<void> {
  await browser.execute((off: boolean) => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => !off });
    window.dispatchEvent(new Event(off ? 'offline' : 'online'));
  }, on);
}

/** P8 G1b — the hub this spec restarted (same dir, same port, same tokens); stopped in `after`. */
let restarted: LocalHub | null = null;

/** Stop the team hub for real (SIGTERM → connection refused), whichever process holds it now. */
async function stopHub(t: NonNullable<typeof TEAM>): Promise<void> {
  if (t.hubContainer) {
    // V2-8.18: a container hub stops for real (connection refused) and comes back on the same volume
    execFileSync('docker', ['stop', t.hubContainer]);
  } else if (restarted) {
    restarted.stop();
    restarted = null;
  } else {
    try {
      process.kill(hubProcess(t), 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  await eventually('the hub to stop answering', async () => !(await hubAnswers(t.hub)), 30_000);
}

/** Start the same hub again on the same port (serve-hub re-reads its tokens), with optional extra flags. */
async function startHub(t: NonNullable<typeof TEAM>, extraArgs: string[] = []): Promise<void> {
  if (t.hubContainer) {
    if (extraArgs.length)
      throw new Error(`a container hub cannot restart with ${extraArgs.join(' ')}`);
    execFileSync('docker', ['start', t.hubContainer]);
    await eventually('the container hub to answer again', () => hubAnswers(t.hub), 60_000);
    return;
  }
  if (!t.hubDir || !t.hubPort) throw new Error('no hub dir/port to restart the in-process hub');
  restarted = await startLocalHub({ dir: t.hubDir, port: t.hubPort, extraArgs });
  expect(restarted.http).toBe(t.hub);
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

  it('1h · Home: Advanced options → Use a self-hosted hub opens the sheet', async () => {
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

  it('2h · Test connection reads Reachable; a wrong password says so and nothing opens', async () => {
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
  });

  it('3h · the right password opens the project’s own copy as a tab with the teammate’s canvases', async () => {
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
    // P8 G1b (06 ad-edge-hub): the team server's row reads like any connection — its own name, the
    // same Sign out — between the other four rows; the window itself says Saved, like a cloud project.
    expect(await (await $(tid('settings-conn-hub'))).getText()).toMatch(/own server/i);
    for (const row of [
      'settings-cloud',
      'settings-github',
      'settings-ai-keys',
      'figma-connect-card',
    ])
      expect(await (await $(tid(row))).isExisting()).toBe(true);
    await eventually(
      'the save word to settle on Saved',
      async () => (await statusWord())?.status === 'saved',
      120_000
    );
    const word = await statusWord();
    expect(word?.status).toBe('saved');
    expect(word?.text).toBe('Saved');
    expect(await (await $(tid('settings-hub-sign-out'))).isDisplayed()).toBe(true);
    const fold = await $(tid('fold-connections.hub-toggle'));
    if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
    const token = await $(tid('settings-hub-token'));
    await token.waitForDisplayed({ timeout: 10_000 });
    expect(await token.getText()).toMatch(/•••• •••• (\S{4}|••••)/);
    expect(await (await $(tid('settings-hub-address'))).getText()).toContain(t.hub);
    // P8-T G1b-3 (06 ad-edge-hub): "Signed in as" names the account this copy signed in with (leg 3h)
    const account = await $(tid('settings-hub-account'));
    expect(await account.getText()).toMatch(/^Signed in as\s*designer@x\.test$/);
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
    const popup = await openSwitcher();
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
    await openSwitcher();
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
    await openSwitcher();
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
    hubAway(t);
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
      hubBack(t);
    }
    await eventually(
      'the edit made while the server was away at the teammate',
      () => (read(theirs) ?? '').includes('written while the server was away'),
      120_000
    );
    // CONTRACT §Save status: once the server is back and the edit delivered, the Share cluster's one word is
    // "Saved" again (V2-8.18 — on the container lane the server was killed and restarted on its volume)
    await eventually(
      'the Share cluster to say Saved again',
      async () => /^saved\b/i.test(((await syncStatusText()) ?? '').trim()),
      90_000
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
    hubAway(t);
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
      await openSwitcher();
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
      hubBack(t);
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

  it('9a · this Mac saved offline, the teammate right after: the teammate’s save is the one held, with a notice and a recovery copy', async () => {
    // Accepted revisions (DDR-241; apps/studio/test/sync-accepted-offline-resume.test.ts): the proposal queued while
    // the server was away is accepted when it comes back; the teammate's later, overlapping save meets a newer head
    // and is refused - kept on the TEAMMATE's disk, `source-conflict-<slug>` + a conflict record in its sync status,
    // the project's version saved beside it as `_history/<slug>/sync-recovery/incoming.tsx`. Never two silently
    // different copies. A canvas of its own (screens/home), so the conflict it leaves held does not touch step 9.
    const t = TEAM as NonNullable<typeof TEAM>;
    const rel = join('screens', 'home.tsx');
    const slug = 'screens-home';
    const mine = join(t.managedDir, '.design', rel);
    const theirs = join(t.teammate, '.design', rel);
    const teammateStatus = () => syncFileOf(t.teammate);
    await closeDiagnostics();
    await settleMotion();

    hubAway(t, 'pause');
    try {
      writeFileSync(mine, canvas('Home, mine while offline'));
      await eventually(
        'the change to be waiting on this machine',
        async () => {
          const text = ((await syncStatusText()) ?? '').toLowerCase();
          return /offline|reconnect|saving|pending|waiting|not shared|unsaved/.test(text);
        },
        60_000
      );
    } finally {
      hubBack(t, 'pause');
    }
    writeFileSync(theirs, canvas('Home, theirs right after'));

    // the teammate's side holds it: the notice, the record, and the project's version (this Mac's) beside its own
    await eventually(
      'the teammate to hold its refused save (notice + conflict record)',
      () => {
        const st = teammateStatus();
        return (
          !!st?.notices?.some((n) => n.id === `source-conflict-${slug}`) &&
          !!st?.conflicts?.some((c) => c.slug === slug)
        );
      },
      120_000
    );
    const recovery = join(t.teammate, '.design', '_history', slug, 'sync-recovery', 'incoming.tsx');
    await eventually('the recovery copy at the teammate', () => existsSync(recovery), 30_000);
    expect(read(recovery) ?? '').toContain('mine while offline');
    expect(read(theirs) ?? '').toContain('theirs right after'); // its own save is kept, not overwritten
    // this Mac's save is the project's: it stays here, and nothing is held on this side
    expect(read(mine) ?? '').toContain('mine while offline');
    await openSyncDetails();
    expect(await (await $(tid(`diag-sync-conflict-${slug}`))).isExisting()).toBe(false);
    await capture('12a-offline-first-wins-held-at-teammate');
    await closeDiagnostics();
  });

  it('9 · the teammate saved offline, this Mac right after: Sync details holds both here, Keep both keeps both', async () => {
    // S11.12 (06 ad-syncd). The file-level conflict of the sync plane, on THIS side: the teammate's change was queued
    // while the server was away and is accepted first; this Mac's overlapping save then meets a newer head. Nothing is
    // overwritten: the runtime holds `source-conflict-<slug>` and the card sits under Needs you until the person
    // chooses. Keep both = the project's version becomes the canvas, this Mac's becomes a new canvas "<name> this Mac"
    // (S9.24's Keep both is per sticky, on the board).
    const t = TEAM as NonNullable<typeof TEAM>;
    const ui = (root: string) => join(root, '.design', 'ui');
    const mine = join(ui(t.managedDir), 'welcome.tsx');
    const theirs = join(ui(t.teammate), 'welcome.tsx');
    const copyAt = (root: string) =>
      readdirSync(ui(root)).find((f) => /^welcome this Mac.*\.tsx$/.test(f)) ?? null;
    await closeDiagnostics();
    await settleMotion();

    hubAway(t, 'pause');
    try {
      writeFileSync(theirs, canvas('Welcome, theirs while offline'));
      // the teammate's studio has no status line: its `_sync.json` says when the save is queued for the server
      await eventually(
        'the teammate’s save to be queued while the server is away',
        () => (syncFileOf(t.teammate)?.accepted?.pending ?? 0) > 0,
        60_000
      );
    } finally {
      hubBack(t, 'pause');
    }
    // this Mac saves right after the server is back
    writeFileSync(mine, canvas('Welcome, mine right after'));

    await openSyncDetails();
    const card = await $(tid('diag-sync-conflict-ui-welcome'));
    await card.waitForDisplayed({ timeout: 120_000 }).catch(() => {
      const h1 = (p: string) => /<h1[^>]*>([^<]*)</.exec(read(p) ?? '')?.[1] ?? '(none)';
      const held = (root: string) =>
        JSON.stringify((syncFileOf(root)?.conflicts ?? []).map((c) => c.slug));
      throw new Error(
        `no conflict card here — this Mac: "${h1(mine)}" holds ${held(t.managedDir)}; teammate: "${h1(theirs)}" holds ${held(t.teammate)}`
      );
    });
    expect(await card.getText()).toContain('changed here and in the cloud.');
    expect(await card.getText()).toContain('Both versions are kept until you choose.');
    expect(await (await $(tid('diag-sync-need-word'))).getText()).toMatch(/need(s)? you/);
    await capture('12-sync-details-conflict-card');

    // Compare: what differs, Yours / Cloud, without choosing anything
    await (await $(tid('diag-sync-compare-ui-welcome'))).click();
    const lines = await $(tid('diag-sync-compare-lines-ui-welcome'));
    await lines.waitForDisplayed({ timeout: 10_000 });
    const compared = await lines.getText();
    expect(compared).toContain('mine right after');
    expect(compared).toContain('theirs while offline');
    expect(read(mine) ?? '').toContain('mine right after'); // still only looking
    await capture('13-sync-details-compare');

    await (await $(tid('diag-sync-keep-both-ui-welcome'))).click();
    await card.waitForDisplayed({ reverse: true, timeout: 30_000 });

    // the project's (the teammate's) is the canvas, mine is a sibling canvas - here ...
    await eventually(
      'the teammate’s version as the canvas on this Mac',
      () => (read(mine) ?? '').includes('theirs while offline'),
      60_000
    );
    await eventually('a "this Mac" copy beside it', () => copyAt(t.managedDir) !== null, 60_000);
    expect(read(join(ui(t.managedDir), copyAt(t.managedDir) as string)) ?? '').toContain(
      'mine right after'
    );
    // ... and, the asymmetric direction, at the teammate: the copy is a new canvas there too
    await eventually(
      'the "this Mac" copy at the teammate',
      () => {
        const f = copyAt(t.teammate);
        return !!f && (read(join(ui(t.teammate), f)) ?? '').includes('mine right after');
      },
      120_000
    );
    expect(read(theirs) ?? '').toContain('theirs while offline');
    // the canvas list names the copy (a new row, the original untouched)
    await closeDiagnostics();
    await (await canvasRow('canvas-row-ui-welcome')).waitForDisplayed({ timeout: 30_000 });
    await capture('14-kept-both-canvas-list');
  });

  it('9b · the reverse race: the teammate edits first, this Mac second - nothing is held here', async () => {
    // Test sync in both directions: the side that wins the race above loses this one.
    const t = TEAM as NonNullable<typeof TEAM>;
    const mine = join(t.managedDir, '.design', 'ui', 'welcome.tsx');
    const theirs = join(t.teammate, '.design', 'ui', 'welcome.tsx');
    writeFileSync(theirs, canvas('Welcome, teammate first'));
    await eventually('the teammate’s edit on this Mac', () =>
      (read(mine) ?? '').includes('teammate first')
    );
    await browser.pause(1_500);
    writeFileSync(mine, canvas('Welcome, designer second'));
    await eventually(
      'the designer’s edit at the teammate',
      () => (read(theirs) ?? '').includes('designer second'),
      120_000
    );
    await openSyncDetails();
    expect(await (await $(tid('diag-sync-conflict-ui-welcome'))).isExisting()).toBe(false);
    expect(await (await $(tid('diag-sync-need-word'))).isExisting()).toBe(false);
    await capture('15-reverse-race-no-card');
    await closeDiagnostics();
  });

  it('10 · Resync from Diagnostics > Advanced: the trace, the result sentence, the log line', async () => {
    // S11.11 (06 ad-trace). One Resync, three places that must agree: the card in Diagnostics > Sync
    // ("Resyncing... 1 204 of 1 318"), the result sentence under it, and the line in Diagnostics > Logs
    // (the Sync filter). A real hub with real files; the numbers differ per run, the shapes do not.
    await closeDiagnostics();
    await pressDiagnosticsAdvancedRow('sync.resync');
    await openSyncDetails();

    const card = await $(tid('diag-resync'));
    await card.waitForExist({ timeout: 30_000 });
    // running: the bar and "Resyncing..." (with "n of m" once the file count is known); a quick cycle may
    // already be done, which is the same card in its other state
    if ((await card.getAttribute('data-state')) === 'running') {
      expect(await (await $(tid('diag-resync-progress'))).getText()).toMatch(
        /^Resyncing…( [\d ]+ of [\d ]+)?$/
      );
      await capture('16-resync-running');
    }
    await browser.waitUntil(async () => (await card.getAttribute('data-state')) !== 'running', {
      timeout: 120_000,
      timeoutMsg: 'Resync never finished',
    });
    const result = await (await $(tid('diag-resync-result'))).getText();
    expect(result).toMatch(/^Resync (done — .+|stopped early — .+)\.$/);
    await capture('17-resync-result');

    // the log line: "resync · 1 318 checked · 3 sent · 0 conflicts" under the Sync source
    // Sync opens alone now (no tabs): the log is one menu hop away — Menu > Diagnostics > Logs.
    await browser.keys('Escape');
    await (await $(tid('project-pill'))).click();
    await (await $(tid('project-menu-row-sub-diagnostics'))).click();
    await (await $(tid('project-menu-row-diag.logs'))).click();
    await (await $(tid('diag-logs-filter-sync'))).click();
    const lines = await $(tid('diag-logs-lines'));
    await lines.waitForDisplayed({ timeout: 10_000 });
    await browser.waitUntil(
      async () =>
        /resync · [\d ]+ checked · [\d ]+ sent · [\d ]+ conflicts/.test(await lines.getText()),
      { timeout: 15_000, timeoutMsg: 'the resync log line never reached Diagnostics > Logs' }
    );
    await capture('18-resync-log-line');
    await closeDiagnostics();
  });

  // ── P8 test round G1b — sync, offline, status words (01 cf-status-words · cf-offline-create, 06 ad-edge-sync ·
  //    ad-edge-where offline column). The hub is a real local one: stopped (connection refused), restarted on the
  //    same port with the same store, once with a write ceiling so it answers 429 + Retry-After.
  after(() => {
    restarted?.stop();
    restarted = null;
  });

  it('11 · cf-status-words: Saved, then Syncing… while a change waits — the exact words, never a control', async () => {
    const t = TEAM as NonNullable<typeof TEAM>;
    const mine = join(t.managedDir, '.design', 'ui', 'welcome.tsx');
    const theirs = join(t.teammate, '.design', 'ui', 'welcome.tsx');
    await closeDiagnostics();
    await eventually('Saved', async () => (await statusWord())?.status === 'saved', 120_000);
    const saved = await statusWord();
    expect(saved).toEqual({ status: 'saved', text: 'Saved', control: false });
    await capture('19-status-saved');

    // held, not dropped (a paused container keeps the connection as SIGSTOP does): the change waits
    hubAway(t, 'pause');
    try {
      writeFileSync(mine, canvas('Welcome, on its way up'));
      await eventually('Syncing…', async () => (await statusWord())?.status === 'syncing', 60_000);
      expect(await statusWord()).toEqual({ status: 'syncing', text: 'Syncing…', control: false });
      // shown, never operated: no Retry beside the word while nothing has failed
      expect(await $(tid('share-cluster-retry')).isExisting()).toBe(false);
      await capture('20-status-syncing');
    } finally {
      hubBack(t, 'pause');
    }
    await eventually(
      'the change at the teammate',
      () => (read(theirs) ?? '').includes('on its way up'),
      120_000
    );
    await eventually('Saved again', async () => (await statusWord())?.status === 'saved', 120_000);
  });

  it('12 · cf-offline-create: the hub is gone — Offline, ⌘N still makes a canvas, the prompt is queued and sends on return', async () => {
    const t = TEAM as NonNullable<typeof TEAM>;
    await stopHub(t);
    // the REAL hub state, before the page is told anything: the cluster's fourth word
    await eventually(
      'Offline — kept on this Mac',
      async () => (await statusWord())?.status === 'offline',
      150_000
    );
    expect(await statusWord()).toEqual({
      status: 'offline',
      text: 'Offline — kept on this Mac',
      control: false,
    });
    await capture('21-status-offline');

    // ⌘N still makes a canvas, kept on this Mac
    const before = canvasesIn(t.managedDir);
    await settleMotion();
    await browser.keys(['Meta', 'n']);
    let made = '';
    await eventually('a new canvas on this Mac', () => {
      made = canvasesIn(t.managedDir).find((c) => !before.includes(c)) ?? '';
      return made !== '';
    });
    await (await $(tid('empty-canvas'))).waitForDisplayed({ timeout: 60_000 });
    expect(canvasesIn(t.teammate)).not.toContain(made);

    // Ask AI stays on; the prompt waits in the outbox on the `hub` gate
    await openAssistant();
    const input = await (await $(tid('chat-composer'))).$('.chat-input');
    await input.waitForDisplayed({ timeout: 30_000 });
    await input.click();
    await input.addValue('Three reel covers for Krpole v pohybu');
    await (await $('[aria-label="Send message"]')).click();
    const queued = await $(tid('ai-queued-line'));
    await queued.waitForDisplayed({ timeout: 30_000 });
    expect((await queued.getText()).trim()).toBe('Queued — sends when this Mac is online.');
    expect((await (await $(tid('ai-offline-line'))).getText()).trim()).toBe(
      'AI is back when this Mac is online.'
    );
    const waiting = intentsOf(t.managedDir).filter(
      (r) => r.kind === 'ai.prompt' && r.state === 'queued'
    );
    expect(waiting.length).toBe(1);
    expect(waiting[0].gates?.[0]).toBe('hub');
    // the board draws the queued prompt with no follow-up chips under it: nothing has been answered yet
    await (await $(tid('ai-suggest'))).waitForExist({ reverse: true, timeout: 15_000 });

    // the hub gate alone — the page still believes this Mac is online — already draws the empty canvas's
    // offline line: the empty canvas and the queued card read the same truth
    expect(await browser.execute(() => navigator.onLine)).toBe(true);
    const hubLine = await $(tid('empty-canvas-offline'));
    await hubLine.waitForDisplayed({ timeout: 30_000 });
    expect((await hubLine.getText()).trim()).toBe('AI is back when this Mac is online.');
    expect(await (await $(tid('empty-canvas'))).getText()).toContain('Your canvas is ready.');
    await capture('22a-hub-away-empty-canvas-line');

    // no internet at all: the page hears it too — the line and the word stay
    await pageOffline(true);
    try {
      const line = await $(tid('empty-canvas-offline'));
      await line.waitForDisplayed({ timeout: 10_000 });
      expect((await line.getText()).trim()).toBe('AI is back when this Mac is online.');
      expect(await (await $(tid('empty-canvas'))).getText()).toContain('Your canvas is ready.');
      expect(await statusWord()).toEqual({
        status: 'offline',
        text: 'Offline — kept on this Mac',
        control: false,
      });
      await capture('22-offline-new-canvas-queued-prompt');

      // 06 ad-edge-where, the Offline column: Resync now is greyed (only what needs the internet), not hidden
      await (await $(tid('project-pill'))).click();
      await (await $(tid('project-menu-row-sub-diagnostics'))).click();
      const advanced = await $(`${tid('project-menu-sub-diagnostics')} [data-sub="Advanced"]`);
      await advanced.waitForDisplayed({ timeout: 10_000 });
      await advanced.click();
      const resync = await $(tid('project-menu-row-sync.resync'));
      await resync.waitForDisplayed({ timeout: 10_000 });
      const grey = await browser.execute((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        return el
          ? {
              disabled:
                el.getAttribute('aria-disabled') === 'true' ||
                (el as HTMLButtonElement).disabled === true,
              text: (el.textContent ?? '').trim(),
            }
          : null;
      }, tid('project-menu-row-sync.resync'));
      await capture('23-where-offline-resync-greyed');
      expect(grey?.disabled).toBe(true);
      await browser.keys('Escape');
      await browser.keys('Escape');
    } finally {
      await pageOffline(false);
    }

    // back: the same hub, the same port — the canvas goes up and the prompt sends by itself
    await startHub(t);
    await eventually(
      'Saved after the hub came back',
      async () => (await statusWord())?.status === 'saved',
      180_000
    );
    await eventually(
      'the new canvas at the teammate',
      () => canvasesIn(t.teammate).includes(made),
      120_000
    );
    await eventually(
      'the queued prompt sent',
      () => !intentsOf(t.managedDir).some((r) => r.kind === 'ai.prompt' && r.state === 'queued'),
      120_000
    );
    await (await $(tid('ai-queued-line'))).waitForExist({ reverse: true, timeout: 60_000 });
    await capture('24-back-online-prompt-sent');
  });

  // 13 · ad-edge-sync (the 429 callout) moved to team-cell.e2e.ts: this lane's hub has no checkout, so every file
  // write is a 405 before any rate check; the cell-shaped hub there accepts them.
});
