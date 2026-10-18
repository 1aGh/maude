// S10.20: the icon vocabulary has no declared gap in the two systems this repo ships.
// Every one of the 40 vocabulary names maps to a glyph that exists: either an
// `assets/icons/<name>.svg` file, or a glyph id drawn in the system's own iconography
// specimen. The null-is-a-declared-gap rule itself stays pinned in ds-check-levels.test.ts.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidSvg } from '../draw/optimize.ts';
import { checkSystem } from '../ds/check.ts';
import { indexRegistry, loadRegistry } from '../ds/registry.ts';
import { diskFs, loadSystem, type SystemConfig, systemConfigsFrom } from '../ds/system.ts';

const designRoot = join(import.meta.dir, '../../../.design');
const reg = loadRegistry();
const idx = indexRegistry(reg);
const cfg = JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
const systems = systemConfigsFrom(cfg);

const FAMILY = {
  maude: { viewBox: '0 0 24 24', stroke: '1' },
  'maude-v2': { viewBox: '0 0 16 16', stroke: '1.5' },
} as const;

for (const name of ['maude', 'maude-v2'] as const) {
  describe(`${name} icon vocabulary`, () => {
    const dir = join(designRoot, 'system', name);
    const components = JSON.parse(readFileSync(join(dir, 'components.json'), 'utf8'));
    const map: Record<string, string | null> = components.icons.map;
    const specimen = existsSync(join(dir, 'preview/iconography.tsx'))
      ? readFileSync(join(dir, 'preview/iconography.tsx'), 'utf8')
      : '';
    const svgPath = (glyph: string) => join(dir, 'assets/icons', `${glyph}.svg`);

    test('ds-check reports 40/40 glyphs and no declared gap', () => {
      const s = systems.find((x) => x.name === name) as SystemConfig;
      const r = checkSystem(loadSystem(diskFs(designRoot), s), idx);
      expect(r.components.declaredMissing.icons).toEqual([]);
      expect(r.components.brand.iconsMissing).toEqual([]);
      expect(r.exit).toBe(0);
      const real = reg.icons.vocabulary.filter((n) => typeof map[n] === 'string');
      expect(real.length).toBe(40);
    });

    test('every mapped glyph resolves to a file or a specimen glyph', () => {
      const unresolved = reg.icons.vocabulary.filter((n) => {
        const g = map[n];
        if (typeof g !== 'string') return true;
        return !(existsSync(svgPath(g)) || specimen.includes(`id: "${g}"`));
      });
      expect(unresolved).toEqual([]);
    });

    test('every icon file is valid, one family: grid, stroke, currentColor, no stray paint', () => {
      const files = [...new Set(Object.values(map))]
        .filter((g): g is string => typeof g === 'string' && existsSync(svgPath(g)))
        .sort();
      expect(files.length).toBeGreaterThan(0);
      const f = FAMILY[name];
      for (const g of files) {
        const svg = readFileSync(svgPath(g), 'utf8');
        expect(isValidSvg(svg)).toBe(true);
        expect(svg).toContain(`viewBox="${f.viewBox}"`);
        expect(svg).toMatch(/(stroke|fill)="currentColor"/); // `more` is the three filled dots
        expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
        // the family stroke, on every stroked element that states one (1 is the SVG default)
        for (const m of svg.matchAll(/stroke-width="([\d.]+)"/g)) expect(m[1]).toBe(f.stroke);
      }
    });
  });
}
