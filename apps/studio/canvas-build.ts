// Browser-loadable canvas bundle (DDR-019, Phase 3.6 Task 6).
//
// The pre-3.6 pipeline (canvas-pipeline.ts) parses the TSX, injects data-cd-id,
// then lowers JSX via Bun.Transpiler. Output is JS but uses Bun-runtime-internal
// `jsxDEV_<hash>` symbol names — not browser-loadable.
//
// This module wraps that pipeline with a second pass through Bun.build, which
// resolves the JSX runtime against the canonical "react/jsx-dev-runtime" import
// and externalises React + ReactDOM. Output is standard ES module text. The
// browser loads it via the runtime importmap declared in _shell.html.
//
// The two-stage approach is deliberate:
//
//   1. canvas-pipeline.ts (oxc + magic-string) — owns identity. Pre-orders JSX
//      elements, injects data-cd-id, writes _locator.json. Pure + fast.
//   2. canvas-build.ts (Bun.build) — owns module shape. Feeds the post-pass-1
//      source to Bun.build via a virtual-loader plugin, so the bundler
//      processes our edited source (not the on-disk file). Externalises every
//      runtime package the importmap covers.
//
// Caller (http.ts) reads the canvas source, calls buildCanvasModule(), then
// serves the resulting JS at /<designRel>/ui/<slug>.tsx with Content-Type
// `application/javascript`.

import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { canvasLibPath, canvasLibResolver } from './canvas-lib-resolver.ts';
import { transpileCanvasSource } from './canvas-pipeline.ts';
import type { LocatorMap } from './locator.ts';
import { RUNTIME_PACKAGES } from './runtime-bundle.ts';

// Sanity-check the dev-server-bundled canvas-lib once per process boot. If the
// install is corrupt (file missing), surface that before the first canvas build
// — Bun.build's plugin throws collapse to a useless "Bundle failed" string.
let canvasLibPresenceVerified = false;
function verifyCanvasLibPresence(): void {
  if (canvasLibPresenceVerified) return;
  const target = canvasLibPath();
  if (!existsSync(target)) {
    throw new Error(
      `[@maude/canvas-lib] canvas library missing at ${target} — dev-server install is corrupt; re-install @1agh/maude.`
    );
  }
  canvasLibPresenceVerified = true;
}

// Per DDR-025, canvas-lib now ships with the dev-server. Downstream projects
// with a legacy `<designRoot>/_lib/canvas-lib.tsx` from a pre-4.0.5 setup get a
// single deprecation warning per dev-server process — the project file is
// ignored, the dev-server-bundled lib is authoritative.
const loggedLegacyForRoot = new Set<string>();
function warnLegacyDesignLib(designRoot: string): void {
  if (loggedLegacyForRoot.has(designRoot)) return;
  loggedLegacyForRoot.add(designRoot);
  const legacy = path.join(designRoot, '_lib', 'canvas-lib.tsx');
  if (existsSync(legacy)) {
    console.warn(
      `[canvas-lib] Legacy ${legacy} detected. As of v0.15.0, canvas-lib ships with the dev-server install — the project file is ignored and can be deleted. See DDR-025 for the migration rationale.`
    );
  }
}

export interface CanvasBundleResult {
  /** Browser-loadable ES module text. */
  js: string;
  /** data-cd-id → source location map (same as the pipeline emits). */
  locator: LocatorMap;
  /** Content-derived hash; suitable as HTTP ETag. */
  etag: string;
}

export interface BuildCanvasOptions {
  /**
   * Absolute path to the design root. Per DDR-025 canvas-lib is dev-server
   * bundled, so this value is no longer required to resolve `@maude/canvas-lib`
   * — it's accepted for back-compat and used only to emit a one-shot
   * deprecation warning when a legacy `<designRoot>/_lib/canvas-lib.tsx` is
   * detected.
   */
  designRoot?: string;
  /**
   * Cloud Phase 25 A1 — the SANDBOX's import allowlist.
   *
   * On a laptop an unrestricted resolver is correct and harmless: your code,
   * your machine, your files. In a CELL the same resolver is a build-time read
   * primitive pointed at a container that holds this tenant's credentials, so
   * a tenant's own source may reach ONLY the runtime packages,
   * `@maude/canvas-lib`, and relative paths that resolve INSIDE the design
   * root. Anything else is a legible build error, never a silent read.
   *
   * Set to the absolute design root to arm it. Absent (desktop) ⇒ unchanged.
   */
  restrictImportsTo?: string;
}

