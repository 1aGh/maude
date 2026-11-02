// S8.13 — POST /_api/assets/trash: the role gate is on the SERVER (a viewer or a canvas-only editor is refused whatever
// the client drew), the body is validated, and the answer is per item so one refusal never blocks the rest.
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveAccess } from '../access/scope.ts';
import { createAssetTrashRoutes } from '../routes/asset-trash.ts';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function setup(access: ReturnType<typeof resolveAccess>) {
  const designRoot = mkdtempSync(path.join(tmpdir(), 'asset-trash-route-'));
  roots.push(designRoot);
  mkdirSync(path.join(designRoot, 'assets'), { recursive: true });
  writeFileSync(path.join(designRoot, 'assets/a1b2c3d4.jpg'), 'x');
  writeFileSync(path.join(designRoot, 'assets/e5f60718.jpg'), 'x');
  const announced: string[] = [];
  const [spec] = createAssetTrashRoutes({
    designRoot,
    access: () => access,
    rows: () => [
      {
        rel: 'assets/a1b2c3d4.jpg',
        usedIn: [],
        usedElsewhere: false,
        olderVersions: false,
        notUsed: true,
      },
      {
        rel: 'assets/e5f60718.jpg',
        usedIn: ['ui/a.tsx'],
        usedElsewhere: false,
        olderVersions: false,
        notUsed: false,
      },
    ],
    announce: (rel) => announced.push(rel),
  });
  const post = (body: unknown) =>
    spec?.handle(
      new Request('http://localhost/_api/assets/trash', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      {}
    ) as Promise<Response>;
  return { designRoot, spec, post, announced };
}
const role = (r: 'owner' | 'member' | 'viewer' | 'observer') => resolveAccess({ v: 1, role: r });

describe('POST /_api/assets/trash', () => {
  test('is a main-origin write a read-only session is refused', () => {
    const { spec } = setup(role('member'));
    expect(spec?.path).toBe('/_api/assets/trash');
    expect(spec?.method).toBe('POST');
    expect(spec?.origin).toBe('main');
    expect(spec?.readOnly).toBe('refused');
  });

  test('an editor moves what is free and is told, per item, what stayed', async () => {
    const { post, designRoot, announced } = setup(role('member'));
    const res = await post({ assets: ['assets/a1b2c3d4.jpg', 'assets/e5f60718.jpg'] });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; results: Array<Record<string, unknown>> };
    expect(j.results.map((r) => (r.ok ? 'moved' : r.reason))).toEqual(['moved', 'used']);
    expect(existsSync(path.join(designRoot, 'assets/a1b2c3d4.jpg'))).toBe(false);
    expect(existsSync(path.join(designRoot, 'assets/e5f60718.jpg'))).toBe(true);
    expect(announced).toContain('assets/a1b2c3d4.jpg');
  });

  test('Can view, Can comment and a canvas-only editor are refused by the server, and nothing moves', async () => {
    for (const access of [
      role('viewer'),
      role('observer'),
      resolveAccess({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] } as never),
      resolveAccess(null),
    ]) {
      const { post, designRoot } = setup(access);
      const res = await post({ assets: ['assets/a1b2c3d4.jpg'] });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { reason: string }).reason).toBe('forbidden');
      expect(existsSync(path.join(designRoot, 'assets/a1b2c3d4.jpg'))).toBe(true);
    }
  });

  test('refuses a body that is not a list of paths', async () => {
    const { post } = setup(role('owner'));
    expect((await post('{nope')).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ assets: [] })).status).toBe(400);
    expect((await post({ assets: [1] })).status).toBe(400);
    expect((await post({ assets: Array(501).fill('assets/a1b2c3d4.jpg') })).status).toBe(400);
  });
});
