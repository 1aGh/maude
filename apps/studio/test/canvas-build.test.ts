// canvas-build.ts — Phase 3.6 Task 6. Verify the per-canvas Bun.build wrap
// produces browser-loadable ES modules that:
//   1. preserve the data-cd-id attributes injected by canvas-pipeline pass 1,
//   2. import "react" / "react/jsx-dev-runtime" as standard ESM specifiers
//      (browser resolves via importmap to /_canvas-runtime/*.js),
//   3. expose the default export so _shell.html can mount it.

import { describe, expect, test } from 'bun:test';
import { realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { buildCanvasModule } from '../canvas-build.ts';

// Bun.build resolves the entrypoint against the filesystem (its virtual-loader
// plugin only kicks in for onLoad, after onResolve has confirmed the path
// exists). Each test writes its source to a real temp file and points
// buildCanvasModule at it; the canvas-virtual-source plugin then intercepts
// the onLoad and feeds the post-pass-1 TSX.
async function writeTmp(name: string, source: string): Promise<string> {
  const abs = `/tmp/canvas-build-${name}-${Math.random().toString(36).slice(2, 8)}.tsx`;
  await Bun.write(abs, source);
  return abs;
}

describe('canvas-build / buildCanvasModule', () => {
  test('preserves data-cd-id from pass 1', async () => {
    const src =
      `import { useState } from "react";\n` +
      'export default function Demo() {\n' +
      '  const [n] = useState(0);\n' +
      `  return <button className="btn">{n}</button>;\n` +
      '}\n';
    const abs = await writeTmp('cd-id', src);
    const r = await buildCanvasModule(abs, src);
    expect(r.js).toContain('data-cd-id');
    expect(r.js).toContain('className: "btn"');
  });

  test('emits standard react JSX runtime import (no Bun-internal symbols)', async () => {
    const src = 'export default function X() { return <div />; }\n';
    const abs = await writeTmp('std-jsx', src);
    const r = await buildCanvasModule(abs, src);
    // Production-mode build uses react/jsx-runtime (the dev variant trips a
    // Bun.build rename collision with React's CJS `var React` hoist; see
    // runtime-bundle.ts comment). Accept either runtime name.
    expect(r.js).toMatch(/react\/jsx(-dev)?-runtime/);
    // The pre-3.6 Bun.Transpiler-only path emitted `jsxDEV_<hash>` /
    // `jsx_<hash>`; Bun.build uses the standard name.
    expect(r.js).not.toMatch(/jsxDEV?_[0-9a-z]{6,}/);
  });

  test('locator + etag mirror the canvas-pipeline result', async () => {
    const src =
      'export default function Y() {\n' + '  return <section><h1>hi</h1></section>;\n' + '}\n';
    const abs = await writeTmp('locator', src);
    const r = await buildCanvasModule(abs, src);
    // section + h1 = 2 JSX elements → 2 locator entries.
    expect(Object.keys(r.locator).length).toBe(2);
    expect(r.etag).toMatch(/^[0-9a-f]+$/);
  });

  test('externalises react + reactDOM (no inlined copies)', async () => {
    const src = 'export default function Z() { return <span />; }\n';
    const abs = await writeTmp('external', src);
    const r = await buildCanvasModule(abs, src);
    // ReactDOM's package signature; the canvas bundle must NOT contain it,
    // or the runtime singleton invariant breaks (two React copies).
    expect(r.js).not.toContain('ReactCurrentOwner');
    // jsx-runtime stays external too — the canvas should import jsxDEV via
    // a normal specifier, not redefine it.
    expect(r.js).not.toContain('function jsxDEV(');
  });

  test('exposes a default export', async () => {
    const src = 'export default function Q() { return <i />; }\n';
    const abs = await writeTmp('default', src);
    const r = await buildCanvasModule(abs, src);
    expect(r.js).toMatch(/export\s*\{[\s\S]*default[\s\S]*\}/);
  });
});

// Spike finding M9 (studyfi-design AWS run, 2026-08-20) — the sandbox's import
// allowlist rejected `data:` URIs. Bundled CSS runs every `url()` through
// onResolve, and `url("data:image/svg+xml,…")` is the standard idiom for
// grain, textures and tiny inline icons — it is neither relative nor absolute,
// so the bare-specifier branch denied it with the npm-packages message. A
// design system's always-on film-grain took every canvas build down; the
// sandbox exists to stop NETWORK reads, and a data: URI never makes one.
describe('canvas-build / sandbox scheme handling (M9)', () => {
  const GRAIN =
    `.grain {\n` +
    `  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise'/%3E%3C/filter%3E%3C/svg%3E");\n` +
    `}\n`;

  // REALPATH, not `/tmp` — on macOS `/tmp` is a symlink to `/private/tmp`, and
  // Bun reports importers by their real path. A root captured through the
  // symlink never matches, the allowlist silently disarms (returns null → the
  // native resolver), and every "denied" assertion here would be testing
  // nothing. Discovered by this very suite going green for the wrong reason.
  //
  // RESOLVED, not hardcoded. The first fix wrote `/private/tmp` literally —
  // macOS's answer to this question, baked in — so on Linux, where that path
  // does not exist, all three tests died in `Bun.write` with ENOENT before
  // reaching a single assertion. Green for the wrong reason on one platform,
  // red for an unrelated reason on the other. `realpathSync(tmpdir())` asks the
  // OS instead: `/tmp` on Linux, `/private/var/folders/…` on macOS, symlink
  // already resolved on both, which is the only property the sandbox needs.
  const TMP_REAL = realpathSync(tmpdir());

  async function tmpProject(): Promise<{ dir: string; abs: string; src: string }> {
    const dir = `${TMP_REAL}/canvas-build-m9-${Math.random().toString(36).slice(2, 8)}`;
    await Bun.write(`${dir}/style.css`, GRAIN);
    const src = `import "./style.css";\nexport default function G() { return <div className="grain" />; }\n`;
    const abs = `${dir}/canvas.tsx`;
    await Bun.write(abs, src);
    return { dir, abs, src };
  }

  test('a data: URI inside bundled CSS survives the ARMED sandbox', async () => {
    const { dir, abs, src } = await tmpProject();
    const r = await buildCanvasModule(abs, src, { restrictImportsTo: dir });
    expect(r.js).toContain('data:image/svg+xml');
  });

  test('the sandbox still denies a bare npm specifier — the scheme pass-through is not a hole', async () => {
    const dir = `${TMP_REAL}/canvas-build-m9-deny-${Math.random().toString(36).slice(2, 8)}`;
    const src = `import x from "left-pad";\nexport default function D() { return <i>{x}</i>; }\n`;
    const abs = `${dir}/canvas.tsx`;
    await Bun.write(abs, src);
    await expect(buildCanvasModule(abs, src, { restrictImportsTo: dir })).rejects.toThrow(
      /not available when it renders in a browser/
    );
  });

  test('an http(s) @import is still refused by the armed sandbox — only non-network schemes pass', async () => {
    // The spike's original fontshare failure was exactly this shape: an
    // `@import url(https://…)` is a BUILD-TIME network fetch, so the sandbox
    // must keep refusing it even now that data:/blob: pass. (A plain
    // `url(https://…)` image reference never reaches onResolve — Bun's CSS
    // loader leaves it external for the browser, where the cell CSP owns it.)
    const dir = `${TMP_REAL}/canvas-build-m9-http-${Math.random().toString(36).slice(2, 8)}`;
    await Bun.write(
      `${dir}/style.css`,
      `@import url("https://api.fontshare.com/v2/css?f=x");\n.x { color: red; }\n`
    );
    const src = `import "./style.css";\nexport default function H() { return <div className="x" />; }\n`;
    const abs = `${dir}/canvas.tsx`;
    await Bun.write(abs, src);
    await expect(buildCanvasModule(abs, src, { restrictImportsTo: dir })).rejects.toThrow(
      /not available when it renders in a browser/
    );
  });
});

// Plan T31/L16 — a stylesheet imported from elsewhere in the design root (a
// design system's tokens) is inlined like a sibling one. The injected tag names
// what it inlined so the open canvas can reload when it changes, and a
// re-import (the soft reload) replaces the text instead of keeping the first.
describe('inlined stylesheets name their sources and refresh on re-import', () => {
  const REAL = realpathSync(tmpdir());
  test('a relative CSS import from another folder is recorded on the style tag', async () => {
    const root = `${REAL}/canvas-build-css-${Math.random().toString(36).slice(2, 8)}`;
    await Bun.write(`${root}/system/ds/tokens.css`, ':root { --accent: rgb(1, 2, 3); }\n');
    const src = `import "../system/ds/tokens.css";\nexport default function T() { return <h1>T</h1>; }\n`;
    const abs = `${root}/ui/T.tsx`;
    await Bun.write(abs, src);
    const r = await buildCanvasModule(abs, src, { designRoot: root, restrictImportsTo: root });
    expect(r.js).toContain('canvasCssSources="system/ds/tokens.css"');
    // Re-running the injector replaces the text rather than keeping the first.
    expect(r.js).toContain('if(s.textContent!==');
    expect(r.js).not.toContain('if(document.getElementById(');
  });

  test('a design root reached through a symlink still names its sources', async () => {
    // macOS keeps every temp dir under `/var` → `/private/var`; the bundler
    // reports importers by their real path, and every source was dropped.
    const real = `${REAL}/canvas-build-css-real-${Math.random().toString(36).slice(2, 8)}`;
    const link = `${REAL}/canvas-build-css-link-${Math.random().toString(36).slice(2, 8)}`;
    await Bun.write(`${real}/system/ds/tokens.css`, ':root { --accent: rgb(1, 2, 3); }\n');
    const src = `import "../system/ds/tokens.css";\nexport default function T() { return <h1>T</h1>; }\n`;
    await Bun.write(`${real}/ui/T.tsx`, src);
    symlinkSync(real, link);
    const r = await buildCanvasModule(`${link}/ui/T.tsx`, src, {
      designRoot: link,
      restrictImportsTo: link,
    });
    expect(r.js).toContain('canvasCssSources="system/ds/tokens.css"');
  });
});

// Security review of #145 (attacker F1). The allowlist waved through any
// importer outside the design root as "our own module". The bundler reports
// importers by REAL path, so behind a symlinked root (macOS `/var`, a symlinked
// `~/git`, and on Windows a `subst` drive, junction or drive-letter case
// mismatch) every canvas file looked foreign and could import anything on disk.
describe('canvas-build / import allowlist through a symlinked design root', () => {
  const REAL = realpathSync(tmpdir());
  async function linkedRoot() {
    const id = Math.random().toString(36).slice(2, 8);
    const base = `${REAL}/canvas-build-allow-${id}`;
    const real = `${base}/real/.design`;
    const link = `${base}/link`;
    await Bun.write(`${base}/real/secret.txt`, 'TOP-SECRET-145\n');
    await Bun.write(`${real}/ui/keep.txt`, 'inside\n');
    symlinkSync(real, link);
    return { real, link };
  }

  test('a relative import out of the root is denied', async () => {
    const { real, link } = await linkedRoot();
    const src = `import s from "../../secret.txt" with { type: "text" };\nexport default function X() { return <pre>{s}</pre>; }\n`;
    await Bun.write(`${real}/ui/x.tsx`, src);
    await expect(
      buildCanvasModule(`${link}/ui/x.tsx`, src, { designRoot: link, restrictImportsTo: link })
    ).rejects.toThrow(/outside the project/);
  });

  test('an absolute import out of the root is denied', async () => {
    const { real, link } = await linkedRoot();
    const secret = `${real}/../secret.txt`;
    const src = `import s from ${JSON.stringify(secret)} with { type: "text" };\nexport default function X() { return <pre>{s}</pre>; }\n`;
    await Bun.write(`${real}/ui/x.tsx`, src);
    await expect(
      buildCanvasModule(`${link}/ui/x.tsx`, src, { designRoot: link, restrictImportsTo: link })
    ).rejects.toThrow(/outside the project/);
  });

  test('a symlink inside the root that points out is judged by where it points (attacker N1)', async () => {
    const { real, link } = await linkedRoot();
    symlinkSync(`${real}/..`, `${real}/ui/dirlink`);
    const src = `import s from "./dirlink/secret.txt" with { type: "text" };\nexport default function X() { return <pre>{s}</pre>; }\n`;
    await Bun.write(`${real}/ui/x.tsx`, src);
    await expect(
      buildCanvasModule(`${link}/ui/x.tsx`, src, { designRoot: link, restrictImportsTo: link })
    ).rejects.toThrow(/outside the project/);
  });

  test('an import inside the root still builds', async () => {
    const { real, link } = await linkedRoot();
    const src = `import s from "./keep.txt" with { type: "text" };\nexport default function X() { return <pre>{s}</pre>; }\n`;
    await Bun.write(`${real}/ui/x.tsx`, src);
    const r = await buildCanvasModule(`${link}/ui/x.tsx`, src, {
      designRoot: link,
      restrictImportsTo: link,
    });
    expect(r.js).toContain('inside');
  });
});

// Cell materializer Task 9. On a cell the disk is a cache — a photo a
// stylesheet references may be in the bucket and not on disk — and a bundler
// read of it made ONE missing file fail the whole canvas ("Could not
// resolve"). Separately, Bun emits a large url() as a hashed `./name-<hash>`
// output nothing serves. `assetUrlBase` rewrites url() onto the static route.
describe('canvas-build / CSS url() onto the served design root', () => {
  async function fixture(css: Record<string, string>, files: Record<string, string> = {}) {
    const root = realpathSync(
      await import('node:fs').then((fs) => fs.mkdtempSync(`${tmpdir()}/cb-url-`))
    );
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const put = (rel: string, body: string) => {
      mkdirSync(`${root}/${rel.split('/').slice(0, -1).join('/')}`, { recursive: true });
      writeFileSync(`${root}/${rel}`, body);
    };
    for (const [rel, body] of Object.entries({ ...css, ...files })) put(rel, body);
    const src = `import './c.css';\nexport default () => <div className="a" />;\n`;
    put('ui/c.tsx', src);
    return { root, abs: `${root}/ui/c.tsx`, src };
  }

  test('a url() to a file NOT on disk no longer fails the canvas', async () => {
    const { root, abs, src } = await fixture({
      'ui/c.css': '.a { background: url("../system/ds/assets/gone.jpg?v=2"); }\n',
    });
    const r = await buildCanvasModule(abs, src, {
      designRoot: root,
      restrictImportsTo: root,
      assetUrlBase: '/.design',
    });
    expect(r.js).toContain('url(\\"/.design/system/ds/assets/gone.jpg?v=2\\")');
  });

  test('…while without assetUrlBase the old behaviour stands (it fails)', async () => {
    const { root, abs, src } = await fixture({
      'ui/c.css': '.a { background: url("../system/ds/assets/gone.jpg"); }\n',
    });
    await expect(
      buildCanvasModule(abs, src, { designRoot: root, restrictImportsTo: root })
    ).rejects.toThrow(/Could not resolve/);
  });

  test('a url() in an @imported stylesheet resolves against THAT stylesheet', async () => {
    // The inlined <style> resolves relative urls against the iframe document,
    // so a DS stylesheet's `./fonts/a.woff2` must be made absolute from where
    // it was written, not from the canvas.
    const { root, abs, src } = await fixture(
      {
        'ui/c.css': "@import '../system/ds/tokens.css';\n.a { color: red; }\n",
        'system/ds/tokens.css':
          '@font-face { font-family: X; src: url(./fonts/a b.woff2) format("woff2"); }\n',
      },
      { 'system/ds/fonts/a b.woff2': 'WOFF' }
    );
    const r = await buildCanvasModule(abs, src, {
      designRoot: root,
      restrictImportsTo: root,
      assetUrlBase: '/.design',
    });
    expect(r.js).toContain('/.design/system/ds/fonts/a%20b.woff2');
    expect(r.js).not.toContain('data:font');
  });

  test('data: urls are untouched, and a url outside the root is still the allowlist’s', async () => {
    const { root, abs, src } = await fixture({
      'ui/c.css':
        '.a { background: url("data:image/svg+xml,%3Csvg%3E%3C/svg%3E"); }\n' +
        '.b { background: url("../../outside.png"); }\n',
    });
    await expect(
      buildCanvasModule(abs, src, {
        designRoot: root,
        restrictImportsTo: root,
        assetUrlBase: '/.design',
      })
    ).rejects.toThrow(/outside the project/);
  });
});
