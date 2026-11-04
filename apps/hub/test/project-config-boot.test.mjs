// A cell's boot puts back the owner's project config BEFORE anything reads it
// (2.0.2 — alligators on 2.0.1 ran on the studio's defaults after every roll).
//
// The door half (what is kept, what boot may write) is pinned beside the door
// in project-config-door.test.mjs. This file pins the ORDER: `createHub`
// itself restores `config.json`, so by the time it returns — before the port
// is bound, before `runAsMain` starts the studio child, before the classifier
// or a first request reads the checkout — the file is back.

import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { after, test } from 'node:test';

import { handleProjectConfigDoor, PROJECT_CONFIG_PATH } from '../src/project-config-door.mjs';
import { createHub } from '../src/server.mjs';
import { addToken } from '../src/tokens.mjs';

const dirs = [];
const tmp = (p) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SUBSET = {
  name: 'alligators',
  tokensCssRel: 'system/alligators/colors_and_type.css',
  designSystems: [{ name: 'alligators', path: 'system/alligators' }],
  defaultDesignSystem: 'alligators',
};

/** The owner's desktop pushing its config into the hub's door, before the roll. */
async function ownerPush(dataDir, designRoot) {
  const owner = addToken(dataDir, { label: 'owner', scope: '*', role: 'owner' }).value;
  const response = new Writable({ write: (_c, _e, cb) => cb() });
  let status = 0;
  response.writeHead = (s) => {
    status = s;
    return response;
  };
  await handleProjectConfigDoor({
    request: {
      headers: { authorization: `Bearer ${owner}` },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify(SUBSET));
      },
    },
    response,
    pathname: PROJECT_CONFIG_PATH,
    method: 'PUT',
    dataDir,
    secret: '',
    designRoot,
  });
  assert.equal(status, 200);
}

test('createHub restores the owner’s config.json before it returns — before the studio can start', async () => {
  // Before the roll: a cell whose owner pushed the config.
  const oldData = tmp('pcfg-boot-old-');
  const oldRepo = tmp('pcfg-boot-oldrepo-');
  mkdirSync(join(oldRepo, '.design'));
  await ownerPush(oldData, join(oldRepo, '.design'));

  // After it: the backup generation's databases, and a checkout re-cloned
  // from the bundle — which never had the door's uncommitted config.json.
  const dataDir = tmp('pcfg-boot-data-');
  copyFileSync(join(oldData, 'tokens.db'), join(dataDir, 'tokens.db'));
  const repoDir = tmp('pcfg-boot-repo-');
  mkdirSync(join(repoDir, '.design'));

  const saved = {};
  const env = {
    HUB_WORKSPACE_MODE: '1',
    MAUDE_STUDIO_CHILD: '0',
    MAUDE_REPO_DIR: repoDir,
    MAUDE_TENANT_ID: undefined,
    MAUDE_BACKUP_TARGET: undefined,
    MAUDE_DATA_EPHEMERAL: undefined,
  };
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = () => {};
  let built;
  try {
    built = createHub({ port: 0, dataDir, secret: 'test-secret', verbose: false });
    // Not yet listening: whatever reads config.json from here on sees the owner's.
    const restored = JSON.parse(readFileSync(join(repoDir, '.design', 'config.json'), 'utf8'));
    assert.deepEqual(restored, SUBSET);
    assert.equal(
      JSON.parse(readFileSync(join(dataDir, 'project-config-created.json'), 'utf8')).createdByDoor,
      true
    );
  } finally {
    if (built) {
      await built.server.listen();
      await built.acceptedReady;
      await built.stopJournal?.();
      await built.server.destroy();
      built.projectStore?.close();
    }
    Object.assign(console, orig);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
