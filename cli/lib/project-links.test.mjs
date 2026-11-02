// gate-b-sec4 — the CLI's writer and the studio's reader agree on the per-Mac link record:
// `maude design link` writes it, the studio's boot gate (apps/studio/sync/link-consent.ts) honours it.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { linkConsent, projectLinkOf } from '../../apps/studio/sync/link-consent.ts';
import { deleteProjectLink, projectLinksPath, recordProjectLink } from './project-links.mjs';

let base;
const saved = { ...process.env };
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'maude-cli-links-')));
  process.env.HUBS_CONFIG_PATH = join(base, 'conf', 'hubs.json');
  delete process.env.MAUDE_PROJECT_LINKS_PATH;
});
afterEach(() => {
  process.env = { ...saved };
  rmSync(base, { recursive: true, force: true });
});

test('a link the CLI records is the link the studio honours — same file, key and shape', () => {
  const repo = join(base, 'repo');
  mkdirSync(join(repo, '.design'), { recursive: true });
  recordProjectLink(repo, 'https://Hub.Example.com/');

  assert.equal(projectLinksPath(), join(base, 'conf', 'project-links.json'));
  assert.equal(statSync(projectLinksPath()).mode & 0o777, 0o600);
  assert.deepEqual(
    { ...projectLinkOf(repo), at: 0 },
    { hub: 'https://hub.example.com', at: 0, how: 'link' }
  );
  const v = linkConsent(
    { url: 'https://hub.example.com' },
    { repoRoot: repo, designRoot: join(repo, '.design') }
  );
  assert.deepEqual(v, { ok: true, how: 'link' });

  deleteProjectLink(repo);
  assert.equal(projectLinkOf(repo), null);
});
