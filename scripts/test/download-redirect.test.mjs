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
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const modPath = process.env.UPDATER_FEED_UNDER_TEST
  ? resolve(process.env.UPDATER_FEED_UNDER_TEST)
  : join(ROOT, 'site', 'lib', 'updater-feed.mjs');
const feed = await import(pathToFileURL(modPath).href);
const { pickInstaller } = feed;
const ROUTE = join(ROOT, 'site', 'app', '(home)', 'desktop', 'download', '[platform]', 'route.ts');

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

// 2.0.2 — right after the 2.0.1 release, /desktop/download/macos sent visitors to 1.10.0, three
// hours after 2.0.0 had shipped WITH its .dmg. The pick never falls back to an older release (the
// tests above), so the list it saw predated 2.0.0: the route read GitHub through Next's data cache
// (`next: { revalidate: 300 }`), which is stale-while-revalidate — the first request after a quiet
// spell is answered from the last list fetched, however old, and only triggers the refresh. The
// redirect is now one pure decision (`downloadRedirect`) and the route reads the list uncached;
// what is cached is the redirect, at the CDN, for a bounded time and never served stale.
const REPO = '1aGh/maude';
const ttl = (cc) => Number(/s-maxage=(\d+)/.exec(cc)?.[1] ?? Number.NaN);

test('download: the newest stable release with its installer → that installer, cached', () => {
  const r = feed.downloadRedirect(
    [rel('v2.0.0', ALL('2.0.0')), rel('v2.0.1', ALL('2.0.1')), rel('v1.10.0', ALL('1.10.0'))],
    'macos',
    REPO
  );
  assert.equal(r.location, 'https://dl.example/Maude_2.0.1_universal.dmg');
  assert.ok(ttl(r.cacheControl) > 0 && ttl(r.cacheControl) <= 300, r.cacheControl);
  assert.doesNotMatch(r.cacheControl, /stale-while-revalidate/);
});

test('download: the newest stable still uploading → its release page, briefly — never an older installer', () => {
  const releases = [
    rel('v2.0.1', ['Maude.app.tar.gz', 'Maude_2.0.1_amd64.deb']),
    rel('v2.0.0', ALL('2.0.0')),
    rel('v1.10.0', ALL('1.10.0')),
  ];
  const r = feed.downloadRedirect(releases, 'macos', REPO);
  assert.equal(r.location, 'https://github.com/1aGh/maude/releases/tag/v2.0.1');
  assert.doesNotMatch(r.location, /dl\.example/);
  // Not final: a short CDN window, no stale serving, so the .dmg is offered minutes after upload.
  assert.ok(ttl(r.cacheControl) <= 60, r.cacheControl);
  assert.doesNotMatch(r.cacheControl, /stale-while-revalidate/);
  // The platform whose installer IS there gets it.
  assert.equal(
    feed.downloadRedirect(releases, 'linux', REPO).location,
    'https://dl.example/Maude_2.0.1_amd64.deb'
  );
});

test('download: a release candidate is never the download, flagged or not', () => {
  const releases = [
    rel('v2.0.2-rc.1', ALL('2.0.2-rc.1'), { prerelease: false }),
    rel('v2.0.1', ['Maude.app.tar.gz']),
    rel('v2.0.0-rc.2', ALL('2.0.0-rc.2')),
  ];
  const r = feed.downloadRedirect(releases, 'macos', REPO);
  assert.equal(r.location, 'https://github.com/1aGh/maude/releases/tag/v2.0.1');
  const onlyRc = feed.downloadRedirect([rel('v2.0.2-rc.1', ALL('2.0.2-rc.1'))], 'macos', REPO);
  assert.equal(onlyRc.location, 'https://github.com/1aGh/maude/releases/latest');
  assert.ok(ttl(onlyRc.cacheControl) <= 60, onlyRc.cacheControl);
});

test('download: an unknown platform or an unreadable list → the releases page, briefly', () => {
  for (const [releases, platform] of [
    [[rel('v2.0.1', ALL('2.0.1'))], 'beos'],
    [{ message: 'API rate limit exceeded' }, 'macos'],
    [null, 'macos'],
  ]) {
    const r = feed.downloadRedirect(releases, platform, REPO);
    assert.equal(r.location, 'https://github.com/1aGh/maude/releases/latest');
    assert.ok(ttl(r.cacheControl) <= 60, r.cacheControl);
  }
});

test('download route: reads the release list uncached and lets downloadRedirect decide', () => {
  const src = readFileSync(ROUTE, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /cache:\s*'no-store'/);
  assert.doesNotMatch(src, /revalidate/);
  assert.match(src, /downloadRedirect\(/);
  // Response.redirect() hands back immutable headers — no Cache-Control could be set on it.
  assert.doesNotMatch(src, /Response\.redirect\(/);
  assert.match(src, /'Cache-Control'/);
});
