import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function discover(start) {
  for (let p = resolve(start); ; p = dirname(p)) {
    if (existsSync(join(p, 'apps/hub/package.json'))) return p;
    if (dirname(p) === p) return null;
  }
}
export const repo = process.env.MAUDE_REPO
  ? resolve(process.env.MAUDE_REPO)
  : discover(dirname(fileURLToPath(import.meta.url))) || discover(process.cwd());
if (!repo) throw new Error('MAUDE_REPO must point to Maude checkout');
export const own = dirname(fileURLToPath(import.meta.url));
export const hubRequire = createRequire(join(repo, 'apps/hub/package.json'));
export const studioRequire = createRequire(join(repo, 'apps/studio/package.json'));
export const desktopRequire = createRequire(join(repo, 'apps/desktop/package.json'));

export const evidenceDir =
  process.env.MAUDE_SPIKE_EVIDENCE_DIR || mkdtempSync(join(tmpdir(), 'maude-browser-evidence-'));
mkdirSync(evidenceDir, { recursive: true });
