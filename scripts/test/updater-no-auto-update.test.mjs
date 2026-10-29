// `MAUDE_NO_AUTO_UPDATE=1` at build time turns the desktop app's SILENT update checks off
// (apps/desktop/src-tauri/src/updater.rs `auto_update_off`) — for local test builds, whose older
// version the stable release would otherwise silently replace (2026-10-29: the v2 freeze `.app`
// became the signed 1.10.0 within ~20 min). A shipped build that carried it would never update
// itself again, so no workflow may set it — not in an `env:` block, not inline in a `run:`.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WORKFLOWS = join(ROOT, '.github', 'workflows');

test('no CI workflow builds with MAUDE_NO_AUTO_UPDATE (release builds keep updating)', () => {
  const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(
    files.includes('build-desktop.yml'),
    'the desktop release workflow moved — re-point this test'
  );
  const setting = files.filter((f) =>
    readFileSync(join(WORKFLOWS, f), 'utf8')
      .split('\n')
      .some((l) => !/^\s*#/.test(l) && l.includes('MAUDE_NO_AUTO_UPDATE'))
  );
  assert.deepEqual(setting, []);
});

test('the switch is read at compile time by both silent checks', () => {
  const full = readFileSync(join(ROOT, 'apps/desktop/src-tauri/src/updater.rs'), 'utf8');
  const src = full.slice(0, full.indexOf('#[cfg(test)]'));
  assert.match(src, /option_env!\("MAUDE_NO_AUTO_UPDATE"\)/);
  assert.equal(src.split('if auto_update_off()').length - 1, 2);
});
