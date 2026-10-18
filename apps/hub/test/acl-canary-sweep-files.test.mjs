// The canary sweep, file-plane half (V2-1.16 §7, S9.4/S9.5 — V2-5 sweep-fix).
//
// `acl-canary-sweep.test.mjs` sweeps a hub with no checkout, so the file plane,
// the asset doors and the git history answer it empty and prove nothing. This
// file sweeps the SAME route table (`_acl-sweep-requests.mjs`) against a
// workspace hub whose checkout and git history carry canvas B:
//
//   ui/canary-b-zx.tsx   imports ui/canary-b-zx.css, references assets/canary-b-only.png
//   commit 2             touches only B ("design: canary-b-zx")
//   commit 3             touches A and B
//
// An A-only canvas-only session must find no `canary-b`, no hash of a B file
// and no B-only commit sha anywhere, and every B-targeted request must answer
// byte-identically to the same request for a missing target (U1).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { resetFileAccessCaches } from '../src/access-files.mjs';
import { HUB_ROUTE_ROWS } from '../src/routes-v2/index.mjs';
import { createHub } from '../src/server.mjs';
import { addToken } from '../src/tokens.mjs';
import { canvasOnlyToken, writeProject } from './_acl-files-fixture.mjs';
import { checkSweepTable, requestsFor, studioDefaultRequests, V1 } from './_acl-sweep-requests.mjs';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const png = (n) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n, n, n, n]);

const A = 'ui/a.tsx';
const B = 'ui/canary-b-zx.tsx';
const NOPE = 'ui/nothing-here.tsx';
const A_FILES = {
  'config.json': JSON.stringify({ name: 'sweep', canvasGroups: [{ label: 'UI', path: 'ui' }] }),
  [A]: `import './a-styles.css';\nexport default function A() {\n  return <div><img src="assets/a-only.png" /></div>;\n}\n`,
  'ui/a-styles.css': '.a { color: red; }\n',
  'assets/a-only.png': png(1),
};
const B_FILES = {
  [B]: `import './canary-b-zx.css';\nexport default function B() {\n  return <div className="canary-b"><img src="assets/canary-b-only.png" />CANARY-B-SOURCE</div>;\n}\n`,
  'ui/canary-b-zx.css': '.canary-b { color: blue; }\n',
  'ui/canary-b-zx.meta.json': JSON.stringify({ title: 'CANARY-B-TITLE' }),
  'assets/canary-b-only.png': png(2),
};

let dataDir;
let repoDir;
let built;
let base;
let tokens;
let leaks;
let bTargets;
let nopeTargets;
const saved = {};

