// Phase 8 · stage C round 3 — the Design system board draws the SPECIMEN, not the token file (13 · ds-board-*).
// Hand-built model: the sections' markup is what is pinned here, not the model builder.
import { afterEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DSSection } from '../ds/board/index.tsx';
import { __resetBoardState } from '../ds/board/state.ts';
import type { BoardComponent, BoardModel, BoardToken, SectionKind } from '../ds/board/types.ts';

afterEach(__resetBoardState);

const tok = (
  css: string,
  section: SectionKind,
  group: string,
  kind: BoardToken['kind'],
  light: string,
  dark?: string,
  label?: string
): BoardToken => ({
  css,
  section,
  group,
  kind,
  label:
    label ??
    css
      .replace(/^--/, '')
      .replace(/-/g, ' ')
      .replace(/^./, (c) => c.toUpperCase()),
  valueNames: {},
  locked: false,
  darkFollows: null,
  values: dark ? { light, dark } : { light },
  used: null,
  pending: null,
});

const button: BoardComponent = {
  name: 'Button',
  label: 'Button',
  className: 'btn',
  variants: [
    { name: 'Primary', class: 'btn--primary' },
    { name: 'Ghost', class: 'btn--ghost' },
  ],
  sizes: [{ name: 'sm', class: 'btn--sm' }],
  used: 3,
  pending: false,
  specimen: null,
  states: ['hover', 'active', 'disabled'],
  look: {},
  patches: [],
};

function model(over: Partial<BoardModel> = {}): BoardModel {
  const c = (css: string, group: string, a: string, b: string) =>
    tok(css, 'colour', group, 'color', a, b);
  return {
    format: 'maude.ds-board',
    v: 1,
    system: 'studio',
    label: 'Studio site',
    rootClass: 'studio',
    themes: { all: ['light', 'dark'], default: 'light', light: 'light', dark: 'dark' },
    converted: true,
    tokens: [
      // declared in the FILE's order — accent first, surfaces last: the board reads them by role
      c('--accent', 'accent', '#0066cc', '#3399ff'),
      c('--accent-fg', 'accent', '#ffffff', '#001133'),
      c('--status-ok', 'status', '#118833', '#33bb66'),
      c('--fg-0', 'text', '#111111', '#f4f4f4'),
      c('--fg-3', 'text', '#777777', '#999999'),
      c('--bg-0', 'surfaces', '#ffffff', '#101114'),
      c('--bg-1', 'surfaces', '#f5f6f8', '#181a1f'),
      tok('--font-body', 'type', 'font', 'font', 'Inter, sans-serif'),
      tok('--type-2xl', 'type', 'size', 'length', '29px'),
      tok('--type-base', 'type', 'size', 'length', '14px'),
      tok('--weight-semibold', 'type', 'weight', 'weight', '600'),
      tok('--radius-lg', 'space', 'radius', 'length', '14px'),
      tok('--radius-sm', 'space', 'radius', 'length', '6px'),
      tok('--radius-pill', 'space', 'radius', 'length', '999px'),
      tok('--space-4', 'space', 'space', 'length', '16px'),
      tok('--space-1', 'space', 'space', 'length', '4px'),
      tok('--dur-panel', 'motion', 'motion', 'duration', '220ms'),
      tok('--dur-flip', 'motion', 'motion', 'duration', '120ms'),
      tok('--ease-out', 'motion', 'motion', 'easing', 'cubic-bezier(0.2, 0.8, 0.2, 1)'),
    ],
    typeRoles: [
      {
        role: 'title',
        class: 't-title',
        style: {
          'font-size': 'var(--type-2xl)',
          'font-weight': 'var(--weight-semibold)',
          'font-family': 'var(--font-display)',
        },
      },
      {
        role: 'body',
        class: 't-body',
        style: { 'font-size': 'var(--type-base)', 'font-weight': 'var(--weight-regular)' },
      },
    ],
    components: [button],
    stateRules: [],
    logos: [],
    pendingCount: 0,
    canvases: 5,
    ...over,
  };
}

