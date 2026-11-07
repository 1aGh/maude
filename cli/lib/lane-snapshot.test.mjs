// #164 B1 (H1-H3) — the hook-side half of attributing a call by what it changed
// (contract apps/studio/client/v2/contracts/164-hash-diff-attribution.md §3, §6).
//
//   H1  laneSnapshot: a stat-only pass hashes nothing; `touch -r` shows through ctime; past the
//       budget sha is null and the manifest is incomplete
//   H2  laneDiff: created / deleted / changed; a same-bytes rewrite is not listed
//   H3  callCoverage: named | all | none over the contract's table
//
// Run: node --test cli/lib/lane-snapshot.test.mjs

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { callCoverage, laneDiff, laneSnapshot } from './bash-guard.mjs';
import { bashStatePath, hookStateDir, readState, removeState, writeState } from './hook-state.mjs';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function makeRoot() {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'maude-lane-')));
  const d = join(project, '.design');
  mkdirSync(join(d, 'ui'), { recursive: true });
  writeFileSync(join(d, 'config.json'), '{}');
  writeFileSync(join(d, 'ui', 'C.tsx'), 'export default 1;\n');
  writeFileSync(join(d, 'ui', 'C.meta.json'), '{}\n');
  writeFileSync(join(d, 'ui', 'Home.tsx'), 'export default 2;\n');
  writeFileSync(join(d, 'ui', 'Alligators Cinematic Cut.tsx'), 'export default 3;\n');
  mkdirSync(join(d, '_runs', 's'), { recursive: true });
  writeFileSync(join(d, '_runs', 's', 'x.tsx'), 'runtime');
  mkdirSync(join(project, 'scripts'));
  return { project, d };
}

describe('H1 laneSnapshot — the stat key, the prefilter and the budget', () => {
  let t;
  before(() => {
    t = makeRoot();
  });
  after(() => rmSync(t.project, { recursive: true, force: true }));

  test('lists the lane files only, with a sha256 and a four-part stat key', () => {
    const m = laneSnapshot(t.d);
    assert.equal(m.v, 1);
    assert.equal(m.complete, true);
    assert.deepEqual(Object.keys(m.files).sort(), [
      'ui/Alligators Cinematic Cut.tsx',
      'ui/C.meta.json',
      'ui/C.tsx',
      'ui/Home.tsx',
    ]);
    const e = m.files['ui/C.tsx'];
    assert.equal(e.length, 5);
    assert.equal(e[2], statSync(join(t.d, 'ui', 'C.tsx')).size);
    assert.equal(e[4], sha256(readFileSync(join(t.d, 'ui', 'C.tsx'))));
  });

  test('a stat-only pass (prev given, nothing changed) hashes nothing', () => {
    const pre = laneSnapshot(t.d);
    // a marker no real hash can equal: if the pass re-hashed, it would come back as the real sha
    for (const e of Object.values(pre.files)) e[4] = 'reused-not-rehashed';
    const post = laneSnapshot(t.d, { prev: pre });
    for (const e of Object.values(post.files)) assert.equal(e[4], 'reused-not-rehashed');
    assert.deepEqual(laneDiff(pre, post), []);
  });

  test('the cache is read too, and only on a matching key', () => {
    const cache = laneSnapshot(t.d);
    cache.files['ui/C.tsx'][4] = 'from-cache';
    cache.files['ui/Home.tsx'][2] += 1; // stale key: must be re-hashed
    cache.files['ui/Home.tsx'][4] = 'stale';
    const m = laneSnapshot(t.d, { cache });
    assert.equal(m.files['ui/C.tsx'][4], 'from-cache');
    assert.equal(m.files['ui/Home.tsx'][4], sha256('export default 2;\n'));
  });

  test('a same-size rewrite restored with touch -r is still seen (ctime)', () => {
    const f = join(t.d, 'ui', 'Home.tsx');
    const ref = join(t.project, 'ref-time');
    writeFileSync(ref, '');
    execFileSync('touch', ['-r', f, ref]); // ref carries f's exact timestamps
    const pre = laneSnapshot(t.d);
    const was = statSync(f, { bigint: true });
    writeFileSync(f, 'export default 9;\n'); // same size, other bytes
    execFileSync('touch', ['-r', ref, f]); // restore mtime (and atime) exactly
    assert.equal(statSync(f, { bigint: true }).mtimeNs, was.mtimeNs);
    const post = laneSnapshot(t.d, { prev: pre });
    assert.notEqual(post.files['ui/Home.tsx'][1], pre.files['ui/Home.tsx'][1]);
    assert.equal(post.files['ui/Home.tsx'][0], pre.files['ui/Home.tsx'][0]); // mtime alone saw nothing
    assert.deepEqual(
      laneDiff(pre, post).map((x) => [x.path, x.sha]),
      [['ui/Home.tsx', sha256('export default 9;\n')]]
    );
    writeFileSync(f, 'export default 2;\n');
  });

  test('past the budget: sha null and complete false', () => {
    const m = laneSnapshot(t.d, { budgetMs: 0 });
    assert.equal(m.complete, false);
    for (const e of Object.values(m.files)) assert.equal(e[4], null);
  });

  test('past maxFiles / maxEntries: the rest is left out and complete is false', () => {
    assert.equal(laneSnapshot(t.d, { maxFiles: 2 }).complete, false);
    assert.equal(Object.keys(laneSnapshot(t.d, { maxFiles: 2 }).files).length, 2);
    assert.equal(laneSnapshot(t.d, { maxEntries: 1 }).complete, false);
  });
});

