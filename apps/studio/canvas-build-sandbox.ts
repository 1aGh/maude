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

import { bothForms } from './access/frame.ts';
import { budgetFromEnv, createModuleCache } from './canvas-module-cache.ts';
import { DEV_SERVER_ROOT } from './paths.ts';

const warnedKnobs = new Set<string>();

/**
 * One sandbox ceiling from the environment: a whole number inside `[min, max]`. Anything that is not
 * a number falls back to `def`; a number outside the range is clamped. Either is said once per
 * process — an operator who typed `90s` must learn it was ignored, but a request loop must not
 * repeat it. (`Number('')` is 0 and `Number('abc')` is NaN: both used to reach `setTimeout` as-is,
 * and a NaN deadline fires at once — every build "timed out" immediately.)
 */
export function sandboxKnob(
  env: NodeJS.ProcessEnv,
  name: string,
  def: number,
  min: number,
  max: number
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw.trim());
  const say = (msg: string) => {
    if (warnedKnobs.has(name)) return;
    warnedKnobs.add(name);
    console.warn(`[canvas-build] ${name} ${msg}`);
  };
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(n)) {
    say(`is not a whole number; using ${def}`);
    return def;
  }
  if (n < min || n > max) {
    const c = Math.min(max, Math.max(min, n));
    say(`${n} is outside ${min}–${max}; using ${c}`);
    return c;
  }
  return n;
}

/**
 * The HARD ceiling: wall clock a build may run before it is stopped, whether or not anyone is still
 * waiting for it (2.0.4 task P). It was 20 s and was also the request's wait, so a design system
 * board that needs 30 s on a shared host was killed on every open and — a timed-out build is never
 * cached — never drew. A build now outlives its request up to this ceiling and is cached; one per
 * canvas at a time (a newer source supersedes it), so the ceiling bounds the CPU a canvas can hold.
 */
export const BUILD_TIMEOUT_MS = sandboxKnob(
  process.env,
  'MAUDE_CANVAS_BUILD_TIMEOUT_MS',
  90_000,
  5_000,
  600_000
);
/**
 * How long a REQUEST waits for its build. Past it the request answers "still building" (503 +
 * Retry-After) and the build goes on; the next open is a cache hit. Never longer than the ceiling.
 */
export const BUILD_WAIT_MS = Math.min(
  BUILD_TIMEOUT_MS,
  sandboxKnob(process.env, 'MAUDE_CANVAS_BUILD_WAIT_MS', 20_000, 1_000, 120_000)
);
/** Resident memory a build process may reach before it is killed. */
export const BUILD_RSS_LIMIT_MB = sandboxKnob(
  process.env,
  'MAUDE_CANVAS_BUILD_RSS_MB',
  768,
  128,
  8_192
);
/** How many built modules to keep. Each is a string that bundles the shared chrome — ~2 MB of
 *  text however small the canvas (issue #204), so the byte bound below is the one that bites. */
export const CACHE_MAX_ENTRIES = sandboxKnob(
  process.env,
  'MAUDE_CANVAS_CACHE_ENTRIES',
  64,
  1,
  1_024
);
/** Issue #204 — what the kept modules may weigh in all, counted at two bytes a character (a JS
 *  string holding any non-Latin-1 character). The module route keeps its own byte-bounded copy in
 *  front of this one (http.ts `canvasCache`), so this cache only saves a rebuild after that one
 *  evicted; 64 two-megabyte strings held here were ~270 MB of a cell's heap. */
export const CACHE_MAX_BYTES = budgetFromEnv('MAUDE_CANVAS_SANDBOX_CACHE_MB', 32);

export interface SandboxBuildOk {
  ok: true;
  js: string;
  locator: unknown;
  etag: string;
  /** gate-b-c4e — every file the module inlined, absolute (canvas-build.ts `inputs`). */
  inputs: string[];
  cached: boolean;
}
export interface SandboxBuildFail {
  ok: false;
  error: string;
  /**
   * `building` is not a failure: the request's wait ran out while the build goes on (task P), or a
   * newer source superseded it. `settled` is the build itself, for whoever records its outcome.
   */
  kind: 'build' | 'timeout' | 'memory' | 'runtime' | 'building';
  settled?: Promise<SandboxBuildResult>;
  /** How many imports the allowlist refused. A COUNT — never the specifiers. */
  rejectedImports?: number;
  /** gate-b-c4m — the canvas's own source did not parse (a `TranspileError`), nothing it imports. */
  transpile?: boolean;
  /** #189 — the worker stopped before its build engine loaded (Maude's side, never the canvas's). */
  engine?: boolean;
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
  /** Requests whose wait ran out while their build went on (task P). */
  stillBuilding: 0,
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
  counters.stillBuilding = 0;
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
    stillBuilding: counters.stillBuilding,
    /** Builds running right now (a gauge, not windowed). */
    inFlight: inflight.size,
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
  for (const run of inflight.values()) run.stop(SUPERSEDED);
  inflight.clear();
}

