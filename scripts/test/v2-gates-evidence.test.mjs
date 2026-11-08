// #168 A — a command gate's evidence file is something anyone who can write the tree can author (a lane
// agent, a sync peer). A record therefore counts only with a MAC under a key kept OUTSIDE the tree, that
// `--record` creates on first use (0600). The key here always comes from a temp path: a test never reads
// or writes the real one under HOME.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/v2-gates.mjs');
const HEAD = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const QUALITY = JSON.parse(readFileSync(join(ROOT, '.ai/workflows.config.json'), 'utf8')).quality;
const QUALITY_HASH = createHash('sha256').update(JSON.stringify(QUALITY)).digest('hex');
const GATE = 'V2-8.2';
const CMD = spawnSync('node', [SCRIPT, '--cmd', GATE], {
  cwd: ROOT,
  encoding: 'utf8',
}).stdout.replace(/\n$/, '');

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'v2-gates-ev-'));
  return { dir, evidence: join(dir, 'gates'), key: join(dir, 'key', 'evidence.key') };
}
const run = (s, extra = []) =>
  spawnSync('node', [SCRIPT, ...extra], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, V2_GATES_EVIDENCE_DIR: s.evidence, V2_GATES_KEY_FILE: s.key },
  });
const line = (out, id) => out.split('\n').find((l) => l.includes(` ${id} `)) ?? '';
/** A record every other check accepts: the real command, HEAD, the current quality hash. */
const record = (over = {}) => ({
  gate: GATE,
  pass: true,
  exit: 0,
  head: HEAD,
  ts: new Date().toISOString(),
  cmd: CMD,
  qualityHash: QUALITY_HASH,
  log: 'ok\n',
  ...over,
});
function plant(s, ev) {
  spawnSync('mkdir', ['-p', s.evidence]);
  writeFileSync(join(s.evidence, `${GATE}.json`), JSON.stringify(ev));
}

test('a forged command record (no MAC) is refused', async () => {
  const s = scratch();
  try {
    plant(s, record());
    assert.match(line(run(s).stdout, GATE), /^FAIL .*stale — .*(signed|gate key)/);
    // with a key on this machine: no MAC, or a made-up one, is no better
    const { readGateKey } = await import('../lib/gate-evidence.mjs');
    readGateKey({ env: { V2_GATES_KEY_FILE: s.key }, repoRoot: ROOT, create: true });
    assert.match(line(run(s).stdout, GATE), /^FAIL .*stale — not signed/);
    plant(s, record({ mac: 'ab'.repeat(32) }));
    assert.match(line(run(s).stdout, GATE), /^FAIL .*stale — .*signed/);
  } finally {
    rmSync(s.dir, { recursive: true, force: true });
  }
});

test('a record signed with the gate key counts; any signed field changed afterwards does not', async () => {
  const { evidenceMac, readGateKey } = await import('../lib/gate-evidence.mjs');
  const s = scratch();
  try {
    const key = readGateKey({ env: { V2_GATES_KEY_FILE: s.key }, repoRoot: ROOT, create: true });
    assert.ok(Buffer.isBuffer(key), String(key?.error));
    // created on first use, owner-only
    assert.equal(statSync(s.key).mode & 0o777, 0o600);
    assert.equal(statSync(join(s.dir, 'key')).mode & 0o777, 0o700);
    const ev = record();
    plant(s, { ...ev, mac: evidenceMac(key, ev) });
    assert.match(line(run(s).stdout, GATE), /^PASS /);
    for (const over of [{ log: 'forged\n' }, { exit: 1 }, { cmd: `${CMD} ` }]) {
      plant(s, { ...ev, mac: evidenceMac(key, ev), ...over });
      assert.match(line(run(s).stdout, GATE), /^FAIL /, JSON.stringify(over));
    }
    // signed under another key → refused
    const other = readGateKey({
      env: { V2_GATES_KEY_FILE: join(s.dir, 'other', 'k') },
      repoRoot: ROOT,
      create: true,
    });
    plant(s, { ...ev, mac: evidenceMac(other, ev) });
    assert.match(line(run(s).stdout, GATE), /^FAIL .*signed/);
  } finally {
    rmSync(s.dir, { recursive: true, force: true });
  }
});

test('the key is refused inside the tree, through a symlink, or readable by others', async () => {
  const { readGateKey } = await import('../lib/gate-evidence.mjs');
  const s = scratch();
  try {
    const inTree = readGateKey({
      env: { V2_GATES_KEY_FILE: join(ROOT, '.ai', 'never-a-key') },
      repoRoot: ROOT,
      create: true,
    });
    assert.ok(inTree?.error && /inside the repository/.test(inTree.error), String(inTree?.error));
    assert.throws(() => statSync(join(ROOT, '.ai', 'never-a-key')));
    const key = readGateKey({ env: { V2_GATES_KEY_FILE: s.key }, repoRoot: ROOT, create: true });
    assert.ok(Buffer.isBuffer(key));
    chmodSync(s.key, 0o644);
    const loose = readGateKey({ env: { V2_GATES_KEY_FILE: s.key }, repoRoot: ROOT });
    assert.ok(loose?.error && /readable/.test(loose.error), String(loose?.error));
    chmodSync(s.key, 0o600);
    const link = join(s.dir, 'link.key');
    spawnSync('ln', ['-s', s.key, link]);
    const viaLink = readGateKey({ env: { V2_GATES_KEY_FILE: link }, repoRoot: ROOT });
    assert.ok(viaLink?.error, 'a symlinked key is refused');
    // a missing key is never created by a plain check
    const none = readGateKey({ env: { V2_GATES_KEY_FILE: join(s.dir, 'absent') }, repoRoot: ROOT });
    assert.ok(none?.error);
    assert.throws(() => statSync(join(s.dir, 'absent')));
  } finally {
    rmSync(s.dir, { recursive: true, force: true });
  }
});

test('--carry refuses to carry an unsigned "green full run"', (t) => {
  // --carry first refuses a dirty tree (uncommitted product changes), which says nothing about the MAC
  if (spawnSync('git', ['diff', '--quiet', 'HEAD', '--', '.', ':!.ai'], { cwd: ROOT }).status !== 0)
    return t.skip('uncommitted product changes');
  const s = scratch();
  try {
    plant(s, record());
    const r = run(s, ['--carry', GATE, '--from', HEAD, '--checks', 'scoped test']);
    assert.notEqual(r.status, 0);
    assert.match(`${r.stdout}${r.stderr}`, /signed|gate key/);
  } finally {
    rmSync(s.dir, { recursive: true, force: true });
  }
});
