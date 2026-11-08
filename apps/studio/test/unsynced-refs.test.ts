// Issue #158 — a linked canvas imports files that never reach the workspace. The diagnostic resolves
// each canvas's relative imports and stylesheet `url()` refs against the sync set and names the file
// and the reason. Read-only: it never changes the membership predicate (sync/file-membership.ts).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classifyProjectFile } from '../sync/file-membership.ts';
import { unsyncedLines, unsyncedRefsOnDisk } from '../sync/unsynced-refs.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'unsynced-refs-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const put = (rel: string, body = '') => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), body);
};
const link = (extra: Record<string, unknown> = {}) =>
  put('config.json', JSON.stringify({ linkedHub: { url: 'https://hub.test', ...extra } }));

const CANVAS = (imports: string) =>
  `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';\n${imports}\nexport default function C(){ return <DesignCanvas><DCArtboard id="a" /></DesignCanvas>; }\n`;

describe('unsyncedRefsOnDisk', () => {
  test('a project with no linked workspace is not checked', () => {
    put('config.json', '{}');
    put('ui/x/foo.tsx', CANVAS("import * as W from './_foo/screens';"));
    const r = unsyncedRefsOnDisk(root);
    expect(r.linked).toBe(false);
    expect(r.refs).toEqual([]);
  });

  test('an import from a _folder is named with the reason', () => {
    link();
    put('ui/x/foo.tsx', CANVAS("import * as W from './_foo/screens';"));
    put('ui/x/_foo/screens.tsx', 'export const S = 1;');
    const r = unsyncedRefsOnDisk(root);
    expect(r.linked).toBe(true);
    expect(r.refs).toHaveLength(1);
    expect(r.refs[0]).toMatchObject({
      canvas: 'ui/x/foo.tsx',
      file: 'ui/x/_foo/screens.tsx',
      reason: 'underscore-folder',
      via: 'import',
    });
    expect(r.refs[0]?.detail).toContain('_foo');
  });

  test('a clean canvas reports nothing', () => {
    link();
    put('ui/x/foo.tsx', CANVAS("import './foo.css';\nimport { a } from './helpers/a';"));
    put('ui/x/foo.css', '.a{background:url(../../assets/p.png)}');
    put('assets/p.png', 'x');
    put('ui/x/helpers/a.ts', 'export const a = 1;');
    const r = unsyncedRefsOnDisk(root);
    expect(r.canvases).toBe(1);
    expect(r.refs).toEqual([]);
  });

  test('a stylesheet url() outside assets/ is named when file sync is off', () => {
    link({ syncFiles: false });
    put('ui/x/foo.tsx', CANVAS("import './foo.css';"));
    put(
      'ui/x/foo.css',
      "@font-face{src:url('./fonts/x.woff2')} .a{background:url(../../assets/p.png)}"
    );
    put('ui/x/fonts/x.woff2', 'f');
    put('assets/p.png', 'x');
    const r = unsyncedRefsOnDisk(root);
    expect(r.syncFiles).toBe(false);
    expect(r.refs).toHaveLength(1);
    expect(r.refs[0]).toMatchObject({
      canvas: 'ui/x/foo.tsx',
      file: 'ui/x/fonts/x.woff2',
      reason: 'sync-files-off',
      via: 'css-url',
    });
  });

  test('the same font is fine when file sync is on', () => {
    link();
    put('ui/x/foo.tsx', CANVAS("import './foo.css';"));
    put('ui/x/foo.css', "@font-face{src:url('./fonts/x.woff2')}");
    put('ui/x/fonts/x.woff2', 'f');
    expect(unsyncedRefsOnDisk(root).refs).toEqual([]);
  });

  test('a missing file, one outside the design folder, and runtime state', () => {
    link();
    put(
      'ui/x/foo.tsx',
      CANVAS(
        "import './gone';\nimport '../../../outside';\nimport { s } from './_state/cache';\nimport './foo.css';"
      )
    );
    put('ui/x/_state/cache.ts', 'export const s = 1;');
    put(
      'ui/x/foo.css',
      'a{background:url(data:image/png;base64,AAA)} b{background:url(https://x.test/a.png)}'
    );
    const byFile = Object.fromEntries(unsyncedRefsOnDisk(root).refs.map((x) => [x.file, x.reason]));
    expect(byFile['ui/x/_state/cache.ts']).toBe('runtime-state');
    expect(byFile['ui/x/gone.tsx']).toBe('missing');
    expect(Object.values(byFile)).toContain('outside-root');
    expect(Object.keys(byFile)).toHaveLength(3);
  });

  test('an import of a kind a canvas cannot load is named even when the file travels', () => {
    link();
    put('ui/x/foo.tsx', CANVAS("import notes from './notes.md' with { type: 'text' };"));
    put('ui/x/notes.md', '# hi');
    const r = unsyncedRefsOnDisk(root);
    expect(r.refs).toHaveLength(1);
    expect(r.refs[0]).toMatchObject({ file: 'ui/x/notes.md', reason: 'import-extension' });
  });

  test('a folder the project leaves out of sync', () => {
    link({ ignoreFolders: ['ui/x/big'] });
    put('ui/x/foo.tsx', CANVAS("import './big/data.json';"));
    put('ui/x/big/data.json', '{}');
    const r = unsyncedRefsOnDisk(root);
    expect(r.refs).toHaveLength(1);
    expect(r.refs[0]).toMatchObject({ file: 'ui/x/big/data.json', reason: 'ignored-folder' });
  });

  test('a link on disk is not a file that travels', () => {
    link();
    put('elsewhere/a.ts', 'export const a = 1;');
    put('ui/x/foo.tsx', CANVAS("import { a } from './a';"));
    symlinkSync(join(root, 'elsewhere/a.ts'), join(root, 'ui/x/a.ts'));
    const r = unsyncedRefsOnDisk(root);
    expect(r.refs).toHaveLength(1);
    expect(r.refs[0]).toMatchObject({ file: 'ui/x/a.ts', reason: 'symlink' });
  });

  test('the walk goes through shared modules and stops at a file that does not travel', () => {
    link();
    put('ui/x/foo.tsx', CANVAS("import { a } from './helpers/a';"));
    put('ui/x/helpers/a.ts', "import './_priv/b';\nexport const a = 1;");
    put('ui/x/helpers/_priv/b.ts', "import './c';\nexport {};");
    put('ui/x/helpers/_priv/c.ts', 'export {};');
    const r = unsyncedRefsOnDisk(root);
    expect(r.refs.map((x) => `${x.canvas} -> ${x.file}`)).toEqual([
      'ui/x/foo.tsx -> ui/x/helpers/_priv/b.ts',
    ]);
  });

  test('a file under a canvas that is not a canvas is not walked from', () => {
    link();
    put('ui/x/helper.tsx', "import './_foo/a';\nexport const H = 1;");
    put('ui/x/_foo/a.ts', 'export {};');
    const r = unsyncedRefsOnDisk(root);
    expect(r.canvases).toBe(0);
    expect(r.refs).toEqual([]);
  });

  test('the words name the file, the reason and one way out, in the product voice', () => {
    link();
    put('ui/x/foo.tsx', CANVAS("import * as W from './_foo/screens';"));
    put('ui/x/_foo/screens.tsx', 'export {};');
    const lines = unsyncedLines(unsyncedRefsOnDisk(root));
    const text = lines.join('\n');
    expect(text).toContain('ui/x/foo.tsx');
    expect(text).toContain('ui/x/_foo/screens.tsx');
    expect(text).not.toMatch(/\bhub\b|\bwe\b|!|board/i);
  });
});

