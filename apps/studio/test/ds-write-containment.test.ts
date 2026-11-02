// V2-2.4b gate — `ds-check --emit` and `ds-upgrade --stage|--apply` write files at paths a
// project's own `.design/config.json` names (`designSystems[].path / name / tokensCssRel`). The
// hub sanitises its copy; a CLONED project's local config is not sanitised, so it could aim the
// tokens.json / CSS writes outside `.design/`. Every write target must resolve (realpath) under
// `<designRoot>/system/` (V2-1.13: a system lives at `system/<ds>/`), else a one-line refusal.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runDsCheck } from '../ds/cli.ts';
import { runDsUpgrade } from '../ds/upgrade-cli.ts';
import { conformantFiles } from './_ds-fixture.ts';

const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});
const mk = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  tmp.push(d);
  return d;
};

/** Write the conformant fixture system (`system/fx/*`) re-rooted at `base/<prefix>/*` — minus
 *  tokens.json, which is what `--emit` writes. */
function writeSystem(base: string, prefix: string) {
  for (const [rel, text] of Object.entries(conformantFiles())) {
    if (rel.endsWith('/tokens.json')) continue;
    const abs = join(base, prefix, rel.replace(/^system\/fx\/?/, ''));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
}

function project(systems: Record<string, unknown>[]) {
  const root = mk('maude-ds-contain-');
  mkdirSync(join(root, '.design', 'system'), { recursive: true });
  writeFileSync(join(root, '.design', 'config.json'), JSON.stringify({ designSystems: systems }));
  return root;
}
const env = (root: string) => ({ CLAUDE_PROJECT_DIR: root });

describe('ds-check --emit stays under .design/system/', () => {
  test('control: a system at system/<ds>/ emits tokens.json', () => {
    const root = project([{ name: 'fx', path: 'system/fx' }]);
    writeSystem(join(root, '.design'), 'system/fx');
    const r = runDsCheck(['fx', '--emit', '--root', root], env(root));
    expect(r.stderr).not.toContain('outside');
    expect(existsSync(join(root, '.design', 'system', 'fx', 'tokens.json'))).toBe(true);
  });

  test('a path that climbs out of .design/ is refused, nothing written', () => {
    const root = project([{ name: 'fx', path: '../evil' }]);
    writeSystem(root, 'evil');
    const r = runDsCheck(['fx', '--emit', '--root', root], env(root));
    expect(r.code).toBe(13);
    expect(r.stderr).toContain('outside .design/system/');
    expect(existsSync(join(root, 'evil', 'tokens.json'))).toBe(false);
  });

  test('a path inside .design/ but outside system/ is refused', () => {
    const root = project([{ name: 'fx', path: 'ui' }]);
    writeSystem(join(root, '.design'), 'ui');
    const r = runDsCheck(['fx', '--emit', '--root', root], env(root));
    expect(r.code).toBe(13);
    expect(existsSync(join(root, '.design', 'ui', 'tokens.json'))).toBe(false);
  });

  test('system/<ds> that is a symlink to a folder outside the project is refused (realpath)', () => {
    const outside = mk('maude-ds-outside-');
    writeSystem(outside, 'fx');
    const root = project([{ name: 'fx', path: 'system/fx' }]);
    symlinkSync(join(outside, 'fx'), join(root, '.design', 'system', 'fx'));
    const r = runDsCheck(['fx', '--emit', '--root', root], env(root));
    expect(r.code).toBe(13);
    expect(r.stderr).toContain('outside .design/system/');
    expect(readdirSync(join(outside, 'fx'))).not.toContain('tokens.json');
  });
});

describe('ds-upgrade --stage / --apply stay under .design/', () => {
  const plan = (root: string) => {
    const p = join(root, 'plan.json');
    writeFileSync(p, '[]');
    return p;
  };

  test('--apply refuses a tokensCssRel outside .design/system/', () => {
    const root = project([
      { name: 'fx', path: 'system/fx', tokensCssRel: '../../outside/colors_and_type.css' },
    ]);
    writeSystem(join(root, '.design'), 'system/fx');
    mkdirSync(join(root, 'outside'));
    const r = runDsUpgrade(['fx', '--apply', plan(root), '--root', root], env(root));
    expect(r.code).toBe(13);
    expect(r.stderr).toContain('outside .design/system/');
    expect(r.stderr.trim().split('\n').length).toBe(1);
    expect(readdirSync(join(root, 'outside'))).toEqual([]);
  });

  test('--apply refuses a tokensCssRel that is not a .css file', () => {
    const root = project([
      { name: 'fx', path: 'system/fx', tokensCssRel: 'system/fx/preview/_ds.tsx' },
    ]);
    writeSystem(join(root, '.design'), 'system/fx');
    const r = runDsUpgrade(['fx', '--apply', plan(root), '--root', root], env(root));
    expect(r.code).toBe(13);
    expect(r.stderr).toContain('not a .css file');
  });

  test('--stage refuses a system name that is a path', () => {
    const name = '../../../../pwn';
    const root = project([{ name, path: 'system/fx' }]);
    writeSystem(join(root, '.design'), 'system/fx');
    const r = runDsUpgrade([name, '--stage', plan(root), '--root', root], env(root));
    expect(r.code).toBe(13);
    expect(existsSync(join(root, 'pwn'))).toBe(false);
    expect(existsSync(join(root, '.design', '_state'))).toBe(false);
  });
});
