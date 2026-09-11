// React 19 runtime bundle — single bundled copy of React + ReactDOM + JSX
// runtime served at `/_canvas-runtime/<pkg>.js`. Every TSX canvas resolves its
// `import "react"` / `import "react/jsx-dev-runtime"` etc. through an importmap
// that points at these URLs, so a multi-canvas session never re-downloads the
// runtime. DDR-019, Phase 3.6 Task 6.
//
// Design:
//   - One Bun.build per logical sub-path. We split into four entries
//     ('react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime')
//     rather than one mega-bundle so the browser cache key per import is stable
//     across React minor version changes (each bundle is re-keyed by content
//     hash; an unaffected sub-path keeps its cache entry).
//   - Lazy: first GET against /_canvas-runtime/<name>.js builds the bundle
//     in-process. Subsequent GETs hit the cache. The build is cheap (~150 ms
//     cold for React + ReactDOM combined) but enough that we don't want to pay
//     it for every page nav.
//   - Etag-aware: returns the bundle's content hash so the browser can 304.
//   - In dev we externalise *nothing* — the four bundles together are
//     self-contained. The importmap wires them together at runtime.

import { join } from 'node:path';

import { DEV_SERVER_ROOT, RUNTIME_BUNDLES_DIR } from './paths.ts';

// Real disk install root — synthetic entry points must anchor here so
// Bun.build's resolver walks UP and finds node_modules/react on disk.
// In compiled binaries, import.meta.url is the virtual `/$bunfs/root`
// where no node_modules exists (Phase 19.1 / v0.18.1).
const HERE = DEV_SERVER_ROOT;

/**
 * Read a pre-built runtime bundle from `dist/runtime/<slug>.js`. Returns
 * null when missing → caller falls back to dynamic Bun.build (dev mode).
 */
async function loadPrebuiltRuntimeBundle(pkg: RuntimePackage): Promise<BundleCacheEntry | null> {
  const path = join(RUNTIME_BUNDLES_DIR, `${slugFor(pkg)}.js`);
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const js = await file.text();
  if (!js) return null;
  return { js, etag: Bun.hash(js).toString(16) };
}

