// p8-boundary-harden — the hub half of the final-3 security pair over the hub folder boundary
// (decision maude/v2-michal-hub-is-the-folder-boundary-before-config).
//
// M1 / attacker L3: an undeclared hub's kernel takes any folder (`allowUndeclaredGroup`), and the
// shared validator let that folder start with `_` or `-`, or be `node_modules` — a teammate could
// propose a canvas into `_state/`, `_history/<slug>/` or `node_modules/`. The kernel uses the same
// validator as the studio, so the first-component rule applies here too.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import * as Y from 'yjs';

import { declaredCanvasGroups, validateCanvasPath } from '../../studio/sync/canvas-path.ts';
import { readCanvasGroups } from '../src/file-manifest.mjs';
import { createWorkspaceAgent } from '../src/workspace-agent.mjs';
import { body, rig } from './_kernel-rig.mjs';

const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'hub-boundary-harden-'));
  temps.push(d);
  return d;
}
const silent = () => ({ log() {}, warn() {}, error() {} });
let gitOk = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch {
  gitOk = false;
}

const slugOf = (rel) => rel.replace(/\.tsx$/, '').replace(/\//g, '-').toLowerCase();

describe('M1 — an undeclared kernel refuses runtime and node_modules folders', () => {
  for (const rel of [
    '_state/x.tsx',
    '_history/s/x.tsx',
    '_comments/x.tsx',
    '-x/y.tsx',
    'node_modules/p/index.tsx',
    'NODE_MODULES/p/index.tsx',
  ]) {
    test(`doc.create at ${rel} is refused`, async () => {
      const r = rig(null);
      const doc = `ws/local/main/${slugOf(rel)}`;
      const res = await r.propose('you', [
        { op: 'doc.create', doc, path: rel, lanes: { html: body() } },
      ]);
      assert.notEqual(res.status, 200, JSON.stringify(res.body));
      assert.match(JSON.stringify(res.body), /no group may be/);
      assert.equal(await r.docRow(doc), null);
    });
  }

  test('an ordinary undeclared folder is still accepted', async () => {
    const r = rig(null);
    await r.create('you', 'ws/local/main/screens-home', 'screens/home.tsx');
    assert.ok(await r.docRow('ws/local/main/screens-home'));
  });
});

// Defender L1 + attacker I2: "has the owner declared folders" had four answers. The workspace agent
// called `[{}]` declared, kept its first non-null answer forever, and resolved paths WITHOUT the
// kernel's `allowUndeclaredGroup` — so under cell pairing (live mode: both write one checkout) a
// teammate's `components/new.tsx` landed here as the flat fallback `components-new.tsx` while the
// paired studio wrote `components/new.tsx`: one slug, two files.
describe('L1 / I2 — one "declared" predicate, re-read, and the agent takes what its kernel takes', () => {
  test('declaredCanvasGroups: the kernel rule, for every config shape', () => {
    for (const raw of [undefined, null, {}, 'ui', [], [{}], [{ path: '' }], [{ label: 'x' }], [''], [3]]) {
      assert.equal(declaredCanvasGroups(raw), null, JSON.stringify(raw ?? 'absent'));
    }
    assert.deepEqual(declaredCanvasGroups([{ label: 'S', path: 'screens' }, {}]), [
      { label: 'S', path: 'screens' },
    ]);
    assert.deepEqual(declaredCanvasGroups(['screens']), [{ path: 'screens' }]);
  });

  test('the hub reader and the validator take the string form the kernel passes', () => {
    const root = tmp();
    writeFileSync(join(root, 'config.json'), JSON.stringify({ canvasGroups: [{}, { path: '' }] }));
    assert.equal(readCanvasGroups(root), null, '[{}] / [{path:""}] declare nothing');
    // server.mjs acceptedCanvasGroups hands the kernel bare strings; they must count as groups,
    // or a declared hub refuses its own declared folder.
    const v = validateCanvasPath({ path: 'screens/x.tsx', slug: 'screens-x', canvasGroups: ['screens'] });
    assert.equal(v.ok, true, JSON.stringify(v));
  });

  const doc = (path) => {
    const d = new Y.Doc();
    d.getText('html').insert(0, 'export default () => <main>c</main>;\n');
    d.getMap('syncMeta').set('path', path);
    return d;
  };

  test('an undeclared checkout: the agent writes components/new.tsx, not components-new.tsx', {
    skip: gitOk ? false : 'git not available',
  }, async () => {
    const repo = tmp();
    mkdirSync(join(repo, '.design'), { recursive: true });
    // `[{}]` is not a declaration — the agent used to treat it as one.
    writeFileSync(join(repo, '.design/config.json'), JSON.stringify({ canvasGroups: [{}] }));
    const agent = createWorkspaceAgent({ repoDir: repo, debounceMs: 5, log: silent() });
    await agent.start();
    const res = await agent.onDocumentStored({
      documentName: 'ws/acme/main/components-new',
      document: doc('components/new.tsx'),
      user: null,
    });
    assert.equal(res.bodyRel, 'components/new.tsx');
    assert.ok(existsSync(join(repo, '.design/components/new.tsx')));
    assert.ok(!existsSync(join(repo, '.design/components-new.tsx')), 'no flat twin');
    await agent.stop();
  });

  test('the agent re-reads the config: declaring folders closes the boundary at once', {
    skip: gitOk ? false : 'git not available',
  }, async () => {
    const repo = tmp();
    mkdirSync(join(repo, '.design'), { recursive: true });
    const agent = createWorkspaceAgent({ repoDir: repo, debounceMs: 5, log: silent() });
    await agent.start();
    const first = await agent.onDocumentStored({
      documentName: 'ws/acme/main/screens-home',
      document: doc('screens/home.tsx'),
      user: null,
    });
    assert.equal(first.bodyRel, 'screens/home.tsx', 'undeclared: the hub is the boundary');
    writeFileSync(
      join(repo, '.design/config.json'),
      JSON.stringify({ canvasGroups: [{ label: 'Screens', path: 'screens' }] })
    );
    const second = await agent.onDocumentStored({
      documentName: 'ws/acme/main/flows-checkout',
      document: doc('flows/checkout.tsx'),
      user: null,
    });
    assert.notEqual(second.bodyRel, 'flows/checkout.tsx', 'declared: flows/ is outside the groups');
    assert.ok(!existsSync(join(repo, '.design/flows/checkout.tsx')));
    await agent.stop();
  });

  test('no forever cache: a widened declaration is honoured by the next store', {
    skip: gitOk ? false : 'git not available',
  }, async () => {
    const repo = tmp();
    mkdirSync(join(repo, '.design'), { recursive: true });
    const cfg = (paths) =>
      writeFileSync(
        join(repo, '.design/config.json'),
        JSON.stringify({ canvasGroups: paths.map((p) => ({ label: p, path: p })) })
      );
    cfg(['screens']);
    const agent = createWorkspaceAgent({ repoDir: repo, debounceMs: 5, log: silent() });
    await agent.start();
    cfg(['screens', 'flows']);
    const res = await agent.onDocumentStored({
      documentName: 'ws/acme/main/flows-checkout',
      document: doc('flows/checkout.tsx'),
      user: null,
    });
    assert.equal(res.bodyRel, 'flows/checkout.tsx', 'the boot-time answer is not kept');
    await agent.stop();
  });
});
