// The supervised studio child — Cloud Phase 27 A1, under DDR-209.
//
// A cell runs the REAL `apps/studio` Bun server, bound to loopback, and the hub
// is a proxy in front of it. That makes the container a two-process container,
// and two processes under tini with no supervisor is how you get a box that
// answers 200 while half of it is dead: tini reaps, nobody restarts, and
// `/health` — served by the process that is still fine — keeps saying yes.
//
// So supervision lives HERE, in the hub, rather than in the entrypoint shell:
//
//   - the hub is what serves `/health`, so it is the only process that can make
//     a dead child visible to the router (D5);
//   - a restart loop needs backoff, and backoff needs state a shell script would
//     have to invent;
//   - the child's lifetime should end when the hub's does, which `spawn` gives
//     us and a backgrounded shell job does not.
//
// WHAT IT DELIBERATELY DOES NOT DO: give up. A cell whose studio cannot start is
// a cell whose customer sees an error page — but a cell that EXITS is a cell the
// platform restarts from cold, losing the warm working set and the pending
// autosave commit with it. It retries forever, with backoff, and tells the truth
// at `/health` the whole time.

import { spawn as nodeSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { isLoopbackUrl, sanitizeForLog } from './log-safety.mjs';

/** Backoff ladder, ms. Long enough that a crash-loop does not spin a CPU;
 *  short enough that a transient failure is invisible to whoever is waiting. */
export const BACKOFF_MS = Object.freeze([250, 500, 1000, 2000, 5000, 10_000, 30_000]);

/** How long the build counters are reused before `/health` re-probes for them. */
const RENDER_STATS_TTL_MS = 60_000;

/** How long a fresh child gets to answer `/_health` before we call it stuck. */
export const READY_TIMEOUT_MS = Number(process.env.MAUDE_STUDIO_READY_MS ?? 60_000);

/** The loopback port the studio binds inside the container. */
export const DEFAULT_STUDIO_PORT = 4399;

/**
 * The identity of a checkout, computed the same way at both ends — D5.
 *
 * The studio reports one for the tree it resolved; the supervisor computes one
 * for the tree it MEANT to hand it, and a mismatch means the customer is being
 * served something other than their project. `realpath` first so a bind-mount
 * and a symlink to the same checkout are one identity; the hash rather than the
 * path because the studio's `/_health` is reachable from the untrusted canvas
 * origin and a server path is not something tenant code should learn.
 */
export function rootIdentity(root) {
  let resolved = root;
  try {
    resolved = realpathSync(root);
  } catch {
    /* not on disk (yet) — hash what we were told, and let the two disagree */
  }
  return createHash('sha256').update(String(resolved), 'utf8').digest('hex').slice(0, 12);
}

/**
 * How to launch the studio, across the two shapes it ships in.
 *
 * A DEV CHECKOUT runs it from source under whatever `bun` is on PATH — Bun reads
 * TypeScript natively, so there is nothing to compile and editing a file is the
 * whole edit-test loop.
 *
 * THE CELL IMAGE runs the COMPILED binary (`MAUDE_STUDIO_BIN`). That is not an
 * optimisation: running from source in a cell would mean shipping the studio's
 * entire production dependency closure — remotion, pixi, onnxruntime, react-dom
 * — into an image whose SIZE an unresolved outage RCA already lists as a
 * suspect. `bun build --compile` bakes the server's own graph and tree-shakes
 * the rest, and it is the fallback the phase's cost gate names by hand.
 *
 * A compiled binary takes NO entry argument — it is its own entry. Passing one
 * would hand `server.ts` to the embedded program as a positional arg, which is
 * the kind of mistake that boots, looks fine, and serves the wrong root.
 */
export function studioLaunch(env = process.env) {
  const bin = env.MAUDE_STUDIO_BIN;
  if (bin && existsSync(bin)) return { cmd: bin, args: [], kind: 'binary' };
  const entry = studioEntry(env);
  if (!entry || !existsSync(entry)) return null;
  return { cmd: env.MAUDE_BUN_PATH || 'bun', args: [entry], kind: 'source' };
}

/** Where the studio's SOURCE entry lives, for the dev-checkout shape. */
export function studioEntry(env = process.env) {
  const candidates = [
    env.MAUDE_STUDIO_SRC ? join(env.MAUDE_STUDIO_SRC, 'server.ts') : null,
    join(process.cwd(), '..', 'studio', 'server.ts'),
    join(process.cwd(), 'apps', 'studio', 'server.ts'),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0] ?? null;
}

/**
 * The child's environment.
 *
 * NOT the parent's. `HUB_SECRET`, `MAUDE_PROJECT_TOKEN_KEY`, the tenant's
 * storage credentials and the Stripe/Cloudflare tokens all live in the hub's
 * env, and the studio needs none of them — it needs a repo, a port, and the
 * knowledge that it is a cell. This is the same reasoning as the build
 * sandbox's empty environment, one level up: the studio parses tenant source
 * (indirectly) and answers tenant-shaped requests, so it gets the smallest
 * environment that lets it work.
 *
 * The one thing it MUST be told is its public identity (D4). Behind the tunnel
 * the `Host` header is an internal name, and Phase 25 shipped that bug into
 * production twice.
 */
// The loopback check on `MAUDE_LOOPBACK_SYNC_URL` below (`isLoopbackUrl`,
// imported from `./log-safety.mjs`) mirrors `apps/studio/sync/cell-pairing.ts`'s
// OWN independent check, and that cross-app duplication is deliberate: the
// studio refuses a non-loopback URL on the receiving end, this hub refuses to
// EMIT one. Either check alone would be enough on a good day; the pair is what
// makes "a cell never dials out" (DDR-209) true even if one side is edited by
// somebody who has not read the other. `sanitizeForLog` is the SAME-app case —
// shared with `server.mjs` via the leaf, not duplicated, because both live in
// this one package with no cycle risk once factored out.

/**
 * DESKTOP ↔ CLOUD LIVE PAIRING — the block of variables that turns the studio
 * child into a peer of its OWN hub (variant C2).
 *
 * The supervisor's env carries `MAUDE_LOOPBACK_SYNC_URL` + `_TOKEN` only when
 * `server.mjs` decided to pair and minted a credential for it, so their presence
 * IS the switch — there is no third place that could say yes independently.
 *
 * The other three are not passed through from anywhere; they are asserted HERE,
 * because they are the conditions under which pairing is safe rather than
 * settings anybody should be able to vary:
 *
 *   MAUDE_SHARED_DOC=1          pairing IS the one-shared-doc model (DDR-064)
 *   MAUDE_SYNC_NO_AUTOCOMMIT=1  the hub stays the sole committer (DDR-209)
 *   MAUDE_CELL_PAIRING=1        the studio's own opt-in gate
 *
 * `MAUDE_HUB_NAMESPACED` rides along when set, because the child must compute
 * the SAME wire document name as the desktop peer it is meant to meet — a
 * mismatch there is two people editing two documents and seeing nothing.
 */
function pairingEnv(env) {
  const url = env.MAUDE_LOOPBACK_SYNC_URL;
  const token = env.MAUDE_LOOPBACK_SYNC_TOKEN;
  if (!url || !token) return {};
  if (!isLoopbackUrl(url)) {
    console.error(
      `[studio] refusing to hand the child a non-loopback pairing URL (${sanitizeForLog(url)}) — a cell syncs to itself or to nothing (DDR-209). Pairing disabled.`
    );
    return {};
  }
  return {
    MAUDE_CELL_PAIRING: '1',
    MAUDE_LOOPBACK_SYNC_URL: url,
    MAUDE_LOOPBACK_SYNC_TOKEN: token,
    MAUDE_SHARED_DOC: '1',
    MAUDE_SYNC_NO_AUTOCOMMIT: '1',
    ...(env.MAUDE_HUB_NAMESPACED ? { MAUDE_HUB_NAMESPACED: env.MAUDE_HUB_NAMESPACED } : {}),
  };
}

export function childEnv(env = process.env, { port }) {
  return {
    PATH: env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: env.HOME ?? '/tmp',
    NODE_ENV: env.NODE_ENV ?? 'production',
    // The invariant, stated to the process that enforces it.
    MAUDE_WORKSPACE_MODE: '1',
    // ONE GIT ENGINE IN A CELL — Cloud Phase 27 D2, and the prerequisite for
    // every lock in this container meaning anything.
    //
    // The studio's WRITE paths default to isomorphic-git, which keeps an
    // in-PROCESS lock and writes `.git/index` directly — it never takes
    // `.git/index.lock` and never notices one. The hub shells out to system
    // git, which does. Two engines over one index, neither able to see the
    // other, is not a race that a careful caller can avoid: it is two programs
    // writing the same file. Forcing the studio onto the same engine makes
    // git's own lock a real boundary between the two processes, and the
    // advisory lock in `apps/studio/git/repo-lock.ts` covers what `index.lock`
    // cannot (a SEQUENCE — `add` then `commit`, `checkout` then `merge`).
    //
    // Unconditional, not passed through: a cell is exactly the deployment this
    // is right for, and leaving it to an operator to remember is leaving the
    // tenant's history to chance. The cell image asserts `git` is present
    // (infra/cell/Dockerfile), so there is no fallback to be lost.
    MAUDE_USE_SYSTEM_GIT: '1',
    PORT: String(port),
    ...(env.MAUDE_REPO_DIR ? { MAUDE_REPO_DIR: env.MAUDE_REPO_DIR } : {}),
    ...(env.MAUDE_DESIGN_ROOT ? { MAUDE_DESIGN_ROOT: env.MAUDE_DESIGN_ROOT } : {}),
    ...(env.MAUDE_STUDIO_SRC ? { MAUDE_STUDIO_SRC: env.MAUDE_STUDIO_SRC } : {}),
    ...(env.MAUDE_CANVAS_WORKERS ? { MAUDE_CANVAS_WORKERS: env.MAUDE_CANVAS_WORKERS } : {}),
    ...(env.MAUDE_BUN_PATH ? { MAUDE_BUN_PATH: env.MAUDE_BUN_PATH } : {}),
    ...(env.MAUDE_STUDIO_BIN ? { MAUDE_STUDIO_BIN: env.MAUDE_STUDIO_BIN } : {}),
    ...(env.MAUDE_DEV_SERVER_ROOT ? { MAUDE_DEV_SERVER_ROOT: env.MAUDE_DEV_SERVER_ROOT } : {}),
    // D4 — public identity from configuration, never from the request.
    ...(env.MAUDE_PUBLIC_CANVAS_ORIGIN
      ? { MAUDE_PUBLIC_CANVAS_ORIGIN: env.MAUDE_PUBLIC_CANVAS_ORIGIN }
      : {}),
    // Extra legit shell embedders (frame-ancestors) — see studio server.ts.
    ...(env.MAUDE_EXTRA_SHELL_ORIGINS
      ? { MAUDE_EXTRA_SHELL_ORIGINS: env.MAUDE_EXTRA_SHELL_ORIGINS }
      : {}),
    ...(env.HUB_PUBLIC_URL ? { HUB_PUBLIC_URL: env.HUB_PUBLIC_URL } : {}),
    // C4 — a browser tab has no window title, so the client has to be told
    // which project it is showing and where "back" is.
    ...(env.HUB_DASHBOARD_URL ? { HUB_DASHBOARD_URL: env.HUB_DASHBOARD_URL } : {}),
    // Where the Report-a-Bug dialog's consented bundle goes. The studio's own
    // comment promises self-hosters can point it somewhere else — a promise
    // that was false inside a hub, because the variable never reached the
    // child and the studio fell back to the vendor's endpoint.
    ...(env.MAUDE_REPORT_URL ? { MAUDE_REPORT_URL: env.MAUDE_REPORT_URL } : {}),
    // Diagnostics only: one log line per proposal / projector write.
    ...(env.MAUDE_SYNC_DEBUG === '1' ? { MAUDE_SYNC_DEBUG: '1' } : {}),
    // feature-cloud-export-render-workers (DDR-230) — where browser-format
    // export jobs dispatch. Presence flips the studio's render lane to
    // `remote`; absent, the lane is `none` and the studio refuses those
    // formats with a remedy instead of failing into a missing browser.
    ...(env.MAUDE_RENDER_URL ? { MAUDE_RENDER_URL: env.MAUDE_RENDER_URL } : {}),
    ...(env.MAUDE_RENDER_SECRET ? { MAUDE_RENDER_SECRET: env.MAUDE_RENDER_SECRET } : {}),
    ...(env.MAUDE_RENDER_CANVAS_BASE
      ? { MAUDE_RENDER_CANVAS_BASE: env.MAUDE_RENDER_CANVAS_BASE }
      : {}),
    ...(env.MAUDE_PROJECT_NAME ? { MAUDE_PROJECT_NAME: env.MAUDE_PROJECT_NAME } : {}),
    ...(env.MAUDE_TENANT_ID ? { MAUDE_TENANT_ID: env.MAUDE_TENANT_ID } : {}),
    // A dev checkout resolves Playwright (the E2E harness) and would otherwise
    // fail the module half of the containment assert before it could be tested.
    ...(env.MAUDE_WORKSPACE_ALLOW_DEV_MODULES
      ? { MAUDE_WORKSPACE_ALLOW_DEV_MODULES: env.MAUDE_WORKSPACE_ALLOW_DEV_MODULES }
      : {}),
    // Passed through so the CONTAINER WATCHER GAP is reproducible off Linux.
    //
    // The gap is inotify-specific: on macOS `fs.watch` DOES fire for the atomic
    // tmp+rename writes the hub makes, so a developer on a laptop cannot tell
    // whether an open canvas healed because the Sync v2 control channel
    // delivered a poke or because the watcher noticed anyway. Setting
    // MAUDE_NO_WATCH=1 on a local workspace run removes the watcher and leaves
    // the poke as the ONLY path — which is exactly the cell's situation, and
    // the difference between testing the fix and testing around it.
    //
    // Its original job (a headless render server that must not hot-reload
    // mid-capture) is unchanged; this only makes it reachable from the hub's
    // environment instead of only from a direct studio launch.
    ...(env.MAUDE_NO_WATCH ? { MAUDE_NO_WATCH: env.MAUDE_NO_WATCH } : {}),
    // Cell-side kill switch for the file-event channel (DDR-226 §4) — the
    // operator runbook's twin of `linkedHub.fileEvents:false`.
    ...(env.MAUDE_FILE_EVENTS ? { MAUDE_FILE_EVENTS: env.MAUDE_FILE_EVENTS } : {}),
    ...(env.NAPI_RS_NATIVE_LIBRARY_PATH
      ? { NAPI_RS_NATIVE_LIBRARY_PATH: env.NAPI_RS_NATIVE_LIBRARY_PATH }
      : {}),
    ...pairingEnv(env),
  };
}

/**
 * Supervise one studio.
 *
 * Every side effect is injectable so the state machine can be tested without
 * spawning anything — the failure modes worth testing here (crash-loop backoff,
 * "healthy but wrong project", never-ready) are all ones a real child makes slow
 * and flaky to reproduce.
 */
export function createStudioChild({
  env = process.env,
  port = Number(env.MAUDE_STUDIO_PORT ?? DEFAULT_STUDIO_PORT),
  spawn = nodeSpawn,
  probe = defaultProbe,
  /**
   * The tree this child is SUPPOSED to serve (D5). Null disables the check —
   * a dev checkout run from the repo root has nothing meaningful to compare
   * against, and inventing an expectation there would fail closed on a shape
   * that was never at risk.
   */
  expectedRootId = env.MAUDE_REPO_DIR ? rootIdentity(env.MAUDE_REPO_DIR) : null,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  log = console,
} = {}) {
  let child = null;
  let stopped = false;
  /** False until start() is called. A supervisor that has never launched is
   *  IDLE, not "restarting" — reporting a restart it never attempted would send
   *  whoever reads /health looking for a crash that did not happen. */
  let launched = false;
  let restarts = 0;
  let consecutiveFailures = 0;
  /** Last-seen build counters + when, so a polled /health does not re-probe. */
  let renderCache = null;
  let lastExit = null;
  let startedAt = null;
  let ready = false;
  let readyAt = null;
  let timer = null;
  /** Set when a child answered, healthily, about the WRONG tree. */
  let wrongProject = null;

  function launch() {
    if (stopped) return;
    const plan = studioLaunch(env);
    if (!plan) {
      // A missing studio is a packaging bug, not a transient one. Keep retrying
      // anyway — an operator can bind-mount one into a running cell, and a
      // supervisor that gives up turns a fixable mistake into a cold restart.
      lastExit = {
        code: null,
        signal: null,
        reason: `no studio to launch (neither MAUDE_STUDIO_BIN nor a source entry resolved)`,
      };
      scheduleRestart();
      return;
    }
    startedAt = now();
    ready = false;
    let proc;
    try {
      proc = spawn(plan.cmd, [...plan.args, '--root', env.MAUDE_REPO_DIR ?? process.cwd()], {
        env: childEnv(env, { port }),
        cwd: env.MAUDE_REPO_DIR ?? process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      lastExit = { code: null, signal: null, reason: `could not start: ${err.message}` };
      scheduleRestart();
      return;
    }
    child = proc;
    // The child's output is the cell's output. Prefixed, not swallowed: the
    // containment boot-assert prints the reason it refused, and losing that
    // message would make the most informative failure the most silent one.
    proc.stdout?.on('data', (c) => process.stdout.write(prefix(c)));
    proc.stderr?.on('data', (c) => process.stderr.write(prefix(c)));
    proc.on('exit', (code, signal) => {
      if (child !== proc) return;
      child = null;
      ready = false;
      lastExit = { code, signal, reason: null, at: now() };
      if (stopped) return;
      log.error?.(`[studio] child exited (code=${code} signal=${signal}) — restarting`);
      scheduleRestart();
    });
    proc.on('error', (err) => {
      if (child !== proc) return;
      lastExit = { code: null, signal: null, reason: err.message, at: now() };
    });
    pollReady(proc);
  }

  function prefix(chunk) {
    return String(chunk)
      .split('\n')
      .filter((l, i, a) => l !== '' || i < a.length - 1)
      .map((l) => `[studio] ${l}\n`)
      .join('');
  }

  async function pollReady(proc) {
    const deadline = now() + READY_TIMEOUT_MS;
    while (!stopped && child === proc && now() < deadline) {
      const verdict = normalizeProbe(await probe(port));
      if (verdict.ok) {
        // D5 — HEALTHY BUT WRONG PROJECT. A child that answers about another
        // tree is the one failure a liveness probe cannot see and the one a
        // customer would notice first, so it is refused rather than served:
        // not ready, `/health` says no, the router stops sending. Killed and
        // retried rather than accepted, because the tree can still become the
        // right one (a rehydrate finishing after the studio started is exactly
        // how this happens); the reason is kept so /health can name it instead
        // of reporting a timeout that did not occur.
        if (expectedRootId && verdict.rootId && verdict.rootId !== expectedRootId) {
          wrongProject = { expected: expectedRootId, actual: verdict.rootId, at: now() };
          log.error?.(
            `[studio] answered about the WRONG tree (expected ${expectedRootId}, got ${verdict.rootId}) — restarting`
          );
          try {
            proc.kill('SIGKILL'); // the exit handler owns the restart
          } catch {
            /* already gone */
          }
          return;
        }
        wrongProject = null;
        ready = true;
        readyAt = now();
        consecutiveFailures = 0;
        log.log?.(`[studio] ready on 127.0.0.1:${port}`);
        return;
      }
      await sleep(250);
    }
    if (!stopped && child === proc && !ready) {
      // Never answered. Kill it rather than leave a process that is running but
      // not serving — that is the exact shape of "200 while half-dead".
      log.error?.(`[studio] did not become ready within ${Math.round(READY_TIMEOUT_MS / 1000)}s`);
      try {
        proc.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }

  function sleep(ms) {
    return new Promise((r) => {
      const t = setTimer(r, ms);
      t?.unref?.();
    });
  }

  function scheduleRestart() {
    if (stopped) return;
    restarts++;
    const delay = BACKOFF_MS[Math.min(consecutiveFailures, BACKOFF_MS.length - 1)];
    consecutiveFailures++;
    timer = setTimer(launch, delay);
    timer?.unref?.();
  }

  return {
    start() {
      stopped = false;
      launched = true;
      launch();
      return this;
    },
    async stop() {
      stopped = true;
      if (timer) clearTimer(timer);
      const proc = child;
      child = null;
      if (!proc) return;
      // SIGTERM, then let it flush. The studio owns `_server.json` and a couple
      // of pending writes; SIGKILL first would leave stale state that the next
      // boot reads as a live instance.
      try {
        proc.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      await new Promise((resolve) => {
        const t = setTimer(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            /* already gone */
          }
          resolve();
        }, 5000);
        t?.unref?.();
        proc.on('exit', () => {
          clearTimer(t);
          resolve();
        });
      });
    },
    get port() {
      return port;
    },
    /** What `/health` reports (D5). `ok` is the ONE field a probe should read. */
    /**
     * The build sandbox's counters, fetched on demand — Cloud Phase 26 Stage 4.
     *
     * Its own short cache rather than a background timer: `/health` is polled
     * by several things at different rates, and a cell should not run a clock
     * whose only job is to keep a number warm. `null` whenever the studio is
     * not up, is an older image that does not report them, or simply cannot be
     * reached — all three are honestly "we do not know", which the operator
     * board renders as an em-dash rather than a zero.
     */
    async renderStats() {
      if (!ready || child === null) return null;
      const at = now();
      if (renderCache && at - renderCache.at < RENDER_STATS_TTL_MS) return renderCache.value;
      let value = null;
      try {
        value = normalizeProbe(await probe(port)).render ?? null;
      } catch {
        /* a probe that failed is not a health failure — see the doc above */
      }
      renderCache = { at, value };
      return value;
    },

    status() {
      return {
        ok: ready && child !== null,
        state: !launched
          ? 'idle'
          : stopped
            ? 'stopped'
            : wrongProject
              ? 'wrong-project'
              : child === null
                ? 'restarting'
                : ready
                  ? 'ready'
                  : 'starting',
        pid: child?.pid ?? null,
        port,
        restarts,
        startedAt,
        readyAt,
        lastExit,
        // Only when it happened. A null field on every healthy cell is noise
        // an operator learns to skip past, which is the last thing this one
        // should be.
        ...(wrongProject ? { wrongProject } : {}),
      };
    },
  };
}

/** Loopback `/_health` probe. Kept tiny and dependency-free — it runs every
 *  250 ms during boot and must not itself be a source of failure.
 *
 *  Returns the ANSWER, not just the fact that there was one: D5's check is
 *  whether the studio is serving the tree we handed it, and only the body can
 *  say. A malformed or unreadable body is still "alive" — a studio that serves
 *  the project but describes itself badly should not take the cell down. */
async function defaultProbe(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/_health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return { ok: false };
    try {
      const body = await res.json();
      return {
        ok: true,
        rootId: body?.rootId ?? null,
        project: body?.project ?? null,
        // Cloud Phase 26 Stage 4 — the build sandbox's counters ride the probe
        // that already runs, rather than a second endpoint and a second auth
        // story. Absent on an older studio, which is a real answer: the
        // operator board renders an em-dash, never a zero.
        render: body?.render ?? null,
      };
    } catch {
      return { ok: true };
    }
  } catch {
    return { ok: false };
  }
}

/** Accept the boolean an injected probe may return, and the object the real
 *  one does. One shape downstream. */
function normalizeProbe(verdict) {
  if (verdict && typeof verdict === 'object') {
    return {
      ok: Boolean(verdict.ok),
      rootId: verdict.rootId ?? null,
      render: verdict.render ?? null,
    };
  }
  return { ok: Boolean(verdict), rootId: null };
}
