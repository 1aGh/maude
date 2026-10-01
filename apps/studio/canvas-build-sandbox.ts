// The sandbox HOST — Cloud Phase 25 A1 + A1b, moved into the studio by
// Cloud Phase 27 / DDR-209 A′2.
//
// Owns everything ABOUT a canvas build that must not live inside it: the
// ceilings, the empty environment, the content-hash cache, and the counters the
// cost surface reads. The build itself is `canvas-build-worker.ts`, running
// under Bun in its own process.
//
// WHY THIS EXISTS AT ALL, given `buildCanvasModule` is one import away. On a
// desktop, "the process that parses your canvas" and "the process you own" are
// the same process, so an in-process build costs nothing. In a cell they are
// not: the server process holds HUB_SECRET, MAUDE_PROJECT_TOKEN_KEY and the
// tenant's storage credentials, and the source being parsed is written by
// somebody who is not us. Same engine either way — a different host.
//
// THE CACHE IS AN ECONOMIC CONTROL, NOT AN OPTIMISATION (A1b). Rebuilding per
// page view makes cost scale with VIEWS; keying the built module by the hash
// of its inputs makes it scale with EDITS. That is the difference between a
// €19 plan that works and one that does not, which is why the counters below
// exist from day one rather than being retrofitted after the first invoice.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import { DEV_SERVER_ROOT } from './paths.ts';

/** Wall clock a single canvas build may take. */
export const BUILD_TIMEOUT_MS = Number(process.env.MAUDE_CANVAS_BUILD_TIMEOUT_MS ?? 20_000);
/** Resident memory a build process may reach before it is killed. */
export const BUILD_RSS_LIMIT_MB = Number(process.env.MAUDE_CANVAS_BUILD_RSS_MB ?? 768);
/** How many built modules to keep. Each is a string; canvases are ~100–400 kB. */
export const CACHE_MAX_ENTRIES = Number(process.env.MAUDE_CANVAS_CACHE_ENTRIES ?? 64);

export interface SandboxBuildOk {
  ok: true;
  js: string;
  locator: unknown;
  etag: string;
  cached: boolean;
}
export interface SandboxBuildFail {
  ok: false;
  error: string;
  kind: 'build' | 'timeout' | 'memory' | 'runtime';
  /** How many imports the allowlist refused. A COUNT — never the specifiers. */
  rejectedImports?: number;
}
export type SandboxBuildResult = SandboxBuildOk | SandboxBuildFail;

/**
 * How much history the counters hold — Cloud Phase 26 Stage 4.
 *
 * A ROLLING WINDOW, not a lifetime total: the sweep reads this hourly, and a
 * monotonic counter read at intervals turns every "how busy was the last hour"
 * question into a subtraction the reader has to get right. An hour of history
 * answers it directly.
 */
export const STATS_WINDOW_MS = Number(process.env.MAUDE_CANVAS_STATS_WINDOW_MS ?? 3_600_000);

const counters = {
  builds: 0,
  cacheHits: 0,
  cacheMisses: 0,
  failures: 0,
  timeouts: 0,
  memoryKills: 0,
  /** Imports the allowlist refused. The COUNT only — see buildStats(). */
  rejectedImports: 0,
  /** Summed wall-clock of completed builds, the closest thing to Active-CPU
   *  this side of the boundary can honestly report. */
  cpuMsTotal: 0,
  /** The biggest import graph any build had to read, in bytes. */
  largestGraphBytes: 0,
  /** Every completed build's wall-clock, newest last, capped. */
  durationsMs: [] as number[],
  /** When this window started. THE FIELD THAT MAKES A ZERO READABLE. */
  windowStartedAt: Date.now(),
};

/** Start a fresh window, keeping the cache (which is not a counter). */
function rollWindow(now: number): void {
  counters.builds = 0;
  counters.cacheHits = 0;
  counters.cacheMisses = 0;
  counters.failures = 0;
  counters.timeouts = 0;
  counters.memoryKills = 0;
  counters.rejectedImports = 0;
  counters.cpuMsTotal = 0;
  counters.largestGraphBytes = 0;
  counters.durationsMs = [];
  counters.windowStartedAt = now;
}

function maybeRoll(now = Date.now()): void {
  if (now - counters.windowStartedAt >= STATS_WINDOW_MS) rollWindow(now);
}

