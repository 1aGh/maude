// V2-2.15 (contract V2-1.13 §5.6, §7): fixture systems give 0 / 10 / 11 with the exact reasons.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkSystem, hasRealGlyph } from '../ds/check.ts';
import { emitTokensJson } from '../ds/emit.ts';
import { indexRegistry, loadRegistry } from '../ds/registry.ts';
import { diskFs, loadSystem, type SystemConfig, systemConfigsFrom } from '../ds/system.ts';
import { conformantFiles, fixtureConfig, memFs } from './_ds-fixture.ts';

const idx = indexRegistry(loadRegistry());
const CSS = 'system/fx/colors_and_type.css';

function run(files: Record<string, string>, cfg: SystemConfig = fixtureConfig(), reEmit = true) {
  const f = { ...files };
  if (reEmit) f['system/fx/tokens.json'] = emitTokensJson(loadSystem(memFs(f), cfg), idx);
  return checkSystem(loadSystem(memFs(f), cfg), idx);
}
const without = (files: Record<string, string>, key: string) =>
  Object.fromEntries(Object.entries(files).filter(([k]) => k !== key));
const edit = (files: Record<string, string>, fn: (css: string) => string) => ({
  ...files,
  [CSS]: fn(files[CSS]),
});
const dropDecl =
  (name: string, nth = 0) =>
  (css: string) => {
    let i = -1;
    return css.replace(new RegExp(`\\n  ${name}: [^;]*;`, 'g'), (m) => (++i === nth ? '' : m));
  };

