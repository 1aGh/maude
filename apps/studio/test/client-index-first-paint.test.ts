// The shell's first paint never waits on another origin — and the app chrome never reaches Google Fonts at all.
//
// v2.0.0-rc.1's first launch showed Home as a white void: `client/index.html` (Home serves it too) had a
// parser-inserted `<link rel="stylesheet" href="https://fonts.googleapis.com/…">` in its <head>, and a parser-inserted
// stylesheet holds the first paint until it answers. With Google slow, first paint came when the font CSS did
// (8 s delay → first-paint at 8316 ms, measured), even though the app's own dark `styles.css` had loaded. The first
// fix moved the link into `client/app.jsx`; #175 item 4 then removed Google entirely (privacy, offline): Inter,
// Inter Tight and JetBrains Mono are self-hosted woff2 under `client/fonts/` (SIL OFL 1.1, licence beside them) and
// declared by `client/styles/fonts.css` with `font-display: swap`. This pins the HTML and the sources so nothing
// cross-origin can be put back on the critical path. Canvases' own DS fonts are out of scope.

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const HTML = readFileSync(join(ROOT, 'client', 'index.html'), 'utf8');

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

  test('the client no longer inserts a font stylesheet', () => {
    const app = readFileSync(join(ROOT, 'client', 'app.jsx'), 'utf8');
    expect(app).not.toContain("fonts.rel = 'stylesheet'");
    expect(app).not.toMatch(/createElement\(['"]link['"]\)/);
  });
});

const SHELL_FILES = [
  'client/index.html',
  'client/app.jsx',
  '../desktop/src/index.html',
  '../desktop/src/strip.html',
  '../desktop/src/root-missing.html',
  '../desktop/src/main.js',
  '../desktop/src/strip.js',
  '../desktop/src/styles.css',
  ...readdirSync(join(ROOT, 'client', 'styles'))
    .filter((f) => f.endsWith('.css'))
    .map((f) => `client/styles/${f}`),
];

describe('the app chrome never reaches Google Fonts (#175 item 4)', () => {
  test('no shipped shell file names fonts.googleapis.com or fonts.gstatic.com', () => {
    const hits = SHELL_FILES.filter((f) =>
      /fonts\.(googleapis|gstatic)\.com/i.test(readFileSync(join(ROOT, f), 'utf8'))
    );
    expect(hits).toEqual([]);
  });

  test('the bundled stylesheet declares the three families from the app origin, and the files exist', async () => {
    const { bundle } = await import('lightningcss');
    const { code } = bundle({ filename: join(ROOT, 'client', 'styles', '_index.css') });
    const css = new TextDecoder().decode(code);
    expect(css).not.toMatch(/fonts\.(googleapis|gstatic)\.com/i);
    for (const family of ['Inter', 'Inter Tight', 'JetBrains Mono']) {
      expect(css).toMatch(new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*"?${family}"?\\s*;`));
    }
    expect(css).toMatch(/font-display:\s*swap/);
    const urls = [...css.matchAll(/url\("?(\/_client\/fonts\/[^")]+\.woff2)"?\)/g)].map(
      (m) => m[1]
    );
    expect(urls.length).toBeGreaterThanOrEqual(6);
    for (const u of urls)
      expect(existsSync(join(ROOT, 'client', u.slice('/_client/'.length)))).toBe(true);
  });

  test('every declared font file is answered by the same-origin /_client/ lane as font/woff2', async () => {
    const { serveClientAsset } = await import('../static-lane.ts');
    const css = readFileSync(join(ROOT, 'client', 'styles', 'fonts.css'), 'utf8');
    const rels = [...css.matchAll(/url\("\/_client\/(fonts\/[^"]+\.woff2)"\)/g)].map((m) => m[1]);
    expect(rels.length).toBe(6);
    for (const rel of rels) {
      const res = await serveClientAsset(rel);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('font/woff2');
    }
  });

  test('the SIL Open Font Licence ships beside the fonts, one per family', () => {
    for (const lic of ['Inter', 'Inter-Tight', 'JetBrains-Mono']) {
      const text = readFileSync(join(ROOT, 'client', 'fonts', `LICENSE-${lic}.txt`), 'utf8');
      expect(text).toContain('SIL OPEN FONT LICENSE Version 1.1');
    }
  });
});
