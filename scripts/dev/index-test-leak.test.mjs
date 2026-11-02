// scripts/dev/index-test-leak.mjs on a fixture index: it lists exactly the unregistered test
// projects (temp roots, e2e app dirs, worktrees, journey/eval scratch, no index.json), keeps every
// registered pid or root, deletes nothing without --apply, and with --apply removes exactly those.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { apply, readRegistry, scan } from './index-test-leak.mjs';

const TOOL = fileURLToPath(new URL('./index-test-leak.mjs', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'maude-index-leak-'));
after(() => rmSync(work, { recursive: true, force: true }));

const pid = (n) => `l${String(n).padStart(16, '0')}`;
function fixture() {
  const idx = mkdtempSync(join(work, 'idx-'));
  const projects = join(idx, 'projects');
  const put = (n, root) => {
    mkdirSync(join(projects, pid(n), 'thumbs'), { recursive: true });
    if (root !== undefined)
      writeFileSync(join(projects, pid(n), 'index.json'), JSON.stringify({ project: { root } }));
  };
  put(1, '/Users/m/git/real-project'); // a real project, not registered: kept (not a temp root)
  put(2, '/var/folders/ab/xyz/T/maude-e2e-cell-123/proj'); // test
  put(3, '/private/tmp/maude-boot-gate-src-1/p'); // test
  put(4, '/Users/m/Library/Application Support/com.maude.app.e2e/projects/x'); // e2e app
  put(5, '/Users/m/git/maude/.claude/worktrees/agent-1/fixture'); // worktree
  put(6, '/Users/m/Downloads/maude-agent-journeys/2026/S1/project'); // journeys
  put(7); // no index.json
  put(8, '/var/folders/ab/xyz/T/registered-by-pid'); // temp root, but its pid is registered
  put(9, '/tmp/registered-by-root'); // temp root, but its root is registered
  mkdirSync(join(projects, 'not-a-pid'), { recursive: true }); // ignored entirely
  symlinkSync(join(projects, pid(2)), join(projects, pid(10))); // a symlink is never followed
  const reg = join(idx, 'app-state.json');
  writeFileSync(
    reg,
    JSON.stringify({
      projects: { [pid(8)]: { root: '/elsewhere' } },
      recent: [pid(11)],
      recent_projects: ['/tmp/registered-by-root'],
    })
  );
  return { idx, projects, reg };
}

test('lists exactly the unregistered test projects, by category', () => {
  const { idx, reg } = fixture();
  const r = scan(idx, readRegistry(reg));
  assert.equal(r.total, 9);
  const got = Object.fromEntries(r.candidates.map((c) => [c.pid, c.category]));
  assert.deepEqual(got, {
    [pid(2)]: 'var-folders',
    [pid(3)]: 'tmp',
    [pid(4)]: 'e2e-app',
    [pid(5)]: 'worktree',
    [pid(6)]: 'agent-journeys',
    [pid(7)]: 'no-index',
  });
  assert.equal(r.kept, 3);
});

test('a dry run deletes nothing; --apply removes exactly the listed dirs', () => {
  const { idx, projects, reg } = fixture();
  const before = readdirSync(projects).sort();
  const dry = execFileSync('node', [TOOL, '--index-dir', idx, '--registry', reg], {
    encoding: 'utf8',
  });
  assert.match(dry, /9 projects · 3 kept · 6 test leftovers/);
  assert.match(dry, /dry run — nothing deleted/);
  assert.deepEqual(readdirSync(projects).sort(), before);
  const out = execFileSync('node', [TOOL, '--index-dir', idx, '--registry', reg, '--apply'], {
    encoding: 'utf8',
  });
  assert.match(out, /removed 6 project dirs/);
  assert.deepEqual(
    readdirSync(projects).sort(),
    [pid(1), pid(8), pid(9), pid(10), 'not-a-pid'].sort()
  );
});

test('--apply refuses without a registry, and never deletes outside <index>/projects', () => {
  const { idx } = fixture();
  assert.throws(
    () =>
      execFileSync(
        'node',
        [TOOL, '--index-dir', idx, '--registry', join(idx, 'nope.json'), '--apply'],
        {
          stdio: 'pipe',
        }
      ),
    /status 2|Command failed/
  );
  assert.throws(
    () => apply(idx, [{ pid: pid(1), dir: join(work, 'elsewhere', pid(1)) }]),
    /refusing/
  );
  assert.ok(existsSync(join(idx, 'projects', pid(1))));
});
