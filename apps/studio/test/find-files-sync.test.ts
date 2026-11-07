// #207 (list speed) — `findFilesSync` (the tree's first answer) lists exactly what `findFiles` does:
// the same skips (`_`-runtime, dot-folders, SKIP_DIRS), no symlink, no hardlink, the same order and
// the same folders.
import { describe, expect, test } from 'bun:test';
import { linkSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { findFiles, findFilesSync, PREVIEW_ASSET_EXTS } from '../api.ts';

describe('findFilesSync', () => {
  test('the same list and folders as findFiles', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ffs-'));
    const g = path.join(root, 'ui');
    for (const d of ['b', 'a/deep', '_state', '.hidden', 'node_modules/x', 'empty'])
      mkdirSync(path.join(g, d), { recursive: true });
    for (const f of [
      'z.tsx',
      'A.tsx',
      'a/one.tsx',
      'a/one.meta.json',
      'a/deep/pic.png',
      'b/notes.txt',
      '_state/x.json',
      '.hidden/h.tsx',
      'node_modules/x/m.tsx',
    ])
      writeFileSync(path.join(g, f), 'x');
    const secret = path.join(root, 'secret.tsx');
    writeFileSync(secret, 'secret');
    symlinkSync(secret, path.join(g, 'b', 'link.tsx'));
    linkSync(secret, path.join(g, 'b', 'hard.tsx'));

    const exts = ['.tsx', '.json', ...PREVIEW_ASSET_EXTS];
    const dirsA: string[] = [];
    const dirsB: string[] = [];
    const a = await findFiles(g, '.design/ui', exts, dirsA);
    const b = findFilesSync(g, '.design/ui', exts, dirsB);
    expect(b).toEqual(a);
    expect(dirsB).toEqual(dirsA);
    expect(b).toEqual(
      expect.arrayContaining([
        '.design/ui/A.tsx',
        '.design/ui/z.tsx',
        '.design/ui/a/one.tsx',
        '.design/ui/a/deep/pic.png',
      ])
    );
    for (const never of ['link.tsx', 'hard.tsx', '_state', '.hidden', 'node_modules', 'notes.txt'])
      expect(b.some((p) => p.includes(never))).toBe(false);
    expect(dirsB).toContain('.design/ui/empty');
    expect(findFilesSync(path.join(root, 'nope'), '.design/nope', exts)).toEqual([]);
  });
});
