// #169 item 1 — a version picture's load graph: what the capture shell preloads, and which of a
// render's requests the renderer's route handler has to see.
//
//   1. The shell preloads the runtime modules every canvas loads (comment-mount.js's static import
//      graph) and, once the server maps the shared canvas-lib, that module and ITS static imports —
//      so the browser fetches the whole graph at once instead of one import level per round trip.
//   2. The renderer routes only requests that are NOT under the capture origin through its handler;
//      Playwright continues the capture origin's own loads itself. Nothing reaches the network that
//      the handler alone would have refused (thumbs-origin.test.ts holds the end-to-end model).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { notUnder } from '../bin/_thumb-route.mjs';
import { sharedCanvasLib, withSharedCanvasLib } from '../canvas-lib-module.ts';

const STUDIO = join(import.meta.dir, '..');
const SHELL = readFileSync(
  join(STUDIO, '..', '..', 'plugins/design/templates/_shell.html'),
  'utf8'
);
const importmapOf = (html: string): Record<string, string> =>
  JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '{}').imports ?? {};
const preloadsOf = (html: string) =>
  [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1] as string);
/** Bare static imports of an ES module (never `import(…)`). */
const staticImportsOfText = (js: string) =>
  new Set(
    [...js.matchAll(/\bimport\s*(?:[\w$*{}\s,]+?\s*from\s*)?"([^"]+)"/g)].map((m) => m[1] as string)
  );

describe('the capture shell preloads the runtime graph', () => {
  test('the template preloads exactly the static graph of comment-mount.js', () => {
    const map = importmapOf(SHELL);
    // walk comment-mount → runtime bundles → their imports, through the template's own importmap
    const want = new Set<string>();
    const queue = [
      ...staticImportsOfText(readFileSync(join(STUDIO, 'dist/comment-mount.js'), 'utf8')),
    ];
    while (queue.length) {
      const spec = queue.shift() as string;
      const url = map[spec];
      if (!url || want.has(url)) continue;
      want.add(url);
      const file = join(STUDIO, 'dist/runtime', url.replace('./_canvas-runtime/', ''));
      for (const s of staticImportsOfText(readFileSync(file, 'utf8')))
        if (s !== spec) queue.push(s);
    }
    expect(want.size).toBeGreaterThan(3);
    expect(new Set(preloadsOf(SHELL))).toEqual(want);
    // after the importmap, never before it
    expect(SHELL.indexOf('rel="modulepreload"')).toBeGreaterThan(SHELL.indexOf('type="importmap"'));
  });

  test('the server adds the shared canvas-lib and the runtime packages it imports statically', async () => {
    const lib = await sharedCanvasLib();
    expect(lib.staticImports).toContain('react');
    expect(lib.staticImports).toContain('remotion');
    // a package canvas-lib only loads on demand is not preloaded
    expect(lib.staticImports).not.toContain('pixi.js');
    const out = withSharedCanvasLib(SHELL, lib.url);
    const preloads = preloadsOf(out);
    expect(preloads).toContain(lib.url);
    expect(preloads).toContain('./_canvas-runtime/remotion.js');
    expect(preloads).toContain('./_canvas-runtime/motion_react.js');
    expect(preloads.length).toBe(new Set(preloads).size);
    expect(out.indexOf(`href="${lib.url}"`)).toBeGreaterThan(out.indexOf('type="importmap"'));
  });

  test('only importmapped runtime URLs, none twice, unknown specifiers skipped', () => {
    const html =
      '<head><script type="importmap">\n{ "imports": { "react": "./_canvas-runtime/react.js", "evil": "https://x.test/a.js" } }\n</script>\n' +
      '    <link rel="modulepreload" href="./_canvas-runtime/react.js" />\n</head>';
    const lib = './_canvas-runtime/canvas-lib.0123456789abcdef.js';
    const out = withSharedCanvasLib(html, lib, ['react', 'evil', 'not-mapped']);
    expect(preloadsOf(out)).toEqual([lib, './_canvas-runtime/react.js']);
    // a build the server does not know preloads only the module itself
    expect(preloadsOf(withSharedCanvasLib(html, lib))).toEqual([lib, './_canvas-runtime/react.js']);
  });
});

describe('the renderer routes only requests off the capture origin', () => {
  const origin = 'http://127.0.0.1:5123';
  const m = notUnder(origin);

  test('the capture origin’s own loads skip the handler; everything else meets it', () => {
    for (const u of [
      `${origin}/_canvas-shell.html?canvas=ui/A.tsx`,
      `${origin}/_canvas-runtime/react.js`,
      `${origin}/.design/ui/A.tsx?sha=abc1234`,
    ])
      expect(m.test(u)).toBe(false);
    for (const u of [
      'http://127.0.0.1:51234/_api/ui-prefs', // a longer port
      'http://127.0.0.1:5123@evil.test/', // user info
      'http://localhost:5123/x', // another host name
      'https://127.0.0.1:5123/x',
      'http://127.0.0.1:4399/_canvas-shell.html', // the main origin's redirect
      `blob:${origin}/0b1c`,
      'https://example.com/',
      origin, // no path
    ])
      expect(m.test(u)).toBe(true);
  });

  test('a URL the handler is spared always has exactly the capture origin', () => {
    const urls = [
      `${origin}/a`,
      `${origin}/%2e%2e/b`,
      `${origin}//c`,
      'http://127.0.0.1:5123.evil.test/',
      'http://127.0.0.1:5123\\@evil.test/',
    ];
    for (const u of urls) if (!m.test(u)) expect(new URL(u).origin).toBe(origin);
  });

  test('anything but an http(s) origin routes every request through the handler', () => {
    for (const bad of ['', 'null', 'http://127.0.0.1:5123/', 'file:///tmp', 'javascript:1'])
      expect(notUnder(bad).test(`${origin}/x`)).toBe(true);
  });

  test('the renderer installs it as its context route', () => {
    const src = readFileSync(join(STUDIO, 'bin/_thumbs-playwright.mjs'), 'utf8');
    expect(src).toContain('ctx.route(notUnder(origin),');
    expect(src).not.toContain("ctx.route('**/*'");
  });
});
