// `PUT /api/project-config` — the owner tells a cell what its project is.
//
// 2026-10-02 (alligators): a cell that came into being by a desktop syncing
// into it had no config.json (the file plane never carries one), ran on the
// studio's defaults, and every canvas relying on the tokens stylesheet lost
// its brand fonts. The door is owner-only and takes a sanitized subset.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  handleProjectConfigDoor,
  PROJECT_CONFIG_PATH,
  sanitizeProjectConfigSubset,
} from '../src/project-config-door.mjs';
import { addToken } from '../src/tokens.mjs';

let dataDir;
let designRoot;
let owner;
let member;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'pcfg-data-'));
  designRoot = mkdtempSync(join(tmpdir(), 'pcfg-root-'));
  owner = addToken(dataDir, { label: 'owner', scope: '*', role: 'owner' }).value;
  member = addToken(dataDir, { label: 'member', scope: '*', role: 'member' }).value;
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(designRoot, { recursive: true, force: true });
});

const ALLIGATORS = {
  name: 'alligators',
  projectLabel: 'Brno Alligators',
  tokensCssRel: 'system/alligators/colors_and_type.css',
  componentsCssRel: null,
  canvasGroups: [
    { label: 'Design system', path: 'system' },
    { label: 'UI kit', path: 'ui' },
  ],
  designSystems: [{ name: 'alligators', path: 'system/alligators', description: 'long text' }],
  defaultDesignSystem: 'alligators',
  linkedHub: { url: 'https://evil.example', workspaceId: 'x' },
};

async function put(body, { bearer = owner, method = 'PUT', pathname = PROJECT_CONFIG_PATH } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const request = {
    headers: { authorization: bearer ? `Bearer ${bearer}` : undefined },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(raw);
    },
  };
  let status = 0;
  let payload = '';
  const response = new Writable({
    write(c, _e, cb) {
      payload += c;
      cb();
    },
  });
  response.writeHead = (s) => {
    status = s;
    return response;
  };
  let changed = 0;
  const handled = await handleProjectConfigDoor({
    request,
    response,
    pathname,
    method,
    dataDir,
    secret: '',
    designRoot,
    onChanged: () => {
      changed += 1;
    },
  });
  return { handled, status, json: payload ? JSON.parse(payload) : null, changed };
}

const config = () => JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));

describe('PUT /api/project-config', () => {
  it('an owner gives a config-less cell its project — and nothing that names a hub', async () => {
    const r = await put(ALLIGATORS);
    assert.equal(r.status, 200);
    assert.equal(r.json.changed, true);
    assert.equal(r.changed, 1);
    const c = config();
    assert.equal(c.tokensCssRel, 'system/alligators/colors_and_type.css');
    assert.deepEqual(c.designSystems, [{ name: 'alligators', path: 'system/alligators' }]);
    assert.equal(c.defaultDesignSystem, 'alligators');
    assert.equal(c.linkedHub, undefined);
  });

  it('merges into an existing config and never drops keys it does not own', async () => {
    writeFileSync(
      join(designRoot, 'config.json'),
      JSON.stringify({ themeDefault: 'dark', handoffTargets: ['x'], tokensCssRel: 'old.css' })
    );
    await put(ALLIGATORS);
    const c = config();
    assert.equal(c.themeDefault, 'dark');
    assert.deepEqual(c.handoffTargets, ['x']);
    assert.equal(c.tokensCssRel, 'system/alligators/colors_and_type.css');
  });

  it('the same config twice writes once', async () => {
    await put(ALLIGATORS);
    const r = await put(ALLIGATORS);
    assert.equal(r.status, 200);
    assert.equal(r.json.changed, false);
    assert.equal(r.changed, 0);
  });

  it('only the owner: a member, a read-only or a scoped token, or no token, write nothing', async () => {
    const viewer = addToken(dataDir, {
      label: 'v',
      scope: '*',
      role: 'owner',
      readOnly: true,
    }).value;
    const scoped = addToken(dataDir, { label: 's', scope: 'ui/alice', role: 'owner' }).value;
    for (const [bearer, status] of [
      [member, 403],
      [viewer, 403],
      [scoped, 403],
      [null, 401],
      ['nope', 401],
    ]) {
      const r = await put(ALLIGATORS, { bearer });
      assert.equal(r.status, status, String(bearer));
    }
    assert.throws(() => config());
  });

  it('refuses what is not a project config, and answers only its own path', async () => {
    assert.equal((await put('not json')).status, 400);
    assert.equal((await put({ linkedHub: { url: 'x' } })).status, 400);
    assert.equal((await put('x'.repeat(40 * 1024))).status, 413);
    assert.equal((await put(ALLIGATORS, { method: 'POST' })).status, 405);
    assert.equal((await put(ALLIGATORS, { pathname: '/api/project-configs' })).handled, false);
  });
});

describe('sanitizeProjectConfigSubset', () => {
  it('keeps only contained relative paths and plain names', () => {
    const s = sanitizeProjectConfigSubset({
      tokensCssRel: '../../etc/passwd',
      canvasGroups: [
        { label: 'ok', path: 'ui' },
        { label: 'abs', path: '/etc' },
        { label: 'up', path: '../x' },
      ],
      designSystems: [
        { name: 'ok', path: 'system/ok', tokensCssRel: 'system/ok/t.css' },
        { name: 'bad/name', path: 'system/x' },
        { name: 'esc', path: 'system/x', tokensCssRel: '/abs.css' },
      ],
      defaultDesignSystem: 'missing',
    });
    assert.deepEqual(s, {
      canvasGroups: [{ label: 'ok', path: 'ui' }],
      designSystems: [{ name: 'ok', path: 'system/ok', tokensCssRel: 'system/ok/t.css' }],
    });
  });
});
