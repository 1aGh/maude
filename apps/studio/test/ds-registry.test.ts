// V2-2.15 (contract V2-1.13 §7): the registry validates against its schema (Ajv 2020-12,
// strict) and holds the invariants JSON Schema can't express.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { loadRegistry } from '../ds/registry.ts';
import { SCHEMA_DIR } from '../paths.ts';

const req = createRequire(import.meta.url);
const Ajv2020 = req('ajv/dist/2020.js').default;
const reg = loadRegistry();

describe('ds-schema-v1 registry', () => {
  test('validates against ds-schema-v1.schema.json under strict Ajv 2020-12', () => {
    const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, 'ds-schema-v1.schema.json'), 'utf8'));
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    const ok = validate(reg);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  test('a 94-role registry is rejected', () => {
    const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, 'ds-schema-v1.schema.json'), 'utf8'));
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    expect(validate({ ...reg, roles: reg.roles.slice(1) })).toBe(false);
  });

  test('95 unique roles, 92 unconditional, 68 DDR-043 + 27 functional', () => {
    const names = reg.roles.map((r) => r.name);
    expect(names.length).toBe(95);
    expect(new Set(names).size).toBe(95);
    expect(reg.roles.filter((r) => !r.family).length).toBe(92);
    expect(reg.roles.filter((r) => r.origin !== 'v1').length).toBe(68);
    expect(reg.roles.filter((r) => r.origin === 'v1').length).toBe(27);
  });

  test('every v1 role has a fallback, no DDR-043 role has one; perTheme = colour-typed', () => {
    for (const r of reg.roles) {
      if (r.origin === 'v1') expect(r.fallback, r.name).not.toBeNull();
      else expect(r.fallback, r.name).toBeNull();
      expect(r.perTheme, r.name).toBe(r.type === 'color');
    }
  });

  test('fallbacks carry no new hue: colour fallbacks reference the system’s own tokens', () => {
    for (const r of reg.roles.filter((x) => x.fallback && x.type === 'color')) {
      expect(r.fallback, r.name).toContain('var(--');
      expect(r.fallback, r.name).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    }
  });

  test('40 icons, 14 core components, 3 brand pieces, 9 S-rules; C7 suffix list', () => {
    expect(reg.icons.vocabulary.length).toBe(40);
    expect(reg.components.core.length).toBe(14);
    expect(reg.components.brand.map((b) => b.name)).toEqual(['Logo', 'Icon', 'Text']);
    expect(reg.canvasRules.map((r) => r.id)).toEqual([
      'S1',
      'S2',
      'S3',
      'S4',
      'S5',
      'S6',
      'S7',
      'S8',
      'S9',
    ]);
    expect(reg.subRoleSuffixes).toEqual([
      'hover',
      'active',
      'fg',
      'soft',
      'on-soft',
      'text',
      'glow',
    ]);
  });

  test('resolution only on signature collision rows; alias natives unique per context', () => {
    for (const c of reg.collisions) {
      if (c.resolution) expect(c.detect, c.id).toBe('signature');
    }
    const seen = new Set<string>();
    for (const a of reg.aliases) {
      const key = `${a.native}|${JSON.stringify(a.context)}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
      expect(
        reg.roles.some((r) => r.name === a.native),
        `${a.native} is a Tier-1 name`
      ).toBe(false);
    }
  });

  test('component fallbackCss is token-only: var(--Tier-1), keywords, 0 or a 1px hairline', () => {
    const tier1 = new Set(reg.roles.map((r) => r.name));
    for (const c of reg.components.core) {
      const css = c.fallbackCss ?? '';
      for (const m of css.matchAll(/var\((--[a-z0-9-]+)/g))
        expect(tier1.has(m[1]), `${c.name}: ${m[1]}`).toBe(true);
      const literals =
        css.replace(/var\([^)]*\)/g, '').match(/(?<![\w-])\d+(?:\.\d+)?[a-z%]*/g) ?? [];
      for (const lit of literals) expect(['0', '1px'], `${c.name}: ${lit}`).toContain(lit);
    }
  });
});
