// V2-2.4b gate — `maude design handoff <canvas> [designRoot]` writes `<Slug>.registry.json` next
// to the canvas. It used to accept ANY path, so a planted `_active.json` / a cloned config's
// `designRoot` could aim the write anywhere. The canvas must be a `.tsx` whose real path is under
// the project's design root (`$CLAUDE_PROJECT_DIR/.design`, realpath); a `designRoot` argument
// must be that same folder. Otherwise exit 2, nothing written.

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = join(import.meta.dir, '..', 'bin', 'handoff.sh');
const CANVAS = `import React from 'react';\nexport default function Home() { return <div className="p-4">Hi</div>; }\n`;

const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});
const mk = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  tmp.push(d);
  return d;
};
function project() {
  const root = mk('maude-handoff-');
  mkdirSync(join(root, '.design', 'ui'), { recursive: true });
  writeFileSync(join(root, '.design', 'config.json'), '{}');
  writeFileSync(join(root, '.design', 'ui', 'home.tsx'), CANVAS);
  return root;
}
async function run(root: string, args: string[]) {
  const p = Bun.spawn(['bash', BIN, ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { stdout, stderr, code };
}

describe('maude design handoff — containment', () => {
  test('control: a canvas under .design/ emits its registry sidecar', async () => {
    const root = project();
    const r = await run(root, [join(root, '.design', 'ui', 'home.tsx'), join(root, '.design')]);
    expect(r.code).toBe(0);
    expect(existsSync(join(root, '.design', 'ui', 'home.registry.json'))).toBe(true);
  });

  test('a canvas outside the design root is refused (exit 2), nothing written', async () => {
    const root = project();
    const outside = mk('maude-handoff-out-');
    writeFileSync(join(outside, 'x.tsx'), CANVAS);
    const r = await run(root, [join(outside, 'x.tsx')]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('not inside');
    expect(existsSync(join(outside, 'x.registry.json'))).toBe(false);
  });

  test('a ../ climb out of .design/ is refused', async () => {
    const root = project();
    writeFileSync(join(root, 'top.tsx'), CANVAS);
    const r = await run(root, [join(root, '.design', '..', 'top.tsx')]);
    expect(r.code).toBe(2);
    expect(existsSync(join(root, 'top.registry.json'))).toBe(false);
  });

  test('a folder under .design/ that is a symlink out of the project is refused (realpath)', async () => {
    const root = project();
    const outside = mk('maude-handoff-out-');
    writeFileSync(join(outside, 'x.tsx'), CANVAS);
    symlinkSync(outside, join(root, '.design', 'linked'));
    const r = await run(root, [join(root, '.design', 'linked', 'x.tsx')]);
    expect(r.code).toBe(2);
    expect(existsSync(join(outside, 'x.registry.json'))).toBe(false);
  });

  test('a canvas file that is a symlink to a file outside is refused', async () => {
    const root = project();
    const outside = mk('maude-handoff-out-');
    writeFileSync(join(outside, 'secret.tsx'), CANVAS);
    symlinkSync(join(outside, 'secret.tsx'), join(root, '.design', 'ui', 'leak.tsx'));
    const r = await run(root, [join(root, '.design', 'ui', 'leak.tsx')]);
    expect(r.code).toBe(2);
    expect(existsSync(join(root, '.design', 'ui', 'leak.registry.json'))).toBe(false);
  });

  test('a designRoot argument other than the project’s is refused', async () => {
    const root = project();
    const outside = mk('maude-handoff-out-');
    writeFileSync(join(outside, 'x.tsx'), CANVAS);
    const r = await run(root, [join(outside, 'x.tsx'), outside]);
    expect(r.code).toBe(2);
    expect(existsSync(join(outside, 'x.registry.json'))).toBe(false);
  });

  test('a non-.tsx target is refused (the sidecar name would be the file itself)', async () => {
    const root = project();
    writeFileSync(join(root, '.design', 'ui', 'notes.md'), '# keep me\n');
    const r = await run(root, [join(root, '.design', 'ui', 'notes.md')]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('must be a .tsx');
    expect(await Bun.file(join(root, '.design', 'ui', 'notes.md')).text()).toBe('# keep me\n');
  });
});
