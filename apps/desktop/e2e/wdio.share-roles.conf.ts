/**
 * WebdriverIO config for `share-roles.e2e.ts` (S9.21c, contract V2-1.7 §7 — real processes, V2-8).
 *
 * Several accounts on ONE hub, the way the multiplayer/ harness stands them up
 * (scripts/dev/sync-e2e/surface-run.mjs): the native app is the OWNER (its
 * hubs.json holds the owner's credential), and every other person is a studio of
 * their own, linked to the same hub with their own hubs.json, driven through a
 * headless Chromium page. A local studio is a desktop-shaped shell (session ''),
 * so it hears the hub's `maude.access` / `maude.access-request` notices
 * (decision v2-S9.21b-notice-relay-desktop-only).
 *
 * Nothing here invents a person, a grant or a link: an explicit run file, written
 * by the V2-8 runner, names them. `MAUDE_SHARE_ROLES_CONFIG` → JSON:
 *
 *   {
 *     "out":           evidence dir (screenshots, timings),
 *     "nativeProject": the owner's project root (the app opens it),
 *     "ownerHubs":     the owner's hubs.json (HUBS_CONFIG_PATH for the app),
 *     "project":       the project's name as people see it,
 *     "canvas":        the canvas shared with Petra, `ui/<name>.tsx` (designRoot-relative; its first <h1> is editable),
 *     "lifecycle":     a LOOPBACK control the runner serves:
 *                        POST /petra/accept         → { url }  Petra accepts the owner's invitation (her own
 *                                                     account) and her studio starts with what it minted
 *                        POST /viewer/redeem {url}  → { url }  a third person opens the owner's link, signed
 *                                                     in, and their studio starts with what it minted
 *     "petra":  { "email", "name" },               not a member yet — the scenario invites her
 *     "lukas":  { "email", "name", "url" },        a member (Can edit) whose studio is already running
 *     "viewer": { "name" }                         the person who opens the link
 *   }
 *
 * The link step needs a hub that hands out links (`/health.access.links`); the
 * scenario fails loud on one that does not, it never skips.
 *
 * Run: MAUDE_SHARE_ROLES_CONFIG=<run.json> pnpm --filter @maude/desktop-e2e e2e:share-roles
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

const path = process.env.MAUDE_SHARE_ROLES_CONFIG;
if (!path)
  throw new Error('share-roles needs MAUDE_SHARE_ROLES_CONFIG (the V2-8 runner writes it).');
const run = JSON.parse(readFileSync(path, 'utf8'));
for (const key of ['out', 'nativeProject', 'ownerHubs', 'project', 'canvas', 'lifecycle'])
  if (typeof run[key] !== 'string' || !run[key]) throw new Error(`share-roles run file: no ${key}`);
for (const who of ['petra', 'lukas', 'viewer'])
  if (!run[who] || typeof run[who].name !== 'string')
    throw new Error(`share-roles run file: no ${who}`);
// One level under ui/: its Canvases row is on screen without opening a folder.
if (!/^ui\/[^/.][^/]*\.tsx$/.test(run.canvas))
  throw new Error('share-roles run file: canvas must be ui/<name>.tsx (designRoot-relative)');
const loopback = (u: string) => {
  const h = new URL(u).hostname;
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h.endsWith('.localhost');
};
if (!loopback(run.lifecycle) || !loopback(run.lukas.url))
  throw new Error('share-roles run file: the lifecycle control and the studios must be loopback');
if (!existsSync(join(run.nativeProject, '.design', run.canvas)))
  throw new Error(`share-roles run file: ${run.canvas} is not in the owner's project`);
mkdirSync(run.out, { recursive: true });

process.env.MAUDE_PROJECT_ROOT = run.nativeProject;
process.env.HUBS_CONFIG_PATH = run.ownerHubs;
process.env.MAUDE_E2E_RUN_DIR = run.out;
// The real origin split — the canvas is a separate, untrusted origin; the
// debug-only frame probe reads it (apps/desktop/src-tauri/src/e2e-frame-probe.js).
process.env.MAUDE_CANVAS_ORIGIN_SPLIT = '1';
process.env.MAUDE_E2E_FRAME_PROBE = '1';
process.env.MAUDE_NO_AUTOBUILD = '1';
// A throwaway profile registry and keychain, never the person's own.
process.env.XDG_CONFIG_HOME ??= mkdtempSync(join(tmpdir(), 'maude-e2e-share-roles-'));
process.env.MAUDE_E2E_FAKE_KEYCHAIN = '1';

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'share-roles.e2e.ts')],
  logLevel: 'warn',
  outputDir: join(run.out, 'driver'),
  // Three people, three hub round trips each; every step still has its own deadline.
  mochaOpts: { ...base.mochaOpts, timeout: 600_000 },
};