/**
 * Build a single canvas TSX file end-to-end. Identity pass is from
 * canvas-pipeline.ts; the module pass is Bun.build with React externalised
 * and `@maude/canvas-lib` resolved to the dev-server-bundled canvas-lib.
 */
export async function buildCanvasModule(
  canvasAbsPath: string,
  source: string,
  options: BuildCanvasOptions = {}
): Promise<CanvasBundleResult> {
  // Pass 1: inject data-cd-id, capture the locator.
  const pass1 = transpileCanvasSource(canvasAbsPath, source);

  // Sanity-check the dev-server-bundled canvas-lib once per process — if the
  // install is corrupt, fail loud before Bun.build collapses plugin throws.
  if (/@maude\/canvas-lib/.test(source)) {
    verifyCanvasLibPresence();
  }

  // Non-destructive deprecation warning for projects still carrying a legacy
  // `<designRoot>/_lib/canvas-lib.tsx`. The dev-server-bundled lib is
  // authoritative; this just nudges the project owner to clean up.
  if (options.designRoot) {
    warnLegacyDesignLib(options.designRoot);
  }

  // Pass 2: Bun.build with a virtual loader that resolves canvasAbsPath to the
  // post-pass-1 TSX. Every other import (npm packages, relative imports of
  // sibling canvas components) goes through Bun's default resolver. The four
  // runtime packages are externalised so they resolve through the importmap.
  // Phase 5.1 — `react-dom` is now its own runtime package (so createPortal is
  // in the bundle). The flatMap legacy alias for `react-dom` is no longer
  // needed; RUNTIME_PACKAGES already lists every specifier the importmap covers.
  const externalSpecifiers = new Set<string>(RUNTIME_PACKAGES);
  const denials: Array<{ specifier: string; reason: string }> = [];
  // Every stylesheet the canvas pulls in by relative import — they are inlined
  // (below), so the open canvas has no <link> to swap when one changes; the
  // injector records them for the iframe's HMR client (see buildCssInjector).
  const cssSources = new Set<string>();

  const built = await Bun.build({
    entrypoints: [canvasAbsPath],
    target: 'browser',
    format: 'esm',
    minify: false,
    splitting: false,
    // Bun.build THROWS by default (an AggregateError whose message is the
    // useless string "Bundle failed"), which made the `built.success` branch
    // below dead code and hid every real diagnostic — including, once the
    // sandbox arrived, the allowlist's own explanation of what it refused.
    // Take the result, report it ourselves.
    throw: false,
    define: {
      // Match runtime-bundle.ts: production React. Without this the canvas's
      // `import { jsxDEV } from "react/jsx-dev-runtime"` resolves against a
      // bundle that fails to load due to a Bun.build naming collision in the
      // dev variant. Both halves of the system MUST agree on the JSX runtime
      // flavour.
      'process.env.NODE_ENV': '"production"',
    },
    plugins: [
      {
        name: 'css-sources',
        setup(builder) {
          builder.onResolve({ filter: /\.css$/ }, (args: { path: string; importer: string }) => {
            if (args.path.startsWith('.') && args.importer) {
              cssSources.add(path.resolve(path.dirname(args.importer), args.path));
            }
            return null; // record only — resolution continues as before
          });
        },
      },
      // Resolve `@maude/canvas-lib` BEFORE exact-externals — we want the bare
      // specifier to map to the dev-server-bundled lib, not get marked external.
      canvasLibResolver(),
      {
        name: 'canvas-virtual-source',
        setup(builder) {
          builder.onLoad({ filter: filterForExactPath(canvasAbsPath) }, () => ({
            contents: pass1.withIds,
            loader: 'tsx',
          }));
        },
      },
      {
        name: 'exact-externals',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (externalSpecifiers.has(args.path)) {
              return { path: args.path, external: true };
            }
            return null;
          });
        },
      },
      // LAST on purpose: by the time a specifier reaches this plugin, the
      // runtime packages are external and `@maude/canvas-lib` is resolved, so
      // what is left is exactly "everything else" — which, from a tenant's
      // own file, must stay inside the design root.
      ...(options.restrictImportsTo ? [importAllowlist(options.restrictImportsTo, denials)] : []),
    ],
  });

  if (!built.success) {
    // A DENIED IMPORT IS THE MESSAGE. Bun collapses a plugin throw into a bare
    // "Bundle failed" log, so the allowlist records its own reasons and they
    // win here — the person who wrote the canvas has to be able to act on it,
    // and "Bundle failed" tells them nothing.
    if (denials.length > 0) {
      // The COUNT of denials travels with the error, so the cost lane can
      // record that imports were refused without ever seeing the specifier —
      // that string is tenant-authored content (Cloud Phase 26 Stage 4). The
      // reasons still go to the person who wrote the canvas, unchanged.
      const err = new Error(denials.map((d) => d.reason).join('\n'));
      (err as Error & { rejectedImports?: number }).rejectedImports = denials.length;
      throw err;
    }
    const msg = built.logs.map((l) => l.message).join('\n');
    throw new Error(`Bun.build failed on ${canvasAbsPath}:\n${msg}`);
  }
  const entry = built.outputs.find((o) => o.kind === 'entry-point');
  if (!entry) {
    throw new Error(`Bun.build produced no entry-point output for ${canvasAbsPath}`);
  }
  let js = await entry.text();

  // Gather any sibling CSS the bundler produced from `import "./<slug>.css"`
  // statements in the canvas/specimen TSX. Bun.build extracts those into a
  // separate `kind: "asset"` CSS file. Browser-loaded ESM doesn't process
  // `import "*.css"` natively, so we inline the CSS via a `<style>` tag
  // injection at module-init time — keeps each canvas self-contained without
  // needing a parallel `<link>` request.
  const cssAssets = built.outputs.filter((o) => o.kind === 'asset' && o.path.endsWith('.css'));
  if (cssAssets.length > 0) {
    let css = '';
    for (const a of cssAssets) css += await a.text();
    if (css.trim().length > 0) {
      const slug = canvasAbsPath.split('/').pop() ?? 'canvas';
      const root = options.designRoot ?? options.restrictImportsTo;
      // Real paths on both sides: the bundler reports importers by their REAL
      // path, and a design root reached through a symlink (macOS `/var` →
      // `/private/var`, where every temp dir lives) made each source look like
      // `../../private/…` — filtered out, so nothing was ever named and the
      // open canvas never restyled.
      const real = (p: string) => {
        try {
          return realpathSync(p);
        } catch {
          return p;
        }
      };
      const realRoot = root ? real(root) : null;
      const sources = realRoot
        ? [...cssSources]
            .map((abs) => path.relative(realRoot, real(abs)).split(path.sep).join('/'))
            .filter((rel) => rel && !rel.startsWith('..'))
        : [];
      js = buildCssInjector(slug, css, sources) + js;
    }
  }

  const etag = Bun.hash(js).toString(16);
  return { js, locator: pass1.locator, etag };
}

