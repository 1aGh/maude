// S8.1 — export file names (contract S8-export-spec.md §5.4): tokens, sanitising, the cap,
// ` (2)` dedupe, and that a name never leaves the export dir.

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import {
  createNameDeduper,
  DEFAULT_NAME_TEMPLATE,
  groupFolderName,
  joinInside,
  renderStem,
  sanitizeStem,
} from '../exporters/file-names.ts';

const DAY = new Date(2026, 9, 18, 23, 30); // local 2026-10-18

describe('renderStem', () => {
  test('every token', () => {
    const stem = renderStem('{project}|{folder}|{canvas}|{artboard}|{kind}|{size}|{scale}|{date}', {
      project: 'Alligators',
      canvas: 'ui/2026/Combine.tsx',
      artboard: 'MVP zápasu',
      kind: 'digital',
      w: 1080,
      h: 1350,
      size: { scale: 2 },
      date: DAY,
    });
    // `|` is unsafe in a file name, so the separators themselves are stripped
    expect(stem).toBe('Alligators2026CombineMVP zápasudigital1080×13502x2026-10-18');
  });

  test('the default template; dpi, paper, and the root folder is the project', () => {
    expect(
      renderStem(DEFAULT_NAME_TEMPLATE, {
        project: 'P',
        canvas: 'Flyer.tsx',
        artboard: 'Front',
        size: { dpi: 300 },
      })
    ).toBe('Flyer — Front@300dpi');
    expect(renderStem('{folder} {size}', { project: 'P', canvas: 'Flyer.tsx', paper: 'A5' })).toBe(
      'P A5'
    );
  });

  test('an unknown token stays literal; an empty one drops its separator', () => {
    expect(renderStem('{canvas} {nope}', { project: 'P', canvas: 'ui/a.tsx' })).toBe('a {nope}');
    expect(
      renderStem(DEFAULT_NAME_TEMPLATE, { project: 'P', canvas: 'ui/a.tsx', artboard: null })
    ).toBe('a@1x');
  });
});

describe('sanitizeStem', () => {
  test('strips the unsafe set and control characters, collapses whitespace', () => {
    expect(sanitizeStem('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    expect(sanitizeStem('x\u0000y\u001fz\u007f')).toBe('xyz');
    expect(sanitizeStem('  lots   of\t\nspace  ')).toBe('lots of space');
    expect(sanitizeStem(`rtl${String.fromCharCode(0x202e)}override`)).toBe('rtloverride');
  });

  test('no hidden files, never empty, capped at 120 characters', () => {
    expect(sanitizeStem('..')).toBe('export');
    expect(sanitizeStem('.env')).toBe('env');
    expect(sanitizeStem('???')).toBe('export');
    expect(sanitizeStem('x'.repeat(300))).toHaveLength(120);
  });
});

describe('dedupe + containment', () => {
  test('duplicates in one job get (2), (3) — case-insensitively', () => {
    const name = createNameDeduper();
    expect(name('Hero', 'png')).toBe('Hero.png');
    expect(name('hero', 'png')).toBe('hero (2).png');
    expect(name('Hero', 'png')).toBe('Hero (3).png');
    expect(name('Hero', 'jpg')).toBe('Hero.jpg');
    expect(name('Hero', '../png')).toBe('Hero.bin');
  });

  test('a traversal template never escapes the export dir', () => {
    const dir = '/tmp/exports/job';
    const name = createNameDeduper();
    for (const evil of ['../../etc/passwd', '..', '/abs/path', 'a/../../b', '..\\..\\win']) {
      const file = name(renderStem(evil, { project: 'P', canvas: null }), 'png');
      expect(file.includes('/') || file.includes('\\')).toBe(false);
      const full = joinInside(dir, file);
      expect(full).toBe(join(dir, file));
    }
    expect(joinInside(dir, '../x.png')).toBeNull();
    expect(joinInside(dir, '..')).toBeNull();
    expect(joinInside(dir, 'a/b.png')).toBeNull();
  });

  test('the multi-file folder is `<project> <date>`', () => {
    expect(groupFolderName('Alligators: 2026', DAY)).toBe('Alligators 2026 2026-10-18');
  });
});
