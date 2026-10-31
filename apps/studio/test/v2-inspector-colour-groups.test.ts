// P6 T1 (inspector-ux-rules IR-8, M2) — the Inspector's colour list reads the DS schema's role groups, both themes and the
// `color-mix()` / `light-dark()` tokens. Before T1 the parser dropped every role written as a mix (`--scrim`,
// `--selection`, the `--status-*-soft` tints: 7 roles in maude-v2, 9 in maude) and kept only the FIRST declaration of a
// name, so a two-theme system showed one theme's value.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTokensCss } from '../client/inspector/ds-tokens.js';
import {
  COLOUR_ROLE_GROUPS,
  colourGroups,
  swatchOf,
} from '../client/v2/inspector/colour-groups.js';

const REPO = join(import.meta.dir, '..', '..', '..');
const schema = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'schema', 'ds-schema-v1.json'), 'utf8')
);
const colourRoles: { name: string; group: string }[] = schema.roles.filter(
  (r: { type: string }) => r.type === 'color'
);
const css = (ds: string) =>
  readFileSync(join(REPO, '.design', 'system', ds, 'colors_and_type.css'), 'utf8');
const declared = (text: string) =>
  new Set([...text.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));

describe('the registry groups are the schema’s, in its order', () => {
  test('COLOUR_ROLE_GROUPS lists every colour role of ds-schema-v1 in schema order', () => {
    const bySchema: Record<string, string[]> = {};
    for (const r of colourRoles) {
      bySchema[r.group] = [...(bySchema[r.group] ?? []), r.name];
    }
    const ours = Object.fromEntries(COLOUR_ROLE_GROUPS.map((g) => [g.id, [...g.roles]]));
    expect(ours).toEqual(bySchema);
    expect(COLOUR_ROLE_GROUPS.map((g) => g.id)).toEqual([
      ...new Set(colourRoles.map((r) => r.group)),
    ]);
  });
});

for (const ds of ['maude-v2', 'maude']) {
  describe(`${ds}: 0 role tokens dropped`, () => {
    const text = css(ds);
    const parsed = parseTokensCss(text);
    const roles = colourRoles.map((r) => r.name).filter((n) => declared(text).has(n));

    test('every colour role the system declares is offered — color-mix and light-dark included', () => {
      const dropped = roles.filter((n) => !parsed.color.includes(n));
      expect(dropped).toEqual([]);
      expect(parsed.color).toContain('--scrim');
      expect(parsed.color).toContain('--status-info-soft');
    });

    test('both themes: a per-theme role has a light and a dark value, each resolved to a colour', () => {
      expect(Object.keys(parsed.themes).sort()).toEqual(['dark', 'light']);
      const l = parsed.themes.light['--bg-3'];
      const d = parsed.themes.dark['--bg-3'];
      expect(l).toMatch(/^oklch\(/);
      expect(d).toMatch(/^oklch\(/);
      expect(l).not.toBe(d);
      // a mix resolves its var() inside the theme it sits in, so the shell can paint it
      expect(parsed.themes.light['--scrim']).toMatch(/^color-mix\(in oklch, oklch\(/);
      expect(parsed.themes.light['--scrim']).not.toContain('var(');
    });

    test('groups render in schema order: Surfaces · Text · Borders · Accent · Status, then More, then the rest', () => {
      const groups = colourGroups(parsed.color);
      const ids = groups.map((g) => g.id);
      expect(ids.slice(0, 6)).toEqual(['surfaces', 'text', 'borders', 'accent', 'status', 'more']);
      const inGroups = groups.flatMap((g) => g.tokens);
      expect(new Set(inGroups).size).toBe(inGroups.length); // each token once
      expect(inGroups.sort()).toEqual([...parsed.color].sort()); // nothing lost
      expect(groups[0].tokens).toEqual(['--bg-0', '--bg-1', '--bg-2', '--bg-3', '--bg-4']);
    });
  });
}

describe('light-dark() and the default theme', () => {
  test('light-dark(a, b) gives a to light and b to dark; :root is the default theme', () => {
    const p = parseTokensCss(
      ':root { --fg-0: light-dark(#111111, #eeeeee); --bg-1: #ffffff; --ink: var(--fg-0); }\n' +
        '[data-theme="dark"] { --bg-1: #000000; }'
    );
    expect(p.defaultTheme).toBe('light');
    expect(p.themes.light['--fg-0']).toBe('#111111');
    expect(p.themes.dark['--fg-0']).toBe('#eeeeee');
    expect(p.themes.dark['--bg-1']).toBe('#000000');
    expect(p.themes.dark['--ink']).toBe('#eeeeee'); // an alias follows its theme
    expect(p.vals['--bg-1']).toBe('#ffffff'); // `vals` stays the default theme (back-compat)
    expect(p.color).toEqual(expect.arrayContaining(['--fg-0', '--bg-1', '--ink']));
  });

  test('a system whose :root is dark says so', () => {
    const p = parseTokensCss(
      ':root, .ds[data-theme="dark"] { --bg-0: #000000; }\n.ds[data-theme="light"] { --bg-0: #ffffff; }'
    );
    expect(p.defaultTheme).toBe('dark');
    expect(p.vals['--bg-0']).toBe('#000000');
    expect(p.themes.light['--bg-0']).toBe('#ffffff');
  });

  test('a one-theme system has one theme, and the swatch is not split', () => {
    const p = parseTokensCss(':root { --accent: #1e6bff; }');
    expect(Object.keys(p.themes)).toEqual(['light']);
    expect(swatchOf('--accent', p)).toEqual({ light: '#1e6bff', dark: null });
  });

  test('swatchOf gives both themes for a two-theme system', () => {
    const p = parseTokensCss(css('maude-v2'));
    const s = swatchOf('--bg-3', p);
    expect(s.light).toMatch(/^oklch/);
    expect(s.dark).toMatch(/^oklch/);
  });
});
