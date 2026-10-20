// video/media-analysis.ts — S7.11b: the job behind `POST /_api/media-analysis` (contract V2-1.10 §5.7;
// decision maude/v2-S7-11b-media-analysis-sync-job).
//
// One analysis of ONE project asset, by the same helper a person or an agent reaches as a verb:
//   transcript → `maude design transcribe-local <asset> --json`            (bin/_transcribe-local.mjs)
//   speech     → the same, with `--speech-only` (energy regions, no engine)
//   beats      → `maude design beats <asset> [--bpm N] --json`              (bin/beats.mjs)
// The route owns what is asked and who may ask; this module owns how it runs and what an exit code means.
//
// The command runs the helper `.mjs` under the studio's own runtime, never the `.sh` shim (which needs a `bun`
// on PATH — the packaged app has none, DDR-177): `MAUDE_BUN_PATH` is the compiled sidecar itself, re-entered
// with `BUN_BE_BUN=1`. The child gets a small environment (no keys, no tokens) — it decodes media and may start
// a headless browser, and neither needs the studio's secrets. Every job takes an injected runner in tests, so
// no speech engine, ffmpeg or browser ever runs there.

import { existsSync } from 'node:fs';

import { BIN_DIR } from '../paths.ts';

export type AnalysisKind = 'transcript' | 'speech' | 'beats';
export const ANALYSIS_KINDS: readonly AnalysisKind[] = ['transcript', 'speech', 'beats'];

export interface AnalysisJob {
  kind: AnalysisKind;
  /** `assets/<8 hex>.<ext>`, already validated by the route */
  asset: string;
  /** beats only: fix the tempo (Half · Double) */
  bpm?: number;
  /** the project (repo) root and the design root's name under it */
  repoRoot: string;
  designRel: string;
}

export interface AnalysisResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type AnalysisRunner = (job: AnalysisJob) => Promise<AnalysisResult>;

/** A transcription of a long interview is minutes; beats are seconds. */
const TIMEOUT_MS: Record<AnalysisKind, number> = {
  transcript: 20 * 60_000,
  speech: 5 * 60_000,
  beats: 5 * 60_000,
};
/** The tail of a child's stderr that is kept. */
const KEEP = 4000;

/** What the helper may see of the studio's environment. */
const CHILD_ENV_KEYS = [
  'PATH',
  'HOME',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'MAUDE_NO_EXTRA_TOOL_DIRS',
  'MAUDE_BROWSER_EXECUTABLE',
  'AGENT_BROWSER_EXECUTABLE_PATH',
  'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH',
] as const;

const isVirtualPath = (p: string) => p.startsWith('/$bunfs') || p.startsWith('B:/~BUN');

/** The command (and the environment) that runs `job`. Pure: it spawns nothing. */
export function analysisCommand(
  job: AnalysisJob,
  env: NodeJS.ProcessEnv = process.env
): { cmd: string[]; env: Record<string, string> } {
  const bun = env.MAUDE_BUN_PATH || 'bun';
  const childEnv: Record<string, string> = {};
  for (const k of CHILD_ENV_KEYS) {
    const v = env[k];
    if (typeof v === 'string') childEnv[k] = v;
  }
  // a path in the sidecar's own virtual filesystem is an address the child cannot open
  const napi = env.NAPI_RS_NATIVE_LIBRARY_PATH;
  if (napi && !isVirtualPath(napi) && existsSync(napi)) childEnv.NAPI_RS_NATIVE_LIBRARY_PATH = napi;
  // DDR-177: the "bun" we run is this very executable — it behaves as a runtime only when told to
  if (env.MAUDE_BUN_PATH && env.MAUDE_BUN_PATH === process.execPath) childEnv.BUN_BE_BUN = '1';

  const cmd =
    job.kind === 'beats'
      ? [
          bun,
          `${BIN_DIR}/beats.mjs`,
          job.asset,
          '--root',
          job.repoRoot,
          '--design-root',
          job.designRel,
          ...(job.bpm !== undefined ? ['--bpm', String(job.bpm)] : []),
          '--json',
        ]
      : [
          bun,
          `${BIN_DIR}/_transcribe-local.mjs`,
          job.asset,
          '--root',
          job.repoRoot,
          ...(job.kind === 'speech' ? ['--speech-only'] : []),
          '--json',
        ];
  return { cmd, env: childEnv };
}

/** The real runner: spawn the helper, wait for it (killed after the kind's time limit). */
export const spawnAnalysis: AnalysisRunner = async (job) => {
  const { cmd, env } = analysisCommand(job);
  const proc = Bun.spawn(cmd, {
    cwd: job.repoRoot,
    env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, TIMEOUT_MS[job.kind]);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (timedOut) return { code: 124, stdout: '', stderr: 'The analysis took too long.' };
    return { code, stdout: stdout.slice(-KEEP), stderr: stderr.slice(-KEEP) };
  } finally {
    clearTimeout(timer);
  }
};

/** The last non-empty line of a child's stderr, short enough for a toast. */
export function lastLine(stderr: string, max = 300): string {
  const lines = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const line = lines[lines.length - 1] ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export interface AnalysisAnswer {
  status: number;
  body: Record<string, unknown>;
}

/**
 * What an exit code means to the person.
 *   transcript / speech:  0 ok · 3 no speech engine on this Mac · 4 "no words recognized" (silence) or any
 *                         other decode / engine failure · anything else a failure
 *   beats:                0 ok · 3 no decoder (no ffmpeg, no Chromium) · anything else a failure
 * `transcribe-local` exits 4 for both a silent file and a broken decode, so the silence is told by its line.
 */
export function interpretExit(kind: AnalysisKind, r: AnalysisResult): AnalysisAnswer {
  if (r.code === 0) return { status: 200, body: { ok: true } };
  if (r.code === 3)
    return kind === 'beats'
      ? { status: 409, body: { error: 'no-decoder' } }
      : { status: 409, body: { error: 'no-engine' } };
  if (kind !== 'beats' && r.code === 4 && /no words recognized/i.test(r.stderr))
    return { status: 422, body: { error: 'no-words' } };
  return { status: 500, body: { error: 'failed', message: lastLine(r.stderr) } };
}
