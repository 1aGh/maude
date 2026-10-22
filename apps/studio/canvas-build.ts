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

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { canvasLibPath, canvasLibResolver } from './canvas-lib-resolver.ts';
import { transpileCanvasSource } from './canvas-pipeline.ts';
import { CanvasBuildError, errorAt, fromBuildLogs, scrubPaths } from './canvas-source/errors.ts';
import { dsResolver, usesDs } from './ds/ds-resolver.ts';
import type { LocatorMap } from './locator.ts';
import { hasMacroImport, macroImportRefusal } from './macro-guard.ts';
import { isUnderOrEqual } from './path-containment.ts';
import { DEV_SERVER_ROOT } from './paths.ts';
import { RUNTIME_PACKAGES } from './runtime-bundle.ts';
import { injectCompMedia } from './video/inject.ts';

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
  /**
   * gate-b-c4e — every file the module inlined, absolute (the build's metafile `inputs`; virtual
   * modules included). The serve path holds them to the requesting frame's closure before the
   * bytes leave (http.ts `inputsRefusal`): an import the closure does not admit — another
   * canvas's board, a canvas the opener cannot read — fails the serve closed.
   */
  inputs: string[];
}

/** The build's metafile `inputs` as absolute paths (Bun reports them relative to the cwd). */
function metafileInputs(metafile: { inputs?: Record<string, unknown> } | undefined): string[] {
  const out: string[] = [];
  for (const key of Object.keys(metafile?.inputs ?? {})) {
    out.push(path.isAbsolute(key) ? key : path.resolve(process.cwd(), key));
  }
  return out;
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
  /**
   * The URL the design root is served under (e.g. `/.design`) — cell
   * materializer Task 9.
   *
   * When set, every CSS `url()` that resolves inside the design root is
   * rewritten to `<assetUrlBase>/<rel>` and left EXTERNAL, so the browser
   * fetches it through the static route instead of the bundler reading it:
   *
   *  • On a cell the file may not be on disk at all (the disk is a cache; the
   *    bytes are in the bucket) — a bundler read made ONE missing photo fail
   *    the whole canvas with `Could not resolve`. The static route
   *    materializes it on demand.
   *  • Anywhere, Bun inlines a small url() as a data URI but emits a large one
   *    as a hashed `./name-<hash>.ext` output that nothing serves — so every
   *    CSS background photo and webfont past the inline limit was already a
   *    broken reference. The route serves the real file at its real path.
   *
   * Absent ⇒ the bundler's own handling, unchanged.
   */
  assetUrlBase?: string;
  /**
   * S1.11 — historical build overlays (contract V2-1.9 §5.6). Absolute path of
   * a stylesheet → the text to build it from INSTEAD of the file on disk.
   *
   * A past version renders from its own lanes: the version's TSX is `source`,
   * and its same-name CSS lane arrives here (`{ <canvas>.css: cssAt(ref) }`).
   * Every other import — shared modules, the design system, assets — still
   * resolves as it is now ("Shared parts show as they are now").
   *
   * The CALLER owns provenance: the text must come from the server's own
   * history store (git object / accepted revision), never from a request. The
   * build owns containment, whatever the caller passes:
   *   • keys are absolute, normalized `.css` paths inside the design root
   *     (`restrictImportsTo`, else `designRoot`); no root ⇒ no overrides. A
   *     module (`.tsx`/`.ts`/`.js`) can never be swapped through this door.
   *   • an overridden stylesheet is CONTENT, not a pass: its `@import` and
   *     `url()` go through the same allowlist / asset rewrite as a live one.
   *   • the override applies even when today's file is gone (a lane the
   *     version had and the working tree no longer does).
   * Anything else throws — a bad key is a programming error, never ignored.
   *
   * No cache lives here; a build with overrides shares nothing with the next
   * build without them. Callers that cache (http.ts `serveHistoricalCanvas`)
   * key by `(path, ref)` in a map apart from the live one.
   */
  overrides?: CanvasOverrides;
}

/** `BuildCanvasOptions.overrides` — absolute `.css` path → that version's text. */
export type CanvasOverrides = Readonly<Record<string, string>>;

/** The one spelling an override is matched by: the real directory + the basename (the file
 *  itself may not exist). The bundler reports paths by their real path (macOS `/var` →
 *  `/private/var`), callers pass the logical one. */
