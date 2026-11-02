// debug-bundle.ts — scrubbed diagnostic bundle for the Report-a-Bug dialog
// (feature-bug-report-button). Three pieces:
//
//   1. a 500-line in-memory log ring fed by a console tap (installLogRing) —
//      the dev-server has no persistent log of its own, so the ring is what
//      gives a report something to attach;
//   2. scrub() — the DETERMINISTIC redaction pass every log line goes through
//      before it can leave the process. Privacy invariant (docs/report-schema.md):
//      the scrubber runs server-side, has red/green tests, and is extended
//      test-first — never "best-effort";
//   3. buildDebugBundle() — assembles the `maude-report/v1` server-side fields.
//
// The consuming route (`GET /_api/debug-bundle`, http.ts) is PRIVILEGED:
// main-origin only, absent from CANVAS_SAFE_API + startCanvasServer's routes
// (dual-allowlist rule, DDR-088) — a hub-pushed canvas must never read logs.

import { homedir } from 'node:os';

import { redactMaudeCredentials, SECRET_ENV_PATTERN } from './credential-grammar.ts';
import { record as recordDiagnostic } from './diagnostics/store.ts';

const RING_MAX = 500;
const ring: string[] = [];
let tapInstalled = false;

/** Append one line to the ring (public for tests + non-console callers). */
export function recordLogLine(line: string): void {
  // V2-2.9: the same line feeds the per-source diagnostics store (server · sync · ai · export).
  recordDiagnostic(line);
  ring.push(line);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
}

/** Last `n` raw (UNSCRUBBED — caller must scrub) ring lines, oldest first. */
export function logRingLines(n = 200): string[] {
  return ring.slice(-n);
}

function fmt(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.stack ?? a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

/**
 * Mirror console.log/warn/error into the ring. Original behavior preserved
 * (stdout/stderr still get every line). Idempotent — safe to call from both
 * the server boot and tests.
 */
export function installLogRing(): void {
  if (tapInstalled) return;
  tapInstalled = true;
  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      recordLogLine(`[${level}] ${fmt(args)}`);
      original(...args);
    };
  }
}

export interface ScrubOptions {
  /** Absolute repo root → rewritten to `<project>/`. */
  repoRoot?: string;
  /** Home dir → rewritten to `~`. Defaults to os.homedir(). */
  home?: string;
}

/**
 * Deterministic redaction. Order matters: repoRoot first (it usually lives
 * under home — scrubbing home first would leave `~/git/repo` variants that
 * the repoRoot rule no longer matches), then home, then secret material,
 * then emails.
 */
export function scrub(text: string, opts: ScrubOptions = {}): string {
  let out = text;

  const repoRoot = opts.repoRoot?.replace(/\/+$/, '');
  if (repoRoot) out = out.replaceAll(repoRoot, '<project>');

  const home = (opts.home ?? homedir()).replace(/\/+$/, '');
  if (home) out = out.replaceAll(home, '~');

  // OURS first — the grammars Maude itself mints (credential-grammar.ts).
  // Kept separate from the vendor rules below because those chase other
  // people's formats and change when a vendor changes; this set changes when
  // WE mint something new, and its test fails if a new prefix is added
  // without registering it.
  out = redactMaudeCredentials(out);
  // Underscore-joined secret env names — `\b(token|secret)` can never match
  // inside `HUB_SECRET`, because `_` is a word character.
  out = out.replace(SECRET_ENV_PATTERN, '$1$2[redacted]');

  // Known token shapes first (GitHub classic + fine-grained, Anthropic, JWTs).
  out = out.replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{8,}\b/g, '[redacted]');
  out = out.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[redacted]');
  out = out.replace(
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g,
    '[redacted]'
  );
  // Vendor key shapes (V2-2.9 review): AWS access key ids, Stripe, Slack, Google API keys.
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]');
  out = out.replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g, '[redacted]');
  out = out.replace(/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, '[redacted]');
  out = out.replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[redacted]');
  // Authorization schemes, however they were logged — the whole credential, not just the scheme.
  out = out.replace(/\b(Bearer|Basic|Token|Digest)\s+[^\s"']+/gi, '$1 [redacted]');
  // Cookie headers carry sessions.
  out = out.replace(/\b(Set-Cookie|Cookie)(\s*:\s*)[^\n]+/gi, '$1$2[redacted]');
  // A secret in a query string (`?key=…`, `&access_token=…`).
  out = out.replace(
    /([?&](?:key|apikey|api_key|token|access_token|refresh_token|sig|signature|code)=)[^&\s"'#]+/gi,
    '$1[redacted]'
  );
  // key=value / "key": "value" forms for secret-shaped keys — keep the key, redact the value.
  // Case-insensitive and allowed after `_` (`access_token=`, `client_secret:`), which a plain
  // `\b` boundary never matched.
  out = out.replace(
    /((?:^|[^A-Za-z0-9])[A-Za-z0-9_-]*(?:token|secret|password|passwd|api[_-]?key|authorization|access[_-]?key))("?\s*[:=]\s*"?)[^\s"',}&]+/gi,
    '$1$2[redacted]'
  );

  out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]');

  return out;
}

export interface DebugBundle {
  app: { maudeVersion: string; platform: string; arch: string };
  context: { projectName: string | null; activeCanvas: string | null };
  /** Server process memory at report time (#119). A runaway-memory report used
   *  to arrive as a number the user eyeballed in Activity Monitor, with nothing
   *  in the bundle to confirm or refute it — and the log ring was silent
   *  because the heap watch was measuring the wrong counter. `rss` is the same
   *  number the user sees, so a future report of this class carries its own
   *  evidence. Bytes; process-level, never per-request. */
  process: { rssBytes: number; heapUsedBytes: number; uptimeSeconds: number };
  logs: { serverLogTail: string };
}

/**
 * Assemble the server-side half of a `maude-report/v1` payload. Everything
 * here is ALREADY scrubbed — the client treats the bundle as display+consent
 * material and must not need to re-clean it. Canvas CONTENT never enters the
 * bundle: `activeCanvas` is the relative path only.
 */
export function buildDebugBundle(args: {
  maudeVersion: string;
  projectName: string | null;
  activeCanvas: string | null;
  repoRoot: string;
  tailLines?: number;
}): DebugBundle {
  const scrubOpts: ScrubOptions = { repoRoot: args.repoRoot };
  const memory = process.memoryUsage();
  return {
    app: {
      maudeVersion: args.maudeVersion,
      platform: process.platform,
      arch: process.arch,
    },
    context: {
      projectName: args.projectName,
      activeCanvas: args.activeCanvas ? scrub(args.activeCanvas, scrubOpts) : null,
    },
    process: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      uptimeSeconds: Math.round(process.uptime()),
    },
    logs: {
      serverLogTail: logRingLines(args.tailLines ?? 200)
        .map((l) => scrub(l, scrubOpts))
        .join('\n'),
    },
  };
}
