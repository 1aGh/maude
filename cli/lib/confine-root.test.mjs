// confine-root.test.mjs — gate-b-sec2 finding 1: inside an AI session a `maude design` verb works on
// the session's project only. Planted attack: an injected chat agent runs an auto-approved verb with
// `--root <another project>` to read it, or to write into it.
//
// Run: node --test cli/lib/confine-root.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isAiSession, rootViolation } from './confine-root.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAUDE = join(ROOT, 'cli', 'bin', 'maude.mjs');
const made = [];
after(() => {
  for (const p of made) rmSync(p, { recursive: true, force: true });
});

function project(name) {
  const base = join(ROOT, 'node_modules', '.cache');
  mkdirSync(base, { recursive: true });
  const p = realpathSync(mkdtempSync(join(base, `confine-root-${name}-`)));
  made.push(p);
  mkdirSync(join(p, '.design', 'ui'), { recursive: true });
  writeFileSync(join(p, '.design', 'config.json'), '{}');
  writeFileSync(
    join(p, '.design', 'ui', 'Secret.tsx'),
    'export default function S() { return null; }\n'
  );
  return p;
}

const A = project('a');
const B = project('b');

// the env with every AI-session marker dropped (this test may itself run inside Claude Code)
const plain = () => {
  const env = { ...process.env, MAUDE_NO_UPDATE_CHECK: '1' };
  for (const k of [
    'MAUDE_AGENT_ACTOR',
    'MAUDE_CHAT_ID',
    'MAUDE_HOOK_SESSION',
    'MAUDE_SESSION_ROOT',
    'CLAUDE_PROJECT_DIR',
  ])
    delete env[k];
  return env;
};
const chat = (extra = {}) => ({
  ...plain(),
  MAUDE_AGENT_ACTOR: 'maude-chat',
  MAUDE_CHAT_ID: 'chat-a',
  MAUDE_SESSION_ROOT: A,
  ...extra,
});

const maude = (words, env, cwd = A) =>
  spawnSync(process.execPath, [MAUDE, 'design', ...words], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
const REFUSED = /points at a different project/;

const ATTACKS = [
  ['read-annotations', 'ui/Secret.tsx', '--root', B],
  ['annotate', 'ui/Secret.tsx', '--pin', 'x', '--text', 'hi', '--root', B],
  ['reel-place', 'cut', '--next', '--root', B],
  ['trash', 'restore', 'ui/Secret.tsx', '--root', B],
  ['comments', 'list', `--root=${B}`],
];

for (const words of ATTACKS) {
  test(`AI session: ${words.slice(0, 2).join(' ')} --root <another project> is refused (exit 2)`, () => {
    const r = maude(words, chat());
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, REFUSED);
    assert.match(r.stderr, /this session's project/);
  });
}

test('a terminal Claude Code session (MAUDE_HOOK_SESSION only) is held the same way', () => {
  const r = maude(['read-annotations', 'ui/Secret.tsx', '--root', B], {
    ...plain(),
    MAUDE_HOOK_SESSION: 'sess-1',
    MAUDE_SESSION_ROOT: A,
  });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, REFUSED);
});

test('without the AI env the same --root works (a person may pass any root)', () => {
  const r = maude(['read-annotations', 'ui/Secret.tsx', '--root', B], plain());
  assert.doesNotMatch(r.stderr, REFUSED);
  assert.equal(r.status, 0, r.stderr);
});

test('AI session: --root naming the session project, and a symlink to it, are allowed', () => {
  const link = join(dirname(A), `${A.split('/').pop()}-link`);
  symlinkSync(A, link);
  made.push(link);
  for (const root of [A, link]) {
    const r = maude(['read-annotations', 'ui/Secret.tsx', '--root', root], chat());
    assert.doesNotMatch(r.stderr, REFUSED);
    assert.equal(r.status, 0, r.stderr);
  }
});

test('rootViolation: the other ways to name another project', () => {
  const env = chat();
  assert.equal(isAiSession(plain()), false);
  assert.equal(isAiSession(env), true);
  // a cwd inside project B (`cd B && maude design …`)
  assert.equal(rootViolation(['read-annotations', 'ui/Secret.tsx'], { env, cwd: B })?.value, B);
  // $CLAUDE_PROJECT_DIR pointed at B
  assert.equal(
    rootViolation(['read-annotations', 'x'], { env: { ...env, CLAUDE_PROJECT_DIR: B }, cwd: A })
      ?.what,
    'CLAUDE_PROJECT_DIR'
  );
  // --design-root climbing out of the session project
  assert.equal(
    rootViolation(
      ['import-asset', 'p.png', '--root', A, '--design-root', `../${B.split('/').pop()}/.design`],
      {
        env,
        cwd: A,
      }
    )?.what,
    '--design-root'
  );
  // a subfolder of the session project names the session project
  mkdirSync(join(A, 'src'), { recursive: true });
  assert.equal(rootViolation(['assets', '--root', join(A, 'src')], { env, cwd: A }), null);
  assert.equal(rootViolation(['assets'], { env, cwd: join(A, 'src') }), null);
  // nothing is checked outside an AI session
  assert.equal(rootViolation(['assets', '--root', B], { env: plain(), cwd: B }), null);
  // Claude Code started outside any project (a folder of repos): the cwd's project is the session's
  const loose = { ...plain(), MAUDE_HOOK_SESSION: 's', CLAUDE_PROJECT_DIR: realpathSync(tmpdir()) };
  assert.equal(rootViolation(['assets'], { env: loose, cwd: A }), null);
  assert.equal(rootViolation(['assets', '--root', B], { env: loose, cwd: A })?.value, B);
});
