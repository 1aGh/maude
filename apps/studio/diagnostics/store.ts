// diagnostics/store.ts — local diagnostics data (V2-2.9, T23). Nothing here leaves the machine
// on its own: there is no background telemetry (decision maude/v2-V2-2.9-diagnostics-no-telemetry).
// A person copies a report or attaches it to a bug report; that is the only way out.
//
//   • four sources — server, sync, ai, export — each an in-memory ring (RING_MAX lines) fed by
//     the existing console tap (debug-bundle.ts installLogRing → recordLogLine → record()), routed
//     by the line's `[prefix]` (classify()).
//   • persisted per source and day under <logDir>/<source>/<YYYY-MM-DD>.log, ALREADY SCRUBBED
//     (debug-bundle.ts scrub(): project root, home, credentials, secrets, e-mails) — a log file a
//     person later shares cannot carry what the report would have redacted.
//     <logDir> = $MAUDE_LOG_DIR or ~/.maude/logs: per machine, outside every project tree, so it
//     can never sync and needs no runtime-state list entry (DDR-115).
//   • 7-day retention: sweep() deletes day files older than RETENTION_DAYS at init and every 6 h.
//   • status providers: each subsystem registers a cheap, synchronous snapshot (registerStatus).
//   • diagnostics() — the JSON the Diagnostics API returns; report() — the text "Copy diagnostic
//     report" puts on the clipboard. Both scrub again at read time.

import { appendFile, mkdir, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { scrub } from '../debug-bundle.ts';

export const SOURCES = ['server', 'sync', 'ai', 'export'] as const;
export type Source = (typeof SOURCES)[number];
export const RETENTION_DAYS = 7;
const RING_MAX = 500;
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;

// `[prefix]` → source. Anything unprefixed (or unknown) is the server's.
const PREFIX: Record<string, Source> = {
  sync: 'sync',
  'git-lifecycle': 'sync',
  remote: 'export',
  video: 'export',
  export: 'export',
  pptx: 'export',
  acp: 'ai',
  'acp-adapter': 'ai',
  ai: 'ai',
  generate: 'ai',
};

/** Which source a console line belongs to: `[level] [prefix…] message`. */
export function classify(line: string): Source {
  const m = line.match(/^\[(?:log|warn|error)\]\s+\[([a-z0-9-]+)(?::[a-z0-9-]+)?\]/i);
  return (m && PREFIX[m[1].toLowerCase()]) || 'server';
}

type StatusFn = () => Record<string, unknown>;

interface State {
  rings: Record<Source, string[]>;
  status: Map<Source, StatusFn>;
  logDir: string;
  repoRoot: string | undefined;
  persist: boolean;
  pending: Promise<void>;
  timer: ReturnType<typeof setInterval> | null;
}

const state: State = {
  rings: { server: [], sync: [], ai: [], export: [] },
  status: new Map(),
  logDir: process.env.MAUDE_LOG_DIR || join(homedir(), '.maude', 'logs'),
  repoRoot: undefined,
  persist: false,
  pending: Promise.resolve(),
  timer: null,
};

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Start persisting (call once at server boot). Until then lines only live in memory, so tests and
 * one-shot CLIs never write files. `logDir` defaults to $MAUDE_LOG_DIR or ~/.maude/logs.
 */
export async function initDiagnostics(
  opts: { repoRoot?: string; logDir?: string; now?: number } = {}
) {
  state.repoRoot = opts.repoRoot;
  if (opts.logDir) state.logDir = opts.logDir;
  state.persist = true;
  await sweep(opts.now);
  if (!state.timer) {
    state.timer = setInterval(() => void sweep(), SWEEP_EVERY_MS);
    state.timer.unref?.();
  }
}

/** Stop the sweep timer and wait for queued writes (server shutdown, tests). */
export async function stopDiagnostics() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  await state.pending;
}

/** Record one console line (called by the console tap). */
export function record(line: string, now = Date.now()) {
  const source = classify(line);
  const ring = state.rings[source];
  ring.push(line);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  if (!state.persist) return;
  const text = `${new Date(now).toISOString()} ${scrub(line, { repoRoot: state.repoRoot })}\n`;
  const dir = join(state.logDir, source);
  // one write chain: lines land in order, and a failed write never throws into a console call
  state.pending = state.pending
    .then(() => mkdir(dir, { recursive: true }))
    .then(() => appendFile(join(dir, `${day(now)}.log`), text))
    .catch(() => {});
}

/** Delete day files older than RETENTION_DAYS. Only touches `<source>/<YYYY-MM-DD>.log`. */
export async function sweep(now = Date.now()) {
  const cutoff = day(now - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  for (const source of SOURCES) {
    let names: string[] = [];
    try {
      names = await readdir(join(state.logDir, source));
    } catch {
      continue;
    }
    for (const name of names) {
      const m = name.match(/^(\d{4}-\d{2}-\d{2})\.log$/);
      if (m && m[1] < cutoff) await rm(join(state.logDir, source, name), { force: true });
    }
  }
}

/** Register a subsystem's status snapshot (cheap and synchronous; called on every read). */
export function registerStatus(source: Source, fn: StatusFn) {
  state.status.set(source, fn);
}

function statusOf(source: Source): Record<string, unknown> {
  const fn = state.status.get(source);
  if (!fn) return { known: false };
  try {
    return fn();
  } catch (e) {
    return { known: false, error: String((e as Error)?.message ?? e) };
  }
}

export interface Diagnostics {
  retentionDays: number;
  logDir: string;
  sources: Record<Source, { status: Record<string, unknown>; recent: string[] }>;
}

/** The Diagnostics API payload: every source's status and recent lines, scrubbed. */
export function diagnostics(tail = 200): Diagnostics {
  const s = (t: string) => scrub(t, { repoRoot: state.repoRoot });
  const sources = {} as Diagnostics['sources'];
  for (const source of SOURCES) {
    sources[source] = {
      status: JSON.parse(s(JSON.stringify(statusOf(source)))),
      recent: state.rings[source].slice(-tail).map(s),
    };
  }
  return { retentionDays: RETENTION_DAYS, logDir: s(state.logDir), sources };
}

/** "Copy diagnostic report": plain text, every source, scrubbed. */
export function report(meta: Record<string, unknown> = {}, tail = 60): string {
  const d = diagnostics(tail);
  const s = (t: string) => scrub(t, { repoRoot: state.repoRoot });
  const lines = ['Maude diagnostic report', ''];
  for (const [k, v] of Object.entries(meta)) lines.push(`${k}: ${s(String(v))}`);
  lines.push(`logs kept: ${d.retentionDays} days in ${d.logDir}`, '');
  for (const source of SOURCES) {
    lines.push(`── ${source} ──`, `status: ${JSON.stringify(d.sources[source].status)}`);
    lines.push(
      ...(d.sources[source].recent.length ? d.sources[source].recent : ['(no lines)']),
      ''
    );
  }
  return lines.join('\n');
}

/** Test seam: forget everything (rings, providers, persistence). */
export function resetDiagnosticsForTest() {
  for (const source of SOURCES) state.rings[source] = [];
  state.status.clear();
  state.persist = false;
  state.repoRoot = undefined;
  state.logDir = process.env.MAUDE_LOG_DIR || join(homedir(), '.maude', 'logs');
}
