// S12.2 — the plugin-surfaces generator (S12-slices D6) and its drift gate.
//
// scripts/gen-plugin-surfaces.mjs generates three things from the plugins' own commands and from
// the CONTRACT: the AI chat panel's slash list, every source-command-* mirror, and the
// contract-voice skill. `--check` must be green on the committed tree, and must go red on each
// kind of drift (planted in a scratch tree, never in the repo).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GEN = join(REPO, 'scripts', 'gen-plugin-surfaces.mjs');
const CONTRACT = '.design/system/maude-v2/CONTRACT.md';

const run = (root, ...args) =>
  spawnSync(process.execPath, [GEN, ...args], {
    env: { ...process.env, ...(root ? { MAUDE_SURFACES_ROOT: root } : {}) },
    encoding: 'utf8',
  });

const read = (rel) => readFileSync(join(REPO, rel), 'utf8');
const verbsOf = (plugin) =>
  readdirSync(join(REPO, 'plugins', plugin, 'commands'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .sort();

const scratch = [];
after(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

/** A small tree the generator accepts: one design + one flow command, their mirrors, the CONTRACT. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'plugin-surfaces-'));
  scratch.push(root);
  for (const plugin of ['design', 'flow']) {
    mkdirSync(join(root, 'plugins', plugin, 'commands'), { recursive: true });
    mkdirSync(join(root, 'plugins', plugin, 'skills'), { recursive: true });
    writeFileSync(
      join(root, 'plugins', plugin, 'commands', 'go.md'),
      '---\nname: go\ndescription: "Go somewhere."\nargument-hint: "[--fast]"\n---\n\nBody.\n'
    );
  }
  mkdirSync(join(root, '.design', 'system', 'maude-v2'), { recursive: true });
  cpSync(join(REPO, CONTRACT), join(root, CONTRACT));
  mkdirSync(join(root, 'apps', 'studio', 'client', 'panels'), { recursive: true });
  assert.equal(run(root).status, 0, 'the fixture generates');
  assert.equal(run(root, '--check').status, 0, 'and is in sync straight after');
  return root;
}

test('--check is green on the committed tree', () => {
  const r = run(null, '--check');
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});

test('--check goes red on a stale mirror', () => {
  const root = fixture();
  const skill = join(root, 'plugins/design/skills/source-command-go/SKILL.md');
  writeFileSync(skill, readFileSync(skill, 'utf8').replace('Go somewhere.', 'Go elsewhere.'));
  const r = run(root, '--check');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /stale: plugins\/design\/skills\/source-command-go\/SKILL\.md/);
});

test('--check goes red on a stale slash list', () => {
  const root = fixture();
  const gen = join(root, 'apps/studio/client/panels/slash-commands.gen.js');
  writeFileSync(gen, readFileSync(gen, 'utf8').replace("'design:go'", "'design:gone'"));
  const r = run(root, '--check');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /stale: apps\/studio\/client\/panels\/slash-commands\.gen\.js/);
});

test('--check goes red when the CONTRACT moved on and contract-voice did not', () => {
  const root = fixture();
  const contract = join(root, CONTRACT);
  const text = readFileSync(contract, 'utf8');
  const moved = text.replace('| Version history | Changes,', '| Saved history | Changes,');
  assert.notEqual(moved, text, 'the planted edit hit the §3 table');
  writeFileSync(contract, moved);
  const r = run(root, '--check');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /stale: plugins\/design\/skills\/contract-voice\/SKILL\.md/);
});

test('--check goes red on an orphan mirror whose command is gone, and a plain run repairs it', () => {
  const root = fixture();
  rmSync(join(root, 'plugins/flow/commands/go.md'));
  const r = run(root, '--check');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /orphan .*plugins\/flow\/skills\/source-command-go/);
  assert.equal(run(root).status, 0);
  assert.equal(run(root, '--check').status, 0);
});

test('the slash list holds every design command, and nothing else', () => {
  const gen = read('apps/studio/client/panels/slash-commands.gen.js');
  const listed = [...gen.matchAll(/name: '(design:[^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(
    listed,
    verbsOf('design').map((v) => `design:${v}`)
  );
  for (const v of [
    'board',
    'generate',
    'photo',
    'reel',
    'import',
    'video-analyze',
    'chat',
    'hub-workspace',
  ]) {
    assert.ok(listed.includes(`design:${v}`), `design:${v} is in the slash list`);
  }
});

test('every command has a mirror and every mirror has a command (design and flow)', () => {
  for (const plugin of ['design', 'flow']) {
    const mirrors = readdirSync(join(REPO, 'plugins', plugin, 'skills'))
      .filter((d) => d.startsWith('source-command-'))
      .map((d) => d.slice('source-command-'.length))
      .sort();
    assert.deepEqual(mirrors, verbsOf(plugin), `${plugin} mirrors`);
  }
});

test('the contract-voice body is CONTRACT §3–§4, verbatim', () => {
  const contract = read(CONTRACT);
  const a = contract.indexOf('## 3 · Words');
  const b = contract.indexOf('## 5 · ');
  assert.ok(a > 0 && b > a, 'CONTRACT has §3 and §5 headings');
  const want = contract.slice(a, b).trimEnd();
  const skill = read('plugins/design/skills/contract-voice/SKILL.md');
  const body = skill.match(
    /<!-- contract:begin [^>]*-->\n\n([\s\S]*?)\n\n<!-- contract:end [^>]*-->/
  );
  assert.ok(body, 'the skill carries the begin/end markers');
  assert.equal(body[1], want);
  assert.match(skill, /^name: contract-voice$/m);
});
