import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';

import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';

/**
 * cloud-attach (Cloud Phase 23 C4 + Phase 17) — the CloudBar lane end to end,
 * DOM-driven, control plane + cell stubbed by wdio.cloud.conf.ts (which
 * primes MAUDE_CLOUD_URL/MAUDE_CLOUD_CONFIG/HUBS_CONFIG_PATH before the app
 * spawns, so no real account or credential is ever touched).
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
 *
 * Note what makes scenario 4 quiet: the stub's handoff exchange returns the
 * fixture folder's own name, an EXACT match. That is the only name-based verdict
 * allowed to pass without a warning — every stub address is
 * `http://127.0.0.1:<port>` and carries no project name, so the linkedHub half
 * never speaks here.
 */
const tid = (s: string) => `[data-testid="${s}"]`;
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_CONFIG = join(HERE, '..', 'fixtures', 'project', '.design', 'config.json');
const STUB_CODE = `mhc_${'a'.repeat(64)}`;

/** Only the sliver of the Tauri global this scenario reaches for. */
interface TauriGlobal {
  event: { emit: (name: string, payload: unknown) => void };
}

const fixtures = createFixtureGuard('cloud-attach', [FIXTURE_CONFIG]);

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

  it('1 · signed out: the rail offers Maude Cloud sign-in', async () => {
    const signin = await $(tid('cloud-signin'));
    await signin.waitForDisplayed({ timeout: 30_000 });
    await capture('signed-out rail');
  });

  it('2 · sign-in completes without a human — the stub approves the first poll', async () => {
    await (await $(tid('cloud-signin'))).click();
    // The dialog may flash (the stub approves in one interval tick) — what
    // must hold is the END state: the account chip with the stub email.
    const account = await $(tid('cloud-account'));
    await account.waitForDisplayed({ timeout: 20_000 });
    expect(await account.getText()).toContain('e2e@example.com');
    await capture('signed in');
  });

  it('3 · the picker: member → Connect, viewer → View in the browser; Connect writes linkedHub', async () => {
    await (await $(tid('cloud-account'))).click();

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
    await browser.waitUntil(
      async () => {
        seen = await (await $(tid('cloud-bar'))).getText();
        return /Connecting to|Syncing with|Connected to/.test(seen);
      },
      { timeout: 20_000 }
    ).catch(() => {
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

  /** Emit the same event the Rust deep-link handler emits — the UI cannot tell
   *  the difference, which is the point. */
  const arrive = (project: string) =>
    browser.execute(
      (p: string, code: string) => {
        const tauri = (window as unknown as { __TAURI__: TauriGlobal }).__TAURI__;
        tauri.event.emit('maude://deep-link', `maude://open/${p}?code=${code}`);
      },
      project,
      STUB_CODE
    );

  it('4 · a maude:// deep link explains both sides, then the one-time code attaches', async () => {
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
    await browser.waitUntil(
      async () => {
        seen = await (await $(tid('cloud-bar'))).getText();
        return /Connecting to|Syncing with|Connected to/.test(seen);
      },
      { timeout: 20_000 }
    ).catch(() => {
      throw new Error(`the deep-link attach note never appeared — the bar said: ${seen.slice(0, 300)}`);
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
    await browser.waitUntil(
      async () => (await (await $(tid('cloud-bar'))).getText()).includes('Nothing was connected'),
      { timeout: 20_000, timeoutMsg: 'the claimed↔actual refusal never surfaced' }
    );
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
    // This stub has NO Yjs hub behind it — the control plane is faked and the
    // WS upgrade goes nowhere. So the honest terminal state here is
    // "unreachable", and reaching it is the proof the sentence is live: an
    // intention-derived string could never have arrived at it.
    await (await $(tid('cloud-account'))).click();
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
    await browser.waitUntil(
      async () =>
        // `Not reachable: <project>.` is the offline sentence `presentation.ts`
        // actually writes; the lowercase `unreachable` this used to look for
        // only ever appears as a SUFFIX on the refusal case, so the plain
        // offline outcome — the one this stub always produces — could never
        // match and the step timed out on a state that was already terminal.
        /Synced with|Not reachable|unreachable|were refused by|nothing to sync yet/.test(
          await note.getText()
        ),
      { timeout: 60_000, timeoutMsg: 'the connect note never reached a terminal state' }
    );
    const text = await note.getText();
    expect(text).not.toContain('Connecting to');

    // And the terminal state names the move. `title` carries it (the rail
    // truncates), so an empty one means the person was told a state and left to
    // work out the next step themselves — the whole complaint.
    const title = await note.getAttribute('title');
    expect(title.length).toBeGreaterThan(text.length - 1);
    expect(/—|resumes by itself|Reconnect|Open one|Create a canvas/.test(title)).toBe(true);
    await capture('connect note, terminal state');
  });

  it('8 · the note is a live region, so the transition is heard and not only seen', async () => {
    // The sentence CHANGES now. A screen-reader user who is not looking at the
    // rail has to be told, or the liveness is a sighted-only feature.
    const note = await $(tid('cloud-connect-note'));
    expect(await note.getAttribute('aria-live')).toBe('polite');
    expect(await note.getAttribute('role')).toBe('status');
  });

  it('9 · Resync re-runs the WHOLE sync from the panel, and the app survives it', async () => {
    // feature-sync-resync-and-out-of-process-sweep. Two things are proven here
    // that no unit test can reach:
    //
    //   • the control is wired to the whole-sync route in the PACKAGED client
    //     bundle (the committed artifact is what ships — a rebuild forgotten in
    //     the last task ships a UI without its own button);
    //   • pressing it leaves the app ALIVE. Resync tears down every provider,
    //     re-authenticates every document and re-fires the asset sweep — the
    //     exact sequence that used to take the dev server down with it. The
    //     canvas list still rendering afterwards IS the assertion.
    const chip = await $(tid('open-sync'));
    await chip.waitForDisplayed({ timeout: 30_000 });
    await chip.click();

    // `waitForExist`, not `waitForDisplayed` — the right dock in this harness's
    // window geometry is the same one `shell-parity` had to assert existence on.
    const panel = await $(tid('sync-panel'));
    await panel.waitForExist({ timeout: 15_000 });
    const resync = await $(tid('sync-resync'));
    await resync.waitForExist({ timeout: 10_000 });
    expect(await resync.isEnabled()).toBe(true);
    await capture('sync panel with Resync');

    await resync.click();
    // It refuses a second press — while the cycle runs AND through the
    // cooldown after it, so an impatient person cannot pin their own hub's
    // rate limit (DDR-102: a restart is one WS auth per document).
    await browser.waitUntil(async () => !(await resync.isEnabled()), {
      timeout: 15_000,
      timeoutMsg: 'Resync stayed pressable — the cycle/cooldown guard is gone',
    });
    await capture('resync in flight');

    // The app is still an app: the canvas list is there, and the panel is still
    // rendering sync state rather than a blank aside.
    await (await $(tid('canvas-list'))).waitForDisplayed({ timeout: 20_000 });
    expect((await panel.getText()).length).toBeGreaterThan(0);
    await capture('after resync — the studio is still up');
  });

  it('10 · a cloud project opens as its OWN copy — no folder chosen (plan T21/T22)', async () => {
    // The project-switcher way in: Maude Cloud (already signed in above) lists
    // the account's projects; Open makes the managed copy and switches to it.
    const trigger = await $(tid('repo-switcher-trigger'));
    await trigger.waitForDisplayed({ timeout: 30_000 });
    await trigger.click();
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