function overrideIdentity(abs: string): string {
  let dir = path.dirname(abs);
  let rest = '';
  for (;;) {
    try {
      const real = realpathSync(dir);
      return path.join(real, rest, path.basename(abs));
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return abs;
      rest = path.join(path.basename(dir), rest);
      dir = parent;
    }
  }
}

/** Validate + normalize the overrides against the design root (see `overrides`). */
function normalizeOverrides(
  overrides: CanvasOverrides,
  root: string | undefined
): Map<string, string> {
  const out = new Map<string, string>();
  const entries = Object.entries(overrides);
  if (entries.length === 0) return out;
  if (!root) throw new Error('Canvas build overrides need a design root to hold them to.');
  const roots = [path.resolve(root)];
  try {
    const real = realpathSync(roots[0]);
    if (real !== roots[0]) roots.push(real);
  } catch {
    // a root that does not exist holds nothing — every key below fails the check
  }
  for (const [key, text] of entries) {
    const bad = (why: string): never => {
      throw new Error(`Canvas build override refused (${why}): ${key}`);
    };
    if (typeof text !== 'string') bad('not text');
    if (!path.isAbsolute(key)) bad('not an absolute path');
    if (path.normalize(key) !== key || key.split(/[\\/]/).includes('..')) bad('not normalized');
    if (!/\.css$/i.test(key)) bad('only a stylesheet can be overridden');
    const id = overrideIdentity(key);
    if (!roots.some((r) => isUnderOrEqual(key, r) && key !== r)) bad('outside the design root');
    if (!roots.some((r) => isUnderOrEqual(id, r) && id !== r)) bad('outside the design root');
    out.set(id, text);
  }
  return out;
}

/**
 * Serve the overridden stylesheets. Registered FIRST so its `onLoad` wins over
 * the asset-url plugin's disk read; the text still passes through `rewrite`
 * (the same `url()` rewrite a live stylesheet gets) and then the bundler, whose
 * `@import`/`url()` resolution runs every plugin — the allowlist included.
 * `onResolve` only answers for an override whose file is gone today, and it
 * runs AFTER the allowlist (see the plugin order), which has judged it already.
 */
function cssOverrides(
  byIdentity: Map<string, string>,
  rewrite: ((css: string, cssFile: string) => string) | null
): { load: import('bun').BunPlugin; resolveMissing: import('bun').BunPlugin } {
  return {
    load: {
      name: 'maude-css-overrides',
      setup(builder) {
        builder.onLoad({ filter: /\.css$/i }, (args: { path: string }) => {
          const text = byIdentity.get(overrideIdentity(args.path));
          if (text === undefined) return undefined; // not overridden — next plugin / disk
          return { contents: rewrite ? rewrite(text, args.path) : text, loader: 'css' };
        });
      },
    },
    resolveMissing: {
      name: 'maude-css-overrides-missing',
      setup(builder) {
        builder.onResolve({ filter: /\.css$/i }, (args: { path: string; importer: string }) => {
          if (!args.importer || !args.path.startsWith('.')) return null;
          const abs = path.resolve(path.dirname(args.importer), args.path);
          const id = overrideIdentity(abs);
          if (!byIdentity.has(id) || existsSync(id)) return null;
          return { path: id };
        });
      },
    },
  };
}

/**
 * Rewrite CSS `url()` references inside the design root to served absolute
 * URLs (see `BuildCanvasOptions.assetUrlBase`).
 *
 * Done at LOAD, on the stylesheet text, because Bun keeps an external url's
 * ORIGINAL text in the output whatever path `onResolve` returns — and a
 * relative url inlined into the canvas's `<style>` then resolves against the
 * iframe document, not the stylesheet it came from. The rewritten absolute
 * URLs are then marked external on resolve, so the bundler never reads them.
 * Anything outside the root is left as written, for the allowlist to judge.
 */