describe('ds-check system levels', () => {
  const base = conformantFiles();

  test('the generated fixture is Conformant (0) with no reasons', () => {
    const r = run(base, fixtureConfig(), false);
    expect(r.reasons).toEqual([]);
    expect(r.exit).toBe(0);
    expect(r.level).toBe('conformant');
    expect(r.tier1.present).toBe(95);
  });

  test('a missing functional role → 10, served by the fallback', () => {
    const r = run(edit(base, (c) => c.replace(/\n {2}--scrim: [^;]*;/g, '')));
    expect(r.reasons).toEqual(['missing-functional']);
    expect(r.exit).toBe(10);
    expect(r.tier1.servedByFallback).toEqual(['--scrim']);
  });

  test('a missing DDR-043 role → 11 missing-core; under a native alias name → native-only', () => {
    expect(run(edit(base, (c) => c.replace(/\n {2}--bg-0: [^;]*;/g, ''))).reasons).toEqual([
      'missing-core',
    ]);
    const r = run(edit(base, (c) => c.replace(/\n {2}--fg-0: ([^;]*);/g, '\n  --text: $1;')));
    expect(r.reasons).toEqual(['native-only', 'alias-not-inverted']);
    expect(r.exit).toBe(11);
    expect(r.tier1.coveredByAlias).toEqual({ '--fg-0': '--text' });
  });

  test('--focus-ring as a box-shadow → 11 type-collision', () => {
    const r = run(
      edit(base, (c) => c.replace(/(--focus-ring): [^;]*;/g, '$1: 0 0 0 2px oklch(0.5 0.1 250);'))
    );
    expect(r.reasons).toEqual(['type-collision']);
    expect(r.tier1.typeErrors.map((e) => [e.name, e.expected])).toEqual([
      ['--focus-ring', 'color'],
      ['--focus-ring', 'color'],
    ]);
    expect(r.collisions.map((c) => c.id)).toEqual(['type-mismatch']);
  });

  test('shadcn --accent signature (+ --accent-foreground) → 11 signature-collision', () => {
    const r = run(
      edit(base, (c) =>
        c.replace(/(\n {2}--accent: [^;]*;)/g, '$1\n  --accent-foreground: oklch(0.2 0 0);')
      )
    );
    expect(r.reasons).toContain('signature-collision');
    expect(r.exit).toBe(11);
    expect(r.collisions.find((c) => c.id === 'accent-shadcn')?.resolution).toEqual({
      '--accent': '--accent-soft',
      '--accent-foreground': '--accent-on-soft',
    });
  });

  test('single theme → 10 single-theme (no inversion, no other reason)', () => {
    const cfg = fixtureConfig({ themes: ['light'] });
    const r = run(conformantFiles(cfg), cfg);
    expect(r.reasons).toEqual(['single-theme']);
  });

  test('a colour role missing from one theme block → theme-gap (inheritance never counts)', () => {
    const r = run(edit(base, dropDecl('--bg-2', 1)));
    expect(r.reasons).toEqual(['theme-gap']);
    expect(r.tier1.themeGaps).toEqual([{ name: '--bg-2', theme: 'dark' }]);
  });

  test('a theme block without .ds[data-theme] → no-ds-scope', () => {
    const r = run(edit(base, (c) => c.replace(',\n.ds[data-theme="dark"] {', ' {')));
    expect(r.reasons).toEqual(['no-ds-scope']);
  });

  test('unprefixed own name → 10; alias with a value → alias-not-inverted; inverted → clean', () => {
    expect(
      run(edit(base, (c) => c.replace('--bg-0:', '--zebra: 1px;\n  --bg-0:'))).reasons
    ).toEqual(['unprefixed-own']);
    expect(
      run(edit(base, (c) => c.replace('--bg-0:', '--w-semibold: 600;\n  --bg-0:'))).reasons
    ).toEqual(['alias-not-inverted']);
    expect(
      run(
        edit(base, (c) => c.replace('--bg-0:', '--w-semibold: var(--weight-semibold);\n  --bg-0:'))
      ).reasons
    ).toEqual([]);
    // a prefix-own row (v1 = --x-*) not inverted is unprefixed-own, not alias-not-inverted
    expect(
      run(edit(base, (c) => c.replace('--bg-0:', '--spark: red;\n  --bg-0:'))).reasons
    ).toEqual(['unprefixed-own']);
    expect(
      run(
        edit(base, (c) =>
          c.replace('--bg-0:', '--x-spark: red;\n  --spark: var(--x-spark);\n  --bg-0:')
        )
      ).reasons
    ).toEqual([]);
  });

  test('unresolved and cyclic var() refs → 10 unresolved-ref, never a type error', () => {
    const r = run(edit(base, (c) => c.replace(/(--accent-text): [^;]*;/g, '$1: var(--nope);')));
    expect(r.reasons).toEqual(['unresolved-ref']);
    const cyc = run(
      edit(base, (c) =>
        c
          .replace(/(--accent-text): [^;]*;/g, '$1: var(--accent-soft);')
          .replace(/(--accent-soft): [^;]*;/g, '$1: var(--accent-text);')
      )
    );
    expect(cyc.reasons).toEqual(['unresolved-ref']);
    expect(cyc.tier1.typeErrors).toEqual([]);
  });

  test('`--space-0: 0` is a length (the explicit zero form)', () => {
    expect(base[CSS]).toContain('--space-0: 0;');
    expect(run(base).tier1.typeErrors).toEqual([]);
  });

  test('components.json absent → components-missing; no logo → brand-missing; stale tokens.json', () => {
    const noComp = without(base, 'system/fx/components.json');
    const r1 = run(noComp);
    expect(r1.reasons).toEqual(['components-missing', 'brand-missing']);
    const noLogo = without(base, 'system/fx/assets/logos/mark.svg');
    expect(run(noLogo).reasons).toEqual(['brand-missing']);
    const stale = run(
      edit(base, (c) => c.replace(/(--bg-0): [^;]*;/, '$1: oklch(0.5 0 0);')),
      fixtureConfig(),
      false
    );
    expect(stale.reasons).toEqual(['manifest-stale']);
    const absent = without(base, 'system/fx/tokens.json');
    expect(run(absent, fixtureConfig(), false).manifests['tokens.json']).toBe('absent');
  });

  // decision v2-2.15-icon-null-declared-gap: a null is a declared gap, never a pass in disguise.
  const withIconMap = (map: (m: Record<string, string | null>) => void) => {
    const cj = JSON.parse(base['system/fx/components.json']);
    map(cj.icons.map);
    return { ...base, 'system/fx/components.json': JSON.stringify(cj) };
  };

  test('an absent icon name → brand-missing; a null icon name clears it and is listed', () => {
    const absent = run(withIconMap((m) => Reflect.deleteProperty(m, 'calendar')));
    expect(absent.reasons).toEqual(['brand-missing']);
    expect(absent.components.brand.iconsMissing).toEqual(['calendar']);
    const declared = run(withIconMap((m) => (m.calendar = null)));
    expect(declared.reasons).toEqual([]);
    expect(declared.exit).toBe(0);
    expect(declared.components.declaredMissing.icons).toEqual(['calendar']);
  });

  test('a null never counts as a real glyph (keeper Pass C / <Icon name> boundary)', () => {
    const declared = run(withIconMap((m) => (m.calendar = null)));
    expect(hasRealGlyph(declared, 'calendar')).toBe(false);
    expect(hasRealGlyph(declared, 'home')).toBe(true);
    const absent = run(withIconMap((m) => Reflect.deleteProperty(m, 'calendar')));
    expect(hasRealGlyph(absent, 'calendar')).toBe(false);
  });

  test('a null variant is listed as a declared gap', () => {
    const cj = JSON.parse(base['system/fx/components.json']);
    cj.components.Button.variants.danger = null;
    const r = run({ ...base, 'system/fx/components.json': JSON.stringify(cj) });
    expect(r.exit).toBe(0);
    expect(r.components.declaredMissing.variants).toContain('Button.danger');
  });

  test('judgement rows and ladders are notes, never a level', () => {
    const r = run(
      edit(base, (c) => c.replace(/(--ease-out): [^;]*;/, '$1: cubic-bezier(0.3, 1.6, 0.6, 1);'))
    );
    expect(r.exit).toBe(0);
    expect(r.notes.map((n) => n.id)).toContain('ease-out-spring');
    expect(r.notes.map((n) => n.id)).toContain('bg-4-order');
  });
});

describe('ds-check on this repo’s systems (A16)', () => {
  const designRoot = join(import.meta.dir, '../../../.design');
  const cfg = JSON.parse(require('node:fs').readFileSync(join(designRoot, 'config.json'), 'utf8'));
  const systems = systemConfigsFrom(cfg);
  const fs = diskFs(designRoot);
  for (const name of ['maude', 'maude-v2']) {
    test(`${name} is Conformant (0) — gaps declared, never hidden`, () => {
      const s = systems.find((x) => x.name === name) as SystemConfig;
      const r = checkSystem(loadSystem(fs, s), idx);
      expect(r.tier1.present).toBe(95);
      expect(r.tier1.typeErrors).toEqual([]);
      expect(r.reasons).toEqual([]);
      expect(r.exit).toBe(0);
      expect(r.c7.families).toBe(1);
      // the icon gaps stay visible (decision v2-2.15-icon-null-declared-gap)
      expect(r.components.declaredMissing.icons.length).toBeGreaterThan(0);
    });
  }
});
