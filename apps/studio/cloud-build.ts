// The cloud build — Cloud Phase 27 D1: ELIMINATE, do not un-route.
//
// A cell already refuses every one of these surfaces three times over: the
// route table is pruned at boot (`workspace-mode.ts`), the hub's manifest denies
// them, and a running cell 404s all of them. That is operational containment,
// and it is not the same claim as DDR-123's "claude never runs on our
// infrastructure" — which is a statement about what is IN the image, not about
// what answers. Code that is present is code that a future route, a future
// import, or a future mistake can reach.
//
// WHAT MADE THIS POSSIBLE. `--define` plus dead-code elimination does not work
// here: Bun inlines a dynamically-imported module and keeps the branch, so the
// bytes stay (verified before writing any of this — the sentinel survived a
// minified `--define`d build). What DOES work is substitution at build time:
// `Bun.build({ compile })` accepts plugins, and a plugin that replaces a module
// with an inert one removes the original from the binary entirely. Verified the
// same way: the sentinel string is absent from the compiled artifact.
//
// WHAT IS NOT ELIMINATED, AND WHY. System git stays — Phase 27 D2 makes it the
// engine a cell RUNS on, because two git engines over one index is not a race a
// careful caller can avoid. Its presence is deliberate and is not part of the
// secret-bearing surface: it carries no credential and spawns nothing the tenant
// can name.
//
// The stubs are GENERATED from each module's own export list rather than
// hand-written. A hand-written stub is a second copy of an interface, and the
// day it falls behind is the day the cloud build fails to boot for a reason
// nobody can see. Reading the real file's exports means a module that grows a
// function still stubs cleanly.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The modules a cloud build replaces, relative to `apps/studio/`.
 *
 * Each line is one of the surfaces DDR-209's D1 names. Grouped by WHY, because
 * the reason is the thing to check when deciding whether a new module belongs
 * on this list.
 */
export const CLOUD_ELIMINATED = Object.freeze([
  // The agent, and everything that starts one. DDR-123: the user's own `claude`
  // subscription, on the user's own machine, never on ours.
  'acp/index.ts',
  'acp/bridge.ts',
  'acp/login-state.ts', // the `bash -c` native installer
  'acp/probe.ts', // resolves + trusts a `claude` binary path
  'acp/plugin-bootstrap.ts',
  // Other ACP agents (DDR-252): discovery runs vendor binaries, connect runs the conformance probe and
  // vendor sign-in, the key routes hold BYOK chat keys. All of it is `/_api/agents`; stubbing the
  // route module takes acp/agents/* and acp/policy/* out of the graph with it.
  'routes/agents.ts',
  // Shell probes — `$SHELL -ilc "command -v …"`. A login shell on a server is
  // an execution surface with a tenant-shaped input near it.
  'readiness.ts',
  'design-setup-readiness.ts',
  // The exporter's subprocess spine.
  'exporters/_runtime.ts',
  // BYOK: provider keys at rest, and the adapters that spend them.
  'generation/keys.ts',
  'generation/adapters/gemini.ts',
  'generation/adapters/elevenlabs.ts',
  'generation/adapters/groq.ts',
  // Endpoints that speak to somebody else's account on the user's behalf.
  'cloud/endpoints.ts',
  'github/endpoints.ts',
  // …and the REST client behind it, which `git/endpoints.ts` also reaches for
  // its "open a pull request" verb. Stubbing only the endpoints left every
  // GitHub API URL in the image through that second importer — found by the
  // gate below, which is the entire reason it greps the artifact instead of
  // trusting the list.
  'github/service.ts',
  'sync/hub-link.ts',
  // The debug bundle scrubs, but it still assembles an environment report.
  'debug-bundle.ts',
]);

/**
 * Strings that must not appear in a cloud binary.
 *
 * The gate greps for these because a stub that silently failed to apply is
 * indistinguishable from one that worked, right up until it is not. Chosen to
 * be specific to the eliminated code rather than to any word near it.
 */
export const CLOUD_FORBIDDEN_STRINGS = Object.freeze([
  'claude-agent-acp', // the ACP adapter package
  '@agentclientprotocol/codex-acp', // the Codex ACP adapter (DDR-252)
  '-ilc', // the login-shell probe
  'application/vnd.github+json', // the REST client that speaks for a user's account
  'generativelanguage.googleapis.com', // BYOK image generation
  'api.elevenlabs.io', // BYOK audio generation
]);

// A NOTE ON CHOOSING THESE. They must be strings only OUR code can produce.
// `api.github.com` looked ideal and is useless: Bun's own runtime carries
// `GITHUB_API_DOMAIN` and `GITHUB_API_URL`, so it appears in every compiled
// binary whatever we do. A gate that can never go green teaches people to
// ignore it. Each string above is verified present in a desktop binary and
// absent from a cloud one — that pair is the assertion, not the absence alone.

