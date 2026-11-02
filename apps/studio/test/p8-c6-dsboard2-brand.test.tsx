// P8 C6 dsboard2 — board 13 Brand section: icons, voice, Say / not, "Rules for AI and code" drawn from the
// system's own files (assets/icons, SKILL.md), and Patterns drawn from the kept showcases the board loaded.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseBrandNotes } from '../ds/board/brand-notes.ts';
import { buildBoardModel } from '../ds/board/build-model.ts';
import { DSSection } from '../ds/board/index.tsx';
import { __registerBoardModel, __resetBoardState } from '../ds/board/state.ts';
import { systemConfigsFrom } from '../ds/system.ts';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});
beforeEach(() => __resetBoardState());

const SKILL = `---
name: x
---

# x — design-system skill

## Load-bearing rules (do not violate)

1. **Chrome floats; the canvas is the window.** All chrome is an \`.island\` (preview).
2. **Three colour roles, never mixed:** accent acts.
3. **Voice:** quiet pro with a warm touch; everyday nouns (canvas, artboard). No hype.

## Specimen shape

1. Not a rule.
`;

describe('parseBrandNotes', () => {
  test('rules are the bold lead of each numbered rule, voice is the Voice rule, nothing invented', () => {
    const n = parseBrandNotes(SKILL, '');
    expect(n.rules).toEqual([
      'Chrome floats; the canvas is the window.',
      'Three colour roles, never mixed.',
    ]);
    expect(n.voice).toBe('Quiet pro with a warm touch.');
    expect(n.say).toBeNull();
  });

  test('a Say … not … line becomes the pair', () => {
    const n = parseBrandNotes(
      '## Voice\n\nCalm, precise, unhurried.\n\n- **Say** See the work **not** Discover our amazing portfolio!\n',
      ''
    );
    expect(n.voice).toBe('Calm, precise, unhurried.');
    expect(n.say).toEqual({ say: 'See the work', not: 'Discover our amazing portfolio!' });
  });

  test('nothing to read → all empty', () => {
    expect(parseBrandNotes('', '')).toEqual({ voice: null, say: null, rules: [] });
  });
});

function system(extra: (dir: string) => void) {
  const root = mkdtempSync(path.join(tmpdir(), 'ds-brand-'));
  roots.push(root);
  const dir = path.join(root, 'system', 'x');
  mkdirSync(path.join(dir, 'preview'), { recursive: true });
  mkdirSync(path.join(dir, 'assets', 'icons'), { recursive: true });
  const config = {
    designSystems: [
      {
        name: 'x',
        path: 'system/x',
        themes: ['light', 'dark'],
        themeDefault: 'light',
        rootClass: 'ds',
      },
    ],
    defaultDesignSystem: 'x',
  };
  writeFileSync(path.join(root, 'config.json'), JSON.stringify(config));
  writeFileSync(
    path.join(dir, 'colors_and_type.css'),
    ':root,.ds[data-theme="light"]{--accent:#00f;}.ds[data-theme="dark"]{--accent:#44f;}'
  );
  writeFileSync(path.join(dir, 'tokens.json'), '{}');
  extra(dir);
  return buildBoardModel(root, systemConfigsFrom(config)[0]);
}
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M2 8h12" stroke="currentColor"/></svg>';

describe('the model reads icons + notes', () => {
  test('assets/icons become masks; SKILL.md becomes voice and rules', () => {
    const m = system((d) => {
      writeFileSync(path.join(d, 'assets', 'icons', 'add.svg'), svg);
      writeFileSync(path.join(d, 'assets', 'icons', 'bell.svg'), svg);
      writeFileSync(path.join(d, 'SKILL.md'), SKILL);
    });
    expect(m.brand.icons.map((i) => i.name)).toEqual(['add', 'bell']);
    expect(m.brand.icons[0].src).toStartWith('data:image/svg+xml;base64,');
    expect(m.brand.rules.length).toBe(2);
    expect(m.brand.voice).toBe('Quiet pro with a warm touch.');
  });
});

describe('the Brand section draws what the board draws', () => {
  const html = (m: ReturnType<typeof system>) =>
    renderToStaticMarkup(<DSSection kind="brand" model={m} mode="light" />);
  test('icons row, voice, Rules for AI and code, and the SKILL.md caption', () => {
    const m = system((d) => {
      writeFileSync(path.join(d, 'assets', 'icons', 'add.svg'), svg);
      writeFileSync(path.join(d, 'SKILL.md'), SKILL);
    });
    const out = html(m);
    expect(out).toContain('data-testid="ds-brand-icons"');
    expect(out).toContain('Quiet pro with a warm touch.');
    expect(out).toContain('Rules for AI and code');
    expect(out).toContain('Chrome floats; the canvas is the window.');
    expect(out).toContain('Written to SKILL.md');
  });
  test('a system with no icons or notes draws none of those headings', () => {
    const out = html(system(() => {}));
    expect(out).not.toContain('Rules for AI and code');
    expect(out).not.toContain('ds-brand-icons');
  });
});

describe('Patterns draws the kept showcases the board loaded', () => {
  test('no showcase → the quiet empty line stays', () => {
    const m = system(() => {});
    expect(renderToStaticMarkup(<DSSection kind="patterns" model={m} mode="light" />)).toContain(
      'No patterns yet'
    );
  });
  test('each registered showcase is a labelled, scaled live tile', () => {
    const m = system(() => {});
    __registerBoardModel(m, {
      'preview/ui_kits-desktop-showcase.tsx': () => <p>Hello showcase</p>,
    });
    const out = renderToStaticMarkup(<DSSection kind="patterns" model={m} mode="light" />);
    expect(out).toContain('data-testid="ds-pattern-tile"');
    expect(out).toContain('Desktop showcase');
    expect(out).toContain('Hello showcase');
    expect(out).not.toContain('No patterns yet');
  });
});
