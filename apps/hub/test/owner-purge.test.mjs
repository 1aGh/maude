// The owner's confirmed bulk purge (`POST /api/file-purge`, owner-purge.mjs).
//
// A deletion past the owner's door budget is a bulk purge: a dry run lists the
// exact set (count, bytes, sample) and hands back a confirmation; the confirm
// deletes THAT set — every file quarantined and tombstoned, in bounded batches —
// and refuses the moment the set is not the one the owner saw.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { isProjectOwnerMatch, peerAccess } from '../src/access-gate.mjs';
import { currentHashFor, handleFileDoor } from '../src/file-door.mjs';
import {
  closeJournal,
  DELETE_BUDGET_PER_WINDOW,
  OWNER_DELETE_BUDGET_PER_WINDOW,
  OWNER_DELETE_SOURCE,
  OWNER_PURGE_SOURCE,
  openJournal,
} from '../src/journal.mjs';
import { handleOwnerPurge, PURGE_BATCH, PURGE_PATH, resetPurgePlans } from '../src/owner-purge.mjs';
import { classifyHubRequest, runHubRoutes } from '../src/routes-v2/index.mjs';
import { addToken, verifyToken } from '../src/tokens.mjs';

let dataDir;
let designRoot;
let tokens;
let clock;
const SECRET = 'operator-secret-for-the-purge-test-0123';

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'purge-data-'));
  designRoot = mkdtempSync(join(tmpdir(), 'purge-root-'));
  mkdirSync(join(designRoot, 'assets'), { recursive: true });
  writeFileSync(join(designRoot, 'config.json'), '{}');
  tokens = {
    owner: addToken(dataDir, { label: 'owner', scope: '*', role: 'owner' }).value,
    member: addToken(dataDir, { label: 'member', scope: '*', role: 'member' }).value,
    roleless: addToken(dataDir, { label: 'roleless', scope: '*' }).value,
    viewer: addToken(dataDir, { label: 'viewer', scope: '*', role: 'viewer', readOnly: true })
      .value,
    scopedOwner: addToken(dataDir, { label: 'scoped', scope: 'a-canvas', role: 'owner' }).value,
    env: SECRET,
  };
  clock = 1_000_000;
  resetPurgePlans();
});

afterEach(() => {
  resetPurgePlans();
  closeJournal(dataDir);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(designRoot, { recursive: true, force: true });
});

const sha = (body) => createHash('sha256').update(body).digest('hex');

function seed(rel, body = `bytes of ${rel}`) {
  const journal = openJournal(dataDir);
  const abs = join(designRoot, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body);
  journal.recordWrite({ designRoot, path: rel, source: 'peer-put' });
  return rel;
}

function seedMany(n, prefix = 'assets/unused/') {
  const rels = [];
  for (let i = 0; i < n; i += 1) rels.push(seed(`${prefix}f-${String(i).padStart(4, '0')}.png`));
  return rels;
}

/** acceptedAuth's bearer branch, as server.mjs builds it. */
function auth(req) {
  const bearer = String(req.headers?.authorization ?? '').replace(/^Bearer\s+/i, '');
  const m = bearer ? verifyToken(dataDir, bearer, SECRET) : null;
  if (!m) return null;
  return {
    actor: m.owner || m.label,
    readOnly: !!m.readOnly,
    scope: m.scope ?? '*',
    access: peerAccess(m).access,
    owner: isProjectOwnerMatch(m),
  };
}

function purgeDeps(extra = {}) {
  const journal = openJournal(dataDir);
  return {
    auth,
    purge: () => ({
      journal,
      designRoot,
      dataDir,
      materializer: null,
      onDeleted: ({ path, owner, purge }) =>
        journal.recordWrite({
          designRoot,
          path,
          source: purge ? OWNER_PURGE_SOURCE : owner ? OWNER_DELETE_SOURCE : 'peer-put',
          deleted: true,
        }),
      now: () => clock,
      batchIntervalMs: 0,
      ...extra,
    }),
  };
}

function req(bearer, body, method = 'POST') {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    method,
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    async *[Symbol.asyncIterator]() {
      if (text) yield Buffer.from(text);
    },
  };
}

async function purge(bearer, body, { deps = purgeDeps(), method = 'POST' } = {}) {
  let status = 0;
  let json = null;
  await handleOwnerPurge({
    request: req(bearer, body, method),
    method,
    path: PURGE_PATH,
    respondJson: (s, b) => {
      status = s;
      json = b;
    },
    deps,
  });
  return { status, json };
}

