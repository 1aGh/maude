// The shell's first paint never waits on another origin.
//
// v2.0.0-rc.1's first launch showed Home as a white void: `client/index.html` (Home serves it too) had a
// parser-inserted `<link rel="stylesheet" href="https://fonts.googleapis.com/…">` in its <head>, and a parser-inserted
// stylesheet holds the first paint until it answers. With Google slow, first paint came when the font CSS did
// (8 s delay → first-paint at 8316 ms, measured), even though the app's own dark `styles.css` had loaded. The fonts
// now load from `client/app.jsx` (script-inserted: never render-blocking). This pins the HTML so nothing cross-origin
// can be put back on the critical path.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HTML = readFileSync(join(import.meta.dir, '..', 'client', 'index.html'), 'utf8');

const attr = (tag: string, name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1] ?? null;
const crossOrigin = (url: string | null) => !!url && /^(https?:)?\/\//i.test(url);

describe('client/index.html — the first paint waits on nothing cross-origin', () => {
  test('no stylesheet <link> from another origin', () => {
    const bad = [...HTML.matchAll(/<link\b[^>]*>/gi)]
      .map((m) => m[0])
      .filter(
        (tag) => /\bstylesheet\b/i.test(attr(tag, 'rel') ?? '') && crossOrigin(attr(tag, 'href'))
      );
    expect(bad).toEqual([]);
  });

  test('no classic or module <script src> from another origin', () => {
    const bad = [...HTML.matchAll(/<script\b[^>]*>/gi)]
      .map((m) => m[0])
      .filter((tag) => crossOrigin(attr(tag, 'src')));
    expect(bad).toEqual([]);
  });

  test('the web fonts still load — from the client, after the first paint', () => {
    const app = readFileSync(join(import.meta.dir, '..', 'client', 'app.jsx'), 'utf8');
    expect(app).toContain("fonts.rel = 'stylesheet'");
    expect(app).toContain('https://fonts.googleapis.com/css2?family=Inter');
  });
});
