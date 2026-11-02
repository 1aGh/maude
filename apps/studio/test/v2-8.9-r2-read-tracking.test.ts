// V2-8.9 round 2 — read tracking gaps (attacker M-R2-1, defender R2-L3; decision
// maude/v2-8.9-round2-writer-verbs-audience). The audience gate is only as good as the reads it knows:
//   • whole-file canvas copies under `_history/`, `_trash/`, `_versions` and the path-less
//     `history show <ref>` / `history diff` count as reading the whole design folder;
//   • a `--flag=path` counts by its value, a loopback URL by its decoded `?canvas=`, a glob by its
//     base folder; a Grep with no path (the working directory holds the design root) is all of it.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readPathsOf } from '../acp/audience.ts';

let tmp: string;
let repo: string;
let design: string;

beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'maude-r2-reads-')));
  repo = join(tmp, 'repo');
  design = join(repo, '.design');
  for (const d of ['ui', '_history/ui-x', '_trash', '_versions', '_chat'])
    mkdirSync(join(design, d), { recursive: true });
  for (const f of [
    'ui/x.tsx',
    'ui/Pricing-internal.tsx',
    '_history/ui-x/1.tsx',
    '_trash/Pricing-internal.tsx',
    '_versions/r3.tsx',
    '_chat/a.tsx',
  ])
    writeFileSync(join(design, f), 'x');
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const kind = (abs: string) => {
  try {
    const st = statSync(abs);
    return st.isDirectory() ? ('dir' as const) : st.isFile() ? ('file' as const) : null;
  } catch {
    return null;
  }
};
const WHOLE = [{ rel: '', dir: true }];
const read = (rel: string) =>
  readPathsOf('Read', { rawInput: { file_path: join(design, rel) } }, repo, [design], kind);
const bash = (command: string) =>
  readPathsOf('Bash', { rawInput: { command } }, repo, [design], kind);

describe('M-R2-1 — canvas copies in runtime folders and path-less history verbs', () => {
  test('a Read under _history/, _trash/, _versions is a read of the whole design folder', () => {
    expect(read('_history/ui-x/1.tsx')).toEqual(WHOLE);
    expect(read('_trash/Pricing-internal.tsx')).toEqual(WHOLE);
    expect(read('_versions/r3.tsx')).toEqual(WHOLE);
    expect(bash('cat .design/_trash/Pricing-internal.tsx')).toEqual(WHOLE);
  });
  test('other runtime state stays untracked', () => {
    expect(read('_chat/a.tsx')).toEqual([]);
  });
  test('`history show <ref>` / `history diff` with no canvas → the whole design folder', () => {
    expect(bash('maude design history show r12')).toEqual(WHOLE);
    expect(bash('maude design history diff --from r3')).toEqual(WHOLE);
    expect(bash('maude design history diff ui/x.tsx')).toEqual([{ rel: 'ui/x.tsx', dir: false }]);
  });
});

describe('R2-L3 — flag values, loopback URLs, globs, a path-less Grep', () => {
  test('--flag=path counts by its value', () => {
    expect(bash('maude design annotate --in=ui/Pricing-internal.tsx')).toEqual([
      { rel: 'ui/Pricing-internal.tsx', dir: false },
    ]);
  });
  test('a loopback URL counts by its decoded ?canvas=', () => {
    expect(
      bash(
        "maude design screenshot --url 'http://127.0.0.1:4399/?canvas=ui%2FPricing-internal.tsx'"
      )
    ).toEqual([{ rel: 'ui/Pricing-internal.tsx', dir: false }]);
    expect(bash('curl http://localhost:4399/_canvas-shell?canvas=ui%2Fx.tsx')).toEqual([
      { rel: 'ui/x.tsx', dir: false },
    ]);
  });
  test('a website URL is not a design read', () => {
    expect(bash('maude design screenshot --url https://example.com/?canvas=ui%2Fx.tsx')).toEqual(
      []
    );
  });
  test('a glob counts as its base folder', () => {
    expect(bash('cat .design/ui/Pri*.tsx')).toEqual([{ rel: 'ui', dir: true }]);
    expect(bash('cat .design/**/*.tsx')).toEqual(WHOLE);
  });
  test('a Grep with no path searches the working directory, which holds the design root', () => {
    expect(readPathsOf('Grep', { rawInput: { pattern: 'TIERS' } }, repo, [design], kind)).toEqual(
      WHOLE
    );
  });
});
