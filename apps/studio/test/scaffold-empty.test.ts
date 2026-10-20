// S6.15 (Q10) — a new project starts EMPTY: scaffoldDesign() writes the config and the two empty
// folders and no canvas. The guides (How to use Maude, How to make video) are added on request by
// Help › Help and guides → addGuideCanvases(), from the same template strings, never over a file.
import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addGuideCanvases, GUIDE_CANVASES, scaffoldDesign } from '../scaffold-design.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'maude-scaffold-empty-'));
const canvasesIn = (ui: string) =>
  readdirSync(ui).filter((f) => f.endsWith('.tsx') || f.endsWith('.meta.json'));

describe('scaffoldDesign — a new project has 0 canvases', () => {
  test('writes the config and no canvas, no Welcome, no guides', () => {
    const dir = tmp();
    try {
      expect(scaffoldDesign(dir, 'Empty').ok).toBe(true);
      expect(existsSync(join(dir, '.design', 'config.json'))).toBe(true);
      expect(canvasesIn(join(dir, '.design', 'ui'))).toEqual([]);
      expect(existsSync(join(dir, '.design', 'ui', 'Welcome.tsx'))).toBe(false);
      expect(existsSync(join(dir, '.design', 'ui', 'How to use Maude.tsx'))).toBe(false);
      expect(existsSync(join(dir, '.design', 'ui', 'How to make video.tsx'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('addGuideCanvases — the two guides, on request', () => {
  function project() {
    const dir = tmp();
    scaffoldDesign(dir, 'Guides');
    return { dir, ui: join(dir, '.design', 'ui') };
  }

  test('adds exactly the two guides, each with a parseable .tsx and a meta sidecar', () => {
    const { dir, ui } = project();
    try {
      const r = addGuideCanvases(ui);
      expect(r).toEqual({
        ok: true,
        added: ['How to use Maude', 'How to make video'],
        skipped: [],
      });
      const transpiler = new Bun.Transpiler({ loader: 'tsx' });
      for (const [name, count] of [
        ['How to use Maude', 10],
        ['How to make video', 7],
      ] as const) {
        const src = readFileSync(join(ui, `${name}.tsx`), 'utf8');
        expect(src.length).toBeGreaterThan(10_000);
        expect(() => transpiler.transformSync(src)).not.toThrow();
        expect(src).toMatch(/export default function \w+/);
        expect(src).toContain('const TOKENS');
        const meta = JSON.parse(readFileSync(join(ui, `${name}.meta.json`), 'utf8'));
        expect(meta.artboards.length).toBe(count);
        expect(meta.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      expect(canvasesIn(ui).sort()).toEqual(
        GUIDE_CANVASES.flatMap((g) => [`${g}.meta.json`, `${g}.tsx`]).sort()
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('never overwrites: a guide the person edited stays as they left it', () => {
    const { dir, ui } = project();
    try {
      mkdirSync(ui, { recursive: true });
      writeFileSync(join(ui, 'How to use Maude.tsx'), '// mine\n');
      const r = addGuideCanvases(ui);
      expect(r).toEqual({ ok: true, added: ['How to make video'], skipped: ['How to use Maude'] });
      expect(readFileSync(join(ui, 'How to use Maude.tsx'), 'utf8')).toBe('// mine\n');
      expect(existsSync(join(ui, 'How to use Maude.meta.json'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a second request adds nothing and says so', () => {
    const { dir, ui } = project();
    try {
      addGuideCanvases(ui);
      expect(addGuideCanvases(ui)).toEqual({
        ok: true,
        added: [],
        skipped: ['How to use Maude', 'How to make video'],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
