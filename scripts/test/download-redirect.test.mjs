// The marketing "Download for Mac" button's installer pick (V2-7.2).
//
// /desktop/download/<platform> 302s to the newest installer on a GitHub Release. It used to read
// `releases/latest`, which GitHub keeps free of prereleases only by FLAG: a release candidate that
// is published without the prerelease flag would have become the download every first-time
// visitor gets. The updater feed already refuses that by version string too (V2-2.0); the
// download now shares the same rule through `pickInstaller`.
//
// Runs against site/lib/updater-feed.mjs. To prove a test still catches the bug it guards:
//   UPDATER_FEED_UNDER_TEST=/path/to/old.mjs node --test scripts/test/download-redirect.test.mjs

import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const modPath = process.env.UPDATER_FEED_UNDER_TEST
  ? resolve(process.env.UPDATER_FEED_UNDER_TEST)
  : join(ROOT, 'site', 'lib', 'updater-feed.mjs');
const { pickInstaller } = await import(pathToFileURL(modPath).href);

const asset = (name) => ({ name, browser_download_url: `https://dl.example/${name}` });
const rel = (tag, names, extra = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: /-/.test(tag),
  assets: names.map(asset),
  ...extra,
});
const ALL = (v) => [
  `Maude_${v}_universal.dmg`,
  `Maude_${v}_x64_en-US.msi`,
  `Maude_${v}_amd64.deb`,
  'Maude.app.tar.gz',
  'Maude.app.tar.gz.sig',
];

test('macOS gets the .dmg of the newest stable release', () => {
  const releases = [rel('v1.9.1', ALL('1.9.1')), rel('v1.9.0', ALL('1.9.0'))];
  assert.equal(pickInstaller(releases, 'macos')?.name, 'Maude_1.9.1_universal.dmg');
});

test('the updater archive is never offered as a download', () => {
  assert.equal(pickInstaller([rel('v1.9.1', ['Maude.app.tar.gz'])], 'macos'), null);
});

test('an rc beside the stable release is skipped (flagged)', () => {
  const releases = [rel('v2.0.0-rc.1', ALL('2.0.0-rc.1')), rel('v1.9.1', ALL('1.9.1'))];
  assert.equal(pickInstaller(releases, 'macos')?.name, 'Maude_1.9.1_universal.dmg');
});

test('a mis-flagged rc (prerelease: false) is skipped too', () => {
  const releases = [
    rel('v2.0.0-rc.1', ALL('2.0.0-rc.1'), { prerelease: false }),
    rel('v1.9.1', ALL('1.9.1')),
  ];
  assert.equal(pickInstaller(releases, 'macos')?.name, 'Maude_1.9.1_universal.dmg');
});

test('only an rc published: nothing to download (the caller falls back to the releases page)', () => {
  const releases = [rel('v2.0.0-rc.1', ALL('2.0.0-rc.1'), { prerelease: false })];
  assert.equal(pickInstaller(releases, 'macos'), null);
});

test('drafts are skipped', () => {
  const releases = [rel('v1.9.2', ALL('1.9.2'), { draft: true }), rel('v1.9.1', ALL('1.9.1'))];
  assert.equal(pickInstaller(releases, 'macos')?.name, 'Maude_1.9.1_universal.dmg');
});

test('windows and linux get their own installer; an unknown platform gets nothing', () => {
  const releases = [rel('v1.9.1', ALL('1.9.1'))];
  assert.equal(pickInstaller(releases, 'windows')?.name, 'Maude_1.9.1_x64_en-US.msi');
  assert.equal(pickInstaller(releases, 'linux')?.name, 'Maude_1.9.1_amd64.deb');
  assert.equal(pickInstaller(releases, 'beos'), null);
});