/** Dry run then confirm until done (or a refusal), as the CLI does. */
async function purgeAll(bearer, spec, deps = purgeDeps()) {
  const dry = await purge(bearer, { ...spec, dryRun: true }, { deps });
  assert.equal(dry.status, 200, JSON.stringify(dry.json));
  const calls = [];
  for (let i = 0; i < 100; i += 1) {
    const r = await purge(bearer, { ...spec, confirm: dry.json.confirm }, { deps });
    calls.push(r);
    if (r.status !== 200 || r.json.done) break;
  }
  return { dry, calls };
}

const present = (rel) => existsSync(join(designRoot, rel));

describe('the dry run', () => {
  it('lists the exact set — count, bytes, sample — and deletes nothing', async () => {
    const rels = seedMany(30);
    const r = await purge(tokens.owner, { prefix: 'assets/unused/', dryRun: true });
    assert.equal(r.status, 200);
    assert.equal(r.json.dryRun, true);
    assert.equal(r.json.count, 30);
    const bytes = rels.reduce((n, rel) => n + statSync(join(designRoot, rel)).size, 0);
    assert.equal(r.json.bytes, bytes);
    assert.ok(Array.isArray(r.json.sample) && r.json.sample.length > 0);
    assert.ok(r.json.sample.every((p) => p.startsWith('assets/unused/')));
    assert.equal(typeof r.json.confirm, 'string');
    assert.ok(r.json.confirm.length >= 32);
    assert.ok(rels.every(present), 'a dry run deletes nothing');
  });

  it('takes an explicit list and names the paths it could not find', async () => {
    seed('assets/a.png');
    seed('assets/b.png');
    const r = await purge(tokens.owner, {
      paths: ['assets/a.png', 'assets/b.png', 'assets/never-was.png'],
      dryRun: true,
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.count, 2);
    assert.equal(r.json.missing, 1);
  });

  it('refuses a prefix that names runtime state or the whole project', async () => {
    for (const prefix of ['', '/', '_trash/', '../', 'assets/../system/']) {
      const r = await purge(tokens.owner, { prefix, dryRun: true });
      assert.equal(r.status, 400, `prefix ${JSON.stringify(prefix)}`);
    }
  });
});

describe('the confirm', () => {
  it('deletes the confirmed set past both door budgets, in bounded batches', async () => {
    const n = OWNER_DELETE_BUDGET_PER_WINDOW + 60;
    const rels = seedMany(n);
    const { calls } = await purgeAll(tokens.owner, { prefix: 'assets/unused/' });
    assert.ok(
      calls.every((c) => c.status === 200),
      JSON.stringify(calls.at(-1))
    );
    assert.equal(calls.length, Math.ceil(n / PURGE_BATCH), 'one bounded batch per call');
    assert.ok(calls.every((c) => c.json.purged <= PURGE_BATCH));
    assert.equal(calls.at(-1).json.done, true);
    assert.equal(calls.at(-1).json.remaining, 0);
    assert.ok(rels.every((rel) => !present(rel)));

    const journal = openJournal(dataDir);
    assert.ok(
      rels.every((rel) => currentHashFor(journal, rel) === null),
      'every file tombstoned'
    );
    // Outside both windows: neither the member nor the owner door budget is spent.
    assert.equal(journal.deletionsSince(0), 0);
    assert.equal(journal.ownerDeletionsSince(0), 0);
    assert.equal(journal.allDeletionsSince(0), n, 'the replay still counts every tombstone');
  });

  it('the operator env secret may purge, like any owner', async () => {
    seedMany(DELETE_BUDGET_PER_WINDOW + 10);
    const { calls } = await purgeAll(tokens.env, { prefix: 'assets/unused/' });
    assert.equal(calls.at(-1).status, 200);
    assert.equal(calls.at(-1).json.done, true);
  });

  it('quarantines every purged file under one trash folder, restorable', async () => {
    const rels = seedMany(5);
    const before = Object.fromEntries(
      rels.map((rel) => [rel, readFileSync(join(designRoot, rel), 'utf8')])
    );
    const { calls } = await purgeAll(tokens.owner, { prefix: 'assets/unused/' });
    const trash = calls.at(-1).json.trash;
    assert.match(trash, /^_trash\/[^/]+$/);
    assert.deepEqual(readdirSync(join(designRoot, '_trash')).length, 1, 'one folder per purge');
    for (const rel of rels) {
      assert.equal(readFileSync(join(designRoot, trash, rel), 'utf8'), before[rel]);
    }
    // Restore: put the folder back and let the journal meet the files again.
    const journal = openJournal(dataDir);
    for (const rel of rels) {
      renameSync(join(designRoot, trash, rel), join(designRoot, rel));
      journal.recordWrite({ designRoot, path: rel, source: 'walk-import' });
      assert.equal(currentHashFor(journal, rel), sha(before[rel]));
    }
  });

  it('writes an audit line for the plan, each batch and the end', async () => {
    seedMany(PURGE_BATCH + 1);
    await purgeAll(tokens.owner, { prefix: 'assets/unused/' });
    const file = join(dataDir, 'purge-audit.jsonl');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const lines = readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      lines.map((l) => l.event),
      ['purge-plan', 'purge-batch', 'purge-batch', 'purge-done']
    );
    assert.ok(lines.every((l) => l.actor === 'owner' && typeof l.plan === 'string'));
    assert.equal(lines[0].count, PURGE_BATCH + 1);
  });

  it('paces the batches — a second batch inside the interval waits', async () => {
    seedMany(PURGE_BATCH + 5);
    const deps = purgeDeps({ batchIntervalMs: 2000 });
    const dry = await purge(tokens.owner, { prefix: 'assets/unused/', dryRun: true }, { deps });
    const spec = { prefix: 'assets/unused/', confirm: dry.json.confirm };
    assert.equal((await purge(tokens.owner, spec, { deps })).status, 200);
    const early = await purge(tokens.owner, spec, { deps });
    assert.equal(early.status, 429);
    assert.ok(early.json.retryAfterMs > 0);
    clock += 2000;
    const later = await purge(tokens.owner, spec, { deps });
    assert.equal(later.status, 200);
    assert.equal(later.json.done, true);
  });
});

