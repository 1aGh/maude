// S8.22 — POST /_api/import-asset, v2 body (routes/assets.ts): the role gate is on the server, the bytes decide what
// runs (never the kind hint, never the name), the read is capped while streaming, the dedupe answer says "reused",
// and the v1 SVG body keeps its v1 answer. Real conversions: import-convert.test.ts. Local fixtures only.

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveAccess } from '../access/scope.ts';
import { ImportAssetError, writeContainedAsset } from '../bin/_import-asset.mjs';
import { createAssetImportRoutes, importDisplayName } from '../routes/assets.ts';

const FIX = join(import.meta.dir, 'fixtures', 'import-convert');
const PSD = readFileSync(join(FIX, 'tiny.psd'));
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
const role = (r: 'owner' | 'member' | 'viewer' | 'observer') => resolveAccess({ v: 1, role: r });

function setup(access = role('member')) {
  const root = mkdtempSync(join(tmpdir(), 'maude-s822-route-'));
  roots.push(root);
  const calls: string[] = [];
  const announced: string[] = [];
  // the seams stand in for the canary (a browser) and sips (macOS): each writes the real contained asset
  const [spec] = createAssetImportRoutes({
    root,
    designRel: '.design',
    access: () => access,
    announce: (rel) => announced.push(rel),
    importSvg: async (text, o) => {
      calls.push('svg');
      if (text.includes('<!ENTITY'))
        throw new ImportAssetError(3, 'ENTITY declarations are rejected');
      return {
        ...writeContainedAsset(o.root, o.designRootRel, Buffer.from(text), 'svg'),
        removed: { scripts: 1, links: 2, other: 0 },
      };
    },
    importConvertible: async (bytes, o) => {
      calls.push('convert');
      return {
        ...writeContainedAsset(
          o.root,
          o.designRootRel,
          Buffer.concat([PNG_HEAD, bytes.subarray(0, 32)]),
          'png'
        ),
        converted: 'psd',
      };
    },
    importRaster: (bytes, o) => {
      calls.push('raster');
      return writeContainedAsset(o.root, o.designRootRel, bytes, 'png');
    },
  });
  const post = (body: BodyInit, headers: Record<string, string> = {}) =>
    spec?.handle(
      new Request('http://localhost/_api/import-asset', { method: 'POST', headers, body }),
      {}
    ) as Promise<Response>;
  return { root, spec, post, calls, announced };
}

