// The cloud's v1 → v2 conversion at cell boot (p8-v1-drop-cloud, decision
// `maude/v2-michal-drop-v1-auto-convert`): a cell hub — workspace mode, a checkout, a tenant —
// whose image is a stable 2.x converts its project on start; a second start changes nothing; an
// rc or a 1.x image never converts; the backup is taken before the first write; a failure is that
// cell's alone and `/health` says so.
//
// One cell is one project (apps/cells/worker.mjs), so "two projects" are two cells booted in turn.
// The studio child is off (MAUDE_STUDIO_CHILD=0): the conversion is the coordinator's, and the
// boot that runs it is the same with or without the child (a paired child is what the fleet has —
// the `browser-not-paired` refusal is pinned in v2-convert.test.mjs).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { after, describe, test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { openSqliteProjectStore } from '../src/project-transactions/store-sqlite.mjs';
import { createHub } from '../src/server.mjs';
import { parseReportLine } from '../src/v2-convert.mjs';

const STABLE = { hub: '2.0.0', release: '2.0.0' };
const TREE_IS_RC = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version.includes('-');
const dirs = [];
const tmp = (p) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x.test', ...args], {
    cwd,
    stdio: 'ignore',
  });

/** A cell's two disks: a committed checkout with one canvas, and the hub's data dir. */
function makeCell({ checkoutFormat = null, store = {} } = {}) {
  const dataDir = tmp('maude-v2c-data-');
  const repoDir = tmp('maude-v2c-repo-');
  mkdirSync(join(repoDir, '.design', 'ui'), { recursive: true });
  writeFileSync(
    join(repoDir, '.design', 'config.json'),
    `${JSON.stringify({
      name: 'v2c',
      canvasGroups: [{ label: 'UI', path: 'ui' }],
      ...(checkoutFormat ? { formatVersion: checkoutFormat } : {}),
    })}\n`
  );
  writeFileSync(
    join(repoDir, '.design', 'ui', 'home.tsx'),
    'export default () => <h1>home</h1>;\n'
  );
  git(repoDir, 'init', '-q');
  git(repoDir, 'add', '-A');
  git(repoDir, 'commit', '-q', '-m', 'seed');
  return { dataDir, repoDir, store };
}

async function seedStore(dataDir, { formatVersion = 1, mode = 'legacy' } = {}) {
  const s = openSqliteProjectStore(dataDir);
  try {
    let epoch = 0;
    if (formatVersion !== 1) epoch = (await s.setFormat({ formatVersion, expectEpoch: 0 })).epoch;
    if (mode !== 'legacy') await s.setMode({ mode, expectEpoch: epoch });
  } finally {
    s.close();
  }
}

/** Boot a cell hub, wait for its boot chain (which runs the conversion), hand back the log. */
async function bootCell(cell, { tenant, v2Convert } = {}) {
  const saved = {};
  const env = {
    HUB_WORKSPACE_MODE: '1',
    MAUDE_STUDIO_CHILD: '0',
    MAUDE_REPO_DIR: cell.repoDir,
    MAUDE_TENANT_ID: tenant,
  };
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  const lines = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  let built;
  try {
    built = createHub({
      port: 0,
      dataDir: cell.dataDir,
      secret: 'test-secret',
      verbose: false,
      ...(v2Convert ? { v2Convert } : {}),
    });
    await built.server.listen();
    await built.acceptedReady;
  } finally {
    console.log = orig.log;
    console.error = orig.error;
  }
  const http = built.server.httpURL.replace('0.0.0.0', '127.0.0.1');
  const health = await (await fetch(`${http}/health`)).json();
  const state = await built.projectStore.state();
  await built.stopJournal?.();
  await built.server.destroy();
  built.projectStore.close();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return { lines, health, state };
}

const reportOf = (lines) => lines.map(parseReportLine).filter(Boolean);

/** Every file of the checkout (minus .git), hashed — "the project's bytes". */
function treeHash(root) {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      if (name === '.git') continue;
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else h.update(`${relative(root, abs)}\0`).update(readFileSync(abs));
    }
  };
  walk(root);
  return h.digest('hex');
}

const generations = (dataDir) => {
  const dir = join(dataDir, 'v2-convert', 'backups');
  return existsSync(dir) ? readdirSync(dir).sort() : [];
};

/** The project store as the backup holds it. */
async function backedUpStoreState(dataDir, gen) {
  const gz = readFileSync(join(dataDir, 'v2-convert', 'backups', gen, 'project-store.sqlite.gz'));
  const restored = tmp('maude-v2c-restored-');
  writeFileSync(join(restored, 'project-store.sqlite'), gunzipSync(gz));
  const s = openSqliteProjectStore(restored);
  try {
    return await s.state();
  } finally {
    s.close();
  }
}

