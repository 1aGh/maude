// S10.6 — the Design system canvas (`@maude/ds/board`): sections drawn from the model, a pending
// value shown "as edited" through a board-scoped <style> (hostile values dropped), the lock on a
// frozen brand colour, and the system's own Dark as a section class — never the app's theme.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildBoardModel } from '../ds/board/build-model.ts';
import { DSSection, DsBarView, SECTIONS, waitingWords } from '../ds/board/index.tsx';
import {
  __registerBoardModel,
  __resetBoardState,
  getBoardMode,
  setBoardMode,
} from '../ds/board/state.ts';
import { type BoardModel, boardThemeCss, modesOf, safeCssValue } from '../ds/board/types.ts';
import { systemConfigsFrom } from '../ds/system.ts';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const STUDIO_CSS = `:root,
.studio[data-theme="light"],
.ds[data-theme="light"] {
  --bg-0: #ffffff;
  --bg-1: #f6f7f9;
  --fg-0: #111317;
  --accent: oklch(0.55 0.2 255);
  --accent-hover: oklch(0.5 0.2 255);
  --radius-md: 10px;
  --space-4: 16px;
  --font-body: "Inter", system-ui, sans-serif;
  --type-base: 14px;
  --lh-base: 1.4;
  --weight-semibold: 600;
  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.1);
  --dur-flip: 120ms;
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --x-sky: #5aa9e6;
  --focus-ring: oklch(0.6 0.2 255);
  --focus-ring-width: 2px;
}
.studio[data-theme="dark"],
.ds[data-theme="dark"] {
  --bg-0: #101216;
  --bg-1: #181b21;
  --fg-0: #eef0f4;
  --accent: oklch(0.65 0.18 255);
  --accent-hover: oklch(0.7 0.18 255);
  --x-sky: #7cc0f0;
}
`;

// "Alligators": the club green is dark and the default; paper is Light. Brand colours are locked,
// type is condensed.
const GATOR_CSS = `:root,
.gators[data-theme="dark"],
.ds[data-theme="dark"] {
  --bg-0: #0b3d2a;
  --bg-1: #0f4a33;
  --fg-0: #ffffff;
  --accent: #f2c200;
  --brand: #0b3d2a;
  --brand-2: #f2c200;
  --font-display: "Avenir Next Condensed", "Arial Narrow", sans-serif;
  --font-body: "Avenir Next", system-ui, sans-serif;
  --radius-md: 2px;
}
.gators[data-theme="light"],
.ds[data-theme="light"] {
  --bg-0: #f4efe2;
  --bg-1: #ece5d2;
  --fg-0: #0b3d2a;
  --accent: #0b3d2a;
  --brand: #0b3d2a;
  --brand-2: #f2c200;
}
`;

const tokensJson = (system: string, label: string, leaves: Record<string, object>) =>
  JSON.stringify(
    {
      $extensions: { 'sh.maude': { system, label, themes: ['light', 'dark'] } },
      color: Object.fromEntries(
        Object.entries(leaves).map(([css, ext]) => [
          css.replace(/^--/, ''),
          { $value: '#000000', $type: 'color', $extensions: { 'sh.maude': { css, ...ext } } },
        ])
      ),
    },
    null,
    2
  );