const html = (kind: SectionKind, m = model()) =>
  renderToStaticMarkup(<DSSection kind={kind} model={m} mode="light" />);

describe('Brand', () => {
  test('opens with the hero: a glyph tile, the name and one line saying what the system holds', () => {
    const out = html('brand');
    expect(out).toContain('data-testid="ds-hero"');
    expect(out).toContain('Design system <span>Studio site</span>');
    expect(out).toContain(
      '7 sections · 7 colours, each with a Light and a Dark value · 2 type styles · 1 component with their states · used by 5 canvases'
    );
  });
});

describe('Colour', () => {
  test('reads by role — surfaces and text before the accent — not in the file’s order', () => {
    const out = html('colour');
    const at = (g: string) => out.indexOf(`data-ds-group="${g}"`);
    expect(at('surfaces')).toBeGreaterThan(-1);
    expect(at('surfaces')).toBeLessThan(at('text'));
    expect(at('text')).toBeLessThan(at('accent'));
    expect(at('accent')).toBeLessThan(at('status'));
    // two groups to a row
    expect(out).toContain('class="ds-swrow"');
  });

  test('draws "Text on surfaces" as Aa pairs with the ratio in Light | Dark', () => {
    const out = html('colour');
    expect(out).toContain('Text on surfaces — contrast, Light | Dark');
    expect(out).toContain('Fg 0 on Bg 0');
    expect(out).toMatch(/18\.\d \| 1\d\.\d/);
    // Fg 3 on Bg 0 needs 3 and holds it in Light; the pair that fails says so
    expect(out).toContain('Fg 3 on Bg 0');
  });
});

describe('Type', () => {
  test('draws each ROLE as a real sentence in its own look, with its size and weight beside the name', () => {
    const out = html('type');
    expect(out).toContain('Calm, careful software.');
    expect(out).toContain('class="ds-tsample t-title"');
    expect(out).toContain('font-size:var(--type-2xl)');
    expect(out).toContain('<b>Title</b><em>29 · Semibold</em>');
    // the families come last, as themselves
    expect(out).toContain('font-family:var(--font-body)');
    // a role row edits the size it is set in
    expect(out).toContain('data-ds-token="--type-2xl"');
  });
});

describe('Space & shape', () => {
  test('lists corners and spacing smallest first and draws the 12-column layout grid', () => {
    const out = html('space');
    expect(out.indexOf('Sm')).toBeLessThan(out.indexOf('Lg'));
    expect(out.indexOf('Lg')).toBeLessThan(out.indexOf('Pill'));
    expect(out).toContain('∞');
    expect(out.indexOf('data-ds-token="--space-1"')).toBeLessThan(
      out.indexOf('data-ds-token="--space-4"')
    );
    expect(out).toContain('class="ds-grid"');
    expect((out.match(/<i><\/i>/g) ?? []).length).toBeGreaterThanOrEqual(12);
  });
});

describe('Motion', () => {
  test('is cards: each duration with the curve it moves on, its name and what it is for', () => {
    const out = html('motion');
    expect(out).toContain('class="ds-curve"');
    expect(out.indexOf('Flip')).toBeLessThan(out.indexOf('Panel')); // fastest first
    expect(out).toContain('Hover and press');
    expect(out).toContain('Menus and panels');
  });
});

describe('Components', () => {
  test('a master is a grid: a row per variant, a column per state, then the sizes', () => {
    const out = html('components');
    expect(out).toContain('class="ds-var"');
    for (const w of ['Default', 'Hover', 'Pressed', 'Disabled'])
      expect(out).toContain(`<span class="ds-var-h">${w}</span>`);
    expect(out).toContain('ds-m-sample btn btn--primary ds-force-hover');
    expect(out).toContain('ds-m-sample btn btn--ghost ds-force-disabled');
    expect(out).toContain('Sizes');
  });
});
