// The desktop updater feed's channel rules (V2-2.0, T21′).
//
//   stable install → never a prerelease (by GitHub's flag or by version string)
//   rc install     → the newest rc, then the stable release that supersedes it
//
// Runs against site/lib/updater-feed.mjs. To prove a test still catches the bug
// it guards, point it at another implementation:
//   UPDATER_FEED_UNDER_TEST=/path/to/old.mjs node --test scripts/test/updater-feed.test.mjs

import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const modPath = process.env.UPDATER_FEED_UNDER_TEST
  ? resolve(process.env.UPDATER_FEED_UNDER_TEST)
  : join(ROOT, 'site', 'lib', 'updater-feed.mjs');
const { compareSemver, pickArtifact, releasesApiPath, selectRelease } = await import(
  pathToFileURL(modPath).href
);

const rel = (tag, extra = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: /-/.test(tag),
  assets: [],
  ...extra,
});
const tagOf = (r) => r?.tag_name ?? null;

test('a stable install reads releases/latest; an rc install reads the list', () => {
  assert.equal(releasesApiPath('1.8.1'), 'releases/latest');
  assert.equal(releasesApiPath('2.0.0-rc.1'), 'releases?per_page=30');
});

test('a stable install is offered the newer stable, never the rc beside it', () => {
  const releases = [rel('v2.0.0-rc.1'), rel('v1.8.2'), rel('v1.8.1')];
  assert.equal(tagOf(selectRelease(releases, '1.8.1')), 'v1.8.2');
});

test('a stable install is offered nothing when only an rc is newer', () => {
  assert.equal(selectRelease([rel('v2.0.0-rc.1'), rel('v1.8.1')], '1.8.1'), null);
});

test('a mis-flagged rc (prerelease: false) still never reaches a stable install', () => {
  assert.equal(selectRelease([rel('v2.0.0-rc.1', { prerelease: false })], '1.8.1'), null);
});

test('a stable install that is current gets nothing', () => {
  assert.equal(selectRelease([rel('v1.8.1')], '1.8.1'), null);
});

test('an rc install is offered the next rc', () => {
  const releases = [rel('v2.0.0-rc.2'), rel('v2.0.0-rc.1'), rel('v1.8.2')];
  assert.equal(tagOf(selectRelease(releases, '2.0.0-rc.1')), 'v2.0.0-rc.2');
});

test('an rc install is promoted to the stable release that supersedes it', () => {
  const releases = [rel('v2.0.0'), rel('v2.0.0-rc.3'), rel('v2.0.0-rc.2')];
  assert.equal(tagOf(selectRelease(releases, '2.0.0-rc.3')), 'v2.0.0');
});

test('an rc install is never moved back to an older stable line', () => {
  // v1.8.3 may be the NEWEST release by date (a 1.x patch during the rc soak).
  assert.equal(selectRelease([rel('v1.8.3'), rel('v2.0.0-rc.1')], '2.0.0-rc.1'), null);
});

test('rc numbers compare numerically, not as text', () => {
  assert.equal(
    tagOf(selectRelease([rel('v2.0.0-rc.9'), rel('v2.0.0-rc.10')], '2.0.0-rc.9')),
    'v2.0.0-rc.10'
  );
});

test('drafts are never offered', () => {
  assert.equal(selectRelease([rel('v1.9.0', { draft: true })], '1.8.1'), null);
  assert.equal(selectRelease([rel('v2.0.0-rc.2', { draft: true })], '2.0.0-rc.1'), null);
});

test('an unparseable current version is offered the newest stable (as before)', () => {
  assert.equal(tagOf(selectRelease([rel('v1.8.1'), rel('v2.0.0-rc.1')], 'garbage')), 'v1.8.1');
});

test('semver precedence (the spec §11 example chain)', () => {
  const chain = [
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0',
    '1.0.1',
    '1.1.0',
    '2.0.0',
  ];
  for (let i = 1; i < chain.length; i++) {
    assert.ok(compareSemver(chain[i], chain[i - 1]) > 0, `${chain[i]} > ${chain[i - 1]}`);
    assert.ok(compareSemver(chain[i - 1], chain[i]) < 0, `${chain[i - 1]} < ${chain[i]}`);
  }
  assert.equal(compareSemver('v2.0.0-rc.1', '2.0.0-rc.1'), 0);
});

test('the artifact and its signature are picked per platform', () => {
  const release = rel('v2.0.0-rc.1', {
    assets: [
      { name: 'Maude.app.tar.gz', browser_download_url: 'u1' },
      { name: 'Maude.app.tar.gz.sig', browser_download_url: 'u2' },
      { name: 'Maude_2.0.0-rc.1_x64_en-US.msi', browser_download_url: 'u3' },
    ],
  });
  const mac = pickArtifact(release, 'darwin', 'aarch64');
  assert.equal(mac.asset.name, 'Maude.app.tar.gz');
  assert.equal(mac.sigAsset.name, 'Maude.app.tar.gz.sig');
  assert.deepEqual(pickArtifact(release, 'windows', 'x86_64'), { missing: 'signature' });
  assert.deepEqual(pickArtifact(release, 'linux', 'x86_64'), { missing: 'artifact' });
});