/**
 * Synthesize a module-init prologue that creates a `<style data-canvas-css>`
 * tag with the bundled CSS text. One tag per slug — a duplicate mount reuses
 * it, and a RE-IMPORT (the iframe's soft reload after a stylesheet changed)
 * replaces its text, so a changed import actually reaches the page. Run at
 * top-level so it executes before the React component does its first render.
 *
 * `sources` — the design-root-relative stylesheets inlined here — lands on the
 * tag as `data-canvas-css-sources` (`|`-separated): the iframe's HMR client
 * reloads when one of them changes, since there is no <link> to swap (plan
 * T31/L16: a canvas importing `../system/<ds>/tokens.css` never restyled).
 */
function buildCssInjector(slug: string, css: string, sources: readonly string[] = []): string {
  // JSON-encode the CSS text so we don't need to worry about backticks,
  // backslashes, or embedded `</style>` (which would break a raw template).
  const enc = JSON.stringify(css);
  const id = JSON.stringify(`canvas-css-${slug.replace(/[^a-zA-Z0-9-]/g, '_')}`);
  const src = JSON.stringify(sources.join('|'));
  return `// canvas-build: inject bundled sibling CSS so the canvas is self-contained.\n(function(){if(typeof document==="undefined")return;var s=document.getElementById(${id});if(!s){s=document.createElement("style");s.id=${id};s.dataset.canvasCss="bundled";document.head.appendChild(s);}s.dataset.canvasCssSources=${src};if(s.textContent!==${enc})s.textContent=${enc};})();\n`;
}