describe('a stable 2.x cell converts its project on boot', () => {
  test('format 1 in legacy mode → format 2 + accepted revisions, backup first; a second boot changes nothing', {
    timeout: 60_000,
  }, async () => {
    const cell = makeCell();
    await seedStore(cell.dataDir);
    const first = await bootCell(cell, { tenant: 'cell-a', v2Convert: { versions: STABLE } });
    assert.deepEqual(reportOf(first.lines), [{ converted: 1, skipped: 0, failed: 0 }]);
    assert.equal(first.state.formatVersion, 2);
    assert.equal(first.state.mode, 'transactions');
    assert.equal(first.state.importPending, false);
    assert.deepEqual(
      { ...first.health.v2Convert, at: undefined },
      { state: 'done', converted: 1, skipped: 0, failed: 0, at: undefined }
    );

    // The backup: one full generation (documents, store, checkout), taken BEFORE the flip.
    const gens = generations(cell.dataDir);
    assert.equal(gens.length, 1);
    const manifest = JSON.parse(
      readFileSync(join(cell.dataDir, 'v2-convert', 'backups', gens[0], 'manifest.json'), 'utf8')
    );
    const names = manifest.files.map((f) => f.name);
    assert.ok(names.includes('project-store.sqlite'), names.join());
    assert.ok(manifest.repo, 'the checkout rides in the same generation');
    const before = await backedUpStoreState(cell.dataDir, gens[0]);
    assert.equal(before.formatVersion, 1, 'the backup holds the project as it was');
    assert.equal(before.mode, 'legacy');

    // Idempotent: the second deploy / restart converts nothing and writes nothing.
    const bytes = treeHash(cell.repoDir);
    const second = await bootCell(cell, { tenant: 'cell-a', v2Convert: { versions: STABLE } });
    assert.deepEqual(reportOf(second.lines), [{ converted: 0, skipped: 1, failed: 0 }]);
    assert.deepEqual(second.state, first.state, 'the store is exactly as the first boot left it');
    assert.equal(treeHash(cell.repoDir), bytes, 'the checkout is byte-identical');
    assert.deepEqual(generations(cell.dataDir), gens, 'no second backup');
  });

  test('format 2 still saving the old way → accepted revisions (the other project)', {
    timeout: 60_000,
  }, async () => {
    const cell = makeCell({ checkoutFormat: 2 });
    await seedStore(cell.dataDir, { formatVersion: 2 });
    const out = await bootCell(cell, { tenant: 'cell-b', v2Convert: { versions: STABLE } });
    assert.deepEqual(reportOf(out.lines), [{ converted: 1, skipped: 0, failed: 0 }]);
    assert.equal(out.state.formatVersion, 2);
    assert.equal(out.state.mode, 'transactions');
    assert.equal(generations(cell.dataDir).length, 1);
  });

  test('a cell that fails is that cell alone: it stays as it was and /health says failed=1', {
    timeout: 60_000,
  }, async () => {
    const broken = makeCell();
    await seedStore(broken.dataDir);
    const out = await bootCell(broken, {
      tenant: 'cell-c',
      v2Convert: {
        versions: STABLE,
        backup: async () => {
          throw new Error('forced');
        },
      },
    });
    assert.deepEqual(reportOf(out.lines), [{ converted: 0, skipped: 0, failed: 1 }]);
    assert.equal(out.health.ok, true, 'the boot is not blocked');
    assert.equal(out.health.v2Convert.failed, 1);
    assert.equal(out.state.formatVersion, 1, 'left readable as it was');
    assert.equal(out.state.mode, 'legacy');
    assert.ok(out.lines.some((l) => /cell-c: FAILED \(backup: forced\)/.test(l)));
  });
});

describe('an rc or a 1.x image never converts', () => {
  for (const [label, versions, reason] of [
    ['an rc', { hub: '2.0.0-rc.1', release: '2.0.0-rc.1' }, 'prerelease'],
    ['a 1.x', { hub: '1.10.0', release: '1.10.0' }, 'v1'],
    // No override: this tree's own version — gated while the v2 line is an rc (from promote on,
    // the stable cases above are what this tree is).
    ['this tree', null, 'prerelease'],
  ]) {
    const skip = !versions && !TREE_IS_RC && 'this tree is a stable release';
    test(`${label} image leaves a format-1 legacy project alone`, {
      timeout: 60_000,
      skip,
    }, async () => {
      const cell = makeCell();
      await seedStore(cell.dataDir);
      const bytes = treeHash(cell.repoDir);
      const out = await bootCell(cell, {
        tenant: 'cell-g',
        ...(versions ? { v2Convert: { versions } } : {}),
      });
      assert.deepEqual(reportOf(out.lines), []);
      assert.equal(out.state.formatVersion, 1);
      assert.equal(out.state.mode, 'legacy');
      assert.equal(out.health.v2Convert.state, 'gated');
      assert.equal(out.health.v2Convert.reason, reason);
      assert.deepEqual(generations(cell.dataDir), []);
      assert.equal(treeHash(cell.repoDir), bytes);
    });
  }
});
