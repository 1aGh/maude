// #169 T8.1c — `@maude/canvas-lib` as ONE shared browser module (decision v2-2.17-version-picture-
// budget-open: "the lever is smaller canvas modules — share canvas-lib").
//
// Every canvas module used to inline the whole canvas library (~2.3 MB of the ~2.4 MB a canvas
// module weighs), so each canvas frame and each version picture fetched, parsed and evaluated its
// own copy. It is now built once per server (per chrome edit) and served beside the runtime bundles
// at `/_canvas-runtime/canvas-lib.<hash>.js`; the shell's importmap maps the bare specifier to it,
// and a canvas build leaves the specifier external (canvas-build.ts `sharedCanvasLib`).
//
// Why `/_canvas-runtime/` and not a new route: it IS runtime — Maude's own code, with no project
// content in it — and that prefix is already in every canvas-origin list with the same meaning
// (`CANVAS_SAFE_API`'s prefix rule, `framelessAllowed`, the capture origin's GET-only gate), so the
// shared module adds no route and no allowlist entry. It cannot join the committed `dist/runtime`
// bundles: it is source, rebuilt when the studio's own files change.
//
// The hash in the URL is the content's, so the answer is immutable: a frame on a canvas-lib edit is
// reloaded with a new shell (new importmap), never handed different bytes under the same URL. The
// last few builds stay servable, so a shell loaded just before an edit still finds its module.
//
// One module instance per document is also what canvas-lib's module state was written for: the
// soft reload re-imports only the canvas, so the live camera (`liveViewport`) outlives the remount.

import { realpathSync } from 'node:fs';
import path from 'node:path';

import { canvasLibPath } from './canvas-lib-resolver.ts';
import { canvasDefines } from './release-build.ts';
import { RUNTIME_PACKAGES } from './runtime-bundle.ts';

export interface SharedCanvasLib {
  /** Module bytes (UTF-8). */
  bytes: Uint8Array<ArrayBuffer>;
  /** Content hash (hex) — the URL key and the ETag. */
  hash: string;
  /** The URL the shell's importmap names, relative to the shell document. */
  url: string;
  /** Every file the module bundled, absolute real paths. A canvas bundle may inline none of them. */
  inputs: ReadonlySet<string>;
}

/** `/_canvas-runtime/<slug>` of the shared module (the hash is hex). */
export const SHARED_LIB_SLUG_RE = /^canvas-lib\.([0-9a-f]{8,32})\.js$/;

const KEEP = 3;
const served = new Map<string, SharedCanvasLib>();
let current: Promise<SharedCanvasLib> | null = null;
let builder: () => Promise<SharedCanvasLib> = buildSharedCanvasLib;

/**
 * The shared module for the studio's canvas-lib as it is now: built on first use, then reused until
 * `invalidateSharedCanvasLib`. A failed build stays failed until then, so a shell and the canvas
 * builds of one chrome version agree on whether the module exists.
 */
export function sharedCanvasLib(): Promise<SharedCanvasLib> {
  if (!current) {
    current = builder().then((lib) => {
      served.delete(lib.hash);
      served.set(lib.hash, lib);
      while (served.size > KEEP) served.delete(served.keys().next().value as string);
      return lib;
    });
    current.catch(() => {});
  }
  return current;
}

/** The studio's own source changed (http.ts chrome watchers): the next use rebuilds. */
export function invalidateSharedCanvasLib(): void {
  current = null;
}

/** A built module by the hash in its URL — the current one or one of the last few. */
export function sharedCanvasLibByHash(hash: string): SharedCanvasLib | null {
  return served.get(hash) ?? null;
}

/** @internal Test seam — swap the builder (and forget every build). */
export function setSharedCanvasLibBuilderForTest(
  fn: (() => Promise<SharedCanvasLib>) | null
): void {
  builder = fn ?? buildSharedCanvasLib;
  served.clear();
  current = null;
}

async function buildSharedCanvasLib(): Promise<SharedCanvasLib> {
  const externals = new Set<string>(RUNTIME_PACKAGES);
  const built = await Bun.build({
    entrypoints: [canvasLibPath()],
    target: 'browser',
    format: 'esm',
    splitting: false,
    throw: false,
    metafile: true,
    // Whitespace + syntax only: identifiers keep their names (component names, `fn.name`), and the
    // build's `// <path>` comments — the install path — do not reach the canvas origin.
    minify: { whitespace: true, syntax: true, identifiers: false },
    // The canvas builds' own defines (canvas-build.ts): both halves agree on the JSX runtime flavour.
    define: { 'process.env.NODE_ENV': '"production"', ...canvasDefines() },
    plugins: [
      {
        name: 'runtime-externals',
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) =>
            externals.has(args.path) ? { path: args.path, external: true } : null
          );
        },
      },
    ],
  });
  if (!built.success) {
    throw new Error(
      `[@maude/canvas-lib] shared module build failed: ${built.logs.map((l) => l.message).join('\n')}`
    );
  }
  const js = built.outputs.find((o) => o.kind === 'entry-point');
  if (!js || built.outputs.length !== 1) {
    // A second output (a stylesheet, a chunk) would be bytes no canvas loads: never serve a
    // half-module. The caller falls back to inlining canvas-lib into each canvas.
    throw new Error('[@maude/canvas-lib] shared module build produced more than one output');
  }
  const bytes = new Uint8Array(await js.arrayBuffer());
  const hash = Bun.hash(bytes).toString(16).padStart(16, '0');
  const inputs = new Set<string>();
  for (const key of Object.keys(built.metafile?.inputs ?? {})) {
    inputs.add(realOrSelf(path.isAbsolute(key) ? key : path.resolve(process.cwd(), key)));
  }
  return { bytes, hash, url: `./_canvas-runtime/canvas-lib.${hash}.js`, inputs };
}

/** `p` resolved through symlinks (a missing file as given) — both sides of the overlap check. */
export function realOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

const IMPORTMAP_RE = /(<script type="importmap">\s*)([\s\S]*?)(\s*<\/script>)/;

/**
 * The shell with `@maude/canvas-lib` mapped to the shared module. Applied before the CSP hashes the
 * inline scripts (http.ts `serveCanvasShell`), so the policy matches what is served. A shell whose
 * importmap cannot be read is returned unchanged (its canvases then fail to load the specifier,
 * which the canvas builds never emit without this mapping — see http.ts `sharedLibForCanvas`).
 */
export function withSharedCanvasLib(shellHtml: string, url: string): string {
  const m = IMPORTMAP_RE.exec(shellHtml);
  if (!m) return shellHtml;
  let map: { imports?: Record<string, string> };
  try {
    map = JSON.parse(m[2] as string);
  } catch {
    return shellHtml;
  }
  const next = { ...map, imports: { ...(map.imports ?? {}), '@maude/canvas-lib': url } };
  return shellHtml.replace(
    IMPORTMAP_RE,
    (_all, open: string, _body: string, close: string) =>
      `${open}${JSON.stringify(next, null, 2)}${close}`
  );
}