/**
 * The sandbox's import allowlist (Cloud Phase 25 A1).
 *
 * The rule is stated by IMPORTER, not by target, because the two trees have
 * different rights: canvas-lib and its siblings are OUR code and import each
 * other freely; a tenant's canvas may only reach inside the design root. A
 * target-only rule would let a tenant's `../../../app/...` traversal land in
 * the maude install and be waved through as "our" file.
 *
 * Denials THROW with the specifier and the reason — a rejected import must
 * reach the person as a legible build error, never a 500 and never a silent
 * read of something they should not have.
 */
function importAllowlist(
  designRoot: string,
  denials: Array<{ specifier: string; reason: string }>
  // Bun's own plugin type, not a hand-rolled structural twin: the local shape
  // described a narrower `setup` than Bun.build's `plugins` accepts, so the
  // value was not assignable at the one place it is used.
): import('bun').BunPlugin {
  const root = path.resolve(designRoot);
  const inRoot = (p: string) => p === root || p.startsWith(root + path.sep);
  const deny = (specifier: string, reason: string): never => {
    denials.push({ specifier, reason });
    throw new Error(reason);
  };
  return {
    name: 'maude-import-allowlist',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args: { path: string; importer: string }) => {
        // `data:` / `blob:` are SELF-CONTAINED — no request leaves the page, so
        // the sandbox has nothing to say about them. They reach this hook
        // because bundled CSS runs every `url()` through onResolve, and
        // `url("data:image/svg+xml,…")` — the standard idiom for grain,
        // textures and tiny inline icons — is neither relative nor absolute,
        // so the bare-specifier branch below used to reject it with the
        // npm-packages message (spike finding M9: a design system's always-on
        // film-grain took the whole canvas build down). The denial is for
        // schemes that go to the NETWORK; these never do.
        if (/^(data|blob):/i.test(args.path)) return { path: args.path, external: true };
        const importer = args.importer ? path.resolve(args.importer) : '';
        // Our own modules (canvas-lib and its graph) resolve normally.
        if (importer && !inRoot(importer)) return null;
        if (!args.path.startsWith('.') && !path.isAbsolute(args.path)) {
          deny(
            args.path,
            `This canvas imports "${args.path}", which is not available when it renders in a browser. ` +
              `A canvas here can use the Maude runtime (react, motion, @maude/canvas-lib) and its own ` +
              `project files — npm packages are not installed. Open the project in Maude Desktop if you ` +
              `need one.`
          );
        }
        const resolved = path.resolve(path.dirname(importer || root), args.path);
        if (!inRoot(resolved)) {
          deny(
            args.path,
            `This canvas imports "${args.path}", which is outside the project (${path.relative(root, resolved)}). ` +
              `A canvas may only import files inside its own design.`
          );
        }
        return null; // inside the root — let Bun's resolver finish the job
      });
    },
  };
}

function filterForExactPath(absPath: string): RegExp {
  // Bun.build hands onLoad the resolved on-disk path. On macOS /tmp is a
  // symlink to /private/tmp, so an entrypoint of "/tmp/foo.tsx" arrives in
  // onLoad as "/private/tmp/foo.tsx". Match on the *trailing* path
  // segments — same filename + parent dir — which is enough to uniquely
  // identify a canvas file path while tolerating prefix normalisations.
  // We require the last two segments to match so a canvas with the same
  // filename in a different directory doesn't collide.
  const parts = absPath.split('/');
  const tail = parts.slice(-2).join('/');
  return new RegExp(`/${escapeRegex(tail)}$`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