describe('the smoke report', () => {
  test('smoke.sh asks the helper, adds a section, and never changes the exit code for it', () => {
    const src = readFileSync(join(import.meta.dir, '../bin/smoke.sh'), 'utf8');
    expect(src).toContain('_unsynced-refs.mjs');
    expect(src).toContain("## Files that won't sync");
    // advisory: TOTAL_FAIL counts render and lint failures only
    expect(src).toMatch(/TOTAL_FAIL=\$\(\(FAILED \+ LINT_FAILED\)\)/);
  });

  test('the helper prints the lines for a linked project and nothing for a clean one', async () => {
    link();
    put('ui/x/foo.tsx', CANVAS("import * as W from './_foo/screens';"));
    put('ui/x/_foo/screens.tsx', 'export {};');
    const helper = join(import.meta.dir, '../bin/_unsynced-refs.mjs');
    const run = async () => {
      const p = Bun.spawn(['bun', helper, '--design-root', root], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      return { out: await new Response(p.stdout).text(), code: await p.exited };
    };
    const dirty = await run();
    expect(dirty.code).toBe(0);
    expect(dirty.out).toContain('ui/x/_foo/screens.tsx');
    rmSync(join(root, 'ui/x/_foo'), { recursive: true });
    put('ui/x/foo.tsx', CANVAS(''));
    const clean = await run();
    expect(clean.code).toBe(0);
    expect(clean.out).toBe('');
  });
});

describe('the membership predicate is only read', () => {
  test('the same paths classify as before', () => {
    expect(classifyProjectFile('ui/x/_foo/screens.tsx')).toBe('never');
    expect(classifyProjectFile('ui/x/fonts/x.woff2')).toBe('inert-media');
    expect(classifyProjectFile('ui/x/helpers/a.ts')).toBe('code-module');
  });
});
