// The prerelease channel (V2-2.0, T21′), as assertions.
//
// WHY. Every release workflow triggered on `v*.*.*`, and that glob matches
// `v2.0.0-rc.1` too: one rc tag would have rolled the production cell fleet,
// deployed the render service, moved the hub's `:latest` and npm-published to
// `latest`. Nothing said so until someone was about to push one. These tests
// hold the split:
//
//   - every tag-triggered workflow is EITHER stable-only or rc-capable — a new
//     one has to be put in one of the two lists, deliberately
//   - stable-only workflows (fleet, render, hub image, self-host check) fire on
//     vX.Y.Z and on NO prerelease, and refuse one even if a later edit widens
//     the filter
//   - rc-capable workflows (npm binaries + desktop) fire on vX.Y.Z and
//     vX.Y.Z-rc.N only, and every publish they make is routed by the release
//     classification: npm dist-tag `next`, a prerelease GitHub release
//
// The trigger check evaluates the filters with GitHub's own rule (patterns in
// order, the last match decides, `!` excludes), against the bytes a
// maintainer edits — the failure this catches is an edit, not a runtime bug.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyRelease, parseReleaseVersion } from '../release-kind.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// RELEASE_WORKFLOWS_UNDER_TEST=<dir> points the workflow assertions at another
// copy of .github/workflows — how the red-first run proved they fail on the
// pre-V2-2.0 files.
const WF = process.env.RELEASE_WORKFLOWS_UNDER_TEST
  ? resolve(process.env.RELEASE_WORKFLOWS_UNDER_TEST)
  : join(ROOT, '.github', 'workflows');
const read = (name) => readFileSync(join(WF, name), 'utf8');

// ── GitHub filter-pattern semantics (the subset these workflows use) ─────────

