// Lead decision maude/v2-p8-lead-underscore-file-is-a-module — a design-root `.tsx` whose basename
// starts with `_` is a module, never a canvas, unless it has its own meta / board / stored grant.
// Found on a real project: ui/club-web/_frames.tsx (no default export, a helper that wraps
// DesignCanvas) counted as a canvas by its content, so the frame gate (c4j: never inline a foreign
// canvas) refused it to all eight club-web canvases. Mirrors the DS rule (preview/_ds.tsx stays a
// module, c4l). '_' files are never listed, opened or granted as canvases, so inlining one exposes
// no one's canvas; a meta / board / grant still makes one a canvas (fail closed).

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canvasImportsReport,
  closureConfigOf,
  closureFor,
  type ProjectReader,
} from '../access/closure.ts';
import { resolveAccess } from '../access/scope.ts';
import { audienceIsCanvas } from '../acp/index.ts';

const project = (files: Record<string, string>): ProjectReader => ({
  list: () => Object.keys(files),
  text: (r) => files[r] ?? null,
  head: () => 'h1',
});
const viewer = (c: string) => resolveAccess({ v: 1, role: null, grants: [{ c, r: 'viewer' }] });

const HOME = 'ui/club-web/Home.tsx';
const FRAMES = 'ui/club-web/_frames.tsx';
const BASE: Record<string, string> = {
  [HOME]:
    "import { Frames } from './_frames.tsx';\nexport default () => <Frames><p>home</p></Frames>;\n",
  'ui/club-web/Home.meta.json': '{}',
  [FRAMES]:
    'import { DesignCanvas, DCArtboard } from \'@maude/canvas-lib\';\nexport const Frames = ({ children }) => <DesignCanvas><DCArtboard id="a" width={10} height={10}>{children}</DCArtboard></DesignCanvas>;\n',
};

describe('a `_` file that renders DesignCanvas is a module', () => {
  test('inlinable into a canvas’s frame: no refusal, in the grant’s read set', () => {
    expect(canvasImportsReport(project(BASE), [HOME]).has(HOME)).toBe(false);
    const c = closureFor(viewer(HOME), project(BASE));
    expect(c.blocked.has(HOME)).toBe(false);
    expect(c.read.has(FRAMES)).toBe(true);
  });

  test('with its own meta it is a canvas again — refused', () => {
    const files = { ...BASE, 'ui/club-web/_frames.meta.json': '{}' };
    expect(canvasImportsReport(project(files), [HOME]).get(HOME)).toEqual([FRAMES]);
  });

  test('with its own board it is a canvas again — refused', () => {
    const files = { ...BASE, 'ui-club-web-_frames.annotations.json': '{}' };
    expect(canvasImportsReport(project(files), [HOME]).get(HOME)).toEqual([FRAMES]);
  });

  test('with a stored grant it is a canvas again — refused', () => {
    const cfg = closureConfigOf({}, [FRAMES]);
    expect(canvasImportsReport(project(BASE), [HOME], cfg).get(HOME)).toEqual([FRAMES]);
  });

  test('the write audience asks the same question (acp/index.ts audienceIsCanvas)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'maude-underscore-'));
    try {
      mkdirSync(join(dir, 'ui', 'club-web'), { recursive: true });
      for (const [rel, text] of Object.entries(BASE)) writeFileSync(join(dir, rel), text);
      expect(audienceIsCanvas(dir, HOME, () => [])).toBe(false); // no DesignCanvas in its text
      expect(audienceIsCanvas(dir, FRAMES, () => [])).toBe(false);
      expect(audienceIsCanvas(dir, FRAMES, () => [FRAMES])).toBe(true);
      writeFileSync(join(dir, 'ui-club-web-_frames.annotations.json'), '{}');
      expect(audienceIsCanvas(dir, FRAMES, () => [])).toBe(true);
      writeFileSync(join(dir, 'ui/club-web/frames.tsx'), BASE[FRAMES] as string);
      expect(audienceIsCanvas(dir, 'ui/club-web/frames.tsx', () => [])).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a plain-named file that renders DesignCanvas is still a canvas — refused', () => {
    const files: Record<string, string> = {
      [HOME]: "import { Frames } from './frames.tsx';\nexport default () => <Frames />;\n",
      'ui/club-web/Home.meta.json': '{}',
      'ui/club-web/frames.tsx': BASE[FRAMES] as string,
    };
    expect(canvasImportsReport(project(files), [HOME]).get(HOME)).toEqual([
      'ui/club-web/frames.tsx',
    ]);
  });
});
