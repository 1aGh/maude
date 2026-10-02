// Shared runtime + path resolution for the external playwright render shims
// (`bin/_{png,pdf,svg,html,pptx,video}-playwright.mjs`).
//
// RCA: issue-desktop-export-failures. The render exporters were written for the
// dev-server runtime and never migrated for the compiled-Bun sidecar packaging,
// so they broke in two ways in every `bun --compile` standalone binary (the
// desktop app AND `npm i -g @1agh/maude`):
//
//   1. Shim paths computed from `import.meta.dir` → inside a compiled binary that
//      is the virtual `/$bunfs/root`, not a real disk path, so `Bun.spawn` /
//      `Bun.build` fail with "failed to open root directory: /$bunfs/root". This
//      is the DDR-045 bug: filesystem-relative paths MUST derive from
//      `paths.ts`, never a local `import.meta.dir`.
//   2. Spawning a hardcoded `'node'` → the desktop sidecar is a compiled Bun
//      binary with no bundled `node`; a Finder-launched `.app` can't rely on one
//      being on PATH, so the spawn fails with `posix_spawn 'node'` ENOENT.
//
// This module centralizes both concerns so all six adapters resolve identically.

import path from 'node:path';

import { DEV_SERVER_ROOT } from '../paths.ts';

/**
 * Real-disk dir holding the render shims (`<DEV_SERVER_ROOT>/bin`).
 *
 * Derived from `DEV_SERVER_ROOT` (paths.ts) — NEVER `import.meta.dir`, which is
 * the virtual `/$bunfs/root` inside a compiled binary (DDR-045). In dev this is
 * the same `apps/studio/bin` the old `path.join(import.meta.dir, '..', 'bin')`
 * resolved to; in the desktop bundle it resolves to `Resources/apps/studio/bin`
 * (the shims ARE staged there — stage-resources ships the whole source tree).
 */
export const EXPORT_SHIM_DIR: string = path.join(DEV_SERVER_ROOT, 'bin');

/** Absolute path to a render shim by basename (e.g. `_png-playwright.mjs`). */
export function exportShimPath(basename: string): string {
  return path.join(EXPORT_SHIM_DIR, basename);
}

/**
 * Resolve a JS runtime able to execute the external `.mjs` render shims.
 *
 * Ladder (mirrors `acp/probe.ts` resolveAgentRuntime): explicit override → a
 * real `node` on PATH → a standalone `bun` on PATH. The compiled maude binary
 * (`process.execPath`) is deliberately NOT a fallback — a `bun --compile`
 * standalone ignores a script argument and re-runs its own embedded entrypoint,
 * so it can't run a shim. When nothing resolves (a packaged desktop app whose
 * sidecar has no node/bun on PATH) we throw an ACTIONABLE error instead of the
 * cryptic `posix_spawn 'node'` ENOENT the hardcoded `'node'` produced.
 */
export function resolveExportRuntime(): string {
  // Look up against the LIVE process PATH (the desktop sidecar sets it via env at
  // spawn — DDR-128), not Bun's startup env snapshot, so a corrected PATH is
  // honored and the lookup is deterministic/testable.
  const pathEnv = process.env.PATH;
  const runtime =
    process.env.MAUDE_EXPORT_RUNTIME ||
    Bun.which('node', { PATH: pathEnv }) ||
    Bun.which('bun', { PATH: pathEnv });
  if (!runtime) {
    throw new Error(
      'render export needs a JS runtime (node or bun) on PATH, but this build has none. ' +
        'Run the export from the browser dev-server (`maude design serve`), install Node, ' +
        'or set MAUDE_EXPORT_RUNTIME to a node/bun binary. ' +
        '(Native desktop render-export backend is pending — see RCA issue-desktop-export-failures.)'
    );
  }
  return runtime;
}

export interface SpawnShimOptions {
  /** cwd for the spawned shim — callers pass `path.dirname(<SHIM>)`. */
  cwd: string;
  /** Aborts the render — kills the child process. */
  signal?: AbortSignal;
  /** Fired for each `MAUDE_PROGRESS {"current":N,"total":M}` stdout line. */
  onProgress?: (update: { current: number; total: number }) => void;
  /**
   * Fired for the single `MAUDE_TIMING {…}` line a shim emits at the end.
   * Per-stage costs, so "the export is slow" can be answered with a
   * measurement instead of a guess about which stage owns the time.
   */
  onTiming?: (timing: Record<string, unknown>) => void;
}

export interface SpawnShimResult {
  code: number;
  /** stdout lines with `MAUDE_PROGRESS` lines filtered out (written-file paths etc.). */
  stdoutLines: string[];
  stderr: string;
}

const PROGRESS_LINE = /^MAUDE_PROGRESS (.+)$/;
// Filtered here rather than in the adapters for a load-bearing reason: every
// video adapter parses `stdoutLines.at(-1)` as its summary JSON, so a trailing
// diagnostic line on stdout would break EVERY video export.
const TIMING_LINE = /^MAUDE_TIMING (.+)$/;

