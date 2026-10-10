// Lazy IIFE bundling of ESM libraries that need to run inside `page.evaluate`.
//
// `dom-to-svg` and `dom-to-pptx` ship as Node ESM only — they can't be
// `<script>`-loaded into a browser context as-is. Bun.build turns them into
// single-file IIFE bundles cached under the OS temp dir so the playwright
// shims can `addScriptTag({ path })` without re-bundling per request.

import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DEV_SERVER_ROOT } from '../paths.ts';

interface CachedBundle {
  path: string;
  ready: Promise<string>;
}

const bundles = new Map<string, CachedBundle>();

async function buildIife(entry: string, globalName: string, cachePath: string): Promise<string> {
  if (existsSync(cachePath)) return cachePath;
  // Bun.build doesn't expose IIFE directly — wrap a generated ESM bundle with
  // a tiny shim that exposes its exports as a window global.
  const built = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format: 'esm',
    minify: true,
  });
  if (!built.success) {
    throw new Error(`bundle ${entry} failed: ${built.logs.map((l) => l.message).join('; ')}`);
  }
  const firstOutput = built.outputs[0];
  if (!firstOutput) throw new Error(`bundle ${entry} produced no outputs`);
  const esm = await firstOutput.text();
  // ESM → IIFE wrapper: evaluate the module as a Function body, then attach
  // its exports to `window[globalName]`. We can't use top-level `import`
  // inside a Function, so we transform `export {` to assignments via regex
  // — the Bun-emitted bundle is consistent (`export { a as foo, b as bar };`).
  const exportsMatch = esm.match(/export\s*\{([^}]+)\}\s*;?\s*$/);
  let body = esm;
  let exportsBlock = '';
  if (exportsMatch) {
    body = esm.slice(0, exportsMatch.index);
    const captured = exportsMatch[1] ?? '';
    const entries = captured
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        // `localName as exportedName` | bare `name`
        const m = s.match(/^(.+?)\s+as\s+(.+)$/);
        if (m?.[1] && m[2]) return { local: m[1].trim(), exported: m[2].trim() };
        return { local: s, exported: s };
      });
    exportsBlock = entries
      .map(
        (e) =>
          `globalThis[${JSON.stringify(globalName)}][${JSON.stringify(e.exported)}] = ${e.local};`
      )
      .join('\n');
  }
  const iife = `(function(){
  globalThis[${JSON.stringify(globalName)}] = globalThis[${JSON.stringify(globalName)}] || {};
  ${body}
  ${exportsBlock}
})();`;
  await Bun.write(cachePath, iife);
  return cachePath;
}

/**
 * DDR-231 (hybrid export lanes) — bundle the SHARED capture spine
 * (`capture-core.ts`) for injection into the playwright SVG shim's page. The
 * module's top-level side effect assigns `window.__maudeCaptureCore`; the shim
 * injects it as a module script next to the dom-to-svg IIFE and calls the SAME
 * functions the canvas runtime's export-capture bridge imports directly —
 * one source, two hosts (the single-spine rule).
 */
let captureCoreReady: Promise<string> | null = null;
export function getCaptureCoreBundle(): Promise<string> {
  if (captureCoreReady) return captureCoreReady;
  const entry = path.join(DEV_SERVER_ROOT, 'exporters', 'capture-core.ts');
  captureCoreReady = (async () => {
    const built = await Bun.build({
      entrypoints: [entry],
      target: 'browser',
      format: 'esm',
      minify: true,
      conditions: ['browser', 'import'],
    });
    if (!built.success) {
      throw new Error(`capture-core bundle failed: ${built.logs.map((l) => l.message).join('; ')}`);
    }
    const first = built.outputs[0];
    if (!first) throw new Error('capture-core bundle produced no outputs');
    return writeHashedBundle(await first.text(), 'maude-capture-core');
  })();
  return captureCoreReady;
}