function project(opts: {
  name: string;
  css: string;
  themeDefault: 'light' | 'dark';
  rootClass: string;
  tokens: string;
  meta?: object;
  usage?: object;
  components?: object;
}): { root: string; sys: ReturnType<typeof systemConfigsFrom>[number] } {
  const root = mkdtempSync(path.join(tmpdir(), 'ds-board-'));
  roots.push(root);
  const dsPath = `system/${opts.name}`;
  mkdirSync(path.join(root, dsPath, 'preview'), { recursive: true });
  mkdirSync(path.join(root, dsPath, 'assets', 'logos'), { recursive: true });
  const config = {
    designSystems: [
      {
        name: opts.name,
        path: dsPath,
        themes: ['light', 'dark'],
        themeDefault: opts.themeDefault,
        rootClass: opts.rootClass,
      },
    ],
    defaultDesignSystem: opts.name,
  };
  writeFileSync(path.join(root, 'config.json'), JSON.stringify(config));
  writeFileSync(path.join(root, dsPath, 'colors_and_type.css'), opts.css);
  writeFileSync(path.join(root, dsPath, 'tokens.json'), opts.tokens);
  writeFileSync(
    path.join(root, dsPath, 'assets', 'logos', 'mark.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>'
  );
  if (opts.components)
    writeFileSync(path.join(root, dsPath, 'components.json'), JSON.stringify(opts.components));
  if (opts.meta)
    writeFileSync(path.join(root, dsPath, 'design-system.meta.json'), JSON.stringify(opts.meta));
  if (opts.usage) {
    mkdirSync(path.join(root, '_cache', 'index'), { recursive: true });
    writeFileSync(path.join(root, '_cache', 'index', 'ds-usage.json'), JSON.stringify(opts.usage));
  }
  const sys = systemConfigsFrom(config)[0];
  return { root, sys };
}

const USAGE = (name: string) => ({
  format: 'maude.ds-usage',
  v: 1,
  builtAt: '2026-10-18T00:00:00Z',
  sources: {},
  systems: {
    [name]: {
      draft: false,
      canvases: { 'ui/a.tsx': { follows: true }, 'ui/b.tsx': { follows: true } },
      tokens: {
        '--accent': { 'ui/a.tsx': { places: 3 }, 'ui/b.tsx': { places: 1 } },
        '--bg-0': { 'ui/a.tsx': { places: 1 } },
      },
      components: { Button: { 'ui/a.tsx': { instances: 2 } } },
    },
  },
});

function studio(extra: { meta?: object } = {}): BoardModel {
  const { root, sys } = project({
    name: 'studio',
    css: STUDIO_CSS,
    themeDefault: 'light',
    rootClass: 'studio',
    tokens: tokensJson('studio', 'Studio site system', {
      '--accent': { label: 'Accent', valueNames: { light: 'Azure', dark: 'Sky' } },
      '--bg-0': { label: 'Page' },
    }),
    usage: USAGE('studio'),
    meta: extra.meta,
    components: {
      components: {
        Button: {
          class: 'btn',
          label: 'Button',
          variants: { primary: 'btn--primary', ghost: 'btn--ghost' },
          sizes: { sm: 'btn--sm' },
        },
      },
    },
  });
  return buildBoardModel(root, sys);
}

function gators(): BoardModel {
  const { root, sys } = project({
    name: 'gators',
    css: GATOR_CSS,
    themeDefault: 'dark',
    rootClass: 'gators',
    tokens: tokensJson('gators', 'Alligators brand system', {
      '--brand': { label: 'Club green', locked: true },
      '--brand-2': { label: 'Club yellow', locked: true },
      '--accent': { label: 'Accent' },
    }),
  });
  return buildBoardModel(root, sys);
}

const html = (
  kind: (typeof SECTIONS)[number]['kind'],
  model: BoardModel,
  mode: 'light' | 'dark' = 'light'
) => renderToStaticMarkup(<DSSection kind={kind} model={model} mode={mode} />);

beforeEach(() => __resetBoardState());

describe('the model: sections come from the files', () => {
  test('Studio site: tokens land in their section, with words and "used in"', () => {
    const m = studio();
    const by = (css: string) => m.tokens.find((t) => t.css === css);
    expect(m.label).toBe('Studio site system');
    expect(by('--accent')?.section).toBe('colour');
    expect(by('--radius-md')?.section).toBe('space');
    expect(by('--space-4')?.section).toBe('space');
    expect(by('--shadow-sm')?.kind).toBe('shadow');
    expect(by('--font-body')?.section).toBe('type');
    expect(by('--type-base')?.section).toBe('type');
    expect(by('--weight-semibold')?.kind).toBe('weight');
    expect(by('--dur-flip')?.section).toBe('motion');
    expect(by('--ease-out')?.section).toBe('motion');
    expect(by('--x-sky')?.section).toBe('colour'); // a Tier-3 colour is typed by its value
    // the focus group holds a colour AND a length: only the colour is a swatch
    expect(by('--focus-ring')?.section).toBe('colour');
    expect(by('--focus-ring-width')?.section).toBe('space');
    expect(by('--accent')?.label).toBe('Accent');
    expect(by('--accent-hover')?.label).toBe('Accent hover'); // nobody named it: humanised
    expect(by('--accent')?.valueNames).toEqual({ light: 'Azure', dark: 'Sky' });
    expect(by('--accent')?.used).toBe(2);
    expect(by('--bg-0')?.used).toBe(1);
    expect(by('--accent-hover')?.used).toBe(0);
    expect(m.canvases).toBe(2);
    expect(m.components[0]).toMatchObject({ name: 'Button', used: 1 });
    expect(m.themes).toMatchObject({ light: 'light', dark: 'dark', default: 'light' });
  });

  test('without a usage cache "used in" is absent, never "Not used yet"', () => {
    const m = gators();
    expect(m.tokens.every((t) => t.used === null)).toBe(true);
    expect(html('colour', m)).not.toContain('Not used yet');
  });

  test('all seven sections are named with the 13 sizes', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual([
      'ds-brand',
      'ds-colour',
      'ds-type',
      'ds-space',
      'ds-motion',
      'ds-components',
      'ds-patterns',
    ]);
    expect(SECTIONS.find((s) => s.kind === 'colour')).toMatchObject({ w: 1000, h: 620 });
  });

  test('Light and Dark: the default theme can be either', () => {
    expect(modesOf(['light', 'dark'], 'dark')).toEqual({ light: 'light', dark: 'dark' });
    expect(modesOf(['day', 'night'], 'day')).toEqual({ light: 'day', dark: 'night' });
    expect(modesOf(['only'], 'only')).toEqual({ light: 'only', dark: null });
  });
});

