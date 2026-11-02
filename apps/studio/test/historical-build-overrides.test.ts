// S1.11 — historical build overlays (contract V2-1.9 §5.6, V2-1.17 §5.8).
//
// A past version renders from its OWN lanes: the version's TSX (the `source` argument, as
// before), and now its same-name CSS through `BuildCanvasOptions.overrides`. The override is a
// server-side option fed from the history store — never a request body — and it stays inside the
// same sandbox as every other build: CSS only, inside the design root, its own @import / url()
// still judged by the import allowlist (a historical lane is still peer-authored content).

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildCanvasModule, type CanvasOverrides } from '../canvas-build.ts';

const CANVAS = `import "./A.css";
export default function A() { return <div className="x">hi</div>; }
`;
const TODAY = '.x { --lane: today-lane; }\n';
const THEN = '.x { --lane: then-lane; }\n';

/** A design root under the OS temp dir — on macOS that is `/var/…` → `/private/var/…`, so every
 *  test here also crosses the symlink the bundler reports real paths through. */
function project(files: Record<string, string> = { 'ui/A.tsx': CANVAS, 'ui/A.css': TODAY }) {
  const designRoot = path.join(mkdtempSync(path.join(tmpdir(), 's1-11-')), '.design');
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(designRoot, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  const abs = (rel: string) => path.join(designRoot, rel);
  const build = (source: string, overrides?: CanvasOverrides, extra = {}) =>
    buildCanvasModule(abs('ui/A.tsx'), source, {
      designRoot,
      restrictImportsTo: designRoot,
      overrides,
      ...extra,
    });
  const cleanup = () => rmSync(path.dirname(designRoot), { recursive: true, force: true });
  return { designRoot, abs, build, cleanup };
}

describe('historical build overlays (S1.11)', () => {
  test("a version whose CSS differs renders its own CSS, not today's", async () => {
    const p = project();
    try {
      const live = await p.build(CANVAS);
      expect(live.js).toContain('today-lane');

      const then = await p.build(CANVAS, { [p.abs('ui/A.css')]: THEN });
      expect(then.js).toContain('then-lane');
      expect(then.js).not.toContain('today-lane');
      // different bytes → different etag: the two builds can never answer for each other
      expect(then.etag).not.toBe(live.etag);

      // nothing sticks: the next live build is today's CSS again
      const again = await p.build(CANVAS);
      expect(again.js).toContain('today-lane');
      expect(again.etag).toBe(live.etag);
    } finally {
      p.cleanup();
    }
  });

  test('the override is matched through the real path (logical and real spellings both work)', async () => {
    const p = project();
    try {
      const realKey = path.join(realpathSync(path.join(p.designRoot, 'ui')), 'A.css');
      const r = await p.build(CANVAS, { [realKey]: THEN });
      expect(r.js).toContain('then-lane');
    } finally {
      p.cleanup();
    }
  });

  test("a version's CSS lane renders even when today's file is gone", async () => {
    const p = project({ 'ui/A.tsx': CANVAS });
    try {
      const r = await p.build(CANVAS, { [p.abs('ui/A.css')]: THEN });
      expect(r.js).toContain('then-lane');
    } finally {
      p.cleanup();
    }
  });

  test('an overridden stylesheet is still inside the sandbox: its imports are judged', async () => {
    const p = project();
    try {
      // a version's CSS reaching outside the design root is refused like today's would be
      const outside = '@import "../../../../../../../../etc/hosts.css";\n.x{color:red}\n';
      await expect(p.build(CANVAS, { [p.abs('ui/A.css')]: outside })).rejects.toThrow(
        /outside the project/
      );
    } finally {
      p.cleanup();
    }
  });

  test('url() in an overridden stylesheet is rewritten to the served path like a live one', async () => {
    const p = project({ 'ui/A.tsx': CANVAS, 'ui/A.css': TODAY, 'ui/bg.png': 'png' });
    try {
      const r = await p.build(
        CANVAS,
        { [p.abs('ui/A.css')]: '.x { background: url(./bg.png); }\n' },
        { assetUrlBase: '/.design' }
      );
      expect(r.js).toContain('/.design/ui/bg.png');
    } finally {
      p.cleanup();
    }
  });

  test('only a stylesheet inside the design root can be overridden', async () => {
    const p = project();
    try {
      const bad: Array<[string, CanvasOverrides]> = [
        ['a module', { [p.abs('ui/_parts.tsx')]: 'export const x = 1;' }],
        ['the canvas itself', { [p.abs('ui/A.tsx')]: 'export default () => null;' }],
        ['outside the root', { [path.join(path.dirname(p.designRoot), 'x.css')]: '' }],
        ['a relative key', { 'ui/A.css': THEN }],
        ['a traversal', { [`${p.designRoot}/ui/../../x.css`]: THEN }],
      ];
      for (const [what, overrides] of bad) {
        await expect(p.build(CANVAS, overrides), what).rejects.toThrow(/override/i);
      }
      // without a root to hold them to, overrides are refused outright
      await expect(
        buildCanvasModule(p.abs('ui/A.tsx'), CANVAS, { overrides: { [p.abs('ui/A.css')]: THEN } })
      ).rejects.toThrow(/override/i);
    } finally {
      p.cleanup();
    }
  });
});
