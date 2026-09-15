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
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  'cloud-attach.e2e.ts': 'pnpm test:e2e:desktop:cloud',
  'git-branch-switcher.e2e.ts': 'pnpm test:e2e:desktop:git',
  'git-lifecycle.e2e.ts': 'pnpm test:e2e:desktop:lifecycle',
  'git-switch-repos.e2e.ts': 'pnpm test:e2e:desktop:switchrepos',
  'onboarding.e2e.ts': 'pnpm test:e2e:desktop:onboarding',
  'shell-parity.e2e.ts': 'pnpm test:e2e:desktop:parity',
  // Needs the canvas-origin split ON, which this config forces OFF below.
  'sidecar-respawn-canvas-switch.e2e.ts': 'pnpm test:e2e:desktop:sidecar-respawn',
  // A real hub + a seeding teammate studio + a first-run home.
  'team-project.e2e.ts': 'pnpm test:e2e:desktop:team-project',
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
  if (confs.length !== Object.keys(DEDICATED).length) {
    throw new Error(
      `[wdio] ${confs.length} dedicated config(s) on disk but ${Object.keys(DEDICATED).length} ` +
        `spec(s) excluded from the default glob. Update DEDICATED in wdio.conf.ts.\n  ` +
        confs.join('\n  ')
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
if (process.env.MAUDE_CANVAS_ORIGIN_SPLIT === undefined) {
  process.env.MAUDE_CANVAS_ORIGIN_SPLIT = '0';
}

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
  return found;
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  beforeSession() {
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
  tsConfigPath: join(HERE, 'tsconfig.json'),

  specs: DEFAULT_SPECS,
  maxInstances: 1, // one native window at a time

  onPrepare: (cfg: WebdriverIO.Config) => {
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
  services: [['@wdio/tauri-service', { embeddedPort: 4455 }]],

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
