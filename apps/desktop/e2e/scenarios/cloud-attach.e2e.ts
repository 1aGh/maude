import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';

import { closeDiagnostics, openSyncDetails, pressDiagnosticsAdvancedRow } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { invokeTauri } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';
import { openSwitcher } from '../helpers/switcher';
import { canvasRow } from '../helpers/tree';

/**
 * cloud-attach (Cloud Phase 23 C4 + Phase 17) — the CloudBar lane end to end,
 * DOM-driven, control plane stubbed and cell = a LOCAL throwaway hub, both by wdio.cloud.conf.ts (which
 * primes MAUDE_CLOUD_URL/MAUDE_CLOUD_CONFIG/HUBS_CONFIG_PATH before the app
 * spawns, so no real account, hub or credential is ever touched).
 *
 * Proven here:
 *   1. sign-in flips the rail to the account email without a human (the stub
 *      approves the first poll);
 *   2. the picker lists a member project as Connect and a VIEWER project as
 *      "View in the browser" (Phase 17 T4 — no dead menus);
 *   3. Connect writes `linkedHub` into the fixture project's config — the
 *      exact state `maude design link` writes;
 *   4. a maude:// deep link surfaces the explicit DECISION MODAL — naming both
 *      sides and what syncs — and the one-time code attach completes (the same
 *      `maude://deep-link` event the Rust handler emits; OS scheme registration
 *      is DDR-177 smoke);
 *   5. a name that merely RESEMBLES the folder still warns — after the attacker
 *      pass, containment no longer buys silence (the project id is registerable
 *      by anyone, so "contains your folder name" was the attacker's off-switch);
 *   6. a link naming an unrelated project warns, demotes connecting to "Connect
 *      anyway", and is still refused server-side by the claimed↔actual check.
 *   2b (S9.20b). local → cloud: a LOCAL project's Share offers Move to cloud; the window's own
 *      click creates the cloud project, links the folder (linkedHub), and Settings › Account then
 *      reads "Free trial · 12 days left" from the stub's /api/home. The step unlinks again
 *      (`/_api/cloud/detach`) so step 3 still starts from a local folder.
 *      WRITTEN, NOT YET RUN on a desktop build (S9.20b hand-back).
 *
 * V2-4.7a moved the account (sign-in, the email, the projects) from the left panel's footer into
 * Settings › Connections — the footer's CloudBar is now an invisible `cloud-host` that only answers
 * maude:// links. So every account step first opens Settings (the project pill → Settings…) and
 * its Connections section (V2-4.7c); the deep-link dialogs still come from the host.
 *
 * Note what makes scenario 4 quiet: the stub's handoff exchange returns the
 * fixture folder's own name, an EXACT match. That is the only name-based verdict
 * allowed to pass without a warning — every stub address is
 * `http://127.0.0.1:<port>` and carries no project name, so the linkedHub half
 * never speaks here.
 */
const tid = (s: string) => `[data-testid="${s}"]`;
const HERE = dirname(fileURLToPath(import.meta.url));
// The lane runs on a throwaway copy of the fixture (wdio.cloud.conf.ts, p8-e2e-fix-r10): the project the app opened.
const FIXTURE_CONFIG = join(
  process.env.MAUDE_E2E_CLOUD_ROOT ?? join(HERE, '..', 'fixtures', 'project'),
  '.design',
  'config.json'
);
const STUB_CODE = `mhc_${'a'.repeat(64)}`;

const fixtures = createFixtureGuard('cloud-attach', [FIXTURE_CONFIG]);

/** Settings › Connections, opened from the one menu (project pill → Settings…) unless it is up. */
async function openConnections() {
  const panel = await $(tid('settings-panel-connections'));
  if (await panel.isDisplayed().catch(() => false)) return;
  if (!(await (await $(tid('settings-sheet'))).isExisting())) {
    await (await $(tid('project-pill'))).click();
    const row = await $(tid('project-menu-row-settings.open'));
    await row.waitForDisplayed({ timeout: 10_000 });
    await row.click();
    await (await $(tid('settings-sheet'))).waitForDisplayed({ timeout: 10_000 });
  }
  await (await $(tid('settings-tab-connections'))).click();
  await panel.waitForDisplayed({ timeout: 10_000 });
}