export const RUNTIME_PACKAGES = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  // Toasts in standalone canvases resolve without node_modules in packaged installs.
  'sonner',
  // Pixi.js v8 — per-iframe runtime bundle for the non-destructive photo editor
  // (feature-photo-editor). The canvas-lib `<PhotoLayer>` reaches the WebGL
  // compositor (`photo/pipeline.ts`) through a LAZY runtime `import('pixi.js')`,
  // so a canvas with no edited photo never pays the ~500 KB bundle cost (the
  // lazy-bundle guarantee — regression-tested in test/photo-canvas-bundle.test.ts).
  // Pre-built into dist/runtime/pixi-js.js + floored in .min-sizes.json.
  // (Originally parked by DDR-024 for snapshot-to-texture rendering; the photo
  // editor is the first real activation — see the photo-editor architecture DDR.)
  'pixi.js',
  // @imgly/background-removal (feature-photo-editor) — client-side ML background
  // removal (WASM/WebGPU via onnxruntime-web, ZERO native deps; the Node/native
  // `-node` variant is NEVER imported — bun-compile-hostile, DDR-070 sharp-class
  // exclusion). Externalised for the same lazy per-iframe bundling as pixi: the
  // bg-remove harness (PhotoBgRemoveHarness) reaches it through a runtime
  // `import('@imgly/background-removal')`, so a canvas that never removes a
  // background pays zero cost. Model weights (~11–44 MB isnet) are fetched at
  // first use (IMG.LY CDN by default; `publicPath` self-hosts for air-gapped —
  // a documented follow-up, see the photo-editor DDR). Pre-built into
  // dist/runtime + floored in .min-sizes.json.
  '@imgly/background-removal',
  // Phase 3.7 / DDR-049 — Motion One (motion/react) is the canonical motion
  // library for the canvas-lib + handoff pipeline. Externalised here so the
  // canvas-lib motion helpers (<MotionDemo>, etc.) resolve through the same
  // importmap path; consumers of /design:handoff still see a "motion" peer
  // dep declaration on the registry-item.json output.
  'motion',
  'motion/react',
  // Phase 8 / DDR-051 — Yjs + y-protocols for the canvas-shell collab client.
  // Each canvas iframe opens a WS to /_ws/collab/:slug and owns a per-iframe
  // Y.Doc + Awareness instance. Externalised here so the client-side
  // use-collab.tsx + cursors-overlay.tsx resolve via the importmap; canvases
  // that don't use collab pay zero bundle cost (tree-shaken).
  'yjs',
  'y-protocols/sync',
  'y-protocols/awareness',
  // Phase 8 follow-up — lib0 sub-paths are imported DIRECTLY by use-collab.tsx
  // (a transitive dep of canvas-lib.tsx via canvas-shell). Without these in
  // RUNTIME_PACKAGES the canvas Bun.build at request time tries to resolve
  // `lib0/decoding` from the user's project node_modules and fails — lib0 is
  // only a transitive dep of yjs and pnpm/npm don't hoist it to a path
  // reachable from a user canvas entrypoint. Externalising routes the import
  // through the importmap to a dedicated /_canvas-runtime/lib0_*.js bundle.
  // Bug shipped in v0.21.0; every canvas that uses @maude/canvas-lib (i.e.
  // every real canvas) returned HTTP 500 "Bundle failed".
  'lib0/decoding',
  'lib0/encoding',
  // DDR-148 — Remotion video-comp authoring. `remotion` carries the React
  // context stack (RemotionEnvironment / Sequence / Timeline) that a video-comp
  // canvas AND the `<Player>` preview BOTH consume — so it MUST be a single
  // externalised bundle (importmap-shared), exactly like React itself, or the
  // Player's provider and the composition's `useCurrentFrame()` bind to
  // different context instances and the comp renders frozen at frame 0 (the
  // dual-package hazard). `@remotion/player` + `@remotion/transitions` each
  // externalise `remotion` (→ the one bundle) and INLINE their own stateless
  // helpers — `remotion/no-react` (interpolate/random/validators/NoReactInternals,
  // all pure), plus `@remotion/paths`/`@remotion/shapes` for transitions — which
  // hold no cross-package state, so a per-bundle copy is harmless. NOT shipping
  // `@remotion/renderer`/`@remotion/web-renderer` (export goes through the
  // capture spine). Pre-built into dist/runtime + floored in .min-sizes.json.
  'remotion',
  '@remotion/player',
  '@remotion/media',
  '@remotion/transitions',
  // Transition presentations are separate subpath modules by design (Remotion
  // tree-shakes to what you import). But a canvas import specifier that isn't
  // in RUNTIME_PACKAGES tries to resolve against the USER's node_modules at
  // request-time Bun.build — which doesn't exist on an npm/marketplace install
  // — so EVERY presentation the skill teaches must be pre-bundled + importmap-
  // routed. v1 ships the six core wipes ("join 4 clips + crossfade" vocabulary);
  // exotic presentations (dreamy-zoom, film-burn, …) are a documented follow-up.
  '@remotion/transitions/fade',
  '@remotion/transitions/slide',
  '@remotion/transitions/wipe',
  '@remotion/transitions/flip',
  '@remotion/transitions/clock-wipe',
  '@remotion/transitions/none',
  // DDR-231 (hybrid export lanes) — the workspace `browser` lane captures
  // artboards in the MEMBER's browser. canvas-lib's export-capture listener
  // reaches dom-to-svg through a LAZY runtime `import('dom-to-svg')` (the
  // pixi.js pattern), so a canvas that never exports pays zero bundle cost —
  // regression-pinned alongside pixi in test/photo-canvas-bundle.test.ts.
  'dom-to-svg',
] as const;