/**
 * A snapshot for the operator surface + the cost lane.
 *
 * COUNTS AND DURATIONS ONLY. Never a canvas name, never a path, and never the
 * text of a rejected import specifier — that specifier is written by the
 * tenant, so it is their content; the operational fact is that a rejection
 * happened, not what it said.
 *
 * `windowStartedAt` travels with the counters and is load-bearing. The window
 * lives in memory, so a cell restart resets it — and without the start time a
 * row of zeroes from a cell that rebooted a minute ago is indistinguishable
 * from a genuinely quiet hour. One of those is nothing to do; the other is a
 * crash loop.
 *
 * `cacheHitRatio` is offered for a human reading this payload directly, but
 * the two COUNTS are what travel to the operator board, which divides at read
 * time. A ratio computed over a window that reset is a confident lie.
 */
export function buildStats() {
  maybeRoll();
  const d = [...counters.durationsMs].sort((a, b) => a - b);
  const p = (q: number) =>
    d.length === 0 ? null : d[Math.min(d.length - 1, Math.floor(d.length * q))];
  const total = counters.cacheHits + counters.cacheMisses;
  return {
    builds: counters.builds,
    cacheHits: counters.cacheHits,
    cacheMisses: counters.cacheMisses,
    cacheHitRatio: total === 0 ? null : Number((counters.cacheHits / total).toFixed(3)),
    failures: counters.failures,
    timeouts: counters.timeouts,
    memoryKills: counters.memoryKills,
    rejectedImports: counters.rejectedImports,
    cpuMsTotal: counters.cpuMsTotal,
    largestGraphBytes: counters.largestGraphBytes,
    p50Ms: p(0.5),
    p95Ms: p(0.95),
    maxMs: d.length === 0 ? null : d[d.length - 1],
    windowMs: STATS_WINDOW_MS,
    windowStartedAt: counters.windowStartedAt,
  };
}

/** Record one import the allowlist refused. The specifier is NOT passed in. */
export function noteRejectedImport(): void {
  maybeRoll();
  counters.rejectedImports++;
}

/** Test seam. */
export function _resetBuildStats(): void {
  rollWindow(Date.now());
  cache.clear();
}

/** key → { js, locator, etag } */
const cache = new Map<string, { js: string; locator: unknown; etag: string }>();

/**
 * The cache key: the canvas source plus every sibling source it could pull in.
 *
 * Hashing only the entry file would serve a stale bundle after an edit to an
 * imported component — the exact bug the desktop's mtime-keyed cache had to
 * grow a watcher for. Here the inputs are cheap to enumerate (the design root
 * is small and local), so the key is honest by construction.
 */
export function cacheKeyFor(designRoot: string, canvasAbs: string): string {
  const h = createHash('sha256');
  h.update(canvasAbs);
  for (const file of relevantSources(designRoot, canvasAbs)) {
    try {
      const st = statSync(file);
      h.update(`\0${file}\0${st.size}\0${st.mtimeMs}`);
    } catch {
      h.update(`\0${file}\0missing`);
    }
  }
  return h.digest('hex');
}

/**
 * Files whose content can change a canvas's bundle: the canvas itself, and
 * every `.tsx`/`.ts`/`.css` file it can reach by relative import inside the
 * design root (transitively). The allowlist guarantees nothing outside can be
 * reached, so nothing outside can invalidate.
 */
function relevantSources(designRoot: string, canvasAbs: string): string[] {
  const seen = new Set<string>();
  const root = resolve(designRoot);
  const stack = [resolve(canvasAbs)];
  while (stack.length > 0) {
    const file = stack.pop();
    if (!file || seen.has(file) || !existsSync(file)) continue;
    if (file !== root && !file.startsWith(root + sep)) continue;
    seen.add(file);
    let src = '';
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const m of src.matchAll(/(?:from|import)\s*["'](\.[^"']+)["']/g)) {
      for (const candidate of resolveCandidates(dirname(file), m[1])) stack.push(candidate);
    }
  }
  return [...seen].sort();
}

function resolveCandidates(fromDir: string, spec: string): string[] {
  const base = resolve(fromDir, spec);
  return [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    join(base, 'index.tsx'),
    join(base, 'index.ts'),
  ];
}

/** Total bytes of every source a build could have to read. Sizes only. */
function graphBytes(designRoot: string, canvasAbs: string): number {
  let total = 0;
  for (const file of relevantSources(designRoot, canvasAbs)) {
    try {
      total += statSync(file).size;
    } catch {
      /* a file that vanished contributes nothing rather than failing a build */
    }
  }
  return total;
}

function remember(key: string, value: { js: string; locator: unknown; etag: string }): void {
  cache.set(key, value);
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
  }
}