function git(args) {
  return execFileSync('git', args, {
    cwd: repoDir,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
}
const commit = (msg) => {
  git(['add', '-A']);
  git(['-c', 'user.name=Olga', '-c', 'user.email=olga@x.test', 'commit', '-q', '-m', msg]);
  return git(['rev-parse', 'HEAD']);
};

before(async () => {
  resetFileAccessCaches();
  dataDir = mkdtempSync(join(tmpdir(), 'maude-acl-sweep-files-data-'));
  repoDir = mkdtempSync(join(tmpdir(), 'maude-acl-sweep-files-repo-'));
  const designRoot = join(repoDir, '.design');
  git(['init', '-q', '-b', 'main']);
  writeProject(designRoot, A_FILES);
  commit('design: Alpha');
  writeProject(designRoot, B_FILES);
  const bOnlySha = commit('design: canary-b-zx');
  writeProject(designRoot, {
    [A]: `${A_FILES[A]}// touched with B\n`,
    'ui/canary-b-zx.css': '.canary-b { color: green; }\n',
  });
  commit('design: update 2 canvases (canary-b-zx)');
  for (const k of ['HUB_WORKSPACE_MODE', 'MAUDE_STUDIO_CHILD', 'MAUDE_REPO_DIR']) {
    saved[k] = process.env[k];
  }
  process.env.HUB_WORKSPACE_MODE = '1';
  process.env.MAUDE_STUDIO_CHILD = '0';
  process.env.MAUDE_REPO_DIR = repoDir;
  tokens = {
    owner: addToken(dataDir, { label: 'owner', scope: '*', role: 'owner', owner: 'o@x.test' })
      .value,
    canvasA: canvasOnlyToken(dataDir, 'canvas-a', [{ c: A, r: 'member' }]),
  };
  built = createHub({ port: 0, dataDir, secret: 'test-secret', verbose: false, rateLimit: false });
  await built.server.listen();
  await built.acceptedReady;
  await built.startJournalReconciler({ target: null, intervalMs: 3_600_000 });
  base = built.server.httpURL.replace('0.0.0.0', '127.0.0.1');

  // A vote on B when this hub keeps votes (a stand-in id otherwise).
  const voted = await fetch(`${base}${V1}/votes`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokens.owner}`, 'content-type': 'application/json' },
    body: JSON.stringify({ canvas: B, targets: ['ab:t1', 'ab:t2'], expected: 3 }),
  });
  const vote = voted.status === 201 ? (await voted.json()).vote.id : 'vote-0000000000';

  const bHashes = [
    ...Object.values(B_FILES).map((v) => sha256(v)),
    sha256('.canary-b { color: green; }\n'),
  ];
  leaks = ['canary-b', ...bHashes, bOnlySha];
  bTargets = {
    path: B,
    doc: `ws/local/main/ui-canary-b-zx`,
    hash: bHashes[0],
    commentsHash: bHashes[1],
    slug: 'canary-b-zx',
    vote,
    tx: 'tx_none_b',
    action: 'a_00000000-0000-4000-8000-00000000000b',
    sha: bOnlySha,
    css: 'ui/canary-b-zx.css',
    asset: 'assets/canary-b-only.png',
  };
  nopeTargets = {
    path: NOPE,
    doc: 'ws/local/main/ui-nothing-here',
    hash: sha256('nothing'),
    commentsHash: sha256('nothing either'),
    slug: 'nothing-here',
    vote: vote.replace(/[0-9a-f]/g, (c) => (c === '0' ? '1' : '0')),
    tx: 'tx_none_n',
    action: 'a_00000000-0000-4000-8000-00000000000e',
    sha: sha256('no commit').slice(0, 40),
    css: 'ui/nothing-here.css',
    asset: 'assets/nothing-here.png',
  };
});

after(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await built?.stopJournal?.();
  await built?.server.destroy();
  built?.projectStore?.close?.();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repoDir, { recursive: true, force: true });
});

function normalize(text, targets) {
  let out = String(text);
  for (const v of Object.values(targets)) {
    if (typeof v !== 'string' || v === '') continue;
    out = out.split(v).join('<T>').split(encodeURIComponent(v)).join('<T>');
  }
  return out.replace(
    /"(proposalHash|transactionId|committedAt|at|date|uptimeMs|startedAt|now|expiresAt|id|sessionId)":("[^"]*"|\d+)/g,
    '"$1":0'
  );
}

const leaked = (text) => {
  const folded = String(text).toLowerCase();
  return leaks.filter((l) => folded.includes(l.toLowerCase()));
};

async function send(token, [method, path, body]) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body && method !== 'GET' && method !== 'HEAD' ? { body } : {}),
    redirect: 'manual',
  });
  const text = method === 'HEAD' ? '' : Buffer.from(await res.arrayBuffer()).toString('latin1');
  const headers = [...res.headers.entries()]
    .filter(([k]) => k !== 'date')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  return { status: res.status, text, headers };
}

const SESSION_ENDING = new Set(['/auth/logout', '/auth/browser/signout']);

// OPEN, handed back to the lead (V2-5 sweep-fix Q1): a canvas-only editor may
// CREATE a new `assets/<name>` (scope.ts `writes`, create-only), so a create
// at a name B's closure already holds is refused (403 not-in-scope) where a
// free name is written (200/201) — an existence oracle for GUESSED asset names.
// V2-1.16 L20 covers only content-addressed `assets/<sha8>.<ext>` names (X3).
// Pinned here so the sweep stays honest: the entry must still differ, and the
// list empties when the question is decided. (Only the FIRST create probe
// shows it: that request writes the twin's free name, so every later create
// probe — `/api/file-uploads`, `PUT /assets/…` — meets two existing names.)
const KNOWN_OPEN = new Set(['PUT /api/file/assets/canary-b-only.png [/api/file/*]']);

describe('the file-plane canary sweep (A-only canvas session over a checkout)', () => {
  test('the sweep table reaches every row', () => {
    assert.deepEqual(checkSweepTable(HUB_ROUTE_ROWS, [bTargets, nopeTargets], { epoch: 0 }), []);
  });

  test('the fixture is real: the owner reads B through the file plane', async () => {
    const files = await send(tokens.owner, ['GET', '/api/files']);
    assert.equal(files.status, 200);
    const listed = JSON.parse(files.text).files.map((f) => f.path);
    assert.ok(listed.includes('assets/canary-b-only.png'), listed.join(','));
    const bytes = await send(tokens.owner, ['GET', '/_project-file/assets/canary-b-only.png']);
    assert.equal(bytes.status, 200, bytes.text.slice(0, 200));
    const log = await send(tokens.owner, ['GET', `/api/history?path=${encodeURIComponent(B)}`]);
    assert.ok(log.text.includes(bTargets.sha), `${log.status} ${log.text.slice(0, 200)}`);
  });

  test('every row: no B byte, and B answers exactly as a missing target', async () => {
    const rows = HUB_ROUTE_ROWS.filter((r) => !SESSION_ENDING.has(r.path));
    const ctx = { epoch: 0 };
    const passes = [
      ...rows.map((row) => [
        row,
        requestsFor(row, bTargets, ctx),
        requestsFor(row, nopeTargets, ctx),
      ]),
      [
        { path: '(studio default)' },
        studioDefaultRequests(bTargets),
        studioDefaultRequests(nopeTargets),
      ],
    ];
    const findings = [];
    const open = new Set();
    let swept = 0;
    for (const [row, bReqs, nReqs] of passes) {
      for (let i = 0; i < bReqs.length; i++) {
        const where = `${bReqs[i][0]} ${bReqs[i][1].split('?')[0]} [${row.path ?? row.pattern}]`;
        const key = KNOWN_OPEN.has(where) ? where : `${where}#${i}`;
        const b = await send(tokens.canvasA, bReqs[i]);
        const n = await send(tokens.canvasA, nReqs[i]);
        const bText = normalize(b.text, bTargets);
        const nText = normalize(n.text, nopeTargets);
        if (process.env.SWEEP_DEBUG) console.log(`SW ${b.status} ${where} ${bText.slice(0, 90)}`);
        for (const l of leaked(bText + b.headers)) findings.push(`${where}: leaks ${l}`);
        for (const l of leaked(n.text)) findings.push(`${where} (twin): leaks ${l}`);
        if (KNOWN_OPEN.has(key)) {
          if (b.status !== n.status) open.add(key);
        } else if (b.status !== n.status) {
          findings.push(`${where}: status B ${b.status} ≠ missing ${n.status}`);
        } else if (bText !== nText) {
          findings.push(`${where}: body differs — ${bText.slice(0, 160)} | ${nText.slice(0, 160)}`);
        }
        swept += 1;
      }
    }
    assert.deepEqual(findings, []);
    assert.deepEqual(
      [...open].sort(),
      [...KNOWN_OPEN].sort(),
      'a KNOWN_OPEN entry closed: drop it'
    );
    assert.ok(swept >= rows.length * 2, `swept ${swept}`);
  });

  test('the project-wide reads carry no B byte', async () => {
    for (const path of [
      '/api/files',
      '/api/journal?since=0',
      `/api/history?path=${encodeURIComponent(A)}`,
      `${V1}/bootstrap`,
      '/api/documents',
      '/api/file-limits',
    ]) {
      const r = await send(tokens.canvasA, ['GET', path]);
      assert.deepEqual(leaked(r.text + r.headers), [], `${path}: ${r.text.slice(0, 200)}`);
    }
  });
});
