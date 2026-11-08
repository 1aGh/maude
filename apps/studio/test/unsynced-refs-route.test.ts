// #158 — GET /_api/sync/unsynced-refs: the Sync details panel's read of the unsynced-reference
// diagnostic. Main origin only, a read, project-class (a canvas-only session hears the missing-scope
// refusal), and it answers nothing for a project that is not linked.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type AccessClaim, legacyClaim, resolveAccess } from '../access/scope.ts';
import { guardTableRoute } from '../http.ts';
import { createSyncRoutes } from '../routes/sync.ts';

const PATH = '/_api/sync/unsynced-refs';
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'unsynced-route-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const put = (rel: string, body: string) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), body);
};
const CANVAS =
  "import { DesignCanvas } from '@maude/canvas-lib';\nimport './_foo/screens';\nexport default () => <DesignCanvas />;\n";

function get(o: { claim?: AccessClaim; designRoot?: string | null } = {}) {
  const specs = createSyncRoutes({
    control: () => null,
    trace: { begin() {}, view: () => null } as never,
    warn: () => {},
    access: () => resolveAccess(o.claim ?? legacyClaim('member')),
    ...(o.designRoot === null ? {} : { designRoot: o.designRoot ?? root }),
  }).map(guardTableRoute);
  const spec = specs.find((s) => s.method === 'GET' && s.path === PATH);
  if (!spec) throw new Error('no route');
  return {
    spec,
    run: () =>
      spec.handle(
        new Request(`http://127.0.0.1:4399${PATH}`, { headers: { host: '127.0.0.1:4399' } }),
        {}
      ),
  };
}

describe('GET /_api/sync/unsynced-refs', () => {
  test('is a main-origin read that a read-only session may call', () => {
    const { spec } = get();
    expect(spec.origin).toBe('main');
    expect(spec.readOnly).toBe('allowed');
  });

  test('a linked project: the canvas, the file and the reason', async () => {
    put('config.json', JSON.stringify({ linkedHub: { url: 'https://hub.test' } }));
    put('ui/x/foo.tsx', CANVAS);
    put('ui/x/_foo/screens.tsx', 'export {};');
    const res = await get().run();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.linked).toBe(true);
    expect(body.refs).toHaveLength(1);
    expect(body.refs[0]).toMatchObject({
      canvas: 'ui/x/foo.tsx',
      file: 'ui/x/_foo/screens.tsx',
      reason: 'underscore-folder',
    });
  });

  test('a project that is not linked is not checked', async () => {
    put('config.json', '{}');
    put('ui/x/foo.tsx', CANVAS);
    const body = await (await get().run()).json();
    expect(body).toMatchObject({ linked: false, refs: [] });
  });

  test('no design root known: nothing to say, not an error', async () => {
    const body = await (await get({ designRoot: null }).run()).json();
    expect(body).toMatchObject({ linked: false, refs: [] });
  });

  test('a session limited to one canvas hears the missing-scope refusal', async () => {
    put('config.json', JSON.stringify({ linkedHub: { url: 'https://hub.test' } }));
    const res = await get({
      claim: { v: 1, role: null, grants: [{ c: 'ui/x/foo.tsx', r: 'viewer' }] },
    }).run();
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('screens');
  });
});
