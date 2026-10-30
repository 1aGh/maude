// `PUT /api/project-config` — the owner tells a cell what its project is.
//
// 2026-10-02 (alligators): a cell that came into being by a desktop syncing
// into it had no config.json (the file plane never carries one), ran on the
// studio's defaults, and every canvas relying on the tokens stylesheet lost
// its brand fonts. The door is owner-only and takes a sanitized subset.

import assert from 'node:assert/strict';
import {
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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

  it('a tenant-versioned config is only filled in — nothing it already says changes', async () => {
    writeFileSync(
      join(designRoot, 'config.json'),
      JSON.stringify({
        themeDefault: 'dark',
        handoffTargets: ['x'],
        tokensCssRel: 'old.css',
        canvasGroups: [{ label: 'Mine', path: 'screens' }],
      })
    );
    await put(ALLIGATORS);
    const c = config();
    assert.equal(c.themeDefault, 'dark');
    assert.deepEqual(c.handoffTargets, ['x']);
    assert.equal(c.tokensCssRel, 'old.css');
    assert.deepEqual(c.canvasGroups, [{ label: 'Mine', path: 'screens' }]);
    assert.deepEqual(c.designSystems, [{ name: 'alligators', path: 'system/alligators' }]);
  });

  // Review F1: canvasGroups feed the hub's classifier — two owners' desktops
  // must not flip them back and forth on every reconnect.
  it('in a config this door created, display keys follow the owner but groups never change', async () => {
    await put(ALLIGATORS);
    await put({
      ...ALLIGATORS,
      projectLabel: 'Gators',
      canvasGroups: [{ label: 'Other', path: 'elsewhere' }],
    });
    const c = config();
    assert.equal(c.projectLabel, 'Gators');
    assert.deepEqual(c.canvasGroups, [
      { label: 'Design system', path: 'system' },
      { label: 'UI kit', path: 'ui' },
    ]);
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
  it('P-5: schema / rootClass / themes / themeDefault are filled, never changed', async () => {
    const sys = { name: 'alligators', path: 'system/alligators' };
    await put({ ...ALLIGATORS, designSystems: [sys] });
    await put({
      ...ALLIGATORS,
      designSystems: [
        { ...sys, schema: 1, rootClass: 'gators', themes: ['dark', 'light'], themeDefault: 'dark' },
      ],
    });
    assert.deepEqual(config().designSystems, [
      { ...sys, schema: 1, rootClass: 'gators', themes: ['dark', 'light'], themeDefault: 'dark' },
    ]);
    // a second owner's desktop says otherwise: the door-created config keeps the first values
    await put({
      ...ALLIGATORS,
      designSystems: [{ ...sys, rootClass: 'other', themes: ['light'], themeDefault: 'light' }],
    });
    assert.deepEqual(config().designSystems, [
      { ...sys, schema: 1, rootClass: 'gators', themes: ['dark', 'light'], themeDefault: 'dark' },
    ]);
  });
});

describe('sanitizeProjectConfigSubset', () => {
  it("takes only group paths the hub's own classifier accepts (review F2)", () => {
    const s = sanitizeProjectConfigSubset({
      canvasGroups: [
        { label: 'ok', path: 'ui' },
        { label: 'dot', path: '.' },
        { label: 'dotted', path: 'web.v2' },
        { label: 'trailing', path: 'ui/' },
      ],
    });
    assert.deepEqual(s, { canvasGroups: [{ label: 'ok', path: 'ui' }] });
  });

  it('P-5: carries schema (1 only), rootClass and themes in the class charset, themeDefault among themes', () => {
    const s = sanitizeProjectConfigSubset({
      designSystems: [
        {
          name: 'ok',
          path: 'system/ok',
          schema: 1,
          rootClass: 'fx',
          themes: ['light', 'dark'],
          themeDefault: 'dark',
        },
        {
          name: 'two',
          path: 'system/two',
          schema: 2,
          rootClass: 'Fx</style>',
          themes: ['light', 'Bad Theme', 'light'],
          themeDefault: 'sepia',
        },
        {
          name: 'str',
          path: 'system/str',
          schema: '1',
          rootClass: 'x'.repeat(65),
          themes: 'dark',
          themeDefault: 'dark',
        },
      ],
    });
    assert.deepEqual(s.designSystems, [
      {
        name: 'ok',
        path: 'system/ok',
        schema: 1,
        rootClass: 'fx',
        themes: ['light', 'dark'],
        themeDefault: 'dark',
      },
      { name: 'two', path: 'system/two', themes: ['light'] },
      { name: 'str', path: 'system/str', themeDefault: 'dark' },
    ]);
  });

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

// Security review 2026-10-02 (defender, CRITICAL): the temp name was
// `config.json.<pid>.tmp` inside the tenant's checkout and the write followed
// links — a committed symlink there overwrote /data/admin.json with JSON that
// carried an attacker's `secret`. Each case below is red against that code.
describe('the checkout is tenant-controlled — no link is ever followed', () => {
  let victimDir;
  beforeEach(() => {
    victimDir = mkdtempSync(join(tmpdir(), 'pcfg-victim-'));
    writeFileSync(join(victimDir, 'admin.json'), '{"secret":"real"}');
  });
  afterEach(() => rmSync(victimDir, { recursive: true, force: true }));
  const victim = () => readFileSync(join(victimDir, 'admin.json'), 'utf8');

  it('a link planted at every predictable temp name writes nothing through it', async () => {
    writeFileSync(join(designRoot, 'config.json'), '{"secret":"attacker","name":"x"}');
    for (let pid = 1; pid < 200; pid++) {
      symlinkSync(join(victimDir, 'admin.json'), join(designRoot, `config.json.${pid}.tmp`));
    }
    symlinkSync(join(victimDir, 'admin.json'), join(designRoot, `config.json.${process.pid}.tmp`));
    const r = await put(ALLIGATORS);
    assert.equal(r.status, 200);
    assert.equal(victim(), '{"secret":"real"}');
    assert.equal(config().tokensCssRel, 'system/alligators/colors_and_type.css');
  });

  it('a config.json that is a symlink is refused — never read, never written through', async () => {
    symlinkSync(join(victimDir, 'admin.json'), join(designRoot, 'config.json'));
    const r = await put(ALLIGATORS);
    assert.equal(r.status, 409);
    assert.equal(victim(), '{"secret":"real"}');
  });

  it('a config.json hard-linked to another file is refused', async () => {
    try {
      linkSync(join(victimDir, 'admin.json'), join(designRoot, 'config.json'));
    } catch {
      return; // different filesystems — a hardlink cannot exist here at all
    }
    const r = await put(ALLIGATORS);
    assert.equal(r.status, 409);
    assert.equal(victim(), '{"secret":"real"}');
  });

  it('leaves no temp file behind', async () => {
    await put(ALLIGATORS);
    assert.deepEqual(
      readdirSync(designRoot).filter((n) => n.endsWith('.tmp')),
      []
    );
  });
});
