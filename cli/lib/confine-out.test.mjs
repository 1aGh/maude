// confine-out.test.mjs — contract V2-1.11 §5.3 / §7 (V2-2.8 S4): every `maude design` verb with an
// output flag refuses a path outside the project or the temp dir, BEFORE the helper runs.
//
// Run: node --test cli/lib/confine-out.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { allowedRoots, outputArgs, outputViolation } from './confine-out.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAUDE = join(ROOT, 'cli', 'bin', 'maude.mjs');

// A project that is NOT under the OS temp dir, so "outside the project" can't hide inside the temp
// allowance: a fresh dir under the repo's own (gitignored) scratch area.
function project() {
  const base = join(ROOT, 'node_modules', '.cache');
  mkdirSync(base, { recursive: true });
  const p = realpathSync(mkdtempSync(join(base, 'confine-out-')));
  // a Maude project root (findProjectRoot), so its parent — this repo — is not the root
  mkdirSync(join(p, '.design'), { recursive: true });
  writeFileSync(join(p, '.design', 'config.json'), '{}');
  return p;
}

test('outputArgs finds --out, --out-dir, --output in both forms', () => {
  assert.deepEqual(outputArgs(['--out', 'a', '--out-dir=b', '--output', 'c', '--outx', 'd']), [
    { flag: '--out', value: 'a' },
    { flag: '--out-dir', value: 'b' },
    { flag: '--output', value: 'c' },
  ]);
});

test('inside the project and the temp dir pass; /tmp/../etc and ~ are refused', () => {
  const p = project();
  try {
    const ok = [
      ['--out', 'shots/a.png'],
      ['--out', join(p, '.design', '_history', 'x.png')],
      ['--out-dir', join(tmpdir(), 'va-1')],
      ['--out', '/tmp/x.png'],
      ['--output', '-'],
    ];
    for (const args of ok) assert.equal(outputViolation(args, { cwd: p, projectDir: '' }), null);
    const bad = [
      ['--out', '/tmp/../etc/x'],
      ['--out', join(homedir(), 'x')],
      ['--out-dir=/etc'],
      ['--out', '../x'],
      ['--output', '/etc/passwd'],
      // relative to an outside --root: one of the two bases escapes
      ['--root', homedir(), '--out', '.zshenv'],
    ];
    for (const args of bad) {
      assert.notEqual(outputViolation(args, { cwd: p, projectDir: '' }), null, args.join(' '));
    }
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

// V2-8.9 M2 — in the Maude AI chat the temp dir is the chat's scratch (TMPDIR); the shared /tmp is
// no output root.
test('in the Maude AI chat, /tmp is not an output root; the temp dir still is', () => {
  const p = project();
  const prev = process.env.MAUDE_AGENT_ACTOR;
  process.env.MAUDE_AGENT_ACTOR = 'maude-chat';
  try {
    if (realpathSync(tmpdir()) !== realpathSync('/tmp'))
      assert.notEqual(outputViolation(['--out', '/tmp/x.png'], { cwd: p, projectDir: '' }), null);
    assert.equal(
      outputViolation(['--out', join(tmpdir(), 'x.png')], { cwd: p, projectDir: '' }),
      null
    );
  } finally {
    if (prev === undefined) delete process.env.MAUDE_AGENT_ACTOR;
    else process.env.MAUDE_AGENT_ACTOR = prev;
    rmSync(p, { recursive: true, force: true });
  }
});

test('a symlink inside the project that points out of it is refused', () => {
  const p = project();
  try {
    symlinkSync(homedir(), join(p, 'home-link'));
    assert.notEqual(
      outputViolation(['--out', 'home-link/.zshenv'], { cwd: p, projectDir: '' }),
      null
    );
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test('`..` after a symlink and a dangling link resolve as the kernel does', () => {
  const p = project();
  try {
    symlinkSync('/usr/bin', join(p, 'bin-link'));
    symlinkSync(`/etc/maude-dangling-${process.pid}`, join(p, 'dang'));
    for (const v of ['bin-link/../maude-probe', 'dang', `${p}/bin-link/../../x`])
      assert.notEqual(outputViolation(['--out', v], { cwd: p, projectDir: '' }), null, v);
    assert.equal(outputViolation(['--out', '.design/../x'], { cwd: p, projectDir: '' }), null);
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test('the roots are the project root (not the cwd) and the temp dir (§5.3)', () => {
  const p = project();
  try {
    mkdirSync(join(p, 'sub'), { recursive: true });
    // from a subdirectory, the whole project is in bounds
    assert.equal(
      outputViolation(['--out', '../x.png'], { cwd: join(p, 'sub'), projectDir: '' }),
      null
    );
    // a cwd that is no project is not a root: `--out x` from ~ would land in ~
    assert.ok(!allowedRoots({ cwd: homedir(), projectDir: '' }).includes(realpathSync(homedir())));
    assert.notEqual(
      outputViolation(['--out', '.zshenv'], { cwd: homedir(), projectDir: '' }),
      null
    );
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

// The dispatcher refuses before spawning the helper. Three verbs that are harmless to run if the
// gate were missing (red phase): slug, svg-optimize, curl-local (nothing listens on that port).
test('`maude design <verb> --out /tmp/../etc/x` exits 2 before the helper runs', () => {
  const p = project();
  try {
    const cases = [
      ['slug', 'foo', '--out', '/tmp/../etc/maude-confine-probe'],
      ['svg-optimize', '--out', '/tmp/../etc/maude-confine-probe'],
      ['curl-local', 'http://127.0.0.1:9/', '--output', '/tmp/../etc/maude-confine-probe'],
      ['slug', 'foo', `--out=${join(homedir(), '..', '..', 'etc', 'maude-confine-probe')}`],
      // V2-8.9 B2 — agent-browser-safe's screenshot path is a positional, not a flag.
      ['agent-browser-safe', 'screenshot', '/tmp/../etc/maude-confine-probe.png'],
    ];
    for (const args of cases) {
      const r = spawnSync(process.execPath, [MAUDE, 'design', ...args], {
        cwd: p,
        encoding: 'utf8',
        input: '<svg/>',
        env: { ...process.env, CLAUDE_PROJECT_DIR: p, MAUDE_NO_UPDATE_CHECK: '1' },
        timeout: 20000,
      });
      assert.match(r.stderr, /Pick a path inside the project/, args.join(' '));
      assert.equal(r.status, 2, args.join(' '));
    }
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});
