/**
 * WebdriverIO config — desktop E2E for the bundled Maude `.app` (Tauri v2 + WKWebView).
 *
 * Drives the REAL WKWebView DOM via @wdio/tauri-service's embedded provider
 * (Tauri's official E2E path; macOS embedded WebDriver server inside the app —
 * see the `desktop-e2e` skill + .ai/plans/feature-desktop-e2e-scenario-harness.md).
 * No computer-use: everything is DOM-driven via data-testid.
 *
 * Run: `pnpm test:e2e:desktop:build` (one-time / on source change) then
 *      `pnpm test:e2e:desktop`.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { browser } from '@wdio/globals';
import { bringAppToFront, keepAppInFront } from './helpers/app-front';
import { stopE2eApp } from './helpers/app-lifecycle';
import { isE2eConfigHome } from './helpers/config-home';
import {
  baselineFixtureTree,
  releaseFixtureTree,
  resetFixtureRuntime,
  restoreFixtureTree,
} from './helpers/fixture-tree';
import { pinCurrentWindow } from './helpers/windows';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── Specs that are NOT ours ───────────────────────────────────────────────
// Each of these has a dedicated wdio.<name>.conf.ts that supplies env the spec
// cannot run without (a stubbed control plane, a seeded git remote, a
// first-run-clean home, a second browser target). Sweeping them into the
// default `scenarios/**/*.e2e.ts` glob made `pnpm test:e2e:desktop` look like a
// "run everything" command while actually running those seven under the WRONG
// config — so they failed for missing env, not for a real defect.
const DEDICATED: Record<string, string> = {
  'acp-cold-start.e2e.ts': 'pnpm test:e2e:desktop:acp-cold-start',
  // P8 e2e live lanes: the AI panel's own contracts on the SCRIPTED fake agent + a signed-in claude stub (no model).
  'acp-capability-picker.e2e.ts': 'pnpm --filter @maude/desktop-e2e e2e:acp-fake',
  'acp-write-scope.e2e.ts': 'pnpm --filter @maude/desktop-e2e e2e:acp-fake',
  'cloud-attach.e2e.ts': 'pnpm test:e2e:desktop:cloud',
  'git-branch-switcher.e2e.ts': 'pnpm test:e2e:desktop:git',
  'git-lifecycle.e2e.ts': 'pnpm test:e2e:desktop:lifecycle',
  'git-switch-repos.e2e.ts': 'pnpm test:e2e:desktop:switchrepos',
  // An empty app-state (first launch = Home) + a seeded machine index.
  'home.e2e.ts': 'pnpm test:e2e:desktop:home',
  'onboarding.e2e.ts': 'pnpm test:e2e:desktop:onboarding',
  // Two projects (primary + secondary), one tab each.
  'project-tabs.e2e.ts': 'pnpm test:e2e:desktop:tabs',
  // The same two projects, a throwaway profile registry + a stubbed sign-in.
  'project-tabs-identity.e2e.ts': 'pnpm --filter @maude/desktop-e2e e2e:tabs-identity',
  'shell-parity.e2e.ts': 'pnpm test:e2e:desktop:parity',
  // Needs the canvas-origin split ON, which this config forces OFF below.
  'sidecar-respawn-canvas-switch.e2e.ts': 'pnpm test:e2e:desktop:sidecar-respawn',
  // A real hub + a seeding teammate studio + a first-run home.
  'team-project.e2e.ts': 'pnpm test:e2e:desktop:team-project',
  // A deployment that is already live, named explicitly — no default target.
  's20-deployment.e2e.ts': 'pnpm test:e2e:desktop:s20',
  // V2-3.9: open, quit, relaunch, twice — against one kept app-state.
  'relaunch.e2e.ts': 'pnpm test:e2e:desktop:relaunch',
  // S5.14: ⌘Q while AI works, then a relaunch — needs a signed-in `claude`.
  'ai-quit.e2e.ts': 'pnpm --filter @maude/desktop-e2e e2e:ai-quit',
  // S8.16: the sidecar must run the stub image provider (MAUDE_GENERATE_STUB=1) — no real provider is reached.
  'generate-takes.e2e.ts': 'pnpm --filter @maude/desktop-e2e e2e:generate-takes',
  // S8.17b: the Figma client answers from fixtures/figma (MAUDE_FIGMA_FIXTURE) — no Figma account, no network.
  'import-figma.e2e.ts': 'pnpm --filter @maude/desktop-e2e e2e:import-figma',
  // S9.17: a cloud cell tab's browser door — needs a cell.
  'cell-tab-browser-door.e2e.ts': 'pnpm --filter @maude/desktop-e2e e2e:cell-tab',
  // S10.8: a converted acme project seeded with one pending Accent change.
  'ds-review.e2e.ts': 'pnpm --filter @maude/desktop-e2e e2e:ds-review',
  // S10.9: the reach view ("Used in 5 canvases · Show"), against a project whose canvases use the Accent.
  'ds-reach.e2e.ts': 'pnpm --filter @maude/desktop-e2e e2e:ds-reach',
  'ds-edges.e2e.ts': 'pnpm --filter @maude/desktop-e2e e2e:ds-edges',
  // S10.12: the advanced DS surfaces, seeded.
  'ds-advanced.e2e.ts': 'pnpm --filter @maude/desktop-e2e e2e:ds-advanced',
  // S10.13: the DS library, against a stand-in hub (fixtures/ds-library-hub.ts).
  'ds-library.e2e.ts': 'pnpm --filter @maude/desktop-e2e e2e:ds-library',
  // S10.7: switching the project's DS, against seeded design systems.
  'ds-switch.e2e.ts': 'pnpm --filter @maude/desktop-e2e e2e:ds-switch',
  // S8: the handoff sheet, against its own seeded world.
  'handoff.e2e.ts': 'pnpm --filter @maude/desktop-e2e e2e:handoff',
  // S10.11: an outside DS change + a conflict pick, seeded.
  'ds-review-outside.e2e.ts': 'pnpm --filter @maude/desktop-e2e e2e:ds-outside',
  // S6.11: an invite link landing on Home, against a loopback cloud stub.
  'invite-landing.e2e.ts': 'pnpm --filter @maude/desktop-e2e e2e:invite-landing',
  // S6.16: the first-canvas journey — Home's world (first run, two seeded projects) + a FAKE ACP agent.
  'first-canvas.e2e.ts': 'pnpm --filter @maude/desktop-e2e e2e:first-canvas',
  // S9.21c: several accounts on one hub (V2-1.7 §7) — an explicit run file from the V2-8 runner.
  'share-roles.e2e.ts': 'pnpm --filter @maude/desktop-e2e e2e:share-roles',
};

// Drift tripwire. Adding a wdio.<name>.conf.ts without listing its spec above
// would silently put that spec back under this config — the exact bug this
// block exists to fix — so fail loud at load time instead.
{
  const confs = readdirSync(HERE).filter((f) => /^wdio\..+\.conf\.ts$/.test(f));
  const missingSpec = Object.keys(DEDICATED).filter((s) => !existsSync(join(HERE, 'scenarios', s)));
  if (missingSpec.length > 0) {
    throw new Error(
      `[wdio] DEDICATED names a spec that no longer exists: ${missingSpec.join(', ')}`
    );
  }
  // Every dedicated config's spec must be listed (two configs may share one spec, e.g. ds-review +
  // ds-review-master seed different worlds for the same scenario file).
  const unlisted = confs.filter((c) => {
    const m = readFileSync(join(HERE, c), 'utf8').match(
      /scenarios['"]?,\s*['"]([\w.-]+\.e2e\.ts)['"]|scenarios\/([\w.-]+\.e2e\.ts)/
    );
    const spec = m ? m[1] || m[2] : null;
    return !spec || !(spec in DEDICATED);
  });
  if (unlisted.length > 0) {
    throw new Error(
      `[wdio] dedicated config(s) whose spec is not excluded from the default glob — update DEDICATED in wdio.conf.ts:\n  ` +
        unlisted.join('\n  ')
    );
  }
}

// An explicit list rather than `exclude:` — every dedicated config does
// `{ ...base, specs: [theirSpec] }` WITHOUT touching `exclude`, so an inherited
// exclude list would have contained their own spec and left each of those
// suites running nothing at all.
const DEFAULT_SPECS = readdirSync(join(HERE, 'scenarios'))
  .filter((f) => f.endsWith('.e2e.ts') && !(f in DEDICATED))
  .sort()
  .map((f) => join(HERE, 'scenarios', f));

// ── Fixture + boot env ────────────────────────────────────────────────────
// MAUDE_PROJECT_ROOT short-circuits resolve_project_root() in the Rust shell,
// so the app opens our deterministic fixture instead of the welcome/first-run
// flow — no native dialog / OAuth needed for this pilot. NO_OPEN stops the
// dev-server from spawning a browser. MAUDE_CANVAS_ORIGIN_SPLIT=0 keeps the
// canvas iframe SAME-ORIGIN so WebDriver switchToFrame() works without the
// DDR-054/063 cross-origin barrier (open question 2 — revisit if a scenario
// must exercise the split-origin path).
process.env.MAUDE_PROJECT_ROOT = resolve(HERE, 'fixtures/project');
process.env.NO_OPEN = '1';
// Keep macOS's keychain prompt out of the run: a debug build is re-signed every
// time, so "Always Allow" never persists and each rebuild pops a modal that
// freezes the WKWebView — every WebDriver call then times out and the suite
// fails looking exactly like a broken bundle. Honored only under
// `debug_assertions` (keychain.rs), so no shipped build is affected.
process.env.MAUDE_E2E_NO_KEYCHAIN = '1';
// …and nothing in the process may reach the REAL keychain at all (V2-3.9): the token bridge
// (keychain.rs `start_token_bridge`) reads a profile's GitHub token whenever a project server
// asks for one — the github-backed tabs fixture does at boot — and that read raised macOS's
// SecurityAgent prompt over the app (a covered run). The in-memory store (debug builds only,
// installed first in lib.rs setup) routes every `keyring::Entry` in the app, so EVERY lane gets
// it. A lane that needs a signed-in profile signs in through `e2e_github_sign_in_as`.
process.env.MAUDE_E2E_FAKE_KEYCHAIN ??= '1';
// A native dialog is not DOM-reachable either: managed_project_open's
// "Open a team project from <host>?" confirm (V2-3.6 M3) answers Open under
// `debug_assertions` only (managed.rs).
process.env.MAUDE_E2E_CONFIRM_TEAM_SERVER = '1';
// The service's direct-eval client reads this env var independently of
// embeddedPort. Keep both aligned and allow concurrent worktrees to choose a port.
process.env.TAURI_WEBDRIVER_PORT ??= '4455';
if (process.env.MAUDE_CANVAS_ORIGIN_SPLIT === undefined) {
  process.env.MAUDE_CANVAS_ORIGIN_SPLIT = '0';
}

// ── A clean e2e identity per run ───────────────────────────────────────────
// Since V2-3.2 every window has a stable label → its own WebKit data store
// (`data_store_identifier`), and app-state v2 remembers a preferred port per
// project. A fixture project therefore gets the SAME origin and the SAME store
// on every run, and UI state an earlier run left behind (a collapsed file panel)
// silently changes the next one — the "repo-branch switcher never renders" reds.
// The product keeps that per-project state on purpose; the HARNESS starts clean:
// once in the launcher (below) and again before each session's app launch
// (`beforeSession`) — never at module load in a worker, which re-evaluates this
// file while an app may be running — and only ever inside the
// `com.maude.app.e2e` bundle-id dirs. MAUDE_E2E_KEEP_STATE=1 opts out.
export const E2E_BUNDLE_ID = 'com.maude.app.e2e';
// …and nothing under the person's real `~/.config/maude` may be read or written: `ui-prefs.ts` keeps the Advanced
// folds, panel layout and theme in `$XDG_CONFIG_HOME/maude/prefs.json`, so a default-lane run used to open every fold
// in the PERSON's prefs and carry them into the next spec (a fold one spec opened was open — its toggle then CLOSED
// it — in the next). A throwaway config home, shared by the launcher and its workers through the environment; a lane
// config that names its own `maude-e2e-*` home keeps it.
//
// An inherited home that is NOT one of ours is replaced, never adopted: the test-lane wrapper
// (scripts/v2-test-lane.sh) hands every job one `v2-lane-config.*` dir — and a full run is ONE job, so every lane
// (profiles, prefs, cloud.json) and every spec shared it, and `resetE2eAppState` (which only clears a `maude-e2e-*`
// prefs) never cleared it. The wrapper's prefs/cloud pointers into that dir follow the new home.
{
  const inherited = process.env.XDG_CONFIG_HOME ?? '';
  if (!isE2eConfigHome(inherited)) {
    const own = mkdtempSync(join(tmpdir(), 'maude-e2e-xdg-'));
    process.env.XDG_CONFIG_HOME = own;
    for (const [key, file] of [
      ['MAUDE_UI_PREFS_PATH', 'prefs.json'],
      ['MAUDE_CLOUD_CONFIG', 'cloud.json'],
    ] as const) {
      const cur = process.env[key];
      if (cur !== undefined && inherited !== '' && cur.startsWith(inherited + sep)) {
        process.env[key] = join(own, 'maude', file);
      }
    }
  }
}
export function resetE2eAppState(): void {
  const prefs = join(process.env.XDG_CONFIG_HOME as string, 'maude', 'prefs.json');
  if (prefs.includes('maude-e2e-')) rmSync(prefs, { force: true });
  const uiPrefs = process.env.MAUDE_UI_PREFS_PATH;
  if (uiPrefs?.includes('maude-e2e-')) rmSync(uiPrefs, { force: true });
  const home = homedir();
  const targets = [
    join(home, 'Library', 'WebKit', E2E_BUNDLE_ID, 'WebsiteDataStore'),
    join(home, 'Library', 'Application Support', E2E_BUNDLE_ID, 'app-state.json'),
    join(home, 'Library', 'Application Support', E2E_BUNDLE_ID, 'last-project.txt'),
  ];
  for (const t of targets) {
    if (!t.split(sep).includes(E2E_BUNDLE_ID)) throw new Error(`refusing to reset ${t}`);
    rmSync(t, { recursive: true, force: true });
  }
}
if (!process.env.WDIO_WORKER_ID && !process.env.MAUDE_E2E_KEEP_STATE) resetE2eAppState();
// S5.1b — every studio the app (or a lane conf) boots on an unlinked project stamps a machine id.
// Keep it in the e2e bundle's own dir, never the person's ~/.config/maude/machine.json; the app's
// sidecar and every lane's own `spawn('bun', [server.ts …])` inherit this env.
process.env.MAUDE_MACHINE_FILE ??= join(
  homedir(),
  'Library',
  'Application Support',
  E2E_BUNDLE_ID,
  'machine.json'
);

// Per-run evidence root (consumed by helpers/evidence.ts) — SAME place as
// `/flow:scenario`: .ai/device/scenario-runs/<scenario>/<YYYY-MM-DD-HHMM>/
// (gitignored run-output tree; the committed spec lives in .ai/scenarios/).
// Timestamp format matches the scenario-runner's `date +%Y-%m-%d-%H%M`.
const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR ??= resolve(
  HERE,
  '../../../.ai/device/scenario-runs/app-boots-and-renders-canvas',
  stamp
);

// S8.23 (export_save.rs, debug builds only): the native save panel is not DOM, so a
// save that would ask writes here instead (the spec creates the folder), and Show in
// Finder stops short of popping Finder over the test window. Lives in the run dir.
process.env.MAUDE_E2E_SAVE_PATH ??= join(process.env.MAUDE_E2E_RUN_DIR, 'saved', 'native-save.png');
process.env.MAUDE_E2E_NO_REVEAL ??= '1';
// The test window floats above the person's apps (tabs.rs `e2e_on_top`, debug builds only): a covered WKWebView is
// throttled, and the coordinating chat takes the front back mid-lane, so `bringAppToFront` before each test was not
// enough — a camera that eases mid-test never settled and specs pressed where an element WAS. `0` turns it off.
process.env.MAUDE_E2E_ON_TOP ??= '1';

// ── App binary path (per platform; override with MAUDE_E2E_APP) ────────────
function resolveAppPath(): string {
  // Tauri's sidecar resolver rejects a StartingBinary containing symlinks on
  // macOS (including /tmp → /private/tmp). Launch the canonical executable.
  if (process.env.MAUDE_E2E_APP) return realpathSync(process.env.MAUDE_E2E_APP);
  const target = join(HERE, '..', 'src-tauri', 'target', 'debug');
  // `tauri build --debug` bundles per platform. productName = "Maude" (the .app),
  // but the binary is the Cargo package name `maude-desktop`. Prefer the binary
  // INSIDE the bundle so it resolves the staged apps/studio resource (real bundled
  // run); fall back to the raw target/debug binary (walks up to the source tree).
  const candidates =
    process.platform === 'darwin'
      ? [
          join(target, 'bundle', 'macos', 'Maude.app', 'Contents', 'MacOS', 'maude-desktop'),
          join(target, 'maude-desktop'),
        ]
      : process.platform === 'win32'
        ? [join(target, 'maude-desktop.exe'), join(target, 'Maude.exe')]
        : [join(target, 'maude-desktop')];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `[wdio] no built app at:\n  ${candidates.join('\n  ')}\nRun \`pnpm test:e2e:desktop:build\` first (or set MAUDE_E2E_APP).`
    );
  }
  // Canonical, symlink-free: a worktree that links `src-tauri/target` to another checkout's build
  // would otherwise start the app but never its sidecar (the same resolver rule as above).
  return realpathSync(found);
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  beforeSession() {
    // NOT the place for the per-spec reset: the worker starts after the launcher has the app up, so a reset here
    // pulled the stores and `_server.json` from under a running app. It is `onWorkerEnd` (app stopped first).
    // The runner can install a newer Undici global dispatcher before WebDriver
    // loads its own copy. Mixing their header representations fails POST /session
    // with UND_ERR_INVALID_ARG (invalid content-length header) on Node 24.
    // Resolve through WebDriver so its fetch and dispatcher share one version.
    const require = createRequire(import.meta.url);
    const globalsRequire = createRequire(require.resolve('@wdio/globals'));
    const ioRequire = createRequire(globalsRequire.resolve('webdriverio'));
    const driverRequire = createRequire(ioRequire.resolve('webdriver'));
    const { Agent, setGlobalDispatcher } = driverRequire('undici');
    setGlobalDispatcher(new Agent());
  },
  // @wdio/tauri-service runs `ensureActiveWindowFocus` before every find/click.
  // It asks the app for window states through `window.__wdio_original_core__`,
  // which only the `tauri-plugin-wdio` bridge installs — this app ships the
  // embedded-WebDriver plugin alone, so every command first waited 5 s for a
  // bridge that never comes. That silently ate the whole budget of any
  // `waitForDisplayed({ timeout: 5_000 })` (report-bug-dialog failed on a menu
  // item that was on screen). An explicit switchWindow marks the session as
  // user-switched, and the service then skips the focus check for good.
  // beforeSuite, not before: the service attaches `browser.tauri` in its own
  // `before`, which runs after a config-level one.
  //
  // V2-3.7: ONE `shell` window whose child webviews (`strip`, `home`, `p-<pid>`)
  // are the W3C handles. No `windowLabel` capability is sent, so the session
  // starts on whichever webview the provider lists first (a hash map). Pin the
  // ACTIVE tab — the boot project's when MAUDE_PROJECT_ROOT names one
  // (helpers/windows.ts `pinCurrentWindow`, the same call specs make).
  async beforeSuite() {
    bringAppToFront();
    keepAppInFront(); // MAUDE_E2E_KEEP_FRONT=1 only (helpers/app-front.ts)
    await pinCurrentWindow();
  },
  // A red taken while the app was covered is not evidence (helpers/app-front.ts): every test starts with the e2e
  // app in front.
  beforeTest() {
    bringAppToFront();
  },
  // A red is only evidence when it can be seen: keep what the webview showed at the failing step next to the run's
  // other evidence (<run dir>/failures/). Best effort — a dead session simply has nothing to shoot.
  async afterTest(test, _context, { passed }) {
    if (passed) return;
    try {
      const dir = join(process.env.MAUDE_E2E_RUN_DIR ?? tmpdir(), 'failures');
      mkdirSync(dir, { recursive: true });
      const name = `${test.parent}--${test.title}`.replace(/[^a-z0-9]+/gi, '-').slice(0, 90);
      await browser.saveScreenshot(join(dir, `${name}.png`));
    } catch {
      // nothing to shoot
    }
  },
  tsConfigPath: join(HERE, 'tsconfig.json'),

  specs: DEFAULT_SPECS,
  maxInstances: 1, // one native window at a time

  onPrepare: (cfg: WebdriverIO.Config) => {
    baselineFixtureTree();
    // before the service's onPrepare spawns the first app (config hooks run first): no runtime state from a
    // previous lane
    if (!process.env.MAUDE_E2E_KEEP_STATE) resetFixtureRuntime();
    // Only when THIS config is the one running — a dedicated config spreads
    // `...base` and would otherwise print a banner about specs it never meant
    // to run. Identity holds because each override supplies a fresh array.
    if (cfg.specs !== DEFAULT_SPECS) return;
    // Say out loud what this run does NOT cover, so the default command stops
    // reading as "run everything".
    console.log(
      `\n[wdio] ${Object.keys(DEDICATED).length} scenario(s) NOT run here — each needs its own config:\n` +
        Object.entries(DEDICATED)
          .map(([spec, cmd]) => `  ${spec.replace('.e2e.ts', '')} → ${cmd}`)
          .join('\n') +
        '\n'
    );
  },

  // The lane ends on the baseline `onPrepare` took, whatever failed in the middle.
  onComplete: () => {
    releaseFixtureTree();
  },

  // Every spec file gets its own app (helpers/app-lifecycle.ts): the embedded provider launches ONE app per lane and
  // runs every spec's session against it, so the next spec inherited this one's live page. Stop it here — the
  // service sees its port dead before the next worker and starts a fresh one — and reset in between, while no app
  // runs: a clean e2e identity (the stores outlive the app; a panel one spec collapsed was still collapsed in the
  // next), a pristine fixture tree (the app writes it: restores, edits, moves) and no `_*` runtime state (a trashed
  // canvas, open tabs) — `_*` is outside the tree restore.
  onWorkerEnd: async () => {
    await stopE2eApp(Number(process.env.TAURI_WEBDRIVER_PORT));
    if (!process.env.MAUDE_E2E_KEEP_STATE) resetE2eAppState();
    restoreFixtureTree();
    if (!process.env.MAUDE_E2E_KEEP_STATE) resetFixtureRuntime();
  },

  capabilities: [
    {
      browserName: 'tauri',
      // @ts-expect-error — tauri:options is a service-provided capability key
      'tauri:options': { application: resolveAppPath() },
    },
  ],

  // Pin the embedded WebDriver port to a non-default value (default is 4445) so the
  // harness never collides with a developer's already-running debug Maude instance
  // (which also carries the wdio plugin under debug_assertions and would answer on
  // 4445 — that contention made an early run drive the wrong project). The service
  // forwards this as TAURI_WEBDRIVER_PORT to the spawned e2e app.
  services: [['@wdio/tauri-service', { embeddedPort: Number(process.env.TAURI_WEBDRIVER_PORT) }]],

  logLevel: 'info',
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    // Cold start runs boot-self-heal (bun install + build.ts) up to ~90 s, plus
    // the native launch — give the first scenario plenty of headroom.
    timeout: 180_000,
  },

  // The native app owns its own window lifecycle; nothing to do per-session here.
  waitforTimeout: 30_000,
  connectionRetryTimeout: 180_000,
  connectionRetryCount: 1,
};
