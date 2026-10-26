// confine-read.test.mjs — V2-8.9 re-check H2: in the Maude AI chat, the auto-tier verbs that read a
// path they are given (import-asset, ingest-footage, import-tokens, svg-optimize, …) read only inside
// the chat's read boundary. Planted attack: `maude design ingest-footage ~/Documents --recursive`
// copied any media into assets/ (synced to the hub) and printed the listing — no card.
//
// Run: node --test cli/lib/confine-read.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readViolation, sourceWords } from './confine-read.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAUDE = join(ROOT, 'cli', 'bin', 'maude.mjs');
const made = [];
after(() => {
  for (const p of made) rmSync(p, { recursive: true, force: true });
});

const base = realpathSync(mkdtempSync(join(tmpdir(), 'confine-read-')));
made.push(base);
const project = join(base, 'project');
mkdirSync(join(project, '.design', 'assets'), { recursive: true });
writeFileSync(join(project, '.design', 'config.json'), '{}');
writeFileSync(join(project, 'brief.png'), 'x');
const home = join(base, 'home');
const docs = join(home, 'Documents');
mkdirSync(docs, { recursive: true });
writeFileSync(join(docs, 'secret.png'), 'x');
const photos = join(home, 'Combine');
mkdirSync(photos, { recursive: true });
writeFileSync(join(photos, 'a.png'), 'x');
const store = join(base, 'index', 'ai-grants.json');
mkdirSync(dirname(store), { recursive: true });
writeFileSync(
  store,
  JSON.stringify({
    v: 1,
    folders: [{ root: photos, name: 'Combine', grantedAt: 1, outsideProject: true }],
    chats: { 'chat-a': [photos] },
  })
);

const chat = (extra = {}) => ({
  MAUDE_AGENT_ACTOR: 'maude-chat',
  MAUDE_CHAT_ID: 'chat-a',
  MAUDE_READ_ROOTS: [project, join(project, '.design')].join(delimiter),
  MAUDE_GRANTS_FILE: store,
  ...extra,
});
const check = (verb, args, env = chat()) => readViolation(verb, args, { env, cwd: project, home });

test('sourceWords: positionals and --flag=value, never output/root flag values', () => {
  assert.deepEqual(
    sourceWords(['a.png', '--root', '/r', '--out', '/o', '--kind', 'svg', '--src=/s', '--out=/x']),
    ['a.png', 'svg', '/s']
  );
});

test('inside the project and inside a folder attached to this chat → allowed', () => {
  assert.equal(check('import-asset', ['brief.png', '--root', project]), null);
  assert.equal(check('import-asset', [join(photos, 'a.png')]), null);
  assert.equal(check('ingest-footage', [photos, '--recursive']), null);
  assert.equal(check('beats', ['assets/x.mp3', '--bpm', '120']), null);
});

test('outside → refused; `~`, `..` and another chat do not help', () => {
  assert.equal(check('import-asset', [join(docs, 'secret.png')])?.why, 'outside');
  assert.equal(check('ingest-footage', ['~/Documents', '--recursive'])?.why, 'outside');
  assert.equal(check('import-tokens', ['../home/Documents/secret.png'])?.why, 'outside');
  assert.equal(check('svg-optimize', ['/etc/hosts'])?.why, 'outside');
  assert.equal(
    check('import-asset', [join(photos, 'a.png')], chat({ MAUDE_CHAT_ID: 'chat-b' }))?.why,
    'outside'
  );
});

// V2-8.9 re-check 2 L1 — annotate's file-taking flags read any file the agent named.
test('annotate: --board/--flow/--ops/--rects/--canvas-state hold to the read roots; text does not', () => {
  for (const flag of ['--board', '--flow', '--ops', '--rects', '--canvas-state']) {
    assert.equal(check('annotate', ['ui/x.tsx', flag, '/etc/hosts'])?.why, 'outside', flag);
    assert.equal(check('annotate', ['ui/x.tsx', `${flag}=~/.ssh/id_ed25519`])?.why, 'outside');
    assert.equal(check('annotate', ['ui/x.tsx', flag, 'board.json']), null);
  }
  // a sticker's text that looks like a path is text, not a source
  assert.equal(check('annotate', ['ui/x.tsx', '--sticker', '/etc/hosts', '--title', '~/x']), null);
});

test('a Maude chat without MAUDE_READ_ROOTS fails closed; a terminal is not checked', () => {
  assert.equal(
    check('import-asset', ['brief.png'], chat({ MAUDE_READ_ROOTS: '' }))?.why,
    'no-roots'
  );
  assert.equal(
    check('import-asset', [join(docs, 'secret.png')], { MAUDE_HOOK_SESSION: 's' }),
    null
  );
  assert.equal(check('import-asset', [join(docs, 'secret.png')], {}), null);
  // a verb that reads nothing it is given is not this check's business
  assert.equal(check('slug', [join(docs, 'secret.png')]), null);
});

test('a grants file inside the project (agent-writable) is never read', () => {
  const planted = join(project, '.design', '_state', 'g.json');
  mkdirSync(dirname(planted), { recursive: true });
  writeFileSync(
    planted,
    JSON.stringify({ v: 1, folders: [{ root: docs, name: 'd' }], chats: { 'chat-a': [docs] } })
  );
  assert.equal(
    check('import-asset', [join(docs, 'secret.png')], chat({ MAUDE_GRANTS_FILE: planted }))?.why,
    'outside'
  );
});

test('`maude design import-asset <outside>` in the chat exits 2 before the helper runs', () => {
  const r = spawnSync(
    process.execPath,
    [MAUDE, 'design', 'import-asset', join(docs, 'secret.png')],
    {
      cwd: project,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...chat(),
        MAUDE_SESSION_ROOT: project,
        CLAUDE_PROJECT_DIR: project,
        MAUDE_NO_UPDATE_CHECK: '1',
      },
      timeout: 20000,
    }
  );
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /outside what this AI chat may read/);
});
