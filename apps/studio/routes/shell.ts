// `GET /_api/shell/status` — V2-1.1 decision 8 (authenticated shell ↔ server probes).
//
// The desktop shell (Rust) asks a project server "is AI running, is anything unsent, is a job
// in flight?" before it closes the window or reaps the process. Before this route its probes
// read `<designRoot>/_server.json` and believed whatever answered at that address — a planted
// `_server.json` or a fake responder could hold a window open or let a running chat be killed.
// Now the shell reads the port from its own info file (shell/info-file.ts) and presents the
// per-spawn `MAUDE_SHELL_TOKEN` it gave this process.
//
// Gates, in order (each a test in test/shell-status-token.test.ts):
//   • no `MAUDE_SHELL_TOKEN` in this process  → 404. No shell spawned it (a cell, a terminal
//     `maude design serve`), so the route does not exist.
//   • the request carries `Origin` or `Sec-Fetch-Site` → 403. The caller is a browser — even
//     with the token (a page must never get in, whatever it learned). The shell's probe is a
//     plain HTTP client and sends neither.
//   • `X-Maude-Shell` missing or wrong → 401, compared in constant time.
// `guardTableRoute` (http.ts) runs first, so the loopback-Host (DNS-rebinding) gate applies too.
//
// MAIN ORIGIN ONLY: `origin: 'main'`, so it is in neither canvas allowlist (DDR-054/088).
// The answer is four counts and a public version string — never a chat id, a title, a path or
// a prompt.

import { createHash, timingSafeEqual } from 'node:crypto';

import type { ChatActivity } from '../acp/running.ts';
import { activitySnapshot } from '../acp/running.ts';
import type { AgentRuns } from '../agent-runs.ts';
import { saveHold } from '../ai/save-hold.ts';
import type { Outbox } from '../outbox/index.ts';
import { FINAL_STATES } from '../outbox/types.ts';
import { resolveMaudeVersion } from '../whats-new.ts';
import type { RouteSpec } from './table.ts';

export const SHELL_TOKEN_HEADER = 'x-maude-shell';

export interface ShellStatus {
  version: string;
  ai: { running: number; awaiting: number };
  unsent: number;
  jobs: number;
}

export interface ShellRouteDeps {
  /** V2-2.16 outbox: queued intents + the content lane's pending entries */
  outbox: Outbox;
  /** export + generation job queues (`list()` — every job this process knows) */
  exportJobs: { list(): { status?: string }[] };
  generateJobs: { list(): { status?: string }[] };
  /** the agent-hook run registry (terminal Claude Code runs); shared with routes/agent.ts */
  runs?: Pick<AgentRuns, 'openRuns'>;
  /** injected in tests; default: the ACP manager's per-chat activity (acp/running.ts) */
  activity?: () => ChatActivity[];
  /** injected in tests; default: `MAUDE_SHELL_TOKEN`, read per request */
  token?: () => string | undefined;
  version?: () => string;
  /** injected in tests; default: the studio's save hold (ai/save-hold.ts) */
  heldSaves?: () => number;
}

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** Constant-time string equality: both sides hashed first, so length leaks nothing either. */
export function tokenMatches(got: string | null, want: string): boolean {
  if (!got) return false;
  const a = createHash('sha256').update(got).digest();
  const b = createHash('sha256').update(want).digest();
  return timingSafeEqual(a, b);
}

const LIVE_JOB = new Set(['queued', 'running']);

/** The four counts. Each source failing reads as 0 — a probe must never throw. */
export function shellStatus(deps: ShellRouteDeps): ShellStatus {
  const count = (fn: () => number) => {
    try {
      return fn();
    } catch {
      return 0;
    }
  };
  const chats = safeActivity(deps);
  // A Maude chat's hook run is bracketed by the ACP manager already (its chat is in `chats`);
  // every other open run is a terminal Claude Code session.
  const terminalRuns = count(
    () => deps.runs?.openRuns().filter((r) => r.actor !== 'maude-chat').length ?? 0
  );
  return {
    version: (deps.version ?? resolveMaudeVersion)(),
    ai: {
      running: chats.filter((c) => c.state === 'running').length + terminalRuns,
      awaiting: chats.filter((c) => c.state === 'awaiting-input').length,
    },
    // p8-a1-save-hold — a person's save held behind an AI call is unsent too: the shell must not rest
    // or reap the server mid-hold, and the close confirm counts it
    unsent:
      count(
        () =>
          deps.outbox.content().pending +
          deps.outbox.store.list().filter((r) => !FINAL_STATES.includes(r.state)).length
      ) + count(() => (deps.heldSaves ?? (() => saveHold().size()))()),
    jobs: count(
      () =>
        [...deps.exportJobs.list(), ...deps.generateJobs.list()].filter((j) =>
          LIVE_JOB.has(j.status ?? '')
        ).length
    ),
  };
}

function safeActivity(deps: ShellRouteDeps): ChatActivity[] {
  try {
    return deps.activity ? deps.activity() : activitySnapshot().chats;
  } catch {
    return [];
  }
}

export function createShellRoutes(deps: ShellRouteDeps): RouteSpec[] {
  return [
    {
      method: 'GET',
      path: '/_api/shell/status',
      origin: 'main',
      readOnly: 'allowed',
      handle: (req) => {
        const want = (deps.token ?? (() => process.env.MAUDE_SHELL_TOKEN))();
        if (!want) return new Response('Not found', { status: 404 });
        if (req.headers.has('origin') || req.headers.has('sec-fetch-site'))
          return json(403, { error: 'browser-refused' });
        if (!tokenMatches(req.headers.get(SHELL_TOKEN_HEADER), want))
          return json(401, { error: 'shell-token' });
        return json(200, shellStatus(deps));
      },
    },
  ];
}
