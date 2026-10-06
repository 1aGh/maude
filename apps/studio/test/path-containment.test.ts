// #145 — canvases rendered nothing on Windows: the static route built a mixed
// `C:\proj/.design/a.tsx` path and the string-prefix check against the native
// design root (`C:\proj\.design`) never matched, so `.tsx` went out as text.
// The win32 cases run on any host by passing `path.win32`.
import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { isUnderOrEqual, resolveUrlPathUnder } from '../path-containment.ts';

const W = path.win32;
const P = path.posix;
const WIN_REPO = 'C:\\Users\\eva\\proj';
const WIN_DESIGN = W.join(WIN_REPO, '.design');

describe('win32 — the #145 reproduction', () => {
  test('a canvas URL resolves to a native path inside the design root', () => {
    const fp = resolveUrlPathUnder('/.design/ui/home.tsx', WIN_REPO, W);
    expect(fp).toBe('C:\\Users\\eva\\proj\\.design\\ui\\home.tsx');
    expect(isUnderOrEqual(fp as string, WIN_DESIGN, W)).toBe(true);
  });

  test('a mixed-separator path is still recognised as inside the root', () => {
    expect(isUnderOrEqual('C:\\Users\\eva\\proj/.design/ui/home.tsx', WIN_DESIGN, W)).toBe(true);
  });

  test('containment ignores case, like NTFS', () => {
    expect(isUnderOrEqual('c:\\users\\EVA\\proj\\.design\\a.tsx', WIN_DESIGN, W)).toBe(true);
  });

  test('traversal out of the repo is refused', () => {
    expect(resolveUrlPathUnder('/../secret.tsx', WIN_REPO, W)).toBeNull();
    expect(resolveUrlPathUnder('/.design/../../x.tsx', WIN_REPO, W)).toBeNull();
  });

  test('backslash and colon in the URL are refused (the canvas gate reads them as plain chars)', () => {
    expect(resolveUrlPathUnder('/.design/..\\.env', WIN_REPO, W)).toBeNull();
    expect(resolveUrlPathUnder('/.design/..\\..\\x.tsx', WIN_REPO, W)).toBeNull();
    expect(resolveUrlPathUnder('/C:/Windows/win.ini', WIN_REPO, W)).toBeNull();
    expect(resolveUrlPathUnder('/.design/a.tsx::$DATA', WIN_REPO, W)).toBeNull();
  });

  test('another drive and a sibling-prefix directory are outside', () => {
    expect(isUnderOrEqual('D:\\Users\\eva\\proj\\.design\\a.tsx', WIN_DESIGN, W)).toBe(false);
    expect(isUnderOrEqual('C:\\Users\\eva\\proj\\.design-evil\\a.tsx', WIN_DESIGN, W)).toBe(false);
  });
});

describe('posix — unchanged behaviour', () => {
  const REPO = '/home/eva/proj';

  test('a canvas URL resolves exactly as before', () => {
    expect(resolveUrlPathUnder('/.design/ui/home.tsx', REPO, P)).toBe(
      '/home/eva/proj/.design/ui/home.tsx'
    );
    expect(isUnderOrEqual('/home/eva/proj/.design/ui/home.tsx', `${REPO}/.design`, P)).toBe(true);
  });

  test('the root itself counts as inside; a sibling prefix does not', () => {
    expect(resolveUrlPathUnder('/', REPO, P)).toBe(REPO);
    expect(isUnderOrEqual('/home/eva/proj-evil/a.tsx', REPO, P)).toBe(false);
  });

  test('traversal and NUL are refused', () => {
    expect(resolveUrlPathUnder('/../etc/passwd', REPO, P)).toBeNull();
    expect(resolveUrlPathUnder('/.design/ui/../../../etc/passwd.tsx', REPO, P)).toBeNull();
    expect(resolveUrlPathUnder('/.design/a\0.tsx', REPO, P)).toBeNull();
  });

  test('a backslash is an ordinary file-name character on posix', () => {
    expect(resolveUrlPathUnder('/.design/a\\b.tsx', REPO, P)).toBe(
      '/home/eva/proj/.design/a\\b.tsx'
    );
  });
});