describe('H2 laneDiff — created, deleted, changed; a same-bytes rewrite is not listed', () => {
  let t;
  before(() => {
    t = makeRoot();
  });
  after(() => rmSync(t.project, { recursive: true, force: true }));

  test('the four cases', async () => {
    const pre = laneSnapshot(t.d);
    await new Promise((r) => setTimeout(r, 15));
    writeFileSync(join(t.d, 'ui', 'C.tsx'), 'export default 100;\n'); // changed
    writeFileSync(join(t.d, 'ui', 'Home.tsx'), 'export default 2;\n'); // same bytes (sed -i, no match)
    rmSync(join(t.d, 'ui', 'C.meta.json')); // deleted
    writeFileSync(join(t.d, 'ui', 'New Board.tsx'), 'export default 4;\n'); // created
    const post = laneSnapshot(t.d, { prev: pre });
    assert.deepEqual(laneDiff(pre, post), [
      { path: 'ui/C.meta.json', sha: null, created: false, deleted: true },
      { path: 'ui/C.tsx', sha: sha256('export default 100;\n'), created: false, deleted: false },
      {
        path: 'ui/New Board.tsx',
        sha: sha256('export default 4;\n'),
        created: true,
        deleted: false,
      },
    ]);
  });

  test('a file with no pre-hash (past the budget) whose stat changed is sent with sha null', async () => {
    const pre = laneSnapshot(t.d, { budgetMs: 0 });
    await new Promise((r) => setTimeout(r, 15));
    writeFileSync(join(t.d, 'ui', 'Home.tsx'), 'export default 77;\n');
    const post = laneSnapshot(t.d, { prev: pre });
    const d = laneDiff(pre, post).find((x) => x.path === 'ui/Home.tsx');
    assert.deepEqual(d, { path: 'ui/Home.tsx', sha: null, created: false, deleted: false });
  });

  test('an incomplete pre proves no create, an incomplete post proves no delete', () => {
    const full = laneSnapshot(t.d);
    const partial = laneSnapshot(t.d, { maxFiles: 1 });
    assert.equal(partial.complete, false);
    const created = laneDiff(partial, full).filter((x) => x.created);
    assert.deepEqual(created, []);
    assert.deepEqual(
      laneDiff(full, partial).filter((x) => x.deleted),
      []
    );
  });

  test('garbage in, nothing out', () => {
    assert.deepEqual(laneDiff(null, null), []);
    assert.deepEqual(laneDiff({}, { files: {} }), []);
  });
});