type CachedBuild = { js: string; locator: unknown; etag: string; inputs: string[] };
/** key → { js, locator, etag, inputs }, LRU under both bounds. */
const cache = createModuleCache<{ bytes: number; build: CachedBuild }>({
  maxBytes: CACHE_MAX_BYTES,
  maxEntries: CACHE_MAX_ENTRIES,
});

/** A build that is running: who it is for, its outcome, and how to stop it early. */
interface Inflight {
  key: string;
  promise: Promise<SandboxBuildResult>;
  stop: (outcome: SandboxBuildFail) => void;
}
/**
 * canvas (absolute) → its ONE running build (task P). Concurrent opens of the same source share it;
 * a request for a newer source of the same canvas stops it first, so a canvas never holds more than
 * one build's CPU and memory, however many people open it or however fast it is edited.
 */
const inflight = new Map<string, Inflight>();

const SUPERSEDED: SandboxBuildFail = {
  ok: false,
  kind: 'building',
  error: 'a newer version of this canvas is being built.',
};

/** Whether a build of this canvas is running now — what `/_api/canvas-errors` says as `building`. */
export function sandboxBuildRunning(canvasAbs: string): boolean {
  return inflight.has(resolve(canvasAbs));
}

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

function remember(key: string, value: CachedBuild): void {
  cache.set(key, { bytes: value.js.length * 2, build: value });
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
  waitMs,
  ceilingMs,
}: {
  designRoot: string;
  canvasAbs: string;
  /** BuildCanvasOptions.assetUrlBase, passed to the worker as argv[4]. */
  assetUrlBase?: string;
  env?: NodeJS.ProcessEnv;
  /** How long this request waits (default `BUILD_WAIT_MS`); the build itself may run to the ceiling. */
  waitMs?: number;
  /** The hard ceiling for a build this call starts (default `BUILD_TIMEOUT_MS`). */
  ceilingMs?: number;
}): Promise<SandboxBuildResult> {
  maybeRoll();
  const key = cacheKeyFor(designRoot, canvasAbs);
  const hit = cache.get(key)?.build;
  if (hit) {
    counters.cacheHits++;
    return { ...hit, ok: true, cached: true };
  }
  const id = resolve(canvasAbs);
  let run = inflight.get(id);
  if (run && run.key !== key) {
    // The source moved on: the running build can only produce a module nobody will be served.
    run.stop(SUPERSEDED);
    run = undefined;
  }
  if (!run) {
    counters.cacheMisses++;
    run = startBuild({
      id,
      key,
      designRoot,
      canvasAbs,
      assetUrlBase,
      env,
      ceilingMs: ceilingMs ?? BUILD_TIMEOUT_MS,
    });
  }
  const wait = Math.max(0, Math.min(waitMs ?? BUILD_WAIT_MS, ceilingMs ?? BUILD_TIMEOUT_MS));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<null>((done) => {
    timer = setTimeout(() => done(null), wait);
  });
  const result = await Promise.race([run.promise, waited]);
  clearTimeout(timer);
  if (result !== null) return result;
  counters.stillBuilding++;
  return {
    ok: false,
    kind: 'building',
    error: 'this canvas is still being built.',
    settled: run.promise,
  };
}