describe('the confirmation is bound to the exact set', () => {
  it('no dry run, no purge', async () => {
    const rels = seedMany(3);
    const r = await purge(tokens.owner, { prefix: 'assets/unused/', confirm: 'x'.repeat(43) });
    assert.equal(r.status, 410);
    assert.ok(rels.every(present));
  });

  it('a changed file invalidates the confirmation, and nothing is deleted', async () => {
    const rels = seedMany(4);
    const dry = await purge(tokens.owner, { prefix: 'assets/unused/', dryRun: true });
    // Somebody edits one file after the owner looked.
    writeFileSync(join(designRoot, rels[2]), 'EDITED');
    openJournal(dataDir).recordWrite({ designRoot, path: rels[2], source: 'peer-put' });
    const r = await purge(tokens.owner, { prefix: 'assets/unused/', confirm: dry.json.confirm });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'set-changed');
    assert.ok(rels.every(present), 'a refused confirm deletes nothing');
    const again = await purge(tokens.owner, {
      prefix: 'assets/unused/',
      confirm: dry.json.confirm,
    });
    assert.equal(again.status, 410, 'the refused confirmation is spent');
  });

  it('a file added under the prefix invalidates it', async () => {
    seedMany(4);
    const dry = await purge(tokens.owner, { prefix: 'assets/unused/', dryRun: true });
    seed('assets/unused/new-arrival.png');
    const r = await purge(tokens.owner, { prefix: 'assets/unused/', confirm: dry.json.confirm });
    assert.equal(r.status, 409);
    assert.ok(present('assets/unused/new-arrival.png'));
  });

  it('a different set named with the same confirmation is refused', async () => {
    seedMany(4);
    seed('assets/keep/precious.png');
    const dry = await purge(tokens.owner, { prefix: 'assets/unused/', dryRun: true });
    const r = await purge(tokens.owner, { prefix: 'assets/', confirm: dry.json.confirm });
    assert.equal(r.status, 409);
    assert.ok(present('assets/keep/precious.png'));
  });

  it('a confirmation belongs to the owner credential that asked for it', async () => {
    const rels = seedMany(3);
    const dry = await purge(tokens.owner, { prefix: 'assets/unused/', dryRun: true });
    const r = await purge(tokens.env, { prefix: 'assets/unused/', confirm: dry.json.confirm });
    assert.equal(r.status, 403);
    assert.ok(rels.every(present));
  });

  it('expires', async () => {
    const rels = seedMany(3);
    const dry = await purge(tokens.owner, { prefix: 'assets/unused/', dryRun: true });
    clock += 60 * 60 * 1000;
    const r = await purge(tokens.owner, { prefix: 'assets/unused/', confirm: dry.json.confirm });
    assert.equal(r.status, 410);
    assert.ok(rels.every(present));
  });
});