describe('H3 callCoverage — named | all | none', () => {
  let t;
  before(() => {
    t = makeRoot();
    writeFileSync(join(t.project, 'scripts', 'other.py'), 'print("hi")\n');
    writeFileSync(join(t.project, 'scripts', 'gen.py'), "root = '.design'\nprint(root)\n");
    writeFileSync(join(t.project, 'scripts', 'names.py'), "open('ui/Home.tsx', 'w')\n");
  });
  after(() => rmSync(t.project, { recursive: true, force: true }));
  const cov = (command, cwd = t.project) => callCoverage(t.d, cwd, command);

  test('a build, a test run, git: none', () => {
    for (const c of [
      'pnpm test',
      'bun test',
      'npm run build && git status',
      'git pull',
      'python3 scripts/other.py',
      'sed -i "" s/a/b/ notes.txt',
    ])
      assert.deepEqual(cov(c), { mode: 'none', files: [] }, c);
  });

  test('the S7 heredoc names its canvas: named', () => {
    const c = cov(
      `cd ${t.d}/ui && python3 - <<'EOF'\np='Alligators Cinematic Cut.tsx'\nopen(p,'w')\nEOF`
    );
    assert.deepEqual(c, { mode: 'named', files: ['ui/Alligators Cinematic Cut.tsx'] });
  });

  test('a new file the command names (a create) is named', () => {
    const c = cov(`python3 -c "open('.design/ui/New Board.tsx','w')"`);
    assert.deepEqual(c, { mode: 'named', files: ['ui/New Board.tsx'] });
  });

  test('a lane path that resolves outside the design root is not covered', () => {
    assert.deepEqual(cov(`python3 -c "open('src/Other.tsx','w')"`), { mode: 'none', files: [] });
  });

  test('node -e naming Home.tsx with the cwd inside the design root: named', () => {
    const c = cov(`node -e "require('fs').writeFileSync('Home.tsx','x')"`, join(t.d, 'ui'));
    assert.deepEqual(c, { mode: 'named', files: ['ui/Home.tsx'] });
  });

  test('a relative create resolves against the cwd', () => {
    const c = cov(`node -e "require('fs').writeFileSync('Fresh.tsx','x')"`, join(t.d, 'ui'));
    assert.deepEqual(c, { mode: 'named', files: ['ui/Fresh.tsx'] });
  });

  test('a glob over the design root names nothing: all', () => {
    assert.deepEqual(cov('sed -i "" s/Hi/Yo/ .design/ui/*.tsx'), { mode: 'all', files: [] });
    assert.deepEqual(cov("find .design -name '*.tsx' -exec sed -i '' s/a/b/ {} +"), {
      mode: 'all',
      files: [],
    });
  });

  test('a script that mentions the design root: all; one that names a canvas: named', () => {
    assert.deepEqual(cov('python3 scripts/gen.py'), { mode: 'all', files: [] });
    assert.deepEqual(cov('python3 scripts/names.py'), {
      mode: 'named',
      files: ['ui/Home.tsx'],
    });
  });

  test('a script past scriptMaxBytes is not read', () => {
    assert.deepEqual(
      callCoverage(t.d, t.project, 'python3 scripts/gen.py', { scriptMaxBytes: 4 }),
      {
        mode: 'none',
        files: [],
      }
    );
  });

  test('a script outside the project is not read', () => {
    const out = realpathSync(mkdtempSync(join(tmpdir(), 'maude-lane-out-')));
    writeFileSync(join(out, 'evil.py'), "x = '.design'\n");
    try {
      assert.deepEqual(cov(`python3 ${out}/evil.py`), { mode: 'none', files: [] });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test('a cwd inside the design root: all', () => {
    assert.deepEqual(cov('python3 -c "pass"', join(t.d, 'ui')), { mode: 'all', files: [] });
    assert.deepEqual(cov('cd .design/ui && python3 -c "pass"'), { mode: 'all', files: [] });
  });

  test('the absolute design root in the text: all', () => {
    assert.deepEqual(cov(`python3 -c "import os; os.listdir('${t.d}')"`), {
      mode: 'all',
      files: [],
    });
  });

  test('a runtime folder is never covered', () => {
    assert.deepEqual(cov(`python3 -c "open('.design/_runs/s/x.tsx','w')"`).files, []);
  });

  test('not a command: none', () => {
    assert.deepEqual(callCoverage(t.d, t.project, ''), { mode: 'none', files: [] });
    assert.deepEqual(callCoverage(t.d, t.project, undefined), { mode: 'none', files: [] });
  });
});

describe('hook-state — outside the project, 0600', () => {
  test('MAUDE_HOOK_STATE_HOME decides the folder; files are 0600, dirs 0700; a torn file reads as null', () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'maude-hs-')));
    const env = { MAUDE_HOOK_STATE_HOME: home };
    try {
      const p = bashStatePath('/some/root', 'sess', 'toolu_1', env);
      assert.ok(p.startsWith(hookStateDir('/some/root', env)));
      assert.ok(p.startsWith(home));
      writeState(p, { v: 1 });
      assert.deepEqual(readState(p), { v: 1 });
      assert.equal(statSync(p).mode & 0o777, 0o600);
      assert.equal(statSync(join(p, '..')).mode & 0o777, 0o700);
      writeFileSync(p, '{"v":');
      assert.equal(readState(p), null);
      removeState(p);
      assert.equal(readState(p, 'gone'), 'gone');
      assert.equal(bashStatePath('/r', '../x', 'a', env), null);
      assert.equal(bashStatePath('/r', 's', 'a/b', env), null);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
