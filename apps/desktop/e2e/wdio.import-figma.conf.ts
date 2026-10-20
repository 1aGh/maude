/**
 * WebdriverIO config for the S8.17 Import from Figma scenario (12 · ia-figma-sheets, ia-figma-arrived, ia-figjam).
 *
 * The sidecar runs with `MAUDE_FIGMA_FIXTURE=fixtures/figma` (S8.17b): the Figma client answers from those local JSON/SVG
 * files and makes no network call, so the frame leg (paste a link → pick frames → artboards) runs without a Figma
 * account. A throwaway 0600 key file holds a fake token so the sheet starts connected, and nothing touches the real key
 * store or the keychain. Needs an unlocked screen. Not run in CI.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

// the sidecar inherits this env when the app launches
process.env.MAUDE_FIGMA_FIXTURE = resolve(HERE, 'fixtures', 'figma');
const keysDir = mkdtempSync(join(tmpdir(), 'maude-e2e-figma-keys-'));
const keysPath = join(keysDir, 'keys.json');
writeFileSync(keysPath, JSON.stringify({ keys: { figma: 'figd_E2E_FIXTURE_TOKEN' } }), {
  mode: 0o600,
});
process.env.MAUDE_GEN_KEYS_PATH = keysPath;

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'import-figma.e2e.ts')],
};