describe('sections render from the model', () => {
  test('Colour: each swatch is Light | Dark, named in words, with where it is used', () => {
    const out = html('colour', studio());
    expect(out).toContain('data-ds-token="--accent"');
    expect(out).toContain('>Accent<');
    expect(out).toContain('Used in 2 canvases');
    expect(out).toContain('Used in 1 canvas<');
    expect(out).toContain('Not used yet');
    expect(out).toContain('Azure');
    // both halves are drawn, each in its own theme, independent of the preview mode
    expect(out).toContain('class="ds ds-chip-l" data-theme="light"');
    expect(out).toContain('class="ds ds-chip-d" data-theme="dark"');
    expect(out).toContain('background:var(--accent)');
    expect(out).toContain('data-testid="ds-section-colour"');
  });

  test('Type, Space, Motion, Components, Brand, Patterns draw their own tokens', () => {
    const m = studio();
    expect(html('type', m)).toContain('font-family:var(--font-body)');
    expect(html('type', m)).toContain('font-size:var(--type-base)');
    expect(html('type', m)).toContain('font-weight:var(--weight-semibold)');
    expect(html('space', m)).toContain('border-radius:var(--radius-md)');
    expect(html('space', m)).toContain('box-shadow:var(--shadow-sm)');
    expect(html('motion', m)).toContain('ds-curve-p'); // cubic-bezier → drawn
    expect(html('motion', m)).toContain('Hover and press'); // a duration is a card with its curve
    const comps = html('components', m);
    expect(comps).toContain('data-ds-master="Button"');
    expect(comps).toContain('class="ds-m-sample btn btn--primary"');
    expect(comps).toContain('Used in 1 canvas');
    expect(html('brand', m)).toContain('data:image/svg+xml;base64,');
    expect(html('patterns', m)).toContain('No patterns yet');
  });

  test('a condensed system shows its display face as itself', () => {
    expect(html('type', gators())).toContain('font-family:var(--font-display)');
  });

  test('no model registered and none passed → a quiet empty state, no throw', () => {
    const out = renderToStaticMarkup(<DSSection kind="colour" />);
    expect(out).toContain('No design system here');
  });

  test('the registered model is what a section renders with no props', () => {
    __registerBoardModel(studio());
    expect(renderToStaticMarkup(<DSSection kind="colour" />)).toContain('data-ds-token="--accent"');
  });
});