export type RuntimePackage = (typeof RUNTIME_PACKAGES)[number];

/**
 * Discover the public export keys of a package at build time. React + ReactDOM
 * ship CJS in npm; `export * from "..."` against a CJS module produces empty
 * ESM bindings (the spec only allows `export *` to re-export static bindings,
 * and CJS has none). We work around this by dynamically `import()`ing the
 * package in the host Bun process, enumerating `Object.keys`, and emitting an
 * explicit named-re-export list. Robust to React version bumps (every new
 * named export — public or `__INTERNAL_*` — gets carried automatically).
 *
 * React 19's `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE`
 * is the canonical bridge ReactDOM uses to read React's shared internal state;
 * if we drop it the runtime fails with "Cannot read properties of undefined
 * (reading 'S')" on first ReactDOM.createRoot() call. Auto-discovery is the
 * only sustainable answer.
 */
const namedExportsCache = new Map<RuntimePackage, readonly string[]>();
async function namedExportsFor(pkg: RuntimePackage): Promise<readonly string[]> {
  const hit = namedExportsCache.get(pkg);
  if (hit) return hit;
  const mod = (await import(pkg)) as Record<string, unknown>;
  // `default` is auto-emitted from our synthetic entry separately; skip here.
  const keys = Object.keys(mod)
    .filter((k) => k !== 'default')
    .sort();
  namedExportsCache.set(pkg, keys);
  return keys;
}

/**
 * URL slug used in `/_canvas-runtime/<slug>.js`. Maps package specifier to a
 * filename-safe form. Inverse of {@link packageForSlug}.
 *
 * Slashes → `_`. Dots in package names → `-` (so `pixi.js` → `pixi-js` and
 * the trailing `.js` extension on the URL stays unambiguous; without this,
 * `packageForSlug` would strip `.js` and resolve `pixi.js.js` → `pixi`).
 */