/** One filter pattern → RegExp. `*` = any run of non-`/`, `**` = anything. */
export function patternToRegExp(p) {
  if (/[?+[\]]/.test(p)) {
    throw new Error(`'${p}' uses a filter metacharacter this emulator does not model`);
  }
  let re = '';
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '*') {
      if (p[i + 1] === '*') {
        re += '.*';
        i++;
      } else re += '[^/]*';
    } else re += p[i].replace(/[.^$(){}|\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/**
 * GitHub: "A matching negative pattern (prefixed with !) after a positive
 * match will exclude the Git ref. A matching positive pattern after a negative
 * match will include the Git ref again." — i.e. the last match decides.
 */
export function refMatches(patterns, ref) {
  let included = false;
  for (const raw of patterns) {
    const neg = raw.startsWith('!');
    if (patternToRegExp(neg ? raw.slice(1) : raw).test(ref)) included = !neg;
  }
  return included;
}

const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, '$2');

/** `on.push.tags` of a workflow, or null when it has no tag trigger. */
export function pushTagPatterns(text) {
  const lines = text.split('\n');
  let inOn = false;
  let inPush = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;
    if (/^\S/.test(line)) {
      inOn = /^on:\s*(#.*)?$/.test(line);
      inPush = false;
      continue;
    }
    if (!inOn) continue;
    if (/^ {2}\S/.test(line)) {
      inPush = /^ {2}push:\s*(#.*)?$/.test(line);
      continue;
    }
    if (!inPush) continue;
    const m = /^ {4}tags:\s*(.*)$/.exec(line);
    if (!m) continue;
    const rest = m[1].replace(/\s+#.*$/, '').trim();
    if (rest.startsWith('[')) {
      return rest
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map(unquote)
        .filter(Boolean);
    }
    const out = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*(#.*)?$/.test(lines[j])) continue;
      const b = /^ {6}- (.*)$/.exec(lines[j]);
      if (!b) break;
      out.push(unquote(b[1].replace(/\s+#.*$/, '')));
    }
    return out;
  }
  return null;
}

// ── The split ───────────────────────────────────────────────────────────────

/** Never for a prerelease: the fleet, render, the hub's `:latest`, the self-host set. */
const STABLE_ONLY = [
  'cells-deploy.yml',
  'hub-image.yml',
  'render-deploy.yml',
  'selfhost-images.yml',
];
/** Build for an rc too, routed to the prerelease channel. */
const RC_CAPABLE = ['build-binaries.yml', 'build-desktop.yml'];

const STABLE_TAGS = ['v1.8.2', 'v2.0.0', 'v10.20.30'];
const RC_TAGS = ['v2.0.0-rc.1', 'v2.1.0-rc.12'];
const OTHER_PRERELEASES = ['v2.0.0-beta.1', 'v2.0.0-alpha', 'v2.0.0-dryrun.1'];

test('the filter emulator follows GitHub: the last matching pattern decides', () => {
  assert.equal(refMatches(['v*.*.*'], 'v2.0.0-rc.1'), true, 'the old glob DID match an rc');
  assert.equal(refMatches(['v*.*.*', '!v*.*.*-*'], 'v2.0.0-rc.1'), false);
  assert.equal(refMatches(['v*.*.*', '!v*.*.*-*', 'v*.*.*-rc.*'], 'v2.0.0-rc.1'), true);
  assert.equal(refMatches(['v*.*.*', '!v*.*.*-*', 'v*.*.*-rc.*'], 'v2.0.0-beta.1'), false);
  assert.equal(refMatches(['v*'], 'v1/x'), false, '`*` never crosses a `/`');
});

test('every tag-triggered workflow is classified stable-only or rc-capable', () => {
  const tagged = readdirSync(WF)
    .filter((n) => n.endsWith('.yml'))
    .filter((n) => pushTagPatterns(read(n)) !== null)
    .sort();
  assert.deepEqual(
    tagged,
    [...STABLE_ONLY, ...RC_CAPABLE].sort(),
    'a workflow gained or lost a tag trigger — decide whether a release candidate may run it and put it in STABLE_ONLY or RC_CAPABLE'
  );
});

for (const wf of STABLE_ONLY) {
  test(`${wf}: fires on stable tags and on no prerelease`, () => {
    const pats = pushTagPatterns(read(wf));
    for (const t of STABLE_TAGS) assert.equal(refMatches(pats, t), true, `${wf} must fire on ${t}`);
    for (const t of [...RC_TAGS, ...OTHER_PRERELEASES]) {
      assert.equal(
        refMatches(pats, t),
        false,
        `${wf} fires on ${t} — a prerelease tag would touch production (fleet / render / hub :latest)`
      );
    }
  });

  test(`${wf}: refuses a prerelease tag even if the filter is widened later`, () => {
    // Defence in depth, read at the step: a tag run whose name carries a
    // prerelease suffix stops before anything is built or pushed.
    assert.match(
      read(wf),
      /if: github\.ref_type == 'tag' && contains\(github\.ref_name, '-'\)[\s\S]{0,900}?exit 1/,
      `${wf} has no step that refuses a prerelease tag`
    );
  });
}

for (const wf of RC_CAPABLE) {
  test(`${wf}: fires on stable and rc tags, not on other prereleases`, () => {
    const pats = pushTagPatterns(read(wf));
    for (const t of [...STABLE_TAGS, ...RC_TAGS]) {
      assert.equal(refMatches(pats, t), true, `${wf} must fire on ${t}`);
    }
    for (const t of OTHER_PRERELEASES) {
      assert.equal(
        refMatches(pats, t),
        false,
        `${wf} fires on ${t}, which the pipeline cannot ship`
      );
    }
  });

  test(`${wf}: classifies the release with scripts/release-kind.mjs`, () => {
    assert.match(read(wf), /node scripts\/release-kind\.mjs/);
  });
}

/** Non-comment lines of a workflow. */
const commandLines = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l));

test('build-binaries: every npm publish names the classified dist-tag', () => {
  // An invocation carries flags (`npm publish --access …`); prose such as the
  // job name "… (blocking npm publish)" does not.
  const lines = commandLines(read('build-binaries.yml')).filter((l) => /\bnpm publish --/.test(l));
  assert.ok(lines.length >= 4, 'expected the sub-package + main publish and dry-run lines');
  for (const l of lines) {
    assert.match(
      l,
      /--tag "\$NPM_TAG"/,
      `an npm publish without --tag defaults to "latest" — an rc would become every user's install:\n  ${l.trim()}`
    );
  }
  assert.match(
    read('build-binaries.yml'),
    /NPM_TAG: \$\{\{ needs\.classify\.outputs\.npm_tag \}\}/
  );
});

test('build-binaries: an rc creates a PRERELEASE GitHub release', () => {
  const text = read('build-binaries.yml');
  assert.match(text, /PRERELEASE: \$\{\{ needs\.classify\.outputs\.prerelease \}\}/);
  assert.match(text, /gh release create [^\n]*"\$\{FLAGS\[@\]\}"/);
  assert.match(text, /FLAGS\+=\(--prerelease\)/);
  // build-desktop's attach step can create the record first; an rc must still
  // end up flagged.
  assert.match(text, /gh release edit "\$GITHUB_REF_NAME" --prerelease/);
});

test('build-binaries: nothing downstream runs when the classification refuses', () => {
  const text = read('build-binaries.yml');
  assert.match(text, /needs\.classify\.result == 'success'/);
});

test('build-binaries: a dispatch dry run reaches the root package dry-run publish', () => {
  // create-release is skipped on every dispatch, and GitHub's implicit
  // `success()` is false once ANY upstream job was skipped — the first V2-2.0
  // dry run showed desktop-gate and publish-main skipped for exactly that
  // reason. Both must name the upstream results they depend on.
  const text = read('build-binaries.yml');
  const jobIf = (job) =>
    new RegExp(`\\n {2}${job}:\\n(?: {4}.*\\n|\\s*\\n)*? {4}if: (.*)\\n`).exec(text)?.[1] ?? '';
  assert.match(jobIf('desktop-gate'), /!cancelled\(\) && needs\.build-binaries\.result == 'success'/);
  assert.match(
    jobIf('publish-main'),
    /!cancelled\(\).*needs\.build-binaries\.result == 'success'.*needs\.desktop-gate\.result == 'success'/
  );
});

test('build-desktop: attaches to the release with the classified prerelease flag', () => {
  const text = read('build-desktop.yml');
  assert.match(text, /prerelease: \$\{\{ steps\.release\.outputs\.prerelease \}\}/);
  assert.match(text, /MSI_VERSION: \$\{\{ steps\.release\.outputs\.msi_version \}\}/);
});

// ── The classifier ──────────────────────────────────────────────────────────

test('release grammar: X.Y.Z and X.Y.Z-rc.N only', () => {
  for (const ok of ['1.8.1', '0.0.1', '2.0.0-rc.1', '2.0.0-rc.12', '10.0.0']) {
    assert.ok(parseReleaseVersion(ok), `${ok} should parse`);
  }
  for (const bad of [
    '2.0',
    '02.0.0',
    '2.0.0-rc.0',
    '2.0.0-rc',
    '2.0.0-RC.1',
    '2.0.0-beta.1',
    '2.0.0-rc.1+build.5',
    '2.0.0-rc.01',
    'v2.0.0',
    '2.0.0-rc.1-dryrun',
    '',
  ]) {
    assert.equal(parseReleaseVersion(bad), null, `${bad} should be refused`);
  }
});

test('a stable tag is a stable release: npm latest, normal GitHub release', () => {
  assert.deepEqual(classifyRelease({ refType: 'tag', refName: 'v1.8.2', pkgVersion: '1.8.2' }), {
    version: '1.8.2',
    kind: 'stable',
    npmTag: 'latest',
    prerelease: false,
    msiVersion: '',
    source: 'tag',
  });
});

test('an rc tag is a prerelease: npm next, prerelease GitHub release, numeric MSI version', () => {
  assert.deepEqual(
    classifyRelease({ refType: 'tag', refName: 'v2.0.0-rc.3', pkgVersion: '2.0.0-rc.3' }),
    {
      version: '2.0.0-rc.3',
      kind: 'rc',
      npmTag: 'next',
      prerelease: true,
      msiVersion: '2.0.0.3',
      source: 'tag',
    }
  );
});

test('a tag that does not match package.json is refused', () => {
  assert.throws(
    () => classifyRelease({ refType: 'tag', refName: 'v2.0.0-rc.1', pkgVersion: '2.0.0' }),
    /does not match package\.json/
  );
  assert.throws(
    () => classifyRelease({ refType: 'tag', refName: 'v2.0.0', pkgVersion: '2.0.0-rc.1' }),
    /does not match package\.json/
  );
});

test('a non-release tag is refused', () => {
  for (const t of ['v2.0.0-beta.1', 'v2.0.0-rc.1-dryrun', 'release-2', 'v2.0']) {
    assert.throws(
      () => classifyRelease({ refType: 'tag', refName: t, pkgVersion: '2.0.0' }),
      /not a release tag/,
      t
    );
  }
});

test('off a tag (a workflow_dispatch dry run) the version comes from package.json', () => {
  const r = classifyRelease({
    refType: 'branch',
    refName: 'v2-ci-dryrun-1',
    pkgVersion: '2.0.0-rc.1',
  });
  assert.equal(r.kind, 'rc');
  assert.equal(r.npmTag, 'next');
  assert.equal(r.source, 'package.json');
  assert.throws(
    () => classifyRelease({ refType: 'branch', refName: 'main', pkgVersion: '2.0.0-beta.1' }),
    /not a release version/
  );
});

test('an rc that cannot be an MSI version is refused before anything builds', () => {
  assert.throws(
    () => classifyRelease({ refType: 'branch', pkgVersion: '256.0.0-rc.1' }),
    /cannot be an MSI version/
  );
});

test('the CLI writes the step outputs the workflows read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-kind-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '2.0.0-rc.2' }));
    const out = join(dir, 'out.txt');
    const stdout = execFileSync(process.execPath, [join(ROOT, 'scripts', 'release-kind.mjs')], {
      cwd: dir,
      env: {
        ...process.env,
        GITHUB_REF_TYPE: 'tag',
        GITHUB_REF_NAME: 'v2.0.0-rc.2',
        GITHUB_OUTPUT: out,
        GITHUB_STEP_SUMMARY: '',
      },
      encoding: 'utf8',
    });
    assert.match(stdout, /release: 2\.0\.0-rc\.2 \(rc\)/);
    assert.match(stdout, /NOT touched: +hub-image/);
    const kv = Object.fromEntries(
      readFileSync(out, 'utf8')
        .trim()
        .split('\n')
        .map((l) => l.split('='))
    );
    assert.deepEqual(kv, {
      version: '2.0.0-rc.2',
      kind: 'rc',
      npm_tag: 'next',
      prerelease: 'true',
      msi_version: '2.0.0.2',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the CLI refuses a mismatched tag with a non-zero exit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-kind-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.8.1' }));
    assert.throws(
      () =>
        execFileSync(process.execPath, [join(ROOT, 'scripts', 'release-kind.mjs')], {
          cwd: dir,
          env: {
            ...process.env,
            GITHUB_REF_TYPE: 'tag',
            GITHUB_REF_NAME: 'v2.0.0-rc.1',
            GITHUB_OUTPUT: '',
          },
          stdio: 'pipe',
        }),
      (err) => err.status === 1 && /does not match package\.json/.test(String(err.stderr))
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