describe('only the project owner, only on the main origin', () => {
  it('a member, a role-less token, a viewer and a canvas-scoped owner are refused', async () => {
    const rels = seedMany(3);
    for (const who of ['member', 'roleless', 'viewer', 'scopedOwner']) {
      const r = await purge(tokens[who], { prefix: 'assets/unused/', dryRun: true });
      assert.equal(r.status, 403, who);
    }
    assert.equal((await purge(null, { prefix: 'assets/unused/', dryRun: true })).status, 401);
    assert.ok(rels.every(present));
  });

  it('the access gate refuses a member before the handler runs', async () => {
    let status = 0;
    const handled = await runHubRoutes({
      request: req(tokens.member, { prefix: 'assets/', dryRun: true }),
      response: {},
      method: 'POST',
      path: PURGE_PATH,
      verify: (t) => verifyToken(dataDir, t, SECRET),
      respondJson: (s) => {
        status = s;
      },
      deps: purgeDeps(),
    });
    assert.equal(handled, true);
    assert.equal(status, 403);
  });

  it('the canvas origin never reaches it', async () => {
    seedMany(3);
    const { row } = classifyHubRequest('POST', PURGE_PATH, { canvasHost: true });
    assert.equal(row.handler, undefined, 'the canvas host row carries no handler');
    let status = 0;
    const handled = await runHubRoutes({
      request: req(tokens.owner, { prefix: 'assets/unused/', dryRun: true }),
      response: {},
      method: 'POST',
      path: PURGE_PATH,
      canvasHost: true,
      verify: (t) => verifyToken(dataDir, t, SECRET),
      respondJson: (s) => {
        status = s;
      },
      deps: purgeDeps(),
    });
    assert.equal(handled, false, 'nothing on the canvas origin answers the purge');
    assert.equal(status, 0);
    // And the main-origin row is project-scoped, owner capability, no canvas door.
    const main = classifyHubRequest('POST', PURGE_PATH);
    assert.equal(main.capability, 'delete');
    assert.equal(main.scope, 'project');
    assert.notEqual(main.row.canvasDoor, true);
  });

  it('answers POST only', async () => {
    assert.equal((await purge(tokens.owner, undefined, { method: 'GET' })).status, 405);
  });
});

describe('the door after a purge', () => {
  it('a member’s ordinary delete is unaffected by an owner purge', async () => {
    seedMany(DELETE_BUDGET_PER_WINDOW + 5);
    await purgeAll(tokens.owner, { prefix: 'assets/unused/' });
    const rel = seed('assets/member-delete.png', 'M');
    const journal = openJournal(dataDir);
    let status = 0;
    const response = {
      writeHead: (s) => {
        status = s;
        return response;
      },
      end: () => {},
      write: () => true,
    };
    await handleFileDoor({
      request: {
        headers: { authorization: `Bearer ${tokens.member}`, 'x-maude-expect-hash': sha('M') },
        async *[Symbol.asyncIterator]() {},
      },
      response,
      pathname: `/api/file/${rel}`,
      method: 'DELETE',
      dataDir,
      secret: SECRET,
      designRoot,
      journal,
      onDeleted: ({ path }) =>
        journal.recordWrite({ designRoot, path, source: 'peer-put', deleted: true }),
    });
    assert.equal(status, 200);
  });
});

describe('the hub keeps few confirmations', () => {
  it('a new dry run past the cap spends the oldest confirmation', async () => {
    seedMany(3);
    const first = await purge(tokens.owner, { prefix: 'assets/unused/', dryRun: true });
    for (let i = 0; i < 4; i += 1) {
      await purge(tokens.owner, { prefix: 'assets/unused/', dryRun: true });
    }
    const r = await purge(tokens.owner, { prefix: 'assets/unused/', confirm: first.json.confirm });
    assert.equal(r.status, 410);
  });
});
