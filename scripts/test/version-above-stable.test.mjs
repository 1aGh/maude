// The checked-in version is never below the latest STABLE release tag, and a release candidate is strictly above it
// (decision maude/v2-version-2.0.0-rc.1-on-feat, Michal 2026-10-29). A build whose version sits below the latest
// stable gets that stable offered by the updater: the v2 freeze build at 1.9.1 was replaced in place by the signed
// v1.10.0 within ~20 minutes of launch. `quality.yml` checks out with fetch-depth 0, so the tags are here.
//
//   node --test scripts/test/version-above-stable.test.mjs

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.([1-9]\d*))?$/;

/** semver order for X.Y.Z and X.Y.Z-rc.N (an rc sorts below its own X.Y.Z) */
export function compare(a, b) {
  const pa = VERSION.exec(a);
  const pb = VERSION.exec(b);
  if (!pa || !pb) throw new Error(`not a version: ${!pa ? a : b}`);
  for (let i = 1; i <= 3; i++) if (+pa[i] !== +pb[i]) return +pa[i] - +pb[i];
  const ra = pa[4] === undefined ? Number.POSITIVE_INFINITY : +pa[4];
  const rb = pb[4] === undefined ? Number.POSITIVE_INFINITY : +pb[4];
  return ra === rb ? 0 : ra < rb ? -1 : 1;
}

export function latestStable(tags) {
  return tags
    .map((t) => t.trim())
    .filter((t) => STABLE_TAG.test(t))
    .map((t) => t.slice(1))
    .sort(compare)
    .at(-1);
}

/** null when fine, else why */
export function versionProblem(version, stable) {
  if (!stable) return null;
  const c = compare(version, stable);
  if (c < 0)
    return `${version} is below the latest stable ${stable}: the updater would replace this build with it`;
  if (version.includes('-rc.') && c <= 0)
    return `release candidate ${version} is not above the latest stable ${stable}`;
  return null;
}

test('compare orders versions and release candidates', () => {
  assert.ok(compare('2.0.0-rc.1', '1.10.0') > 0);
  assert.ok(compare('1.9.1', '1.10.0') < 0);
  assert.ok(compare('2.0.0-rc.1', '2.0.0') < 0);
  assert.ok(compare('2.0.0-rc.2', '2.0.0-rc.10') < 0);
  assert.equal(compare('1.10.0', '1.10.0'), 0);
});

test('versionProblem refuses a version below the latest stable, and an rc not above it', () => {
  assert.match(versionProblem('1.9.1', '1.10.0'), /below the latest stable/);
  assert.match(versionProblem('1.10.0-rc.1', '1.10.0'), /below the latest stable/); // an rc sorts below its own X.Y.Z
  assert.equal(versionProblem('2.0.0-rc.1', '1.10.0'), null);
  assert.equal(versionProblem('1.10.0', '1.10.0'), null); // a release commit, or main between releases
  assert.equal(versionProblem('1.10.1', '1.10.0'), null);
});

test('the checked-in version is not below the latest stable release tag', () => {
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const tags = execFileSync('git', ['tag', '-l', 'v*'], { cwd: ROOT, encoding: 'utf8' }).split(
    '\n'
  );
  const stable = latestStable(tags);
  assert.ok(
    stable,
    'no stable v*.*.* tag found — the checkout has no tags (fetch-depth 0 in quality.yml)'
  );
  assert.equal(versionProblem(version, stable), null, versionProblem(version, stable) ?? '');
});