/** Runtime-visible exports of a module — what a stub has to provide. Types and
 *  interfaces are erased before this matters, so they are deliberately absent. */
export function exportedNames(source: string): string[] {
  const names = new Set<string>();
  // Leading whitespace is allowed on purpose. The two failure directions are
  // not symmetric: a MISSED export is a boot-time crash in the cloud binary and
  // nowhere else, while an extra one is a duplicate `const` that fails the
  // build loudly, at the desk of whoever caused it. So this errs greedy.
  const patterns = [
    /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*export\s+class\s+([A-Za-z_$][\w$]*)/gm,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) if (m[1]) names.add(m[1]);
  }
  // `export { a, b as c }` — the re-export form.
  for (const m of source.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
    for (const part of (m[1] ?? '').split(',')) {
      const alias = part
        .split(/\s+as\s+/i)
        .pop()
        ?.trim();
      if (alias && /^[A-Za-z_$][\w$]*$/.test(alias) && alias !== 'default') names.add(alias);
    }
  }
  return [...names];
}

/**
 * The inert value every stubbed export becomes.
 *
 * A self-returning proxy rather than `() => {}` or `null`, because the callers
 * are not all the same shape: one boot path calls `createExportJobQueue(...)`
 * and hands the result to the route table, another calls `installLogRing()` for
 * its side effect, a third reads a property off what `createAcp` returned. A
 * value that answers every one of those with another inert value cannot crash a
 * boot on a shape nobody remembered.
 *
 * It is deliberately NOT thenable: `await inert` must yield the proxy, not hang
 * forever waiting for a `then` that never resolves.
 */
const INERT_SOURCE = `
const inert = new Proxy(function cloudEliminated() {}, {
  get(_t, key) {
    if (key === 'then') return undefined;
    if (key === Symbol.toPrimitive || key === 'toString') return () => '';
    if (key === Symbol.iterator) return function* () {};
    return inert;
  },
  apply: () => inert,
  construct: () => inert,
});
`;

/** Build the replacement source for one eliminated module. */
export function stubSource(original: string): string {
  const names = exportedNames(original);
  const decls = names.map((n) => `export const ${n} = inert;`).join('\n');
  return `${INERT_SOURCE}\n${decls}\nexport default inert;\n`;
}

/**
 * The Bun plugin. Pass it to `Bun.build({ plugins: [cloudStubPlugin(root)] })`.
 *
 * `onLoad` rather than `onResolve`: the module still resolves to its real path
 * (so a typo in the list is a build error rather than a silent no-op), and only
 * its CONTENTS are replaced.
 */
export function cloudStubPlugin(studioRoot: string): import('bun').BunPlugin {
  const targets = new Set(CLOUD_ELIMINATED.map((rel) => path.join(studioRoot, rel)));
  const applied = new Set<string>();

  // A LISTED PATH THAT DOES NOT EXIST IS A BUILD FAILURE, NOT A LOG LINE.
  //
  // The plugin matches by exact resolved path, so a rename, a move to `.tsx` or
  // a typo silently stops eliminating that module — and the "never imported"
  // notice below reads as ordinary, because it IS ordinary when a leaf leaves
  // the graph with its stubbed importer. The two cases are indistinguishable at
  // the end of a build, so they are distinguished HERE, where one of them is
  // simply a path that is not on disk.
  const missing = CLOUD_ELIMINATED.filter((rel) => !existsSync(path.join(studioRoot, rel)));
  if (missing.length) {
    throw new Error(
      `cloud build: ${missing.length} module(s) in CLOUD_ELIMINATED do not exist — ` +
        `a rename or a typo means they are NOT being eliminated: ${missing.join(', ')}`
    );
  }
  return {
    name: 'maude-cloud-eliminate',
    setup(build) {
      build.onLoad({ filter: /\.ts$/ }, (args) => {
        if (!targets.has(args.path)) return undefined;
        applied.add(args.path);
        return { contents: stubSource(readFileSync(args.path, 'utf8')), loader: 'ts' };
      });
      build.onEnd?.(() => {
        // A module on the list the graph never reached is USUALLY success, not
        // drift: stubbing `acp/index.ts` takes `acp/bridge.ts` out of the graph
        // with it, so the leaf is eliminated by the same stroke and never gets
        // loaded. Reported at info level for exactly that reason — it is worth
        // seeing (a typo'd path looks identical) and it is not a failure.
        const unused = [...targets].filter((t) => !applied.has(t));
        if (unused.length) {
          console.log(
            `[cloud-build] ${unused.length} listed module(s) left the graph with their importer ` +
              `(or are no longer imported at all): ${unused.map((u) => path.basename(u)).join(', ')}`
          );
        }
      });
    },
  };
}