function cssUrlRewriter(designRoot: string, base: string) {
  const prefix = base.replace(/\/+$/, '');
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const realRoot = real(path.resolve(designRoot));
  const URL_TOKEN = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/g;
  const rewrite = (css: string, cssFile: string): string =>
    css.replace(URL_TOKEN, (whole, quote: string, raw: string) => {
      const ref = raw.trim();
      // Schemes (data:, http:, blob:), fragments and root-absolute paths are
      // not files beside this stylesheet.
      if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('#') || ref.startsWith('/')) {
        return whole;
      }
      const bare = ref.replace(/[?#].*$/, '');
      if (!bare || bare.endsWith('.css')) return whole; // @import is the bundler's
      const abs = path.resolve(path.dirname(cssFile), bare);
      const target = path.join(real(path.dirname(abs)), path.basename(abs));
      if (!target.startsWith(realRoot + path.sep)) return whole; // the allowlist decides
      const rel = path.relative(realRoot, target).split(path.sep).map(encodeURIComponent);
      return `url(${quote}${prefix}/${rel.join('/')}${ref.slice(bare.length)}${quote})`;
    });
  return { prefix, rewrite };
}

function cssUrlAssets(designRoot: string, base: string): import('bun').BunPlugin {
  const { prefix, rewrite } = cssUrlRewriter(designRoot, base);
  return {
    name: 'maude-css-url-assets',
    setup(builder) {
      builder.onLoad({ filter: /\.css$/ }, async (args: { path: string }) => ({
        contents: rewrite(await Bun.file(args.path).text(), args.path),
        loader: 'css',
      }));
      builder.onResolve({ filter: /.*/ }, (args: { path: string; importer: string }) => {
        if (!args.importer?.endsWith('.css')) return null;
        if (prefix && !args.path.startsWith(`${prefix}/`)) return null;
        if (!prefix && !args.path.startsWith('/')) return null;
        return { path: args.path, external: true };
      });
    },
  };
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
  // gate-b-c4n — a Bun macro import runs at build time, in THIS process (or the sandbox worker):
  // pass 1's Bun.Transpiler and Bun.build below both evaluate it. Refuse it before either sees the
  // text; `macroGuard` (first plugin) does the same for every file the bundle loads.
  const macroCtx = {
    designRoot: options.restrictImportsTo ?? options.designRoot ?? path.dirname(canvasAbsPath),
    canvasAbs: canvasAbsPath,
  };
  if (hasMacroImport(source)) throw macroRefused(macroCtx, canvasAbsPath);
  // Pass 1: inject data-cd-id, capture the locator.
  const pass1 = transpileCanvasSource(canvasAbsPath, source);
  // S7.5 (V2-1.10 §5.3) — the comp vocabulary's derived data (`__words` on <Captions>, `__speech`
  // on <Duck>), computed from the comp's clips on disk × their transcripts. Never written to the
  // file; the transcripts are freshness deps (`videoDepsFor`, access/closure.ts).
  const withMedia = injectCompMedia(canvasAbsPath, source, pass1.withIds, {
    designRoot: options.restrictImportsTo ?? options.designRoot,
  }).code;
  // What Bun.build will parse as the entry (pass 1 + the injected comp data), held to the same rule.
  if (hasMacroImport(withMedia)) throw macroRefused(macroCtx, canvasAbsPath);

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
  const macroRefusals: string[] = [];
  const allowlist = options.restrictImportsTo
    ? importAllowlist(options.restrictImportsTo, denials, canvasAbsPath)
    : null;
  // Every stylesheet the canvas pulls in by relative import — they are inlined
  // (below), so the open canvas has no <link> to swap when one changes; the
  // injector records them for the iframe's HMR client (see buildCssInjector).
  const cssSources = new Set<string>();
  // S1.11 — a past version's own stylesheets (validated before any build work).
  const overridden = normalizeOverrides(
    options.overrides ?? {},
    options.restrictImportsTo ?? options.designRoot
  );
  const overrides =
    overridden.size > 0
      ? cssOverrides(
          overridden,
          options.assetUrlBase && options.designRoot
            ? cssUrlRewriter(options.designRoot, options.assetUrlBase).rewrite
            : null
        )
      : null;

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
    // gate-b-c4e — what was inlined, so the serve path can hold it to the frame's closure.
    metafile: true,
    define: {
      // Match runtime-bundle.ts: production React. Without this the canvas's
      // `import { jsxDEV } from "react/jsx-dev-runtime"` resolves against a
      // bundle that fails to load due to a Bun.build naming collision in the
      // dev variant. Both halves of the system MUST agree on the JSX runtime
      // flavour.
      'process.env.NODE_ENV': '"production"',
    },
    plugins: [
      // gate-b-c4n — FIRST, so it reads every file the bundle loads before any other loader
      // answers for it (it never answers itself).
      macroGuard(macroRefusals, macroCtx.designRoot),
      // An overridden stylesheet's onLoad must win over the disk read below.
      ...(overrides ? [overrides.load] : []),
      ...(options.assetUrlBase && options.designRoot
        ? [cssUrlAssets(options.designRoot, options.assetUrlBase)]
        : []),
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
      // `@maude/ds` — per canvas: the system's override or the defaults, and the system registered
      ...(options.designRoot && usesDs(source)
        ? [dsResolver(options.designRoot, canvasAbsPath)]
        : []),
      {
        name: 'canvas-virtual-source',
        setup(builder) {
          builder.onLoad({ filter: filterForExactPath(canvasAbsPath) }, () => ({
            contents: withMedia,
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
      ...(allowlist ? [allowlist.plugin] : []),
      // After the allowlist: only an override whose file is gone today, already judged above.
      ...(overrides ? [overrides.resolveMissing] : []),
    ],
  });

  if (macroRefusals.length > 0) {
    const reason = macroRefusals[0] as string;
    throw new CanvasBuildError(reason, [errorAt(macroCtx, reason)]);
  }
  if (!built.success) {
    const errorCtx = {
      designRoot: options.restrictImportsTo ?? options.designRoot ?? path.dirname(canvasAbsPath),
      canvasAbs: canvasAbsPath,
      source,
    };
    // A DENIED IMPORT IS THE MESSAGE. Bun collapses a plugin throw into a bare
    // "Bundle failed" log, so the allowlist records its own reasons and they
    // win here — the person who wrote the canvas has to be able to act on it,
    // and "Bundle failed" tells them nothing.
    if (denials.length > 0) {
      // The COUNT of denials travels with the error, so the cost lane can
      // record that imports were refused without ever seeing the specifier —
      // that string is tenant-authored content (Cloud Phase 26 Stage 4). The
      // reasons still go to the person who wrote the canvas, unchanged.
      // S11.6 — typed (`CanvasBuildError.errors`: file / line / column / lineText from the
      // logs' positions); the message is unchanged.
      const reason = denials[0]?.reason ?? '';
      const [first, ...rest] = fromBuildLogs(built.logs, errorCtx);
      throw new CanvasBuildError(
        denials.map((d) => d.reason).join('\n'),
        [
          { ...(first ?? errorAt(errorCtx)), message: scrubPaths(reason, errorCtx.designRoot) },
          ...rest,
        ],
        denials.length
      );
    }
    const msg = built.logs.map((l) => l.message).join('\n');
    throw new CanvasBuildError(
      `Bun.build failed on ${canvasAbsPath}:\n${msg}`,
      fromBuildLogs(built.logs, errorCtx)
    );
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

  const inputs = metafileInputs(built.metafile);
  // gate-b-c4g — the bundle is held to the allowlist by what it ACTUALLY inlined, after Bun's own
  // resolution: a `package.json` `main` / `browser` field (or a symlink it names) can carry a
  // directory import the onResolve hook judged as "inside" to any file. And no metafile entry for
  // the canvas itself means the list cannot be trusted to be complete (M2) — fail closed.
  if (allowlist) {
    const refusal = allowlist.vetInputs(inputs);
    if (refusal) {
      const errorCtx = {
        designRoot: options.restrictImportsTo as string,
        canvasAbs: canvasAbsPath,
        source,
      };
      throw new CanvasBuildError(
        refusal,
        [{ ...errorAt(errorCtx), message: scrubPaths(refusal, errorCtx.designRoot) }],
        1
      );
    }
  }

  const etag = Bun.hash(js).toString(16);
  return { js, locator: pass1.locator, etag, inputs };
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

/** What the allowlist reads of a resolve (`kind`: `entry-point-build` for the entry itself). */
type AllowlistArgs = { path: string; importer: string; kind?: string };

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
  denials: Array<{ specifier: string; reason: string }>,
  entryAbs: string
): {
  // Bun's own plugin type, not a hand-rolled structural twin: the local shape
  // described a narrower `setup` than Bun.build's `plugins` accepts, so the
  // value was not assignable at the one place it is used.
  plugin: import('bun').BunPlugin;
  /** gate-b-c4g — the build's real inputs judged by the same rule; a reason, or null. */
  vetInputs: (inputs: readonly string[]) => string | null;
} {
  const root = path.resolve(designRoot);
  // Both spellings of every root: the bundler reports importers (and so every
  // relative target) by REAL path, while callers pass the logical one. Comparing
  // only the logical root made every canvas file behind a symlink — macOS
  // `/var`, a symlinked `~/git`, a Windows `subst` drive or junction — look like
  // one of OUR modules, exempt from the allowlist, so it could import any file
  // on disk (security review of #145, attacker F1).
  const bothForms = (p: string) => {
    const abs = path.resolve(p);
    try {
      const real = realpathSync(abs);
      return real === abs ? [abs] : [abs, real];
    } catch {
      return [abs];
    }
  };
  const roots = bothForms(root);
  // OUR code: canvas-lib and its siblings, plus the dependencies they import
  // (`apps/studio/node_modules`, or hoisted one level up in the npm layout).
  // Named explicitly — an importer that is neither ours nor the tenant's is
  // refused, never presumed safe.
  const ours = [
    ...bothForms(DEV_SERVER_ROOT),
    ...bothForms(path.join(DEV_SERVER_ROOT, 'node_modules')),
    ...bothForms(path.join(DEV_SERVER_ROOT, '..', '..', 'node_modules')),
  ];
  const inRoot = (p: string) => roots.some((r) => isUnderOrEqual(p, r));
  const realTarget = (p: string): string => {
    let dir = p;
    let rest = '';
    for (;;) {
      try {
        const real = realpathSync(dir);
        return rest ? path.join(real, rest) : real;
      } catch {
        const parent = path.dirname(dir);
        if (parent === dir) return p;
        rest = rest ? path.join(path.basename(dir), rest) : path.basename(dir);
        dir = parent;
      }
    }
  };
  const isOurs = (p: string) => ours.some((r) => isUnderOrEqual(p, r));
  /** Under a design root, with a first design-root-relative segment that starts with `_`. */
  const isRuntimeTarget = (p: string) =>
    roots.some((r) => {
      if (!isUnderOrEqual(p, r) || p === r) return false;
      return path.relative(r, p).split(path.sep)[0]?.startsWith('_') === true;
    });
  const deny = (specifier: string, reason: string): never => {
    denials.push({ specifier, reason });
    throw new Error(reason);
  };
  const entryForms = new Set([path.resolve(entryAbs), realTarget(path.resolve(entryAbs))]);
  /**
   * gate-b-c4g — the rule for a file the bundle READS (after Bun's resolver finished, so
   * `package.json` `main` / `browser` / `exports` and symlinks are already followed): the entry
   * canvas; a design-root file that is not runtime state (logical AND real path); or one of our
   * own modules (logical AND real path). Anything else → a reason that names no outside path.
   */
  const judgeLoaded = (p: string): string | null => {
    const abs = path.resolve(p);
    const real = realTarget(abs);
    if (entryForms.has(abs) || entryForms.has(real)) return null;
    if (inRoot(abs) || inRoot(real)) {
      if (!inRoot(abs) || !inRoot(real))
        return 'This canvas imports a file that leads outside the project. A canvas may only import files inside its own design.';
      if (isRuntimeTarget(abs) || isRuntimeTarget(real))
        return `This canvas imports "${path.relative(root, abs)}", which is Maude's own runtime state, not part of the design. A canvas may import its design's files, but not the folders whose names start with "_".`;
      return null;
    }
    if (isOurs(abs) && isOurs(real)) return null;
    return 'This canvas imports a file outside the project (a package.json in the design points there). A canvas may only import files inside its own design.';
  };
  const vetInputs = (inputs: readonly string[]): string | null => {
    if (!inputs.some((p) => entryForms.has(path.resolve(p)))) {
      return 'The canvas build did not report what it read, so the canvas is not served.';
    }
    for (const p of inputs) {
      const reason = judgeLoaded(p);
      if (reason) return reason;
    }
    return null;
  };
  const plugin: import('bun').BunPlugin = {
    name: 'maude-import-allowlist',
    setup(builder) {
      // gate-b-c4g — the file Bun is about to READ, after its own resolution. The onResolve hook
      // below judges the specifier the canvas wrote; a directory import there is "inside" — and
      // Bun then follows that directory's `package.json` wherever it points. Returning nothing
      // lets the next loader read it; a refusal throws (and is reported like any denial).
      builder.onLoad({ filter: /.*/ }, (args: { path: string; namespace?: string }) => {
        if (args.namespace && args.namespace !== 'file') return undefined;
        const reason = judgeLoaded(args.path);
        if (reason) deny(args.path, reason);
        return undefined;
      });
      builder.onResolve({ filter: /.*/ }, (args: AllowlistArgs) => {
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
        // Our own modules (canvas-lib and its graph) resolve normally. The
        // design root is checked FIRST: it may itself sit inside our tree (this
        // repo's own `.design/`), and then the tenant's rules must still apply.
        if (importer && !inRoot(importer)) {
          if (isOurs(importer)) return null;
          deny(
            args.path,
            `"${args.path}" is imported from ${importer}, which is outside the project. ` +
              `A canvas may only import files inside its own design.`
          );
        }
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
        // Where the bytes really are: a symlink INSIDE the design root (file or
        // directory) still points wherever it points. The nearest existing
        // ancestor is resolved, so `./dirlink/secret` and an extensionless
        // specifier through a linked folder are both judged by their real home.
        const real = realTarget(resolved);
        if (!inRoot(resolved) || !inRoot(real)) {
          deny(
            args.path,
            `This canvas imports "${args.path}", which is outside the project (${path.relative(root, resolved)}). ` +
              `A canvas may only import files inside its own design.`
          );
        }
        // gate-b-c4e — never the design root's RUNTIME STATE (DDR-115: a `_`-prefixed first
        // segment — `_state/`, `_comments/`, `_chat/`, `_photo/`, `_active.json`, …). Bun inlines
        // whatever an import names (`with { type: 'text' }` takes any file's bytes) into the
        // module served to the canvas's own frame, and those files hold per-machine secrets and
        // other canvases' threads. Judged on the logical AND the real path; the entry itself (a
        // `_draw/` or `_photo/` harness, which import only `@maude/canvas-lib`) is not an import.
        if (
          args.kind !== 'entry-point-build' &&
          (isRuntimeTarget(resolved) || isRuntimeTarget(real))
        ) {
          deny(
            args.path,
            `This canvas imports "${args.path}", which is Maude's own runtime state, not part of the design. ` +
              `A canvas may import its design's files, but not the folders whose names start with "_".`
          );
        }
        return null; // inside the root — let Bun's resolver finish the job (onLoad re-checks)
      });
    },
  };
  return { plugin, vetInputs };
}

/** gate-b-c4n — the refusal for a macro import in `file`, naming it only inside the design. */
function macroRefused(ctx: { designRoot: string; canvasAbs: string }, file: string) {
  const reason = macroImportRefusal(macroDisplayName(file, ctx.designRoot));
  return new CanvasBuildError(reason, [errorAt(ctx, reason)]);
}

function macroDisplayName(file: string, designRoot: string): string {
  const rel = path.relative(path.resolve(designRoot), path.resolve(file));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : path.basename(file);
}

/**
 * gate-b-c4n — every file Bun is about to READ, whatever its extension: an import attribute
 * (`with { type: 'tsx' }`) makes Bun parse a `.txt` as TSX while `args.loader` still says "text",
 * so the extension proves nothing. A refusal is recorded (Bun collapses a plugin throw into
 * "Bundle failed") and thrown, which stops Bun before it parses — and so before any macro runs.
 * Returning nothing lets the next loader read the file as before.
 */
function macroGuard(refusals: string[], designRoot: string): import('bun').BunPlugin {
  return {
    name: 'maude-macro-guard',
    setup(builder) {
      builder.onLoad({ filter: /.*/ }, (args: { path: string; namespace?: string }) => {
        if (args.namespace && args.namespace !== 'file') return undefined;
        let text: string;
        try {
          text = readFileSync(args.path, 'utf8');
        } catch {
          return undefined; // a virtual module (its contents are ours) or a file Bun cannot read either
        }
        if (hasMacroImport(text)) {
          const reason = macroImportRefusal(macroDisplayName(args.path, designRoot));
          refusals.push(reason);
          throw new Error(reason);
        }
        return undefined;
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