describe('POST /_api/import-asset (v2)', () => {
  test('a main-origin write a read-only session is refused', () => {
    const { spec } = setup();
    expect(spec?.path).toBe('/_api/import-asset');
    expect(spec?.method).toBe('POST');
    expect(spec?.origin).toBe('main');
    expect(spec?.readOnly).toBe('refused');
  });

  test('Can view, Can comment and a canvas-only editor are refused by the server; nothing is written', async () => {
    for (const access of [
      role('viewer'),
      role('observer'),
      resolveAccess({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] } as never),
    ]) {
      const { post, root, calls } = setup(access);
      const res = await post(PSD, { 'x-import-kind': 'psd' });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { reason: string }).reason).toBe('forbidden');
      expect(calls).toEqual([]);
      expect(existsSync(join(root, '.design', 'assets'))).toBe(false);
    }
  });

  test('the bytes decide: PSD bytes labelled svg are converted, PNG bytes labelled psd stay a raster', async () => {
    const { post, calls } = setup();
    expect((await post(PSD, { 'x-import-kind': 'auto' })).status).toBe(201);
    expect(
      (await post(Buffer.concat([PNG_HEAD, Buffer.alloc(40, 1)]), { 'x-import-kind': 'psd' }))
        .status
    ).toBe(201);
    expect(calls).toEqual(['convert', 'raster']);
    const odd = await post(Buffer.from('MZ\x90\x00 not a picture'), { 'x-import-kind': 'auto' });
    expect(odd.status).toBe(415);
    expect(((await odd.json()) as { reason: string }).reason).toBe('unsupported');
  });

  test('the dedupe answer: the same bytes twice are one file, the second says reused (and is not announced)', async () => {
    const { post, root, announced } = setup();
    const a = (await (
      await post(PSD, { 'x-import-kind': 'psd', 'x-import-name': 'dres-2027-final.psd' })
    ).json()) as Record<string, unknown>;
    const b = (await (await post(PSD, { 'x-import-kind': 'psd' })).json()) as Record<
      string,
      unknown
    >;
    expect(a).toMatchObject({
      ok: true,
      reused: false,
      converted: 'psd',
      kind: 'png',
      name: 'dres-2027-final.psd',
    });
    expect(b).toMatchObject({ ok: true, reused: true, path: a.path });
    expect(
      readdirSync(join(root, '.design', 'assets')).filter((f) => !f.startsWith('.'))
    ).toHaveLength(1);
    expect(announced).toEqual([a.path]);
  });

  test('a name with a path in it shapes nothing: the file is stored by its fingerprint; the name is its last segment', async () => {
    const { post, root } = setup();
    const res = await post(PSD, {
      'x-import-kind': 'psd',
      'x-import-name': encodeURIComponent('../../../../etc/cron.d/x\u0007.psd'),
    });
    const body = (await res.json()) as { path: string; name: string };
    expect(body.path).toMatch(/^assets\/[a-z0-9]{8}\.png$/);
    expect(body.name).toBe('x.psd');
    expect(readdirSync(root)).toEqual(['.design']);
    expect(importDisplayName('..')).toBe(null);
    expect(importDisplayName('C:\\Users\\t\\IMG_5012.HEIC')).toBe('IMG_5012.HEIC');
  });

  test('the read is capped while it streams — a body with no length that runs past the cap is cut off', async () => {
    const { post, calls } = setup();
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        sent += 1 << 20;
        c.enqueue(new Uint8Array(1 << 20));
        if (sent > 64 << 20) c.close();
      },
    });
    const res = await post(endless, { 'x-import-kind': 'svg' });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { reason: string }).reason).toBe('too-large');
    expect(sent).toBeLessThan(16 << 20);
    expect(calls).toEqual([]);
    expect(
      (await post('x', { 'x-import-kind': 'heic', 'content-length': String(500 << 20) })).status
    ).toBe(413);
  });

  test('v1 body: an SVG with no header keeps the v1 answer; a refused SVG keeps its 400; PDF keeps its 501', async () => {
    const { post } = setup();
    const ok = await post(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'
    );
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(String(body.path)).toMatch(/^assets\/[a-z0-9]{8}\.svg$/);
    expect(body.removed).toEqual({ scripts: 1, links: 2, other: 0 });
    const xxe = await post(
      '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"/>',
      { 'x-import-kind': 'svg' }
    );
    expect(xxe.status).toBe(400);
    expect(((await xxe.json()) as { reason: string }).reason).toBe('refused');
    expect((await post('%PDF-1.4', { 'x-import-kind': 'pdf' })).status).toBe(501);
  });

  test('a converter refusal carries its word and status', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maude-s822-route-'));
    roots.push(root);
    const refuse = (reason: string) =>
      createAssetImportRoutes({
        root,
        designRel: '.design',
        access: () => role('member'),
        importConvertible: async () => {
          throw new ImportAssetError(3, 'no', reason);
        },
      })[0];
    for (const [reason, status] of [
      ['too-many-pixels', 413],
      ['not-on-mac', 415],
      ['timeout', 422],
      ['external-reference', 422],
      ['no-flat-picture', 422],
      ['busy', 429],
    ] as const) {
      const res = (await refuse(reason)?.handle(
        new Request('http://localhost/_api/import-asset', {
          method: 'POST',
          headers: { 'x-import-kind': 'psd' },
          body: PSD,
        }),
        {}
      )) as Response;
      expect([reason, res.status]).toEqual([reason, status]);
      expect(((await res.json()) as { reason: string }).reason).toBe(reason);
    }
  });
});