/**
 * Resolve the runtime that runs the worker.
 *
 * In the cell image this is the Bun binary staged next to the bundle; in a dev
 * checkout it is whatever `bun` is on PATH — and inside a compiled sidecar it is
 * this very executable re-entered with `BUN_BE_BUN=1` (DDR-177: the packaged app
 * must not need a user-installed runtime). A missing runtime is a configuration
 * error the caller must surface — never a silent fallback to "no rendering",
 * which would look to a member exactly like an empty project.
 */
export function resolveBunPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.MAUDE_BUN_PATH || 'bun';
}

/** Absolute path to the worker script, resolved per DDR-045 (never a bunfs path). */
export function workerScript(env: NodeJS.ProcessEnv = process.env): string {
  const staged = env.MAUDE_CANVAS_WORKERS
    ? join(env.MAUDE_CANVAS_WORKERS, 'canvas-build-worker.ts')
    : null;
  if (staged && existsSync(staged)) return staged;
  return join(DEV_SERVER_ROOT, 'canvas-build-worker.ts');
}

/**
 * The child's environment: a PATH to exec with, a HOME for Bun's cache, and
 * the two PATHS that tell it where our own code lives. Nothing else — every
 * secret in a cell is an env var, and a build that cannot read them cannot
 * leak them, whatever a tenant's source manages to import.
 */
export function workerEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return {
    PATH: env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: env.HOME ?? '/tmp',
    // Where the engine lives. Defaulted to this install's own root so a cell
    // that stages the studio somewhere unusual still resolves it, and a dev
    // checkout needs no configuration at all.
    MAUDE_STUDIO_SRC: env.MAUDE_STUDIO_SRC ?? DEV_SERVER_ROOT,
    // NAPI_RS_NATIVE_LIBRARY_PATH is forwarded ONLY when it names a real file.
    //
    // Inside a `bun --compile` binary this variable is set at runtime by the
    // DDR-042 compile entry, to a path in that binary's OWN virtual filesystem
    // (`/$bunfs/root/…`). Handing that to a child is handing it an address that
    // exists in a different process's imagination: the child resolves
    // oxc-parser, finds the override, cannot open it, and reports "Cannot find
    // native binding" — while the very same command run by hand with a clean
    // environment works, because it then finds the real binding on disk.
    // (Which is exactly how this was diagnosed.)
    ...(env.NAPI_RS_NATIVE_LIBRARY_PATH && !isVirtualPath(env.NAPI_RS_NATIVE_LIBRARY_PATH)
      ? { NAPI_RS_NATIVE_LIBRARY_PATH: env.NAPI_RS_NATIVE_LIBRARY_PATH }
      : {}),
    // DDR-177 — when the "bun" we spawn is the compiled sidecar itself, this is
    // what makes it behave as a JS runtime instead of re-launching the server.
    ...(env.MAUDE_BUN_PATH && env.MAUDE_BUN_PATH === process.execPath ? { BUN_BE_BUN: '1' } : {}),
  };
}

/** A path inside a compiled binary's embedded filesystem — real to that process
 *  and to nothing else. Mirrors `paths.ts`'s own bunfs test. */
function isVirtualPath(p: string): boolean {
  return p.startsWith('/$bunfs') || p.startsWith('B:/~BUN');
}

/**
 * Whether the sandbox is actually wired in this install.
 *
 * This is the `sandboxArmed` input to the containment boot-assert (DDR-209 A′1):
 * a cell may serve `/_canvas-shell` and `/_canvas-runtime` only while a real,
 * runnable, out-of-process build exists. Both halves are checked because either
 * one missing means the same thing in practice — the server would fall back to
 * building tenant source in the process that holds the secrets.
 *
 * Reported rather than thrown so the boot-assert owns the refusal and its
 * wording; this function has no opinion about what a caller does with `false`.
 */
export function isSandboxArmed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!existsSync(workerScript(env))) return false;
  const bun = resolveBunPath(env);
  // A bare `bun` means "whatever is on PATH" and we cannot cheaply prove it is
  // there; an absolute path we can. Both are accepted — the spawn's own failure
  // is the backstop, and refusing to boot because PATH lookup is unverifiable
  // would make a dev checkout unable to test workspace mode at all.
  return bun === 'bun' || existsSync(bun);
}

/**
 * Build one canvas, sandboxed.
 */
