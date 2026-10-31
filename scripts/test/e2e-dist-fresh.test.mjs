// p8-e2e-fix-r12: a studio the e2e lane starts from source refuses to boot on a client bundle older than the client.
//
// share-roles went red for r12 (petra read "Can comment" where /_config.access said observer). The studios the
// lane starts from the worktree (share-roles bootStudio + the cell's studio, team-project's teammate) serve
// apps/studio/dist/client.bundle.js. The committed copy (e02b251cb, Oct 26) predates 22 client commits, among
// them 7464cd65e (the share cluster's word), and the test-lane wrapper puts dist back to it after every run.
// r11 had passed right after a client release build. A fresh build turned it green.
//
// Freshness: a committed file counts at its last commit time; a file with uncommitted changes counts at its mtime.
// mtime alone lies after a checkout (git stamps every file with the checkout time).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const E2E = new URL('../../apps/desktop/e2e/', import.meta.url);
const { staleClientDist, assertFreshClientDist, normalizeClientSource } = await import(
  new URL('helpers/dist-fresh.ts', E2E).href
);
const read = (rel) => readFileSync(new URL(rel, E2E), 'utf8');

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'r12-dist-'));
  const studio = join(root, 'apps', 'studio');
  mkdirSync(join(studio, 'client', 'v2'), { recursive: true });
  mkdirSync(join(studio, 'dist'), { recursive: true });
  const git = (args, date) =>
    execFileSync('git', args, {
      cwd: root,
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
        ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
      },
    });
  git(['init', '-q']);
  const commit = (rel, text, date) => {
    writeFileSync(join(studio, rel), text);
    git(['add', '-A']);
    git(['commit', '-q', '-m', rel], date);
  };
  return { root, studio, commit, done: () => rmSync(root, { recursive: true, force: true }) };
}

test('a bundle committed before a later client commit is stale', () => {
  const r = repo();
  try {
    r.commit('dist/client.bundle.js', 'old', '2026-10-26T10:25:57+01:00');
    r.commit('client/v2/share.jsx', 'word', '2026-10-27T03:39:58+01:00');
    assert.match(staleClientDist(r.studio), /older than/);
    assert.throws(() => assertFreshClientDist(r.studio), /client bundle is older than/);
  } finally {
    r.done();
  }
});

test('a whitespace-only client commit after the bundle (a re-format) does not make it stale', () => {
  const r = repo();
  try {
    r.commit('client/v2/share.jsx', 'const a = 1;\n', '2026-10-30T14:00:00+01:00');
    r.commit('dist/client.bundle.js', 'built', '2026-10-30T15:00:58+01:00');
    r.commit('client/v2/share.jsx', 'const a =\n  1;\n', '2026-10-30T15:06:11+01:00');
    assert.equal(staleClientDist(r.studio), null);
    r.commit('client/v2/share.jsx', 'const a = 2;\n', '2026-10-30T15:10:00+01:00');
    assert.match(staleClientDist(r.studio), /older than/);
  } finally {
    r.done();
  }
});

// p8-sec3-lows (defender L1): the exemption used to strip ALL whitespace, so a commit that changed text a user reads
// ('Sign in' -> 'Signin') after the bundle was built counted the stale bundle as fresh.
const wsEdit = (name, before, after, reformat) =>
  test(`a whitespace edit inside ${name} after the bundle makes it stale`, () => {
    const r = repo();
    try {
      r.commit('client/v2/share.jsx', before, '2026-10-30T14:00:00+01:00');
      r.commit('dist/client.bundle.js', 'built', '2026-10-30T15:00:58+01:00');
      r.commit('client/v2/share.jsx', after, '2026-10-30T15:06:11+01:00');
      assert.match(staleClientDist(r.studio), /older than/);
      if (reformat) {
        // …while a pure re-wrap of the same literal-bearing file stays exempt
        r.commit('client/v2/share.jsx', before, '2026-10-30T15:30:00+01:00');
        r.commit('dist/client.bundle.js', 'built2', '2026-10-30T15:40:00+01:00');
        r.commit('client/v2/share.jsx', reformat, '2026-10-30T15:50:00+01:00');
        assert.equal(staleClientDist(r.studio), null);
      }
    } finally {
      r.done();
    }
  });