/**
 * DDR-148 — build the in-page video encoder (`video-encode-lib.ts`) to a
 * self-contained browser ESM module cached under the OS temp dir. It imports
 * mediabunny + gifenc (both INLINED — no externals) and assigns
 * `window.__maudeEnc`; the capture shim injects it via
 * `page.addScriptTag({ content, type: 'module' })`. Returns the cache path.
 *
 * Unlike getBrowserBundle this bundles a LOCAL source entry (not an npm
 * package) and keeps ESM (the module's top-level `window.__maudeEnc = …` side
 * effect runs on load — no IIFE export-hoisting needed).
 */
let encodeLibReady: Promise<string> | null = null;
export function getEncodeLibBundle(): Promise<string> {
  if (encodeLibReady) return encodeLibReady;
  // DDR-045: derive from DEV_SERVER_ROOT, never `import.meta.dir`. In a compiled
  // binary the latter is the virtual `/$bunfs/root`, so `Bun.build` fails with
  // "failed to open root directory: /$bunfs/root" (the mp4/gif export bug).
  const entry = path.join(DEV_SERVER_ROOT, 'exporters', 'video-encode-lib.ts');
  encodeLibReady = (async () => {
    const built = await Bun.build({
      entrypoints: [entry],
      target: 'browser',
      format: 'esm',
      minify: true,
      conditions: ['browser', 'import'],
    });
    if (!built.success) {
      throw new Error(`encode-lib bundle failed: ${built.logs.map((l) => l.message).join('; ')}`);
    }
    const first = built.outputs[0];
    if (!first) throw new Error('encode-lib bundle produced no outputs');
    return writeHashedBundle(await first.text(), 'maude-video-encode-lib');
  })();
  return encodeLibReady;
}

/**
 * DDR-148 addendum (audio export) — build the in-page whole-comp renderer
 * (`video-render-lib.ts`, wraps @remotion/web-renderer's renderMediaOnWeb) to a
 * self-contained browser ESM module cached under the OS temp dir. Assigns
 * `window.__maudeRenderVideo__`; the capture shim injects it via addScriptTag
 * before calling `window.__maude_render_video__` (video-comp.tsx bridge).
 *
 * UNLIKE getEncodeLibBundle, this externalizes 'remotion' + '@remotion/media' —
 * they must resolve to the SAME module instances the canvas's importmap already
 * loaded (dual-package hazard: a second bundled copy would give
 * renderMediaOnWeb's internal Composition/context providers a different
 * `TimelineContext` than the one the passed `component`'s hooks read from,
 * freezing every frame at 0 / silencing audio). The browser's importmap
 * (declared in _shell.html) resolves these bare specifiers even for a
 * dynamically injected `<script type=module>` tag.
 */