export async function buildCanvasSandboxed({
  designRoot,
  canvasAbs,
  assetUrlBase,
  env = process.env,
}: {
  designRoot: string;
  canvasAbs: string;
  /** BuildCanvasOptions.assetUrlBase, passed to the worker as argv[4]. */
  assetUrlBase?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<SandboxBuildResult> {
  maybeRoll();
  const key = cacheKeyFor(designRoot, canvasAbs);
  const hit = cache.get(key);
  if (hit) {
    counters.cacheHits++;
    return { ...hit, ok: true, cached: true };
  }
  counters.cacheMisses++;
  // The pathological-canvas signal, measured rather than argued: a huge import
  // graph burns our Active-CPU while the tenant pays a flat rate. Bytes, never
  // filenames.
  counters.largestGraphBytes = Math.max(
    counters.largestGraphBytes,
    graphBytes(designRoot, canvasAbs)
  );

  const started = Date.now();
  const result = await runWorker({ designRoot, canvasAbs, assetUrlBase, env });
  const elapsed = Date.now() - started;
  counters.cpuMsTotal += elapsed;
  counters.durationsMs.push(elapsed);
  if (counters.durationsMs.length > 200) counters.durationsMs.shift();

  if (result.ok) {
    counters.builds++;
    const value = { js: result.js, locator: result.locator, etag: result.etag };
    remember(key, value);
    return { ...value, ok: true, cached: false };
  }
  counters.failures++;
  if (result.kind === 'timeout') counters.timeouts++;
  if (result.kind === 'memory') counters.memoryKills++;
  counters.rejectedImports += result.rejectedImports ?? 0;
  return result;
}

async function runWorker({
  designRoot,
  canvasAbs,
  assetUrlBase,
  env,
}: {
  designRoot: string;
  canvasAbs: string;
  assetUrlBase?: string;
  env: NodeJS.ProcessEnv;
}): Promise<SandboxBuildResult> {
  const bun = resolveBunPath(env);
  let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
  try {
    child = Bun.spawn(
      [bun, workerScript(env), designRoot, canvasAbs, ...(assetUrlBase ? [assetUrlBase] : [])],
      {
        // THE EMPTY ENVIRONMENT IS THE POINT — see workerEnv().
        env: workerEnv(env),
        cwd: designRoot,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );
  } catch (err) {
    return {
      ok: false,
      kind: 'runtime',
      error: `could not start the build: ${(err as Error).message}`,
    };
  }

  let outcome: SandboxBuildFail | null = null;

  const deadline = setTimeout(() => {
    outcome = {
      ok: false,
      kind: 'timeout',
      error: `this canvas took longer than ${Math.round(BUILD_TIMEOUT_MS / 1000)}s to build and was stopped.`,
    };
    child.kill('SIGKILL');
  }, BUILD_TIMEOUT_MS);

  // RSS ceiling. A hard `ulimit -v` is the obvious alternative and does not
  // work: JS runtimes reserve enormous virtual address space and would die
  // at boot. Polling resident size is honest about what is actually being
  // consumed on our bill.
  const rssPoll = setInterval(() => {
    const mb = rssMb(child.pid);
    if (mb !== null && mb > BUILD_RSS_LIMIT_MB) {
      outcome = {
        ok: false,
        kind: 'memory',
        error: `this canvas needed more than ${BUILD_RSS_LIMIT_MB} MB to build and was stopped.`,
      };
      child.kill('SIGKILL');
    }
  }, 500);
  rssPoll.unref?.();

  let out = '';
  let errOut = '';
  try {
    [out, errOut] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    await child.exited;
  } catch (err) {
    return { ok: false, kind: 'runtime', error: `the build failed: ${(err as Error).message}` };
  } finally {
    clearTimeout(deadline);
    clearInterval(rssPoll);
  }

  if (outcome) return outcome;

  try {
    const parsed = JSON.parse(out);
    if (parsed.ok) {
      return { ok: true, js: parsed.js, locator: parsed.locator, etag: parsed.etag, cached: false };
    }
    return {
      ok: false,
      kind: 'build',
      error: String(parsed.error),
      rejectedImports: Number(parsed.rejectedImports ?? 0) || 0,
    };
  } catch {
    return {
      ok: false,
      kind: 'runtime',
      error: `the build produced no result${errOut ? `: ${errOut.trim().slice(0, 500)}` : ''}`,
    };
  }
}

/** Resident set size of a pid in MB, or null when it cannot be read. */
function rssMb(pid: number | undefined): number | null {
  if (!pid) return null;
  try {
    // Linux (the cell). /proc/<pid>/statm reports pages; page size is 4 KiB.
    const statm = readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ');
    return (Number(statm[1]) * 4096) / (1024 * 1024);
  } catch {
    return null; // macOS dev boxes: the wall-clock ceiling still applies
  }
}
