// S1.6 — a real kernel over a real store core (better-sqlite3 in memory), for
// the history.name / history.aside / trash.* kernel tests. The oracle is the
// store (heads, the logged action, the additive tables), never the kernel's
// own answer alone. Not a test file itself (no `.test.`).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { gunzipSync, gzipSync } from 'node:zlib';

import { proposalScope } from '../src/access-docs.mjs';
import { createKernel } from '../src/project-transactions/kernel.mjs';
import { laneHash } from '../src/project-transactions/lanes.mjs';
import { createStoreCore } from '../src/project-transactions/store-core.mjs';
import { betterSqliteAdapter } from '../src/project-transactions/store-sqlite.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');

export const GZIP = {
  encode: (text) => gzipSync(Buffer.from(text, 'utf8')),
  decode: (stored) =>
    typeof stored === 'string' ? stored : gunzipSync(Buffer.from(stored)).toString('utf8'),
};

export const CODECS = [
  ['identity', null],
  ['gzip', GZIP],
];

export const body = (s = 'v0', extra = '') =>
  `export default () => (\n  <div>\n    <p>${s}</p>${extra}\n  </div>\n);\n`;

/** Owner / member / viewer as the hub passes them (`auth.can`, project-level). */
export const OWNER = { can: () => true };
export const MEMBER = { can: (cap) => cap !== 'delete' };

/**
 * A canvas-only session (V2-1.16 L4) through the REAL S9.5 hooks: `grants`
 * maps a designRoot-relative canvas path to 'member' | 'observer'.
 */
export function canvasOnly(grants) {
  const access = {
    role: null,
    canvasOnly: true,
    grants: Object.entries(grants).map(([c, r]) => ({ c, r })),
    seesCanvas: (c) => Object.hasOwn(grants, c),
    can: (cap, c) =>
      cap === 'delete'
        ? false
        : grants[c] === 'member' || (grants[c] === 'observer' && cap === 'read'),
  };
  return {
    inScope: proposalScope(access),
    can: (cap) => cap !== 'delete' && access.grants.some((g) => access.can(cap, g.c)),
  };
}

let tx = 0;

/** `drop`: store methods to leave out (a remote home whose method list has not grown). */
export function rig(codec, { drop = [] } = {}) {
  const db = new Database(':memory:');
  const core = createStoreCore(betterSqliteAdapter(db), codec ? { codec } : {});
  core.migrate();
  core.setMode({ mode: 'transactions' });
  core.markImported();
  const store = {};
  for (const [name, fn] of Object.entries(core)) {
    if (!drop.includes(name)) store[name] = async (...a) => fn(...a);
  }
  const published = [];
  const kernel = createKernel({
    store,
    projectId: 'p1',
    log: { error() {} },
    applyAccepted: async (a) => {
      published.push(a);
    },
  });
  async function propose(
    actor,
    operations,
    { kind = 'edit', label = null, origin, auth = {} } = {}
  ) {
    const { epoch } = await kernel.state();
    const bytes = JSON.stringify({
      protocol: 1,
      projectId: 'p1',
      epoch,
      transactionId: `tx-${String(++tx).padStart(8, '0')}`,
      action: { kind, label, operations },
      ...(origin ? { origin } : {}),
    });
    return kernel.submit(bytes, { actor, ...auth });
  }
  async function head(doc, lane = 'html') {
    const h = (await store.heads([doc]))[doc];
    const hash = h?.lanes?.[lane]?.hash ?? null;
    return hash ? store.blob(hash) : '';
  }
  async function ok(p) {
    const r = await p;
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  }
  const edit = async (actor, doc, content, opts) =>
    ok(
      propose(
        actor,
        [{ op: 'lane.replace', doc, lane: 'html', content, base: laneHash(await head(doc)) }],
        opts
      )
    );
  const create = (actor, doc, path, content = body(), opts) =>
    ok(propose(actor, [{ op: 'doc.create', doc, path, lanes: { html: content } }], opts));
  const del = (actor, doc, opts = {}) =>
    ok(propose(actor, [{ op: 'doc.delete', doc }], { kind: 'trash', ...opts }));
  const rev = async () => (await kernel.state()).revision;
  const row = async (actionId) => store.action(actionId);
  const docRow = async (doc) => (await store.manifest()).docs.find((d) => d.doc === doc) ?? null;
  return {
    db,
    core,
    kernel,
    store,
    propose,
    head,
    ok,
    edit,
    create,
    del,
    rev,
    row,
    docRow,
    published,
  };
}
