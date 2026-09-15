// The canvas shell under a based origin — Cloud Phase 27 (DDR-209).
//
// The fleet's canvas origin puts the project in the PATH:
// `canvas.<zone>/<project>/_canvas-shell.html`. Every URL the shell builds must
// therefore hang off the path it was SERVED from, not off the origin root —
// otherwise the browser asks for `canvas.<zone>/.design/…`, the data plane reads
// `.design` as a project name, and every dynamic import fails with
// "Failed to fetch dynamically imported module".
//
// Two mechanisms, because the shell has two kinds of URL and only one of them
// can be built at runtime:
//
//   built by JS        → `withCap()` prefixes the derived base.
//   the IMPORTMAP      → cannot be: it must be static and present before any
//                        module loads, and the server cannot rewrite it either
//                        (the data plane strips the project segment before the
//                        request arrives, so only the browser knows the base).
//                        Importmap addresses resolve against the DOCUMENT's base
//                        URL, so `./` gets it for free.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SHELL = readFileSync(
  join(import.meta.dir, '..', '..', '..', 'plugins', 'design', 'templates', '_shell.html'),
  'utf8'
);

/** The shell's own derivation, mirrored so the test breaks when it changes. */
const baseOf = (pathname: string) => pathname.replace(/\/_canvas-shell(\.html)?$/, '');

describe('the canvas shell hangs off the path it was served from', () => {
  test('the base is derived from location, and is empty at the origin root', () => {
    expect(baseOf('/alligators/_canvas-shell.html')).toBe('/alligators');
    expect(baseOf('/alligators/_canvas-shell')).toBe('/alligators');
    expect(baseOf('/_canvas-shell.html')).toBe('');
    expect(baseOf('/_canvas-shell')).toBe('');
    expect(SHELL).toContain("location.pathname.replace(/\\/_canvas-shell(\\.html)?$/, '')");
  });

  test('NO importmap entry is origin-absolute', () => {
    // `"/_canvas-runtime/react.js"` resolves against the origin and drops the
    // project. This is the one that cannot be fixed at runtime, so it is the one
    // most worth pinning.
    expect(SHELL).not.toContain('"/_canvas-runtime/');
    expect(SHELL).toContain('"./_canvas-runtime/');
  });

  test('a relative importmap address resolves under the project, and at the root', () => {
    // The actual browser rule, exercised rather than asserted.
    expect(
      new URL(
        './_canvas-runtime/react.js',
        'https://canvas.cloud.maude.sh/alligators/_canvas-shell.html?t=x'
      ).href
    ).toBe('https://canvas.cloud.maude.sh/alligators/_canvas-runtime/react.js');
    expect(
      new URL('./_canvas-runtime/react.js', 'http://localhost:4399/_canvas-shell.html').href
    ).toBe('http://localhost:4399/_canvas-runtime/react.js');
  });

  test('withCap prefixes the base AND carries the capability', () => {
    const base = '/alligators';
    const cap = 'cap-1';
    const withCap = (u: string) => {
      const abs = u.startsWith('/') ? base + u : u;
      return cap ? abs + (abs.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(cap) : abs;
    };
    expect(withCap('/.design/ui/Home.tsx')).toBe('/alligators/.design/ui/Home.tsx?t=cap-1');
    expect(withCap('/_api/canvas-meta?file=x')).toBe('/alligators/_api/canvas-meta?file=x&t=cap-1');
    expect(SHELL).toContain("const abs = u.startsWith('/') ? base + u : u;");
  });

  test('EVERY absolute URL the shell requests goes through the base', () => {
    // The systematic version of the three separate bugs this file records. Each
    // was one absolute path that nobody had thought about: the module, then the
    // importmap, then `comment-mount.js` — and the last one aborted the mount
    // outright, because it is imported in the same `Promise.all` as the canvas.
    //
    // So this asserts the SHAPE rather than a list: nothing in the shell may
    // form a request from an origin-absolute literal.
    const offenders: string[] = [];
    for (const re of [
      /import\(\s*['"`]\//g, //  import('/…')
      /fetch\(\s*['"`]\//g, //   fetch('/…')
      /\.href\s*=\s*['"`]\//g, // el.href = '/…'
      /\.src\s*=\s*['"`]\//g, //  el.src  = '/…'
      /location\.host\s*\+\s*['"`]\//g, // ws://host + '/…'
    ]) {
      for (const m of SHELL.matchAll(re)) offenders.push(m[0].trim());
    }
    expect(offenders).toEqual([]);
  });

  test('the URLs that DO appear are the ones withCap builds', () => {
    // Belt to the brace above: the four paths the shell legitimately names must
    // each be reachable only through `withCap`.
    for (const path of ['/_client/comment-mount.js', '/_api/canvas-meta']) {
      const at = SHELL.indexOf(path);
      expect(at).toBeGreaterThan(0);
      // `withCap(` appears within the same expression, before the literal.
      const before = SHELL.slice(Math.max(0, at - 120), at);
      expect(before).toContain('withCap(');
    }
  });
});

// The capability expires; an open canvas is handed a fresh one by its parent.
describe('a re-minted capability reaches an open canvas', () => {
  const handler = SHELL.slice(SHELL.indexOf("m.dgn === 'canvas-cap'"));
  test('only from the parent, only a well-formed token, only where one was issued', () => {
    // Inside the parent-gated listener (the same gate as apply-style).
    expect(SHELL.indexOf("m.dgn === 'canvas-cap'")).toBeGreaterThan(
      SHELL.indexOf('if (e.source !== window.parent || window.parent === window) return;')
    );
    expect(handler).toContain('if (!cap ||');
    expect(handler).toContain('/^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/.test(t)');
  });
  test('every later URL carries it, and the shell document re-plants the cookie', () => {
    expect(SHELL).toContain("let cap = params.get('t') || '';");
    expect(handler).toContain('canvasUrl = withCap(');
    expect(handler).toContain("fetch(withCap('/_canvas-shell.html')");
  });
});

// Plan T31/L16 — every design system has a `tokens.css`. The css HMR branch
// matched links by FILE NAME, so a canvas's imported `system/a/tokens.css`
// "matched" the shell's link to `system/b/tokens.css`, swapped the wrong
// sheet, and never reloaded the inlined one: the canvas never restyled.
describe('a stylesheet change is matched by path', () => {
  const cssBranch = SHELL.slice(
    SHELL.indexOf("if (msg.mode === 'css') {"),
    SHELL.indexOf("} else if (msg.mode === 'module' || msg.mode === 'hard') {")
  );
  test('never by the bare file name', () => {
    expect(cssBranch).not.toContain(".split('/').pop()");
    expect(cssBranch).not.toContain('href.includes(');
    expect(cssBranch).toContain('linkPath.endsWith(changed)');
  });
  test('an inlined import it names is re-imported', () => {
    expect(cssBranch).toContain('dataset.canvasCssSources');
    expect(cssBranch).toContain('softReload(v)');
  });
});
