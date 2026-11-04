// 2.0.3 — a picture or clip that is a Git LFS pointer file (a project cloned without `git lfs pull`)
// is its own asset state, `lfs-pointer`, not "here": the studio reads at most the first 1 KB of a
// small file, and says whether the real bytes already sit in this repo's `.git/lfs/objects`.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assetStateDepsFor, projectRootOf } from '../routes/asset-state.ts';
import { pushAssets } from '../sync/asset-push.ts';
import { createAssetStateService, heldMediaRels } from '../sync/asset-state.ts';
import {
  hasLfsObject,
  lfsObjectsDir,
  parseLfsPointer,
  readLfsPointer,
} from '../sync/lfs-pointer.ts';

const OID = `${'a'.repeat(62)}b1`;
const pointer = (oid = OID, size = 48213) =>
  `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`;

function project() {
  const repo = mkdtempSync(join(tmpdir(), 'lfs-ptr-'));
  const design = join(repo, '.design');
  mkdirSync(join(design, 'assets'), { recursive: true });
  return { repo, design };
}

describe('recognising a pointer', () => {
  test('a pointer parses; the spec line must be the first line, exactly', () => {
    expect(parseLfsPointer(pointer())).toEqual({ oid: OID, size: 48213 });
    expect(parseLfsPointer(`x${pointer()}`)).toBeNull();
    expect(parseLfsPointer(pointer().replace('v1', 'v2'))).toBeNull();
    // a malformed oid is still a pointer (the canvas cannot draw it), only with no oid to look up
    expect(parseLfsPointer(pointer('NOT-HEX'))).toEqual({ oid: null, size: 48213 });
  });

  test('a 131-byte non-pointer and a big file are not pointers', () => {
    const { design } = project();
    const ptr = join(design, 'assets/hero.png');
    writeFileSync(ptr, pointer());
    expect(readLfsPointer(ptr)?.oid).toBe(OID);
    const small = join(design, 'assets/small.txt');
    writeFileSync(small, 'y'.repeat(131));
    expect(readLfsPointer(small)).toBeNull();
    // a real file that happens to START with the spec line, but is over 1 KB, is the real file
    const big = join(design, 'assets/big.png');
    writeFileSync(big, `${pointer()}${'z'.repeat(5000)}`);
    expect(readLfsPointer(big)).toBeNull();
  });
});

describe('the asset-state answer', () => {
  test('a pointer on disk is lfs-pointer; a real file and a 131-byte non-pointer are here', async () => {
    const { repo, design } = project();
    writeFileSync(join(design, 'assets/hero.png'), pointer());
    writeFileSync(join(design, 'assets/odd.png'), 'q'.repeat(131));
    writeFileSync(join(design, 'assets/real.png'), Buffer.alloc(4096, 7));
    const svc = createAssetStateService({ designRoot: design, projectRoot: repo, hub: () => null });
    const s = await svc.states(['assets/hero.png', 'assets/odd.png', 'assets/real.png']);
    expect(s['assets/hero.png']).toEqual({ state: 'lfs-pointer', localObject: false });
    expect(s['assets/odd.png']).toEqual({ state: 'here' });
    expect(s['assets/real.png']).toEqual({ state: 'here' });
  });

  test('localObject: the real bytes are in .git/lfs/objects/<o[0:2]>/<o[2:4]>/<oid>', async () => {
    const { repo, design } = project();
    const objects = join(repo, '.git/lfs/objects');
    mkdirSync(join(objects, OID.slice(0, 2), OID.slice(2, 4)), { recursive: true });
    writeFileSync(join(objects, OID.slice(0, 2), OID.slice(2, 4), OID), 'real bytes');
    writeFileSync(join(design, 'assets/hero.png'), pointer());
    writeFileSync(join(design, 'assets/other.png'), pointer('c'.repeat(64)));
    const deps = assetStateDepsFor({
      designRoot: design,
      designRel: '.design',
      runtime: () => null,
    });
    const s = await deps.service()?.states(['assets/hero.png', 'assets/other.png']);
    expect(s?.['assets/hero.png']).toEqual({ state: 'lfs-pointer', localObject: true });
    expect(s?.['assets/other.png']).toEqual({ state: 'lfs-pointer', localObject: false });
  });

  test('the store is found through a worktree .git file; a bad oid is never looked up', () => {
    const { repo } = project();
    const main = mkdtempSync(join(tmpdir(), 'lfs-main-'));
    mkdirSync(join(main, '.git/worktrees/w1'), { recursive: true });
    mkdirSync(join(main, '.git/lfs/objects'), { recursive: true });
    writeFileSync(join(main, '.git/worktrees/w1/commondir'), '../..\n');
    writeFileSync(join(repo, '.git'), `gitdir: ${join(main, '.git/worktrees/w1')}\n`);
    expect(lfsObjectsDir(repo)).toBe(join(main, '.git/lfs/objects'));
    expect(hasLfsObject(join(main, '.git/lfs/objects'), '../../etc/passwd')).toBe(false);
    expect(hasLfsObject(null, OID)).toBe(false);
  });

  test('projectRootOf strips designRel', () => {
    expect(projectRootOf('/p/repo/.design', '.design')).toBe('/p/repo');
    expect(projectRootOf('/p/repo/design/v2', 'design/v2')).toBe('/p/repo');
  });

  test('this Mac does not "hold" a pointer (the held report leaves it out)', () => {
    const { design } = project();
    writeFileSync(join(design, 'assets/hero.png'), pointer());
    writeFileSync(join(design, 'assets/real.png'), Buffer.alloc(2048, 7));
    expect(heldMediaRels(design)).toEqual(['assets/real.png']);
  });
});

describe('the legacy push (journal-less hubs)', () => {
  test('a pointer is not uploaded as the media; it is said once', async () => {
    const { design } = project();
    writeFileSync(join(design, 'assets/hero.png'), pointer());
    writeFileSync(join(design, 'assets/real.png'), Buffer.alloc(2048, 7));
    const putUrls: string[] = [];
    const warned: string[] = [];
    const r = await pushAssets({
      designRoot: design,
      hubUrl: 'https://x.example',
      token: () => 't',
      syncFiles: false,
      sleep: async () => {},
      log: { log: () => {}, warn: (m: string) => warned.push(m) },
      fetchImpl: (async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') putUrls.push(String(url));
        return new Response(null, { status: init?.method === 'HEAD' ? 404 : 200 });
      }) as unknown as typeof fetch,
    });
    expect(r.pushed).toEqual(['assets/real.png']);
    expect(putUrls.some((u) => u.includes('hero.png'))).toBe(false);
    expect(warned.filter((w) => w.includes('Git LFS'))).toHaveLength(1);
  });
});