/**
 * Spawn a render shim (`bin/_{png,pdf,svg,html,pptx,video}-playwright.mjs`)
 * via a resolved node/bun runtime, reading stdout INCREMENTALLY (not
 * buffered via `new Response(proc.stdout).text()`) so a `MAUDE_PROGRESS`
 * line written mid-render reaches `onProgress` as soon as it's flushed,
 * instead of only after the whole process exits. Non-progress lines
 * (written-file paths, the existing per-adapter contract) collect into
 * `stdoutLines` in the order they arrived. Exit-code handling stays with the
 * caller — this returns the same shape the old `Promise.all([...text()])`
 * block did, so adapters keep their existing `if (code !== 0) throw …`.
 */
export async function spawnShim(args: string[], opts: SpawnShimOptions): Promise<SpawnShimResult> {
  const proc = Bun.spawn([resolveExportRuntime(), ...args], {
    cwd: opts.cwd,
    // EXPLICIT, not inherited. Bun.spawn without `env` hands the child the
    // environment the process STARTED with — a variable set at runtime never
    // arrives (Bun 1.3.3, measured). The render worker sets
    // MAUDE_RENDER_SKIP_WHOLE_COMP=1 at startup exactly that way, so every
    // cloud mp4 still burned the 90 s renderMediaOnWeb timeout before falling
    // to frame-step (2026-10-02).
    env: { ...process.env },
    stdout: 'pipe',
    stderr: 'pipe',
    signal: opts.signal,
  });
  // Bun.spawn's `signal` option kills the child on abort; this listener is a
  // defensive fallback in case a given Bun build ignores it — cheap and
  // idempotent (killing an already-exited process is a no-op).
  const onAbort = () => {
    try {
      proc.kill();
    } catch {
      /* already exited */
    }
  };
  opts.signal?.addEventListener('abort', onAbort);

  // Stream the shim's stderr LIVE to this process's stderr (prefixed) as well
  // as buffering it for the exit-code error path. Buffering-only (the old
  // `new Response(proc.stderr).text()`) hid every diagnostic until the child
  // EXITED — so a shim that hung (a headless video encode that never resolves)
  // produced total silence, and even on success the per-stage logs never
  // surfaced. Live teeing makes the render worker's log show what a shim is
  // doing while it does it, which is the only window CI/production has into it.
  const shimTag = path.basename(args[0]).replace(/\.mjs$/, '');
  const stderrPromise = (async () => {
    let acc = '';
    try {
      const reader = proc.stderr.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += value;
        buf += value;
        let nl = buf.indexOf('\n');
        while (nl !== -1) {
          process.stderr.write(`[${shimTag}] ${buf.slice(0, nl)}\n`);
          buf = buf.slice(nl + 1);
          nl = buf.indexOf('\n');
        }
      }
      if (buf) process.stderr.write(`[${shimTag}] ${buf}\n`);
    } catch {
      /* stream closed mid-read — the buffered `acc` still feeds the error path */
    }
    return acc;
  })();
  const stdoutLines: string[] = [];
  let buffer = '';
  const consumeLine = (line: string) => {
    if (!line) return;
    const timing = TIMING_LINE.exec(line);
    if (timing) {
      try {
        opts.onTiming?.(JSON.parse(timing[1]) as Record<string, unknown>);
      } catch {
        /* malformed timing line — diagnostics must never break an export */
      }
      return;
    }
    const match = PROGRESS_LINE.exec(line);
    if (!match) {
      stdoutLines.push(line);
      return;
    }
    try {
      const update = JSON.parse(match[1]) as { current: number; total: number };
      opts.onProgress?.(update);
    } catch {
      /* malformed progress line — drop it rather than treat it as a file path */
    }
  };

  try {
    const reader = proc.stdout.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let newlineIdx = buffer.indexOf('\n');
      while (newlineIdx !== -1) {
        consumeLine(buffer.slice(0, newlineIdx).trim());
        buffer = buffer.slice(newlineIdx + 1);
        newlineIdx = buffer.indexOf('\n');
      }
    }
    if (buffer.trim()) consumeLine(buffer.trim());
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
  }

  const [stderr, code] = await Promise.all([stderrPromise, proc.exited]);
  return { code, stdoutLines, stderr };
}

/**
 * `spawnShim()` + the exit-code check every adapter did identically
 * (`if (code !== 0) throw new Error(...)`; `code review, /flow:done` — six
 * near-copies collapsed into one). `args[0]` is the shim path by convention
 * (every adapter builds it that way), used only for the error message.
 */
export async function runShim(args: string[], opts: SpawnShimOptions): Promise<string[]> {
  const { code, stdoutLines, stderr } = await spawnShim(args, opts);
  if (code !== 0) {
    throw new Error(
      `${path.basename(args[0])} exited ${code}: ${stderr.trim() || stdoutLines.join('\n').trim()}`
    );
  }
  return stdoutLines;
}