wsEdit(
  'a string literal',
  "const a = 'Sign in';\n",
  "const a = 'Signin';\n",
  "const a =\n  'Sign in';\n"
);
wsEdit('a double-quoted string', 'const a = "Sign in";\n', 'const a = "Sign  in";\n');
wsEdit('a template literal', 'const a = `Sign in ${x}`;\n', 'const a = `Signin ${x}`;\n');
wsEdit('a regex source', 'const a = /a, b/;\n', 'const a = /a,b/;\n');
wsEdit(
  'JSX text',
  'f(<b>Sign in, now</b>);\n',
  'f(<b>Sign in,now</b>);\n',
  'f(\n  <b>\n    Sign in, now\n  </b>\n);\n'
);
wsEdit('a gap between two words in code', 'const a = x in y;\n', 'const a = xin y;\n');

// p8-comment-gate (final-3 defender I4 + attacker I1): whitespace the scan still dropped although it changes what runs
// or what a reader sees — ASI after `return`/`throw`/`break`/`continue`/`yield` and before `++`/`--`, a template nested
// in a template, and literals inside the JSX-text candidate after a `>` that is a comparison or a generic.
wsEdit(
  'code: a newline after return (ASI returns undefined)',
  'function f() { return x }\n',
  'function f() { return\n  x }\n',
  'function f() {\n  return x\n}\n'
);
wsEdit(
  'code: a newline after throw / break / continue / yield',
  'function* f() { yield x; for (;;) { break l; } }\n',
  'function* f() { yield\n x; for (;;) { break\n l; } }\n'
);
wsEdit(
  'code: a newline after return behind a block comment',
  'function f() { return /* c */ x }\n',
  'function f() { return /*\n c */ x }\n'
);
wsEdit('code: a newline before ++ (ASI ends the line)', 'x = a\n++b\n', 'x = a++\nb\n');
wsEdit(
  'a template nested in a template',
  'const a = `x ${`Sign in`}`;\n',
  'const a = `x ${`Sign  in`}`;\n',
  'const a =\n  `x ${`Sign in`}`;\n'
);
wsEdit(
  'a template after a comparison (the JSX-text candidate)',
  'const a = n > 1 ? `x\ny` : z;\n',
  'const a = n > 1 ? `x\n  y` : z;\n'
);
wsEdit(
  'a tab inside a string after a comparison',
  "const a = n > 1 ? 'x\ty' : z;\n",
  "const a = n > 1 ? 'x y' : z;\n"
);
wsEdit(
  'an indent inside a template after a generic',
  'const a = f<T>(`x\ny`);\n',
  'const a = f<T>(`x\n  y`);\n'
);

test('the real re-format commit 5f88d88e5 (a re-wrapped string) stays exempt', (t) => {
  const repoRoot = new URL('../../', import.meta.url).pathname;
  const g = (...args) =>
    execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  try {
    g('cat-file', '-e', '5f88d88e5^{commit}');
  } catch {
    t.skip('5f88d88e5 is not in this clone');
    return;
  }
  const files = g('diff', '--name-only', '5f88d88e5^', '5f88d88e5', '--', 'apps/studio/client')
    .split('\n')
    .filter((f) => f && !f.endsWith('.css') && !f.endsWith('.md'));
  assert.ok(files.length > 0);
  for (const f of files)
    assert.equal(
      normalizeClientSource(g('show', `5f88d88e5^:${f}`)),
      normalizeClientSource(g('show', `5f88d88e5:${f}`)),
      f
    );
});

test('re-indenting and re-wrapping code with literals around stays exempt', () => {
  const r = repo();
  try {
    const before =
      "export function f(a, b) { return a ? 'Sign in' : /x y/.test(b) ? `n ${a}` : <i>Hi there</i>; } // note\n";
    const after =
      "export function f(a, b) {\n  return a\n    ? 'Sign in'\n    : /x y/.test(b)\n      ? `n ${a}`\n      : <i>\n          Hi there\n        </i>;\n} // note\n";
    r.commit('client/v2/share.jsx', before, '2026-10-30T14:00:00+01:00');
    r.commit('dist/client.bundle.js', 'built', '2026-10-30T15:00:58+01:00');
    r.commit('client/v2/share.jsx', after, '2026-10-30T15:06:11+01:00');
    assert.equal(staleClientDist(r.studio), null);
  } finally {
    r.done();
  }
});