let webRendererLibReady: Promise<string> | null = null;
export function getWebRendererBundle(): Promise<string> {
  if (webRendererLibReady) return webRendererLibReady;
  const entry = path.join(DEV_SERVER_ROOT, 'exporters', 'video-render-lib.ts');
  webRendererLibReady = (async () => {
    // Bun's `external` field is package-name PREFIX matched (runtime-bundle.ts's
    // comment on the same gotcha) — listing 'remotion' also externalizes deep
    // subpaths like 'remotion/version' (a real import inside web-renderer's own
    // dependency tree). The importmap only maps the bare 'remotion' specifier, so
    // an externalized 'remotion/version' 404s in the browser with "Failed to
    // resolve module specifier". Use an exact-match onResolve plugin (mirrors
    // canvas-build.ts's `exact-externals`) so ONLY the specifiers the importmap
    // actually covers are externalized; every subpath (version, no-react, etc.)
    // gets bundled inline like any other dependency.
    //
    // react/react-dom MUST also be externalized here (not just remotion) — a
    // second bundled React copy inside this module renders the SAME `component`
    // reference the page's importmap-loaded React created, and two React
    // instances in one page is the textbook "Invalid Hook Call" (minified React
    // error #321): the component's hooks resolve against instance A's dispatcher
    // while web-renderer's internal renderer/reconciler is instance B. Discovered
    // empirically — the first working build threw exactly this error.
    const EXTERNAL_EXACT = new Set([
      'remotion',
      '@remotion/media',
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
    ]);
    const built = await Bun.build({
      entrypoints: [entry],
      target: 'browser',
      format: 'esm',
      minify: true,
      conditions: ['browser', 'import'],
      plugins: [
        {
          name: 'exact-externals',
          setup(builder) {
            builder.onResolve({ filter: /.*/ }, (args) => {
              if (EXTERNAL_EXACT.has(args.path)) return { path: args.path, external: true };
              return null;
            });
          },
        },
      ],
    });
    if (!built.success) {
      throw new Error(`web-renderer bundle failed: ${built.logs.map((l) => l.message).join('; ')}`);
    }
    const first = built.outputs[0];
    if (!first) throw new Error('web-renderer bundle produced no outputs');
    return writeHashedBundle(await first.text(), 'maude-video-render-lib');
  })();
  return webRendererLibReady;
}

/**
 * Write a built browser bundle to a CONTENT-ADDRESSED temp path.
 *
 * These used to go to a fixed name (`maude-video-encode-lib.mjs`). Two Maude
 * servers at different versions is a documented normal state in this repo — the
 * desktop app and a terminal dev server — and they share one OS temp dir, so
 * they raced to write that single path. The loser then injected the winner's
 * bundle: an old shim could hand bytes to a newer lib, or vice versa. Nothing
 * about that failure is legible from the outside; it looks like a corrupt
 * export. Hashing the content makes a mismatched pair impossible to construct.
 */
async function writeHashedBundle(code: string, stem: string): Promise<string> {
  const hash = new Bun.CryptoHasher('sha256').update(code).digest('hex').slice(0, 12);
  const cachePath = path.join(tmpdir(), `${stem}.${hash}.mjs`);
  if (!existsSync(cachePath)) await Bun.write(cachePath, code);
  return cachePath;
}

/**
 * Returns the path to an IIFE bundle for the given npm package, attaching its
 * exports under `window[globalName]`. Caches under the OS temp dir so a long-
 * running dev server pays the build cost once.
 */
/**
 * The package's entry FILE on disk, found by walking up from DEV_SERVER_ROOT (V2-2.8 P1).
 * NOT `require.resolve`: inside the `bun --compile` sidecar a runtime resolve of a package that is
 * not embedded never reaches disk (DDR-045 class) — SVG export failed "Cannot find module
 * 'dom-to-svg'" in the desktop app. Bun.build then bundles from this path, the way
 * video-encode-lib.ts reaches mediabunny.
 */
export function packageEntry(name: string, from: string = DEV_SERVER_ROOT): string {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const pkgDir = path.join(dir, 'node_modules', name);
    const pj = path.join(pkgDir, 'package.json');
    if (existsSync(pj)) {
      const pkg = JSON.parse(readFileSync(pj, 'utf8')) as { module?: string; main?: string };
      return path.join(pkgDir, pkg.module ?? pkg.main ?? 'index.js');
    }
    if (path.dirname(dir) === dir) throw new Error(`Cannot find package '${name}' from ${from}`);
  }
}

export function getBrowserBundle(packageName: string, globalName: string): Promise<string> {
  const key = `${packageName}::${globalName}`;
  const existing = bundles.get(key);
  if (existing) return existing.ready;

  const entry = packageEntry(packageName);
  const cachePath = path.join(
    tmpdir(),
    `maude-${packageName.replace(/[^a-z0-9]/gi, '_')}-${globalName}.iife.js`
  );
  const ready = buildIife(entry, globalName, cachePath);
  bundles.set(key, { path: cachePath, ready });
  return ready;
}
