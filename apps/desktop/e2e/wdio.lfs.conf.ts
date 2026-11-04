/**
 * WebdriverIO config for the Git LFS placeholder scenario (2.0.3).
 *
 * Boots the app into a GENERATED throwaway git project (fixtures/make-lfs-fixture.ts) whose one canvas shows two
 * Git LFS pointer files — pic.png with its object in `.git/lfs/objects`, clip.mp4 without — and proves the
 * placeholder frame's words, Copy prompt (the real macOS clipboard) and Fix with AI (the chat composer pre-filled,
 * nothing sent).
 *
 * The canvas-origin split is OFF (the base config's default) because the embedded WebDriver cannot act inside a
 * cross-origin frame: `switchFrame` into it succeeds, then every find / click is a "JavaScript exception" — the
 * driver (vendor/tauri-plugin-wdio-webdriver) runs its JS from the top document and synthesizes pointer events there
 * too (measured 2026-11-04, MAUDE_E2E_LFS_SPLIT=1: the frames and both buttons RENDER on the cross-origin canvas, the
 * failure screenshot shows them, but nothing inside can be pressed). The clipboard fallback is still the path under
 * test: a WebDriver click is a synthetic event, so the shell has no user activation either way.
 * `MAUDE_E2E_LFS_SPLIT=1` runs the same spec with the split on (its in-frame steps then fail at the driver).
 *
 * Run: `pnpm --filter @maude/desktop-e2e e2e:lfs` (or `wdio run ./wdio.lfs.conf.ts` from apps/desktop/e2e).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLfsFixture } from './fixtures/make-lfs-fixture';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

// Evaluated twice (launcher, worker): build ONCE, in the launcher, and hand the worker what it holds.
if (!process.env.MAUDE_E2E_LFS_FIXTURE) {
  process.env.MAUDE_E2E_LFS_FIXTURE = JSON.stringify(makeLfsFixture());
}
process.env.MAUDE_PROJECT_ROOT = JSON.parse(process.env.MAUDE_E2E_LFS_FIXTURE).root;
process.env.MAUDE_CANVAS_ORIGIN_SPLIT = process.env.MAUDE_E2E_LFS_SPLIT ?? '0';

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/lfs-placeholder',
  stamp
);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'lfs-placeholder.e2e.ts')],
};
