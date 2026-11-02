// P8 C8 ds — board 13 Brand logo row: the lockup is painted from the system's own colours (an <img> SVG cannot
// read var(--accent) / currentColor) and also sits on the ink ground — an empty tile in Light, a near-black
// wordmark on a dark tile in Dark, were the two shipped faults.
import { describe, expect, test } from 'bun:test';
import { isLockup, logoTiles, paintLogo, resolveColour } from '../ds/board/logo-paint.ts';
import type { BoardModel, BoardToken } from '../ds/board/types.ts';

const WORDMARK = `<svg xmlns="http://www.w3.org/2000/svg" width="116" height="32" viewBox="0 0 116 32" fill="none">
<path d="M0 0H32V32H0Z" fill="var(--accent)"/><path d="M5 5h5" fill="var(--accent-fg)"/>
<text x="36" y="22" fill="currentColor">maude</text></svg>`;
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M0 0H32V32H0Z" fill="#0074c3"/></svg>`;
const uri = (s: string) => `data:image/svg+xml;base64,${btoa(s)}`;
const body = (src: string | null) => atob((src ?? '').split(',')[1] ?? '');

const tok = (css: string, light: string, dark: string): BoardToken =>
  ({
    css,
    section: 'colour',
    group: 'x',
    kind: 'color',
    label: css,
    valueNames: {},
    locked: false,
    darkFollows: null,
    values: { light, dark },
    used: null,
    pending: null,
  }) as BoardToken;

const model = {
  system: 'x',
  themes: { all: ['light', 'dark'], default: 'light', light: 'light', dark: 'dark' },
  tokens: [
    tok('--bg-0', '#ffffff', '#101214'),
    tok('--fg-0', '#101214', '#f4f5f6'),
    tok('--azure', '#0074c3', '#4aa3e8'),
    tok('--accent', 'var(--azure)', 'var(--azure)'),
    tok('--accent-fg', '#ffffff', '#101214'),
  ],
  logos: [
    { file: 'mark.svg', src: uri(MARK) },
    { file: 'wordmark.svg', src: uri(WORDMARK) },
  ],
} as unknown as BoardModel;

describe('the Brand logo row', () => {
  test('a lockup is the wide file; a square mark is not', () => {
    expect(isLockup('wordmark.svg', null)).toBe(true);
    expect(isLockup('x.svg', uri(WORDMARK))).toBe(true);
    expect(isLockup('mark.svg', uri(MARK))).toBe(false);
  });

  test('var() references are followed to the system value of the theme', () => {
    expect(resolveColour(model, 'light', '--accent')).toBe('#0074c3');
    expect(resolveColour(model, 'dark', '--accent')).toBe('#4aa3e8');
    expect(resolveColour(model, 'light', '--nope')).toBeNull();
  });

  test('Light: lockup on the page, the same lockup on the ink ground (light ink), then the mark', () => {
    const t = logoTiles(model, 'light');
    expect(t.map((x) => [x.file, x.onInk])).toEqual([
      ['wordmark.svg', false],
      ['wordmark.svg', true],
      ['mark.svg', false],
    ]);
    // page tile: ink = fg-0; accent painted
    expect(body(t[0].src)).toContain('fill="#0074c3"');
    expect(body(t[0].src)).toContain('fill="#101214"');
    expect(body(t[0].src)).not.toContain('var(');
    // ink tile: ground is the ink colour, the wordmark is drawn in the page colour (not invisible)
    expect(t[1].ground).toBe('#101214');
    expect(body(t[1].src)).toContain('fill="#ffffff"');
    expect(t[0].ground).toBeNull();
  });

  test('Dark: the wordmark is light on the dark page; the ink tile inverts', () => {
    const t = logoTiles(model, 'dark');
    expect(body(t[0].src)).toContain('fill="#f4f5f6"');
    expect(body(t[0].src)).toContain('fill="#4aa3e8"');
    expect(t[1].ground).toBe('#f4f5f6');
    expect(body(t[1].src)).toContain('fill="#101214"');
  });

  test('an undefined custom property falls back to its own fallback, then to the ink', () => {
    const svg =
      '<svg viewBox="0 0 8 8"><path fill="var(--gone, #123456)"/><path fill="var(--gone2)"/></svg>';
    const out = body(paintLogo(model, uri(svg), { ink: '#abcdef', theme: 'light' }));
    expect(out).toContain('fill="#123456"');
    expect(out).toContain('fill="#abcdef"');
  });

  test('a file that is not a data URI is handed back untouched', () => {
    expect(paintLogo(model, 'https://x/y.svg', { ink: '#000', theme: 'light' })).toBe(
      'https://x/y.svg'
    );
  });
});
