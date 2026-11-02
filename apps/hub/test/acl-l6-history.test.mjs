// V2-1.16 L6 — the cell's git history on the peer door (S9.5, hub half).
//
// The fixture has one commit touching A + B, subject `design: update 2
// canvases`, a body naming B. A-only: the log must name a visible path; it
// shows "Changed Alpha" and no "2", no B; `history/file` for B (at that sha)
// answers exactly as a missing path. Project roles read today's bodies (U7).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createGitRunner } from '../src/git-runner.mjs';
import { HISTORY_FILE_PATH, HISTORY_PATH, handleHistoryRoutes } from '../src/history.mjs';
import { matchesScope } from '../src/tokens.mjs';
import { A, B, CANARY, NOPE, rm, tmpDir } from './_acl-docs-fixture.mjs';

const NIS = { error: 'not-in-scope', reason: 'not-in-scope' };
let repoDir;
let designRoot;
let sha;

const grant = (r) => ({ v: 1, role: null, grants: [{ c: A, r }] });
const MATCHES = {
  owner: { label: 'o', owner: 'o@x.test', role: 'owner', readOnly: false, scope: '*' },
  member: { label: 'm', owner: 'm@x.test', role: 'member', readOnly: false, scope: '*' },
  viewer: { label: 'v', owner: 'v@x.test', role: 'viewer', readOnly: true, scope: '*' },
  aEdit: { label: 'p', owner: 'p@x.test', readOnly: true, scope: '*', access: grant('member') },
  aComment: { label: 'c', owner: 'c@x.test', readOnly: true, scope: '*', access: grant('viewer') },
  aView: { label: 'a', owner: 'a@x.test', readOnly: true, scope: '*', access: grant('observer') },
};

function git(args) {
  execFileSync('git', args, {
    cwd: repoDir,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    stdio: 'pipe',
  });
}

before(() => {
  repoDir = tmpDir('maude-acl-l6-');
  designRoot = join(repoDir, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(join(designRoot, 'config.json'), '{"canvasGroups":[{"path":"ui"}]}');
  writeFileSync(join(designRoot, A), 'export default () => <h1>alpha</h1>;\n');
  writeFileSync(join(designRoot, 'ui/Alpha.meta.json'), '{}\n');
  writeFileSync(join(designRoot, B), 'export default () => <h1>CANARY-B-SOURCE</h1>;\n');
  git(['init', '-b', 'main']);
  git(['add', '-A']);
  git([
    '-c',
    'user.name=Olga',
    '-c',
    'user.email=olga@x.test',
    'commit',
    '-m',
    'design: update 2 canvases',
    '-m',
    '- ui/canary-b-zx',
  ]);
  sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
});

after(() => rm(repoDir));

async function ask(role, path, query) {
  const out = { status: null, body: null };
  await handleHistoryRoutes({
    path,
    method: 'GET',
    query,
    bearer: `tok-${role}`,
    verify: (tok) => MATCHES[tok.slice(4)] ?? null,
    matchesScope,
    repoDir,
    designRoot,
    run: createGitRunner({ maxCapture: 1024 * 1024 }),
    respondJson: (status, body) => {
      out.status = status;
      out.body = body;
    },
  });
  return { ...out, text: JSON.stringify(out.body) };
}

describe('L6 — GET /api/history', () => {
  test('A-only must name a visible path; none, B and a missing one are one answer (U1)', async () => {
    for (const role of ['aEdit', 'aComment', 'aView']) {
      const none = await ask(role, HISTORY_PATH, {});
      const b = await ask(role, HISTORY_PATH, { path: B });
      const nope = await ask(role, HISTORY_PATH, { path: NOPE });
      assert.deepEqual([none.status, none.body], [403, NIS], role);
      assert.deepEqual([b.status, b.body], [403, NIS], role);
      assert.deepEqual([nope.status, nope.body], [403, NIS], role);
    }
  });

  test('A-only reads A’s log with the subject rewritten — no count, no B (U4)', async () => {
    for (const path of [A, 'ui/Alpha.meta.json']) {
      const r = await ask('aEdit', HISTORY_PATH, { path });
      assert.equal(r.status, 200, path);
      assert.equal(r.body.entries.length >= 1, true);
      assert.equal(r.body.entries[0].message, 'Changed Alpha');
      assert.doesNotMatch(r.text, CANARY);
      assert.doesNotMatch(r.text, /\b2\b canvases/);
    }
  });

  test('owner / member / viewer read today’s log, project-wide too (U7)', async () => {
    for (const role of ['owner', 'member', 'viewer']) {
      const all = await ask(role, HISTORY_PATH, {});
      assert.equal(all.status, 200, role);
      assert.equal(all.body.entries[0].message, 'design: update 2 canvases', role);
    }
  });
});

describe('L6 — GET /api/history/file', () => {
  test('B at that sha answers as a missing path; no B bytes', async () => {
    for (const role of ['aEdit', 'aComment']) {
      const b = await ask(role, HISTORY_FILE_PATH, { sha, path: B });
      const nope = await ask(role, HISTORY_FILE_PATH, { sha, path: NOPE });
      assert.equal(b.status, 404, role);
      assert.deepEqual([nope.status, nope.body], [b.status, b.body], role);
      assert.doesNotMatch(b.text, CANARY);
    }
  });

  test('A’s bytes need export on A: an edit or comment grant reads them, Can view does not', async () => {
    for (const role of ['aEdit', 'aComment']) {
      const r = await ask(role, HISTORY_FILE_PATH, { sha, path: A });
      assert.equal(r.status, 200, role);
      assert.match(r.body.content, /alpha/);
    }
    assert.equal((await ask('aView', HISTORY_FILE_PATH, { sha, path: A })).status, 404);
  });

  test('project roles read B as today (U7)', async () => {
    for (const role of ['owner', 'member', 'viewer']) {
      const r = await ask(role, HISTORY_FILE_PATH, { sha, path: B });
      assert.equal(r.status, 200, role);
    }
  });
});