/** Start the one build of `key` for canvas `id`, registered until it settles. */
function startBuild({
  id,
  key,
  designRoot,
  canvasAbs,
  assetUrlBase,
  env,
  ceilingMs,
}: {
  id: string;
  key: string;
  designRoot: string;
  canvasAbs: string;
  assetUrlBase?: string;
  env: NodeJS.ProcessEnv;
  ceilingMs: number;
}): Inflight {
  // The pathological-canvas signal, measured rather than argued: a huge import
  // graph burns our Active-CPU while the tenant pays a flat rate. Bytes, never
  // filenames.
  counters.largestGraphBytes = Math.max(
    counters.largestGraphBytes,
    graphBytes(designRoot, canvasAbs)
  );
  let stopEarly: ((outcome: SandboxBuildFail) => void) | null = null;
  let stoppedWith: SandboxBuildFail | null = null;
  const entry: Inflight = {
    key,
    stop: (outcome) => {
      stoppedWith ??= outcome;
      stopEarly?.(outcome);
    },
    promise: Promise.resolve(null as unknown as SandboxBuildResult),
  };
  const started = Date.now();
  entry.promise = (async (): Promise<SandboxBuildResult> => {
    try {
      const result = stoppedWith
        ? stoppedWith
        : await runWorker({
            designRoot,
            canvasAbs,
            assetUrlBase,
            env,
            ceilingMs,
            onStart: (stop) => {
              stopEarly = stop;
              if (stoppedWith) stop(stoppedWith);
            },
          });
      const elapsed = Date.now() - started;
      counters.cpuMsTotal += elapsed;
      counters.durationsMs.push(elapsed);
      if (counters.durationsMs.length > 200) counters.durationsMs.shift();
      if (result.ok) {
        counters.builds++;
        const value = {
          js: result.js,
          locator: result.locator,
          etag: result.etag,
          inputs: result.inputs,
        };
        // Cached whether or not the request that started it is still waiting: that is the point —
        // the client that gave up gets this on its next open.
        remember(key, value);
        return { ...value, ok: true, cached: false };
      }
      if (result.kind === 'building') return result; // superseded — not a failure of this canvas
      counters.failures++;
      if (result.kind === 'timeout') counters.timeouts++;
      if (result.kind === 'memory') counters.memoryKills++;
      counters.rejectedImports += result.rejectedImports ?? 0;
      return result;
    } finally {
      if (inflight.get(id) === entry) inflight.delete(id);
    }
  })();
  inflight.set(id, entry);
  return entry;
}

async function runWorker({
  designRoot,
  canvasAbs,
  assetUrlBase,
  env,
  ceilingMs = BUILD_TIMEOUT_MS,
  onStart,
}: {
  designRoot: string;
  canvasAbs: string;
  assetUrlBase?: string;
  env: NodeJS.ProcessEnv;
  ceilingMs?: number;
  /** Hands the caller a way to stop this build early with a given outcome (supersede). */
  onStart?: (stop: (outcome: SandboxBuildFail) => void) => void;
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
  onStart?.((early) => {
    outcome ??= early;
    child.kill('SIGKILL');
  });

  const deadline = setTimeout(() => {
    outcome ??= {
      ok: false,
      kind: 'timeout',
      error: `this canvas took longer than ${Math.round(ceilingMs / 1000)}s to build and was stopped.`,
    };
    child.kill('SIGKILL');
  }, ceilingMs);

  // RSS ceiling. A hard `ulimit -v` is the obvious alternative and does not
  // work: JS runtimes reserve enormous virtual address space and would die
  // at boot. Polling resident size is honest about what is actually being
  // consumed on our bill.
  const rssPoll = setInterval(() => {
    const mb = rssMb(child.pid);
    if (mb !== null && mb > BUILD_RSS_LIMIT_MB) {
      outcome ??= {
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
      // gate-b-c4e — no input list, no module: the serve path cannot hold it to a closure.
      // gate-b-c4g (M2) — nor a list that does not name the canvas itself: an empty or missing
      // metafile is no evidence of what the module read. Fail closed.
      const entryForms = bothForms(canvasAbs);
      if (
        !Array.isArray(parsed.inputs) ||
        !parsed.inputs.every((p: unknown) => typeof p === 'string') ||
        !parsed.inputs.some((p: string) => entryForms.includes(resolve(p)))
      )
        return { ok: false, kind: 'runtime', error: 'the build reported no inputs' };
      return {
        ok: true,
        js: parsed.js,
        locator: parsed.locator,
        etag: parsed.etag,
        inputs: parsed.inputs,
        cached: false,
      };
    }
    return {
      ok: false,
      kind: 'build',
      error: String(parsed.error),
      rejectedImports: Number(parsed.rejectedImports ?? 0) || 0,
      transpile: parsed.transpile === true,
      ...(parsed.stage === 'engine' ? { engine: true } : {}),
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

/**
 * #189 — why a sandboxed build stopped, as a class the card may show, or null when the reason is
 * the canvas's own code (a syntax error, which `/_api/canvas-errors` re-reads from the file; or a
 * build error the sandbox keeps illegible, gate-b-c4m). From the host's own fields only — `kind`,
 * the worker's stage flag and the refusal COUNT — never from `error`, which quotes the build.
 */
export function sandboxFailureClass(
  built: SandboxBuildFail
): import('./canvas-source/errors.ts').BuildFailure | null {
  if (built.kind === 'building') return null; // still running — /_api/canvas-errors says `building`
  if (built.kind === 'timeout') return { class: 'timed-out' };
  if (built.kind === 'memory') return { class: 'memory' };
  if (built.kind === 'runtime') return { class: 'engine' };
  if (built.transpile) return null;
  if (built.engine) return { class: 'engine' };
  const n = Number(built.rejectedImports ?? 0);
  if (Number.isFinite(n) && n > 0) return { class: 'imports-refused', count: Math.floor(n) };
  return null;
}
