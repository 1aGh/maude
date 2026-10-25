// P8 round 7 — POST /_api/assets/rename (12 · ia-assets-keys "Rename…"): main origin only, the role gate on the SERVER,
// the new path stays directly inside `<designRoot>/assets/`, the extension is kept, sidecars move with the picture, and a
// picture a canvas uses (or an older version shows) is refused so no reference breaks.
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveAccess } from '../access/scope.ts';
import { createAssetRenameRoutes } from '../routes/asset-rename.ts';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const free = { usedIn: [], usedElsewhere: false, olderVersions: false, notUsed: true } as const;

function setup(
  access: ReturnType<typeof resolveAccess>,
  extraRows: Array<Record<string, unknown>> = []
) {
  const designRoot = mkdtempSync(path.join(tmpdir(), 'asset-rename-route-'));
  roots.push(designRoot);
  mkdirSync(path.join(designRoot, 'assets'), { recursive: true });
  writeFileSync(path.join(designRoot, 'assets/IMG_2231.jpg'), 'x');
  writeFileSync(path.join(designRoot, 'assets/IMG_2231.photo.json'), '{}');
  writeFileSync(path.join(designRoot, 'assets/IMG_2231.0123abcd.photo.json'), '{}');
  writeFileSync(path.join(designRoot, 'assets/Used.jpg'), 'x');
  writeFileSync(path.join(designRoot, 'assets/Taken.jpg'), 'x');
  const announced: string[] = [];
  const [spec] = createAssetRenameRoutes({
    designRoot,
    access: () => access,
    rows: () => [
      { rel: 'assets/IMG_2231.jpg', ...free },
      { rel: 'assets/Used.jpg', ...free, usedIn: ['ui/a.tsx'], notUsed: false },
      { rel: 'assets/Taken.jpg', ...free },
      ...(extraRows as never[]),
    ],
    announce: (rel) => announced.push(rel),
  });
  const post = (body: unknown) =>
    spec?.handle(
      new Request('http://localhost/_api/assets/rename', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      {}
    ) as Promise<Response>;
  return { designRoot, spec, post, announced };
}
const role = (r: 'owner' | 'member' | 'viewer' | 'observer') => resolveAccess({ v: 1, role: r });
const has = (root: string, rel: string) => existsSync(path.join(root, rel));

describe('POST /_api/assets/rename', () => {
  test('is a main-origin write a read-only session is refused, reachable through the route table', () => {
    const { spec } = setup(role('member'));
    expect(spec?.path).toBe('/_api/assets/rename');
    expect(spec?.method).toBe('POST');
    expect(spec?.origin).toBe('main');
    expect(spec?.readOnly).toBe('refused');
    // wired beside Move to trash, on the same deps
    const table = readFileSync(path.join(import.meta.dir, '../routes/index.ts'), 'utf8');
    expect(table.includes('createAssetRenameRoutes(deps.assetTrash)')).toBe(true);
  });

  test('an editor renames a free picture; the extension stays and the sidecars follow', async () => {
    const { post, designRoot, announced } = setup(role('member'));
    const res = await post({ asset: 'assets/IMG_2231.jpg', name: '  Kick off.jpg ' });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; to: string };
    expect(j.to).toBe('assets/Kick off.jpg');
    expect(has(designRoot, 'assets/IMG_2231.jpg')).toBe(false);
    expect(has(designRoot, 'assets/Kick off.jpg')).toBe(true);
    expect(has(designRoot, 'assets/Kick off.photo.json')).toBe(true);
    expect(has(designRoot, 'assets/Kick off.0123abcd.photo.json')).toBe(true);
    expect(has(designRoot, 'assets/IMG_2231.photo.json')).toBe(false);
    expect(announced).toContain('assets/IMG_2231.jpg');
    expect(announced).toContain('assets/Kick off.jpg');
  });

  test('a picture a canvas uses is refused and nothing moves (its references would break)', async () => {
    const { post, designRoot } = setup(role('owner'));
    const res = await post({ asset: 'assets/Used.jpg', name: 'Hero' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe('used');
    expect(has(designRoot, 'assets/Used.jpg')).toBe(true);
    expect(has(designRoot, 'assets/Hero.jpg')).toBe(false);
  });

  test('a name another file has, the same name, and an unlisted picture are refused', async () => {
    const { post, designRoot } = setup(role('member'));
    writeFileSync(path.join(designRoot, 'assets/Unlisted.jpg'), 'x');
    const reasons = [];
    for (const b of [
      { asset: 'assets/IMG_2231.jpg', name: 'Taken' },
      { asset: 'assets/IMG_2231.jpg', name: 'IMG_2231' },
      { asset: 'assets/Unlisted.jpg', name: 'Other' },
    ]) {
      const r = await post(b);
      expect(r.status).toBe(409);
      reasons.push(((await r.json()) as { reason: string }).reason);
    }
    expect(reasons).toEqual(['exists', 'same', 'checking']);
    expect(has(designRoot, 'assets/IMG_2231.jpg')).toBe(true);
  });

  test('a path outside assets/, into runtime state or up the tree is refused before any file is touched', async () => {
    const { post, designRoot } = setup(role('owner'));
    mkdirSync(path.join(designRoot, '_state'), { recursive: true });
    writeFileSync(path.join(designRoot, '_state/x.jpg'), 'x');
    const out = [];
    for (const b of [
      { asset: '_state/x.jpg', name: 'y' },
      { asset: 'assets/../_state/x.jpg', name: 'y' },
      { asset: 'assets/IMG_2231.jpg', name: '../_state/y' },
      { asset: 'assets/IMG_2231.jpg', name: '.hidden' },
      { asset: 'assets/IMG_2231.jpg', name: 'a/b' },
      { asset: 'assets/IMG_2231.jpg', name: '' },
    ]) {
      const r = await post(b);
      expect(r.status).toBe(409);
      out.push(((await r.json()) as { reason: string }).reason);
    }
    expect(out).toEqual(['invalid', 'invalid', 'bad-name', 'bad-name', 'bad-name', 'bad-name']);
    expect(has(designRoot, '_state/x.jpg')).toBe(true);
    expect(has(designRoot, 'assets/IMG_2231.jpg')).toBe(true);
  });

  test('Can view, Can comment and a canvas-only editor are refused by the server, and nothing moves', async () => {
    for (const access of [
      role('viewer'),
      role('observer'),
      resolveAccess({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] } as never),
      resolveAccess(null),
    ]) {
      const { post, designRoot } = setup(access);
      const res = await post({ asset: 'assets/IMG_2231.jpg', name: 'Kick off' });
      expect(res.status).toBe(403);
      expect(has(designRoot, 'assets/IMG_2231.jpg')).toBe(true);
    }
  });

  test('a body that is not { asset, name } is a 400', async () => {
    const { post } = setup(role('member'));
    expect((await post('nope')).status).toBe(400);
    expect((await post({ asset: 'assets/IMG_2231.jpg' })).status).toBe(400);
    expect((await post({ asset: 1, name: 'x' })).status).toBe(400);
  });
});