/** Close the sheet so a deep-link dialog (from the footer's host) is the top layer. */
async function closeSettings() {
  const close = await $(tid('settings-close'));
  if (await close.isExisting()) await close.click();
}

/**
 * The connect / refusal sentence wherever this build says it: the Settings instance's account
 * block (`cloud-bar`) or the footer host (`cloud-host`) that answered the deep link.
 */
async function cloudText() {
  let text = '';
  for (const id of ['cloud-bar', 'cloud-host']) {
    const el = await $(tid(id));
    if (await el.isExisting()) text += ` ${await el.getText()}`;
  }
  return text;
}

describe('cloud-attach — sign-in, picker, attach, deep-link decision (stubbed)', () => {
  before(async function () {
    startReport('cloud-attach — Maude Cloud sign-in + attach, control plane stubbed');
    if (!process.env.MAUDE_E2E_CLOUD_STUB) this.skip();
    fixtures.snapshot();
    await waitForSidecar();
  });

  beforeEach(async () => {
    // WKWebView pauses CSS animations while the test window is occluded, and a
    // dialog frozen on its entry keyframe (opacity 0) is "not displayed" though
    // it is open. Motion is not what these steps test: end states only.
    await browser
      .execute(() => {
        if (document.getElementById('e2e-no-motion')) return;
        const style = document.createElement('style');
        style.id = 'e2e-no-motion';
        style.textContent =
          '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important}';
        document.head.appendChild(style);
      })
      .catch(() => {});
  });

  afterEach(async function () {
    // A failed step leaves its own picture — the assertion says what was
    // missing, the screenshot says what was there instead.
    if (this.currentTest?.state !== 'failed') return;
    await capture(`FAILED ${this.currentTest.title.slice(0, 40)}`).catch(() => {});
    const dialogs = await browser
      .execute(() =>
        Array.from(document.querySelectorAll('[role="dialog"], [data-testid$="-dialog"]'))
          .slice(0, 6)
          .map((d) => {
            const r = d.getBoundingClientRect();
            const cs = getComputedStyle(d);
            return `${d.getAttribute('data-testid') ?? d.className} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} op=${cs.opacity} vis=${cs.visibility} disp=${cs.display}`;
          })
      )
      .catch(() => []);
    console.log(`[cloud-attach] dialogs at failure: ${JSON.stringify(dialogs)}`);
  });

  after(() => {
    // The fixture must stay deterministic for every other suite — undo the
    // linkedHub this run wrote. Survives a killed run too (fixture-guard).
    fixtures.restore();
  });

  it('1 · signed out: Settings › Connections offers Maude Cloud sign-in', async () => {
    await openConnections();
    const signin = await $(tid('cloud-signin'));
    await signin.waitForDisplayed({ timeout: 30_000 });
    await capture('signed-out, Settings › Connections');
  });

  it('2 · sign-in completes without a human — the stub approves the first poll', async () => {
    await openConnections();
    await (await $(tid('cloud-signin'))).click();
    // The dialog may flash (the stub approves in one interval tick) — what
    // must hold is the END state: the account chip with the stub email.
    const account = await $(tid('cloud-account'));
    await account.waitForDisplayed({ timeout: 20_000 });
    expect(await account.getText()).toContain('e2e@example.com');
    await capture('signed in');
  });

  it('2b · local → cloud: Share › Move to cloud links the folder; Settings says the plan', async () => {
    await closeSettings();
    // Share needs an open canvas (share-cluster-share is aria-disabled without one).
    await (await canvasRow('canvas-row-ui-smoke')).click();
    const share = await $(tid('share-cluster-share'));
    await share.waitForDisplayed({ timeout: 30_000 });
    await share.click();
    const confirm = await $(tid('share-move-confirm'));
    await confirm.waitForDisplayed({ timeout: 15_000 });
    await capture('local project — Share offers Move to cloud');
    // A real click: the move route needs the window's own `Sec-Fetch-Site: same-origin`.
    await confirm.click();
    await browser.waitUntil(
      () => {
        const cfg = JSON.parse(readFileSync(FIXTURE_CONFIG, 'utf8'));
        return typeof cfg.linkedHub?.url === 'string';
      },
      { timeout: 60_000, timeoutMsg: 'Move to cloud never wrote linkedHub' }
    );
    const moved = await $(tid('share-moved'));
    await moved.waitForDisplayed({ timeout: 15_000 });
    // linkedHub lands first; the card says "Setting up the cloud project…" until the stub answers, then the final words
    await browser.waitUntil(async () => (await moved.getText()).includes('Moved to the cloud'), {
      timeout: 30_000,
      timeoutMsg: 'the card never reached its final words ("Moved to the cloud")',
    });
    await capture('moved to the cloud');
    await (await $(tid('share-close'))).click();

    // Settings › General › Account: the plan words are the cloud's (stub /api/home), never a sum.
    await (await $(tid('project-pill'))).click();
    const row = await $(tid('project-menu-row-settings.open'));
    await row.waitForDisplayed({ timeout: 10_000 });
    await row.click();
    // The sheet re-opens on the section it was left on (settings-sheet.jsx `remembered()`) — Connections, after
    // steps 1–2 — and the Account block with the plan is General's.
    await (await $(tid('settings-tab-general'))).click();
    const plan = await $(tid('settings-account-plan'));
    await plan.waitForDisplayed({ timeout: 15_000 });
    expect(await plan.getText()).toBe('Free trial · 12 days left');
    await capture('Settings › Account — the plan from the cloud');
    await closeSettings();

    // Back to a local folder so step 3's picker still connects from scratch — the way a person does it, the linked
    // row's Disconnect in Settings › Connections (`connections.cloud-project-disconnect` → POST /_api/cloud/detach).
    // A detach posted from the page behind the panel's back left the panel's own link state on "Connected", so
    // step 3 read "Stub Project · Connected · Disconnect" where Connect should be.
    await openConnections();
    const disconnect = await $('[data-testid^="cloud-disconnect-"]');
    await disconnect.waitForDisplayed({ timeout: 15_000 });
    await disconnect.click();
    await browser.waitUntil(() => !JSON.parse(readFileSync(FIXTURE_CONFIG, 'utf8')).linkedHub, {
      timeout: 20_000,
      timeoutMsg: 'detach left linkedHub in the fixture',
    });
  });

  it('3 · the picker: member → Connect, viewer → View in the browser; Connect writes linkedHub', async () => {
    // Settings lists the projects inline under the account — no menu to open.
    await openConnections();

    const viewer = await $(tid('cloud-project-stub-gallery'));
    await viewer.waitForDisplayed({ timeout: 15_000 });
    expect(await viewer.getText()).toContain('View Stub Gallery in the browser');

    const member = await $(tid('cloud-project-stub-project'));
    expect(await member.getText()).toContain('Connect Stub Project');
    await capture('picker with member + viewer rows');
    await member.click();

    // The note reports an OUTCOME now (connecting / syncing / connected-but-…),
    // never "restart the studio server" — a task naming something a desktop
    // user cannot see. Which arm fires depends on what the fixture has to sync,
    // so assert the shape: this project, and a state we told the truth about.
    let seen = '';
    await browser
      .waitUntil(
        async () => {
          seen = await (await $(tid('cloud-bar'))).getText();
          return /Connecting to|Syncing with|Connected to/.test(seen);
        },
        { timeout: 20_000 }
      )
      .catch(() => {
        throw new Error(`the attach note never appeared — the bar said: ${seen.slice(0, 300)}`);
      });
    expect(await (await $(tid('cloud-bar'))).getText()).not.toContain('studio server');
    const cfg = JSON.parse(readFileSync(FIXTURE_CONFIG, 'utf8'));
    expect(cfg.linkedHub?.url).toContain('127.0.0.1');
    await capture('attached via picker');
  });

  /** Let the dialog's entry animation finish before an evidence shot. The
   *  `gi-dialog` family pops over `--dur-route` (280ms), and a capture fired the
   *  instant `waitForDisplayed` resolves catches it half-transparent — the
   *  assertions were green but the screenshots were unreadable. */
  const settled = () => browser.pause(450);

  /** Have the shell deliver the link to this window — the same park + event
   *  the Rust deep-link handler uses, so the UI cannot tell the difference.
   *  (Pages can no longer `emit`, V2-3.6 M5.) */
  const arrive = (project: string) =>
    invokeTauri('e2e_deliver_deep_link', { url: `maude://open/${project}?code=${STUB_CODE}` });

  it('4 · a maude:// deep link explains both sides, then the one-time code attaches', async () => {
    await closeSettings();
    // The fixture folder IS `project` — an exact identity match, the only
    // name-based verdict allowed to pass without a warning.
    await arrive('project');

    const dialog = await $(tid('cloud-deeplink-dialog'));
    await dialog.waitForDisplayed({ timeout: 15_000 });
    const text = await dialog.getText();
    // Both sides named, and what actually syncs said in plain words — the strip
    // this replaced said "Connect this project to X?" without ever saying which
    // project "this" was.
    expect(text).toContain('Connect to project?');
    expect(text).toContain('This folder');
    expect(text).toContain('Nothing else in this repo is uploaded');
    expect(await (await $(tid('cloud-deeplink-mismatch'))).isExisting()).toBe(false);
    const connect = await $(tid('cloud-deeplink-connect'));
    expect(await connect.getText()).toContain('Connect');
    expect(await connect.getText()).not.toContain('anyway');
    await settled();
    await capture('deep-link decision modal');

    await connect.click();
    let seen = '';
    await browser
      .waitUntil(
        async () => {
          seen = await cloudText();
          return /Connecting to|Syncing with|Connected to/.test(seen);
        },
        { timeout: 20_000 }
      )
      .catch(() => {
        throw new Error(
          `the deep-link attach note never appeared — the bar said: ${seen.slice(0, 300)}`
        );
      });
    await capture('attached via deep link');
  });

  it('5 · a name that merely RESEMBLES this folder still warns — silence is exact-match only', async () => {
    // The attacker-chosen-name case (B1): `project-archive` contains the folder
    // name, which used to buy silence. Two similar names are two workspaces.
    await arrive('project-archive');

    const warn = await $(tid('cloud-deeplink-mismatch'));
    await warn.waitForDisplayed({ timeout: 15_000 });
    expect(await warn.getText()).toContain('different workspaces');
    expect(await (await $(tid('cloud-deeplink-connect'))).getText()).toContain('Connect anyway');
    await settled();
    await capture('near-match still warns');

    // Declining is the cheap move and must leave nothing behind.
    await (await $(tid('cloud-deeplink-dismiss'))).click();
    await browser.waitUntil(
      async () => !(await (await $(tid('cloud-deeplink-dialog'))).isExisting()),
      {
        timeout: 10_000,
        timeoutMsg: 'the dialog outlived "Not now"',
      }
    );
  });

  it('6 · a link naming a project this folder is not warns, and connecting anyway is refused', async () => {
    // The reported near-miss: one project open, "Open in Maude" pressed on
    // another. The modal must say so BEFORE the click — and the server's
    // claimed↔actual check must still be there behind it, because the hint is
    // only a hint. Here both fire: the stub exchange opens `stub-project`, so
    // the 409 refuses a consent given for a different name.
    await arrive('other-workspace');

    const dialog = await $(tid('cloud-deeplink-dialog'));
    await dialog.waitForDisplayed({ timeout: 15_000 });
    const warn = await $(tid('cloud-deeplink-mismatch'));
    await warn.waitForDisplayed({ timeout: 10_000 });
    expect(await warn.getText()).toContain('not other-workspace');

    const connect = await $(tid('cloud-deeplink-connect'));
    // Connecting is demoted to the deliberate move, and says as much.
    expect(await connect.getText()).toContain('Connect anyway');
    await settled();
    await capture('deep-link mismatch warning');

    await connect.click();
    await browser.waitUntil(async () => (await cloudText()).includes('Nothing was connected'), {
      timeout: 20_000,
      timeoutMsg: 'the claimed↔actual refusal never surfaced',
    });
    // The link that was already there is untouched — a refused attach writes
    // nothing.
    const cfg = JSON.parse(readFileSync(FIXTURE_CONFIG, 'utf8'));
    expect(cfg.linkedHub?.url).toContain('127.0.0.1');
    await capture('mismatched claim refused');
  });

  it('7 · the connect note reaches a TERMINAL state — it does not sit on "syncing" forever', async () => {
    // The reported bug, as a scenario. The note used to be computed once, from
    // the attach response, at the instant the confirm dialog closed: it said
    // "Syncing with X — 75 canvases." and stayed there through every outcome,
    // including a link that never connected at all. Nothing in the DOM ever
    // changed again, which is exactly what "reálně se nic nestane" looked like.
    //
    // The control plane is faked but the cell behind it is a real LOCAL hub
    // (wdio.cloud.conf.ts), so the honest terminal state is usually "Synced
    // with …" — and any terminal sentence is the proof the line is live: an
    // intention-derived string could never have arrived at it.
    await openConnections();
    const member = await $(tid('cloud-project-stub-project'));
    await member.waitForDisplayed({ timeout: 15_000 });
    await member.click();

    const note = await $(tid('cloud-connect-note'));
    await note.waitForDisplayed({ timeout: 20_000 });
    await capture('connect note, in flight');

    // The grace window is 30s before a silent link is called offline, so allow
    // for it plus the handshake attempts. Any of the four terminal shapes is a
    // pass — which one depends on the fixture, and pinning that would make this
    // a test of the fixture rather than of the pipeline.
    let said = '';
    // `Not reachable: <project>.` is the offline sentence `presentation.ts` actually writes; the lowercase
    // `unreachable` only ever appears as a SUFFIX on the refusal case (the plain offline outcome — the one this stub
    // always produces — could never match it, and the step timed out on a state that was already terminal)
    const terminal = async () => {
      said = await note.getText().catch(() => said);
      // …and the attention phase (presentation.ts `attention`: "A change needs / N changes need your attention in …"),
      // which waits for the person — terminal too (r5 full run: "3 media uploads failed" against the local hub)
      return /Synced with|Not reachable|unreachable|were refused by|nothing to sync yet|needs? your attention in/.test(
        said
      );
    };
    await browser.waitUntil(terminal, { timeout: 60_000 }).catch(() => {
      throw new Error(`the connect note never reached a terminal state (it said "${said}")`);
    });
    const text = await note.getText();
    expect(text).not.toContain('Connecting to');

    // And the terminal state names the move. `title` carries it (the rail
    // truncates), so an empty one means the person was told a state and left to
    // work out the next step themselves — the whole complaint.
    const title = (await note.getAttribute('title')) ?? '';
    expect(title.length).toBeGreaterThan(text.length - 1);
    // (the attention phase's move is "Open the Sync panel to see what is waiting and why.")
    expect(
      /—|resumes by itself|Reconnect|Open one|Create a canvas|Open the Sync panel/.test(title)
    ).toBe(true);
    await capture('connect note, terminal state');
  });

  it('8 · the note is a live region, so the transition is heard and not only seen', async () => {
    // The sentence CHANGES now. A screen-reader user who is not looking at the
    // rail has to be told, or the liveness is a sighted-only feature.
    const note = await $(tid('cloud-connect-note'));
    expect(await note.getAttribute('aria-live')).toBe('polite');
    expect(await note.getAttribute('role')).toBe('status');
  });

  it('9 · Resync re-runs the WHOLE sync from the menu, and the app survives it', async () => {
    // feature-sync-resync-and-out-of-process-sweep, moved by S11.12b: the v1 Sync panel (and its header
    // button, `sync-resync`) is retired, so Resync is the Diagnostics > Advanced row `sync.resync` and its
    // trace card `diag-resync` in Diagnostics > Sync (S11.11). Two things are proven here that no unit
    // test can reach:
    //
    //   - the row is wired to the whole-sync route in the PACKAGED client bundle (the committed
    //     artifact is what ships: a rebuild forgotten in the last task ships a UI without its button);
    //   - pressing it leaves the app ALIVE. Resync tears down every provider, re-authenticates every
    //     document and re-fires the asset sweep, the exact sequence that used to take the dev server
    //     down with it. The canvas list still rendering afterwards IS the assertion.
    await closeDiagnostics();
    await pressDiagnosticsAdvancedRow('sync.resync');
    await openSyncDetails();

    // `waitForExist`, not `waitForDisplayed`: the sheet in this harness's window geometry is the same
    // one `shell-parity` had to assert existence on.
    const panel = await $(tid('sync-panel'));
    await panel.waitForExist({ timeout: 15_000 });
    const card = await $(tid('diag-resync'));
    await card.waitForExist({ timeout: 30_000 });
    expect(['running', 'done', 'attention']).toContain(await card.getAttribute('data-state'));
    await capture('resync trace in Diagnostics');

    // The cycle ends in a sentence, never in silence.
    await browser.waitUntil(async () => (await card.getAttribute('data-state')) !== 'running', {
      timeout: 120_000,
      timeoutMsg: 'Resync never finished',
    });
    expect(await (await $(tid('diag-resync-result'))).getText()).toMatch(
      /^Resync (done|stopped early)/
    );

    // The app is still an app: the canvas list is there, and Sync details is still rendering sync state
    // rather than a blank sheet.
    await closeDiagnostics();
    await (await $(tid('canvas-list'))).waitForDisplayed({ timeout: 20_000 });
    await openSyncDetails();
    expect((await (await $(tid('sync-panel'))).getText()).length).toBeGreaterThan(0);
    await capture('after resync: the studio is still up');
    await closeDiagnostics();
  });

  it('10 · a cloud project opens as its OWN copy — no folder chosen (plan T21/T22)', async () => {
    // The project-switcher way in: Maude Cloud (already signed in above) lists
    // the account's projects; Open makes the managed copy and switches to it.
    await openSwitcher();
    await (await $(tid('switcher-open-team'))).click();
    const dialog = await $(tid('team-projects-dialog'));
    await dialog.waitForDisplayed({ timeout: 15_000 });
    const row = await $(tid('team-cloud-project-stub-project'));
    await row.waitForDisplayed({ timeout: 20_000 });
    // The viewer project offers the browser, not an Open that would be refused.
    expect(await (await $(tid('team-cloud-project-stub-gallery'))).getText()).toContain('View');
    await capture('team projects from Maude Cloud');
    await row.click();
    await browser.pause(6_000);
    await waitForSidecar();
    // Keyed by the PROJECT's server (the cell the cloud hands out) + id — not
    // by the cloud's own address — so look for the one `*--stub-project` copy.
    const root = join(homedir(), 'Library', 'Application Support', 'com.maude.app.e2e', 'projects');
    let copy = '';
    await browser
      .waitUntil(
        () => {
          const dir = existsSync(root)
            ? readdirSync(root).find((d) => d.endsWith('--stub-project'))
            : undefined;
          copy = dir ? join(root, dir, '.design', 'config.json') : '';
          return !!copy && existsSync(copy);
        },
        { timeout: 30_000 }
      )
      .catch(async () => {
        const err = await $(tid('team-error'));
        const why = (await err.isExisting()) ? await err.getText() : 'no error shown';
        throw new Error(`the managed copy was never created — ${why}`);
      });
    const cfg = JSON.parse(readFileSync(copy, 'utf8'));
    expect(cfg.managed?.projectId).toBe('stub-project');
    await capture('opened the cloud project as its own copy');
  });
});