describe('pending edits show "as edited"', () => {
  const pend = {
    dsPending: {
      tokens: {
        '--accent': {
          light: 'oklch(0.5 0.19 255)',
          dark: 'oklch(0.6 0.175 255)',
          by: { kind: 'person', name: 'Michal' },
        },
        '--x-line': { light: '#abcdef', add: { tier: 3, type: 'color', label: 'Fine line' } },
      },
    },
  };

  test('a board-scoped <style> carries the pending values in place of the files, per theme', () => {
    const m = studio({ meta: pend });
    expect(m.pendingCount).toBe(2);
    const css = boardThemeCss(m);
    const light = css.split('\n').find((l) => l.includes('[data-ds-mode="light"]')) ?? '';
    const dark = css.split('\n').find((l) => l.includes('[data-ds-mode="dark"]')) ?? '';
    expect(light).toContain('--accent:oklch(0.5 0.19 255)');
    expect(light).not.toContain('--accent:oklch(0.55 0.2 255)'); // the file's value is replaced
    expect(dark).toContain('--accent:oklch(0.6 0.175 255)');
    expect(light).toContain('--bg-0:#ffffff'); // everything else is still the files' value
    const out = html('colour', m);
    expect(out).toContain('<style data-ds-theme="" data-ds-pending="">');
    expect(out).toContain('data-pending="true"');
    expect(out).toContain('as edited');
    // a token the edit adds appears, flagged New
    expect(out).toContain('data-ds-token="--x-line"');
    expect(out).toContain('>New<');
  });

  test("no pending → no flag and the style carries the files' values only", () => {
    const out = html('colour', studio());
    expect(out).toContain('<style data-ds-theme="">');
    expect(out).toContain('--accent:oklch(0.55 0.2 255)');
    expect(out).not.toContain('data-ds-pending');
    expect(out).not.toContain('as edited');
  });

  test("the board owns its theme: each theme's values sit at 0,3,0 scope, above the shell's follow-chrome rule", () => {
    const css = boardThemeCss(studio());
    const scope = '.ds-board[data-ds-board="studio"]';
    expect(css).toContain(`${scope}[data-ds-mode="dark"],${scope} [data-ds-mode="dark"]{`);
    expect(css).toContain('--bg-0:#101216');
    expect(css).toContain('--bg-0:#ffffff');
    // the swatch halves are inside the scope and carry the mode, so Light | Dark stay different
    const out = html('colour', studio(), 'dark');
    expect(out).toContain('data-ds-mode="light"');
    expect(out).toContain('data-ds-mode="dark"');
  });

  test('a hostile pending value never leaves its declaration', () => {
    const bad = [
      'red;}body{display:none',
      '</style><script>alert(1)</script>',
      'url(https://evil.example/x)',
      'red /* x */',
      'a\\}',
      'calc(1px',
    ];
    for (const v of bad) expect(safeCssValue(v)).toBe(false);
    const m = studio({
      meta: { dsPending: { tokens: { '--accent': { light: bad[0], dark: bad[1] } } } },
    });
    const out = html('colour', m);
    expect(out).not.toContain('body{');
    expect(out).not.toContain('display:none');
    expect(out).not.toContain('</style><script');
    expect(out).not.toContain('evil.example');
    expect(out).toContain('--accent:oklch(0.55 0.2 255)'); // the hostile value fell back to the file's
    const names = studio({
      meta: { dsPending: { tokens: { '--a}b': { light: '#fff', add: {} } } } },
    });
    expect(html('colour', names)).not.toContain('--a}b');
  });

  test('a token on its way to the Trash is flagged and not repainted', () => {
    const m = studio({
      meta: { dsPending: { tokens: { '--accent-hover': { trash: { replacement: '--accent' } } } } },
    });
    expect(boardThemeCss(m)).toContain('--accent-hover:oklch(0.5 0.2 255)');
    expect(html('colour', m)).toContain('Leaving');
  });
});