export function slugFor(pkg: RuntimePackage): string {
  return pkg.replace(/\//g, '_').replace(/\./g, '-');
}

export function packageForSlug(slug: string): RuntimePackage | null {
  const want = slug.replace(/\.js$/, '');
  for (const p of RUNTIME_PACKAGES) {
    if (slugFor(p) === want) return p;
  }
  return null;
}

interface BundleCacheEntry {
  js: string;
  etag: string;
}

const cache = new Map<RuntimePackage, BundleCacheEntry>();

/**
 * Build (or fetch from cache) a single runtime sub-bundle. Self-contained:
 * each entry includes everything it needs; the four bundles only share state
 * at the browser level (via React's module-singleton convention — multiple
 * imports of "react" resolve to the same module thanks to the importmap).
 *
 * Two paths:
 *   1. **Pre-built on disk** (Phase 19.1 / v0.18.1). Every release ships
 *      `dist/runtime/<slug>.js` so npm-installed users + marketplace cache
 *      users never need disk node_modules/react or Bun.build at request time.
 *      Read from disk → return.
 *   2. **Dynamic Bun.build** — only fires for dev (cd dev-server; bun
 *      server.ts) where `dist/runtime/` may be empty/stale.
 */
export interface GetRuntimeBundleOptions {
  /** Skip the disk cache lookup — used by build.ts to force a fresh dynamic build. */
  skipPrebuilt?: boolean;
  /** Minify the dynamic build output — used by build.ts in release mode. */
  minify?: boolean;
}

export async function getRuntimeBundle(
  pkg: RuntimePackage,
  opts: GetRuntimeBundleOptions = {}
): Promise<BundleCacheEntry> {
  const hit = cache.get(pkg);
  if (hit && !opts.skipPrebuilt) return hit;

  // (1) Pre-built bundle path — try disk first (unless caller opts out).
  if (!opts.skipPrebuilt) {
    const prebuilt = await loadPrebuiltRuntimeBundle(pkg);
    if (prebuilt) {
      cache.set(pkg, prebuilt);
      return prebuilt;
    }
  }

  // A throwaway entrypoint that re-exports every member of the target package.
  // We use named re-exports (default + an enumerated namespace) so the bundle
  // produces real ESM exports even when the source package is CJS (React +
  // ReactDOM are CJS in their npm distribution; `export * from` against a CJS
  // module gives static analyzers nothing to bind, so Bun.build silently emits
  // an empty export shape — manual destructure works around that).
  // Synthetic entrypoint anchored inside the dev-server dir so Bun.build's
  // default resolver walks UP from HERE and finds dev-server/node_modules/react
  // (regardless of where the process happens to be launched from).
  const entryName = `${HERE}/.runtime-bundle-${slugFor(pkg)}-entry.tsx`;
  const exportNames = await namedExportsFor(pkg);
  const namedLines = exportNames.map((n) => `  ${n}`).join(',\n');
  // The `as any` cast tolerates names like `__INTERNAL_DO_NOT_USE_OR_WARN`
  // that aren't declared in the package's .d.ts; the destructure still
  // succeeds at runtime, which is what matters.
  // pixi.js compiles shaders with `new Function()` — which the split-origin
  // canvas iframe's strict CSP (DDR-054) forbids (no `unsafe-eval`), so the
  // photo compositor threw "Current environment does not allow unsafe-eval" and
  // the live preview silently failed in the DEFAULT mode (only same-origin, the
  // opt-out, had no CSP to trip). pixi ships `pixi.js/unsafe-eval` — a
  // side-effect module that swaps the eval-based shader/uniform sync for
  // eval-free polyfills. Baking it into the runtime bundle here makes EVERY
  // canvas's `import('pixi.js')` CSP-safe transparently (feature-photo-editor).
  const sideEffects = pkg === 'pixi.js' ? `import "pixi.js/unsafe-eval";\n` : '';
  const entryContent = `${sideEffects}import * as __mod__ from ${JSON.stringify(pkg)};\n${
    exportNames.length > 0
      ? `const {\n${namedLines}\n} = __mod__ as any;\n` + `export {\n${namedLines}\n};\n`
      : ''
  }export default __mod__;\n`;

  // Externalise the OTHER three runtime packages so they don't get bundled
  // multiple times into this one. The importmap re-stitches at runtime — the
  // browser resolves every reference to a single module URL per package, so
  // React's module-singleton invariant is preserved (no Invalid-Hook-Call).
  //
  // Bun's `external` field is package-name prefixed — listing "react" also
  // marks "react/jsx-runtime" external, which would defeat the per-subpath
  // bundles. We instead pin externals via a `onResolve` plugin so each
  // specifier is matched literally (exact-string compare). Any specifier NOT
  // in `externalSpecifiers` falls through to the default node_modules resolver
  // and gets inlined.
  const externalSpecifiers = new Set<string>(
    RUNTIME_PACKAGES.filter((p) => p !== pkg).flatMap((p) => [p, ...subPathExternals(p)])
  );

  const built = await Bun.build({
    entrypoints: [entryName],
    target: 'browser',
    format: 'esm',
    minify: opts.minify ?? false,
    splitting: false,
    define: {
      // Force React's production module (smaller, no dev-only `let React`
      // reassignment that triggers Bun.build's bundler-rename collision with
      // the `import * as React from "react"` namespace binding). The dev
      // variant has extra console-error scaffolding that's not worth the
      // bundler edge-case it forces us through.
      'process.env.NODE_ENV': '"production"',
    },
    plugins: [
      {
        name: 'synthetic-entry',
        setup(builder) {
          // Resolve the synthetic entrypoint to itself.
          builder.onResolve({ filter: new RegExp(`^${escapeRegex(entryName)}$`) }, (args) => ({
            path: args.path,
            namespace: 'synth',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'synth' }, () => ({
            contents: entryContent,
            loader: 'tsx',
          }));
        },
      },
      {
        name: 'exact-externals',
        setup(builder) {
          // Match every bare specifier — JS, JSX, TS, TSX, "react", "react-dom",
          // sub-paths, file-relative imports. We use a broad `filter` and
          // decide externalisation in the callback so we don't need to escape
          // every sub-path into the regex.
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (externalSpecifiers.has(args.path)) {
              return { path: args.path, external: true };
            }
            return null;
          });
        },
      },
    ],
  });

  if (!built.success) {
    const msg = built.logs
      .map((l) => {
        const lvl = (l as { level?: string }).level ?? 'error';
        return `[${lvl}] ${l.message}`;
      })
      .join('\n');
    const remediation = bunCacheRemediation(pkg, msg);
    throw new Error(
      `Failed to build runtime bundle for "${pkg}":\n${msg || '(no log messages)'}${
        remediation ? `\n\n${remediation}` : ''
      }`
    );
  }

  const out = built.outputs[0];
  if (!out) throw new Error(`Bun.build produced no output for runtime bundle "${pkg}"`);
  const js = await out.text();
  const etag = Bun.hash(js).toString(16);
  const entry = { js, etag };
  cache.set(pkg, entry);
  return entry;
}

