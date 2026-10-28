// S01's real self-host door: a clean native profile signs in to a team's own
// server with the address, email and password a teammate was invited with.
// Operator input: MAUDE_SELFHOST_ENTRY_TARGET points to
// {hubUrl, email, password} for an ISOLATED disposable hub (0600 file).
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useStubClaude } from '../helpers/fake-ai';
import { config as base } from '../wdio.conf';

const here = dirname(fileURLToPath(import.meta.url));
const input = process.env.MAUDE_SELFHOST_ENTRY_TARGET;
if (!input) throw new Error('An explicit disposable self-host target is required.');
const target = JSON.parse(readFileSync(input, 'utf8'));
const url = new URL(target.hubUrl);
const loopback = ['localhost', '127.0.0.1'].includes(url.hostname);
if (!loopback && url.protocol !== 'https:')
  throw new Error('A non-loopback team server must be HTTPS.');
// macOS (V2-8.18, the Docker gate): only against a LOCAL container — the e2e bundle's app dir is the one
// ~/Library/Application Support/com.maude.app.e2e, not a per-run XDG dir, so the profile is made clean below.
if (process.platform !== 'linux' && !(process.platform === 'darwin' && loopback))
  throw new Error(
    'This isolated-profile runner is Linux-only (macOS: a loopback team server only).'
  );
/** Where the e2e app keeps its managed copies (spec + conf agree on it). */
export const e2eAppDir = (scratch: string) =>
  process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'com.maude.app.e2e')
    : join(scratch, 'data', 'com.maude.app.e2e');

if (!process.env.MAUDE_SELFHOST_ENTRY_RUN) {
  const scratch = mkdtempSync(join(tmpdir(), 'maude-e2e-selfhost-entry-'));
  const out = resolve(
    here,
    '../../../../.ai/device/scenario-runs/reliable-project-multiplayer',
    `selfhost-entry-${new Date().toISOString().replaceAll(':', '-')}`
  );
  mkdirSync(out, { recursive: true });
  process.env.MAUDE_SELFHOST_ENTRY_RUN = JSON.stringify({ input, scratch, out });
  process.env.XDG_CONFIG_HOME = join(scratch, 'config');
  process.env.XDG_DATA_HOME = join(scratch, 'data');
  process.env.HUBS_CONFIG_PATH = join(scratch, 'hubs.json');
  process.env.MAUDE_CLOUD_CONFIG = join(scratch, 'cloud.json');
  if (process.platform === 'darwin') {
    // A first-run Home on the shared e2e app dir, as wdio.team-project.conf.ts makes one: no remembered
    // project, the first-run flag cleared, a fresh index + projects dir, a stub `claude` (no keychain dialog),
    // and no managed copy of THIS server left by an earlier run (other servers' copies are not ours to touch).
    const appDir = e2eAppDir(scratch);
    for (const f of [
      'app-state.json',
      'last-project.txt',
      'managed-projects.json',
      join('home', 'home.json'),
    ])
      rmSync(join(appDir, f), { force: true });
    const projects = join(appDir, 'projects');
    for (const name of existsSync(projects) ? readdirSync(projects) : []) {
      try {
        const cfg = JSON.parse(readFileSync(join(projects, name, '.design/config.json'), 'utf8'));
        if (new URL(cfg.linkedHub?.url).origin === url.origin)
          rmSync(join(projects, name), { recursive: true, force: true });
      } catch {
        /* not a managed copy */
      }
    }
    process.env.MAUDE_INDEX_DIR = join(scratch, 'index');
    process.env.MAUDE_HOME_PROJECTS_DIR = join(scratch, 'home-projects');
    mkdirSync(process.env.MAUDE_INDEX_DIR, { recursive: true });
    mkdirSync(process.env.MAUDE_HOME_PROJECTS_DIR, { recursive: true });
    useStubClaude();
  }
  // Evidence records WHICH server, never the credentials.
  writeFileSync(
    join(out, 'target.json'),
    JSON.stringify({ hubUrl: url.origin, email: target.email, scratch }, null, 2)
  );
  console.log(`Self-host entry evidence: ${out}`);
}
const run = JSON.parse(process.env.MAUDE_SELFHOST_ENTRY_RUN);
process.env.MAUDE_E2E_RUN_DIR = run.out;
process.env.MAUDE_CANVAS_ORIGIN_SPLIT = '1';
process.env.MAUDE_E2E_FRAME_PROBE = '1';
process.env.MAUDE_NO_AUTOBUILD = '1';
delete process.env.MAUDE_PROJECT_ROOT;

export const config: WebdriverIO.Config = {
  ...base,
  specs: [join(here, 'selfhost-entry.e2e.ts')],
  logLevel: 'warn',
  outputDir: join(run.out, 'driver'),
  mochaOpts: { ui: 'bdd', timeout: 600_000 },
};