describe('the lock', () => {
  test('a frozen brand colour shows the lock; an ordinary one does not', () => {
    const m = gators();
    const brand = html('brand', m);
    expect(brand).toContain('data-locked="true"');
    expect(brand).toContain('Brand colour — locked');
    const colour = html('colour', m);
    const accent = colour.slice(colour.indexOf('data-ds-token="--accent"'));
    expect(accent.slice(0, accent.indexOf('</span></span>') + 14)).not.toContain('locked');
    expect(m.tokens.find((t) => t.css === '--brand')?.locked).toBe(true);
    expect(m.tokens.find((t) => t.css === '--accent')?.locked).toBe(false);
  });
});

describe("the system's own Dark is a section class, never the app theme", () => {
  test('Dark sets .ds-dark + the dark theme on every section; Light sets neither', () => {
    const m = studio();
    for (const s of SECTIONS) {
      const dark = html(s.kind, m, 'dark');
      expect(dark).toContain('ds-dark');
      expect(dark).toContain('data-theme="dark"');
      expect(dark).toContain(`data-testid="ds-section-${s.kind}"`);
      const light = html(s.kind, m, 'light');
      expect(light).not.toContain('ds-dark');
      expect(light).toContain('data-theme="light"');
    }
  });

  test('the club system is Dark by default: Light still shows the paper theme', () => {
    const m = gators();
    expect(m.themes).toMatchObject({ default: 'dark', light: 'light', dark: 'dark' });
    expect(html('colour', m, 'light')).toContain('class="ds ds-board gators"');
    expect(html('colour', m, 'light')).toContain('data-ds-mode="light"');
  });

  test('the mode is a preview of this canvas: it never writes the document', () => {
    const src = readFileSync(path.join(import.meta.dir, '../ds/board/state.ts'), 'utf8');
    expect(src).not.toMatch(/documentElement|classList|localStorage|sessionStorage/);
    expect(getBoardMode()).toBe('light');
    setBoardMode('dark');
    expect(getBoardMode()).toBe('dark');
    setBoardMode('sepia' as never);
    expect(getBoardMode()).toBe('dark');
    // a registered model + the stored mode drive a prop-less section
    __registerBoardModel(studio());
    expect(renderToStaticMarkup(<DSSection kind="colour" />)).toContain('ds-dark');
  });
});

describe('the bar', () => {
  test('name · Light | Dark · changes waiting', () => {
    const m = studio({ meta: { dsPending: { tokens: { '--accent': { light: '#123456' } } } } });
    const out = renderToStaticMarkup(<DsBarView model={m} mode="dark" onMode={() => {}} />);
    expect(out).toContain('Studio site system');
    expect(out).toContain('data-testid="ds-bar-mode-light" aria-pressed="false"');
    expect(out).toContain('data-testid="ds-bar-mode-dark" aria-pressed="true"');
    expect(out).toContain('1 change waiting');
    expect(out).toContain('data-testid="ds-bar"');
    expect(out).toContain('data-testid="ds-bar-pending"');
    expect(waitingWords(0)).toBeNull();
    expect(waitingWords(3)).toBe('3 changes waiting');
    expect(out).not.toContain('Review'); // S10.8 hands the bar its Review action
  });

  test('a system with one theme disables Dark', () => {
    const m = {
      ...studio(),
      themes: { all: ['light'], default: 'light', light: 'light', dark: null },
    };
    expect(renderToStaticMarkup(<DsBarView model={m} mode="light" onMode={() => {}} />)).toContain(
      'disabled'
    );
  });
});