/**
 * Detect the "Bun's global install cache is in a bad state" failure mode and
 * return a one-paragraph remediation message. Returns null when the build
 * failure has a different shape (real syntax error, missing package, etc.) —
 * the original log is enough then.
 *
 * Symptoms: log messages like `EISDIR reading '/Users/foo/.bun/install/cache/
 * react@19.2.6@@@1 @@1/index.js'` or `ENOENT … .bun/install/cache/<pkg>@…`.
 * Surfacing the cache path + the exact `bun pm cache rm <pkg>` command saves
 * the user from grepping the error to figure out what to do. Phase 19 / DDR-044.
 */
export function bunCacheRemediation(pkg: string, log: string): string | null {
  const cacheHit = /(EISDIR|ENOENT).*\.bun\/install\/cache\/([\w@/.-]+?)(?:@@@|\/)/i.test(log);
  if (!cacheHit) return null;
  const basePkg = pkg.split('/')[0] ?? pkg;
  return [
    `  ⚠ Bun's global package cache for "${basePkg}" appears to be in a bad state`,
    '    (truncated install, EISDIR/ENOENT on an index file).',
    '',
    `    Fix: run \`bun pm cache rm ${basePkg}\` then reload the page.`,
  ].join('\n');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Additional specifiers that resolve to the same package (e.g. `react-dom` is
 * served via the `react-dom/client` bundle but downstream imports might use
 * `react-dom` bare). Listed alongside the canonical specifier in the externals
 * list so internal imports of these sibling paths don't drag the runtime back
 * into the bundle.
 */
function subPathExternals(_pkg: RuntimePackage): string[] {
  // Phase 5.1 — `react-dom` is now its own RUNTIME_PACKAGES entry (so
  // `createPortal` is bundled and reachable). No aliases needed; the package
  // list already covers every specifier the importmap routes.
  return [];
}

/**
 * Pre-warm every sub-bundle. Called eagerly at server boot when the
 * MDCC_PREWARM_RUNTIME env var is set; otherwise bundles build on first GET.
 * The warm-up adds ~200 ms to startup; default off because the dev-server's
 * own cold-start is already the longest tail.
 */
export async function prewarmRuntimeBundles(): Promise<void> {
  // Arrow, not a bare reference: `.map` passes (value, index, array), so
  // `.map(getRuntimeBundle)` handed the ARRAY INDEX to the function's optional
  // `opts` parameter — every pre-warm after the first ran with a nonsense
  // options object. Silent, because a pre-warm that misbehaves just means the
  // real build happens on first GET.
  await Promise.all(RUNTIME_PACKAGES.map((pkg) => getRuntimeBundle(pkg)));
}
