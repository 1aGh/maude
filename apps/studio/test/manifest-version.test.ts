// V2-1.11 §5.6 — the app side of the manifest handshake: the version /_health serves is the
// generated manifest's own stamp, and the design plugin's bundled copy is the same file.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { actionsManifestVersion } from '../actions/manifest-version.ts';

const STUDIO = join(import.meta.dir, '..');
const REPO = join(STUDIO, '..', '..');

describe('actionsManifestVersion', () => {
  test('is the generated manifest stamp (12 hex)', () => {
    const m = JSON.parse(readFileSync(join(STUDIO, 'actions.manifest.json'), 'utf8'));
    expect(actionsManifestVersion()).toMatch(/^[0-9a-f]{12}$/);
    expect(actionsManifestVersion()).toBe(m.manifestVersion);
  });

  test('the design plugin ships a byte copy of the manifest (check-version-parity.sh)', () => {
    expect(readFileSync(join(REPO, 'plugins', 'design', 'actions.manifest.json'), 'utf8')).toBe(
      readFileSync(join(STUDIO, 'actions.manifest.json'), 'utf8')
    );
  });
});