test('a markdown commit under client/ (a v2 contract) after the bundle does not make it stale', () => {
  const r = repo();
  try {
    r.commit('client/v2/share.jsx', 'word', '2026-10-30T14:00:00+01:00');
    r.commit('dist/client.bundle.js', 'built', '2026-10-30T15:00:58+01:00');
    r.commit('client/v2/CONTRACT.md', 'a row', '2026-10-30T19:28:29+01:00');
    assert.equal(staleClientDist(r.studio), null);
  } finally {
    r.done();
  }
});

test('a bundle committed after the last client commit is fresh', () => {
  const r = repo();
  try {
    r.commit('client/v2/share.jsx', 'word', '2026-10-27T03:39:58+01:00');
    r.commit('dist/client.bundle.js', 'new', '2026-10-27T04:00:00+01:00');
    assert.equal(staleClientDist(r.studio), null);
  } finally {
    r.done();
  }
});

test('a rebuilt bundle (uncommitted, written now) over a stale committed one is fresh', () => {
  const r = repo();
  try {
    r.commit('dist/client.bundle.js', 'old', '2026-10-26T10:25:57+01:00');
    r.commit('client/v2/share.jsx', 'word', '2026-10-27T03:39:58+01:00');
    writeFileSync(join(r.studio, 'dist', 'client.bundle.js'), 'rebuilt');
    assert.equal(staleClientDist(r.studio), null);
  } finally {
    r.done();
  }
});

test('an uncommitted client edit newer than the bundle is stale', () => {
  const r = repo();
  try {
    r.commit('client/v2/share.jsx', 'word', '2026-10-27T03:39:58+01:00');
    writeFileSync(join(r.studio, 'dist', 'client.bundle.js'), 'rebuilt');
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(r.studio, 'dist', 'client.bundle.js'), past, past);
    writeFileSync(join(r.studio, 'client', 'v2', 'share.jsx'), 'edited after the build');
    assert.match(staleClientDist(r.studio), /older than/);
  } finally {
    r.done();
  }
});

// 2026-10-28 V2-8.3 record: 1b798abf4 re-wrote client/styles/1-tokens-shell.css (formatting) after the release
// build, and share-roles refused to boot on a bundle a rebuild reproduced byte for byte. CSS is the separate
// styles.css bundle (build.ts, client/styles/_index.css); no .css file is an input of client.bundle.js.
test('a CSS commit after the bundle does not make the JS bundle stale', () => {
  const r = repo();
  try {
    mkdirSync(join(r.studio, 'client', 'styles'), { recursive: true });
    r.commit('client/v2/share.jsx', 'word', '2026-10-27T03:39:58+01:00');
    r.commit('dist/client.bundle.js', 'new', '2026-10-27T21:01:43+01:00');
    r.commit('client/styles/1-tokens-shell.css', ':root{}', '2026-10-27T21:29:44+01:00');
    assert.equal(staleClientDist(r.studio), null);
    writeFileSync(join(r.studio, 'client', 'styles', '1-tokens-shell.css'), ':root{--x:1}');
    assert.equal(
      staleClientDist(r.studio),
      null,
      'an uncommitted CSS edit is not a bundle input either'
    );
  } finally {
    r.done();
  }
});

test('every studio the lane starts from source checks the bundle first', () => {
  const stand = read('share-roles/stand-up.mjs');
  const boot = stand.slice(stand.indexOf('async function bootStudio'));
  assert.match(boot.slice(0, 400), /assertFreshClientDist\(/);
  const cell = stand.slice(
    stand.indexOf('MAUDE_STUDIO_SRC') - 3000,
    stand.indexOf('MAUDE_STUDIO_SRC')
  );
  assert.match(cell, /assertFreshClientDist\(/);
  const team = read('wdio.team-project.conf.ts');
  const spawnAt = team.indexOf("join(ROOT, 'apps/studio/server.ts')");
  assert.match(team.slice(spawnAt - 600, spawnAt), /assertFreshClientDist\(/);
});
