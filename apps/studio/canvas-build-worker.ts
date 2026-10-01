// The cell's canvas build, in its own process — Cloud Phase 25 A1, moved to the
// studio by Cloud Phase 27 / DDR-209 A′2.
//
// WHY A SEPARATE PROCESS, AND WHY BUN.
//
// Phase 25 A0 decided the cell BUILDS a tenant's canvas and the member's browser
// EVALUATES it. "Build is not evaluation" is only true if the build cannot be
// made to do anything else, so the build runs where it can be bounded:
//
//   - its own process, spawned with an EMPTY environment — the derived cell
//     secret, the project token key and the tenant's storage credentials are
//     all env vars in the server, and none of them exist here;
//   - a wall-clock deadline and an RSS ceiling enforced by the parent, so a
//     pathological import graph costs one killed process, not the cell;
//   - an import allowlist (canvas-build.ts `restrictImportsTo`), so a tenant's
//     source can reach the runtime packages, `@maude/canvas-lib`, and its own
//     files — and nothing else on this disk.
//
// WHY IT MOVED. It used to live at `apps/hub/src/canvas/build-worker.ts` and
// import this engine across the repo. DDR-209 A′2 deletes the hub's canvas
// implementation and runs the REAL studio in the cell, so the host has to live
// where the route it protects lives. Nothing about the contract changed — the
// empty env, the allowlist and the ceilings are the same ones, and
// `scripts/check-containment.sh` still asserts every one of them.
//
// It runs under BUN rather than the hub's Node so the output is the SAME
// artifact the desktop produces: same `Bun.hash`-derived `data-cd-id`s (so a
// comment anchored in the browser resolves in the desktop and back), and the
// same `Bun.build` bundle. The alternative — esbuild — was measured at 0.6%
// median drift in the Phase 21 spike; identical beats measured-close, and it
// removes a whole class of "renders differently in the browser" bug reports.
//
// Protocol: argv gives the design root and the canvas path; stdout carries one
// JSON object. Nothing else is printed on the happy path, so the parent parses
// stdout wholesale.

import { join } from 'node:path';

// The optional third argument is the URL the design root is served under
// (BuildCanvasOptions.assetUrlBase) — absent keeps the bundler's own handling.
const [, , designRoot, canvasAbs, assetUrlBase] = process.argv;

/**
 * Where the build engine lives.
 *
 * A DYNAMIC import, not a static one, because this file runs from two very
 * different layouts: a dev checkout (a sibling of `canvas-build.ts`) and the
 * cell image, where the Dockerfile stages the studio source wherever it likes.
 * `MAUDE_STUDIO_SRC` is passed through the sandbox's otherwise-empty environment
 * on purpose — it is a path, not a secret.
 *
 * `import.meta.dir`, NOT `paths.ts`: this file is deliberately dependency-free
 * so the sandboxed child imports the engine and nothing else. DDR-045's rule is
 * about the SERVER's disk paths under `bun --compile`; the worker is never
 * compiled — it is always run as source by an explicit `bun <path>` the parent
 * resolved through `paths.ts` already.
 */
function studioDir(): string {
  return process.env.MAUDE_STUDIO_SRC || import.meta.dir;
}

async function main() {
  if (!designRoot || !canvasAbs) {
    process.stdout.write(JSON.stringify({ ok: false, error: 'usage: <designRoot> <canvasAbs>' }));
    process.exit(2);
  }
  const { buildCanvasModule } = await import(join(studioDir(), 'canvas-build.ts'));
  const source = await Bun.file(canvasAbs).text();
  const built = await buildCanvasModule(canvasAbs, source, {
    designRoot,
    restrictImportsTo: designRoot,
    ...(assetUrlBase ? { assetUrlBase } : {}),
  });
  process.stdout.write(
    JSON.stringify({ ok: true, js: built.js, locator: built.locator, etag: built.etag })
  );
}

main().catch((err) => {
  // The message is the product surface: a rejected import, a syntax error or a
  // missing sibling all arrive here, and the person who wrote the canvas is
  // the one who has to act on it. Bun collapses plugin throws into the build
  // log, so the allowlist's own wording survives in `err.message`.
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: String(err?.message ?? err).slice(0, 4000),
      // A NUMBER, never the specifiers. The host counts these; the strings
      // stay between the canvas and the person who wrote it.
      rejectedImports: Number(err?.rejectedImports ?? 0) || 0,
    })
  );
  process.exit(1);
});
