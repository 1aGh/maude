// S6.12 — the server half of the C5 render signal: a canvas says "I drew fine", the server decides what that
// is worth. The name is a claim; the source and its hash come from disk; a broken source records nothing.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRenderOk, srcHashOf } from '../history/last-good.ts';
import { createRenderOkSignal, RENDER_OK_GAP_MS } from '../history/render-ok-signal.ts';

const GOOD = 'export default function A() { return <div>hi</div>; }\n';
const BROKEN = 'export default function A() { return <div>hi</div ; }\n';

const roots: string[] = [];
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'render-ok-'));
  roots.push(root);
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, '_state'), { recursive: true });
  return { root, designRoot };
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function make(designRoot: string) {
  let t = 1_000_000;
  const accept = createRenderOkSignal({ designRoot, designRel: '.design', now: () => t });
  return {
    accept,
    tick: (ms = RENDER_OK_GAP_MS + 1) => {
      t += ms;
    },
  };
}

describe('render-ok: what the server records', () => {
  test('a clean canvas is recorded, hashed from the DISK source', () => {
    const { designRoot } = sandbox();
    writeFileSync(join(designRoot, 'ui', 'A.tsx'), GOOD);
    const { accept } = make(designRoot);
    const r = accept('.design/ui/A.tsx');
    expect(r).toEqual({ ok: true, canvas: 'ui/A.tsx', wrote: true });
    expect(readRenderOk(designRoot)['ui/A.tsx']?.srcHash).toBe(srcHashOf(GOOD));
  });

  test('a canvas that claims ok for broken code records nothing', () => {
    const { designRoot } = sandbox();
    writeFileSync(join(designRoot, 'ui', 'A.tsx'), BROKEN);
    const r = make(designRoot).accept('.design/ui/A.tsx');
    expect(r).toEqual({ ok: false, reason: 'broken' });
    expect(readRenderOk(designRoot)).toEqual({});
  });

  test('the name is a claim: traversal, runtime folders, non-canvases and junk are refused', () => {
    const { root, designRoot } = sandbox();
    writeFileSync(join(root, 'outside.tsx'), GOOD);
    writeFileSync(join(designRoot, '_state', 'x.tsx'), GOOD);
    writeFileSync(join(designRoot, 'ui', 'A.css'), 'a{}');
    const { accept } = make(designRoot);
    for (const bad of [
      '.design/../outside.tsx',
      '../outside.tsx',
      '.design/_state/x.tsx',
      '',
      42,
      null,
      { file: 1 },
      `.design/ui/${'a'.repeat(600)}.tsx`,
    ]) {
      expect(accept(bad).ok).toBe(false);
    }
    expect(accept('.design/ui/A.css')).toEqual({ ok: false, reason: 'not-canvas' });
    expect(readRenderOk(designRoot)).toEqual({});
  });

  test('the same source twice is one write; a new source is another', () => {
    const { designRoot } = sandbox();
    const file = join(designRoot, 'ui', 'A.tsx');
    writeFileSync(file, GOOD);
    const { accept, tick } = make(designRoot);
    expect(accept('.design/ui/A.tsx')).toMatchObject({ ok: true, wrote: true });
    tick();
    expect(accept('.design/ui/A.tsx')).toMatchObject({ ok: true, wrote: false });
    tick();
    writeFileSync(file, `${GOOD}// edit\n`);
    expect(accept('.design/ui/A.tsx')).toMatchObject({ ok: true, wrote: true });
    expect(readRenderOk(designRoot)['ui/A.tsx']?.srcHash).toBe(srcHashOf(`${GOOD}// edit\n`));
  });

  test('a canvas posting in a loop costs one look per interval', () => {
    const { designRoot } = sandbox();
    writeFileSync(join(designRoot, 'ui', 'A.tsx'), GOOD);
    const { accept, tick } = make(designRoot);
    expect(accept('.design/ui/A.tsx').ok).toBe(true);
    expect(accept('.design/ui/A.tsx')).toEqual({ ok: false, reason: 'too-soon' });
    tick();
    expect(accept('.design/ui/A.tsx').ok).toBe(true);
  });

  test('a symlink that points out of the design root is not read', () => {
    const { root, designRoot } = sandbox();
    writeFileSync(join(root, 'secret.tsx'), GOOD);
    symlinkSync(join(root, 'secret.tsx'), join(designRoot, 'ui', 'L.tsx'));
    const r = make(designRoot).accept('.design/ui/L.tsx');
    expect(r).toEqual({ ok: false, reason: 'bad-name' });
    expect(readRenderOk(designRoot)).toEqual({});
  });
});
