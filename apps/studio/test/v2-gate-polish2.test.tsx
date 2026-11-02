// Wave-B gate design polish 2 (design-critic 05 es-search-panel): panel search never lists Project or
// Runtime files groups when hidden files are off.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('panel search lists only the Design system beside the canvas hits', () => {
  const groups = [
    { kind: 'project', label: 'Project', tree: { 'README.md': {} } },
    { kind: 'canvas', label: 'UI canvases', tree: { 'a.tsx': {} } },
    { kind: 'canvas', label: 'Design system', tree: { 'tokens.tsx': {} } },
    { kind: 'runtime', label: 'Runtime files', tree: { '_server.json': {} } },
  ];

  test('Project and Runtime files never show; the Design system shows with a hit', async () => {
    const { searchOtherGroups } = await import('../client/tree/tree.jsx');
    expect(searchOtherGroups(groups).map((g) => g.label)).toEqual(['Design system']);
  });

  test('a Design system with no hit is left out too (no "No matches." block)', async () => {
    const { searchOtherGroups } = await import('../client/tree/tree.jsx');
    const none = groups.map((g) => ({ ...g, tree: {} }));
    expect(searchOtherGroups(none)).toEqual([]);
  });
});

describe('Settings › General › Look › Theme: Light · Dark · Auto (02 ob-settings)', () => {
  test('the choice and a pick', async () => {
    const { pickTheme, themeChoice } = await import('../client/v2/settings/theme-auto.js');
    expect(themeChoice('light', false)).toBe('light');
    expect(themeChoice('dark', true)).toBe('auto');
    expect(pickTheme('auto', 'light')).toEqual({ auto: true, theme: 'light' });
    expect(pickTheme('dark', 'light')).toEqual({ auto: false, theme: 'dark' });
  });

  test('the Look group is one Theme row with three radios; Inspector words left General', async () => {
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { ThemeSegment } = await import('../client/v2/settings/general-section.jsx');
    const html = renderToStaticMarkup(React.createElement(ThemeSegment, { theme: 'dark' }));
    for (const v of ['light', 'dark', 'auto']) expect(html).toContain(`value="${v}"`);
    expect(html).toContain('data-testid="settings-theme"');
    const src = readFileSync(
      new URL('../client/v2/settings/general-section.jsx', import.meta.url),
      'utf8'
    );
    expect(src.includes('AppearanceTab')).toBe(false); // no "shell chrome" radios, no Inspector vocabulary
  });

  test('a picked theme (the View toggle, ⌘K Theme) ends Auto; the shell core runs the follower', () => {
    const src = readFileSync(
      new URL('../client/hooks/use-project-data.jsx', import.meta.url),
      'utf8'
    );
    expect(src).toContain('writeThemeAuto(false)');
    const core = readFileSync(
      new URL('../client/hooks/use-shell-core.jsx', import.meta.url),
      'utf8'
    );
    expect(core).toContain('useThemeAuto(theme, setTheme)');
  });
});

describe('AI send buttons are azure with a white spark (CONTRACT §7, RC-D); the target menu is solid', () => {
  const rule = (css: string, sel: string) => {
    const at = css.indexOf(`${sel} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };
  test('Home and the empty project send', () => {
    const home = readFileSync(new URL('../client/home/home.css', import.meta.url), 'utf8');
    const ep = readFileSync(
      new URL('../client/v2/create/empty-project.css', import.meta.url),
      'utf8'
    );
    for (const r of [rule(home, '.home-ask-send'), rule(ep, '.ep-ask-send')]) {
      expect(r).toContain('background: var(--accent);');
      expect(r).toContain('color: var(--accent-fg);');
    }
    expect(rule(home, '.island.home-target-menu')).toContain('background: var(--bg-1);');
  });
});
