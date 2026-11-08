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
// The answer is four counts, the store mode and a public version string — never a chat id, a
// title, a path or a prompt. `storeMode` (#206): `read-only` while this server waits for another
// server on the same root to let go of the project store lock, so the tab can say "Finishing the
// terminal's run…" (contract 206-cli-reuses-desktop.md §6 step 5).
//
// `GET /_api/shell/attest?n=<32 hex>` (#206, DDR-250 decision 2, contract §3): how the terminal
// tells a desktop sidecar from a squatter on its port — challenge-response over the per-spawn
// MAUDE_SHELL_ATTEST_KEY (shell/attest.ts has the MAC). Gates, in order (test/shell-attest.test.ts):
// no key → 404 (a terminal server is never attestable) · a browser → 403 · `n` not exactly 32 hex
// characters → 400. No shell token: the key IS the credential, and the answer is one MAC.
//
// #122 (122-C) `GET /_api/shell/clip-export?id=` · `GET /_api/shell/clip-asset?id=&rel=` ·
// `POST /_api/shell/clip-import`: the desktop shell (clip_bridge.rs) carrying a clip from one project's
// server to another's, after the person said Paste in the target tab. The shell-token gates above, in the
// same order (test/shell-clip-routes.test.ts); main origin only, never canvas-safe; shell/clip-transfer.ts
// has every check (items re-checked, modules by sha256, assets against their `<sha8>` names).

import { createHash, timingSafeEqual } from 'node:crypto';

import type { ChatActivity } from '../acp/running.ts';
import { activitySnapshot } from '../acp/running.ts';
import type { AgentRuns } from '../agent-runs.ts';
import { saveHold } from '../ai/save-hold.ts';
import type { Outbox } from '../outbox/index.ts';
import { FINAL_STATES } from '../outbox/types.ts';
import { ATTEST_NONCE_RE, attestMac, bootAttestKey } from '../shell/attest.ts';
import {
  assetForShell,
  CLIP_FRAME_MAX_BYTES,
  GONE as CLIP_GONE,
  TOO_BIG as CLIP_TOO_BIG,
  exportForShell,
  importFromShell,
  parseFrame,
  type Refusal,
} from '../shell/clip-transfer.ts';
import { resolveMaudeVersion } from '../whats-new.ts';
import type { RouteSpec } from './table.ts';

export const SHELL_TOKEN_HEADER = 'x-maude-shell';

export type StoreMode = 'writer' | 'read-only';

export interface ShellStatus {
  version: string;
  ai: { running: number; awaiting: number };
  unsent: number;
  jobs: number;
  /** #206 — present once the server has bound it (server.ts `bindShellRuntime`). */
  storeMode?: StoreMode;
}

/** What `/_api/shell/attest` signs with: the key, and the identity it binds into the MAC. */
export interface AttestFacts {
  key: string;
  rootId: string;
  port: number;
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
  /** #206 — injected in tests; default: MAUDE_SHELL_ATTEST_KEY (read once) + the bound identity */
  attest?: () => AttestFacts | null;
  /** #206 — injected in tests; default: the local store's mode, once bound */
  storeMode?: () => StoreMode | undefined;
  /** #122 (122-C) — the design root the clip routes read modules / assets from and write assets to;
   *  absent = the clip routes answer 404 (routes/index.ts passes it) */
  designRoot?: string;
}

/**
 * #206 — facts the server learns only after the route table exists (its bound port, its store),
 * set once by server.ts. Module state on purpose: http.ts builds the shell deps before Bun.serve
 * has a port, and these are process-wide facts, not per-request ones.
 */
const runtime: { rootId?: string; port?: number; storeMode?: () => StoreMode } = {};

/** Bind what is known; the identity right after the listener binds, the store once it is attached. */
export function bindShellRuntime(facts: {
  rootId?: string;
  port?: number;
  storeMode?: () => StoreMode;
}): void {
  if (facts.rootId !== undefined) runtime.rootId = facts.rootId;
  if (facts.port !== undefined) runtime.port = facts.port;
  if (facts.storeMode !== undefined) runtime.storeMode = facts.storeMode;
}

function defaultAttest(): AttestFacts | null {
  const key = bootAttestKey();
  if (!key || !runtime.rootId || !runtime.port) return null;
  return { key, rootId: runtime.rootId, port: runtime.port };
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

/** The four counts (+ the store mode). Each source failing reads as 0 — a probe must never throw. */
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
  let storeMode: StoreMode | undefined;
  try {
    storeMode = (deps.storeMode ?? (() => runtime.storeMode?.()))();
  } catch {
    storeMode = undefined;
  }
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
    ...(storeMode ? { storeMode } : {}),
  };
}

function safeActivity(deps: ShellRouteDeps): ChatActivity[] {
  try {
    return deps.activity ? deps.activity() : activitySnapshot().chats;
  } catch {
    return [];
  }
}

/** The deps the live route table was built with (the yield watcher counts with them). */
let liveDeps: ShellRouteDeps | null = null;

/**
 * #206 — what a CLI-role server finishes before it steps down (shell/cli-yield.ts): live export +
 * generation jobs and unsent work. 0 before the route table exists.
 */
export function shellPendingWork(): number {
  if (!liveDeps) return 0;
  const s = shellStatus(liveDeps);
  return s.jobs + s.unsent;
}

const fromBrowser = (req: Request) =>
  req.headers.has('origin') || req.headers.has('sec-fetch-site');

/** The shell-token gates `/_api/shell/status` applies, in its order (404 · 403 · 401); null = the shell. */
function shellGate(req: Request, deps: ShellRouteDeps): Response | null {
  const want = (deps.token ?? (() => process.env.MAUDE_SHELL_TOKEN))();
  if (!want) return new Response('Not found', { status: 404 });
  if (fromBrowser(req)) return json(403, { error: 'browser-refused' });
  if (!tokenMatches(req.headers.get(SHELL_TOKEN_HEADER), want))
    return json(401, { error: 'shell-token' });
  return null;
}

const refused = (r: Refusal) =>
  json(r.status, { error: r.error, ...(r.message ? { message: r.message } : {}) });

/** The body, aborted past `max` (a content-length that says more is refused before any read). */
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  const cl = Number(req.headers.get('content-length'));
  if (Number.isFinite(cl) && cl > max) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * #122 (122-C) — the three clip routes the desktop shell carries a clip between two project servers with
 * (shell/clip-transfer.ts has the rules). Same gates as `/_api/shell/status`; main origin only, in neither
 * canvas allowlist; a server with no design root wired answers 404 like one with no shell.
 */
function clipRoutes(deps: ShellRouteDeps): RouteSpec[] {
  const root = () => deps.designRoot;
  return [
    {
      method: 'GET',
      path: '/_api/shell/clip-export',
      origin: 'main',
      readOnly: 'allowed',
      handle: (req) => {
        const gate = shellGate(req, deps);
        if (gate) return gate;
        const designRoot = root();
        if (!designRoot) return new Response('Not found', { status: 404 });
        const out = exportForShell(new URL(req.url).searchParams.get('id') ?? '', designRoot);
        return out.ok ? json(200, out.body) : refused(out);
      },
    },
    {
      method: 'GET',
      path: '/_api/shell/clip-asset',
      origin: 'main',
      readOnly: 'allowed',
      handle: (req) => {
        const gate = shellGate(req, deps);
        if (gate) return gate;
        const designRoot = root();
        if (!designRoot) return new Response('Not found', { status: 404 });
        const q = new URL(req.url).searchParams;
        const abs = assetForShell(q.get('id') ?? '', q.get('rel') ?? '', designRoot);
        if (!abs) return json(404, { error: 'gone', message: CLIP_GONE });
        return new Response(Bun.file(abs), {
          headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' },
        });
      },
    },
    {
      method: 'POST',
      path: '/_api/shell/clip-import',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const gate = shellGate(req, deps);
        if (gate) return gate;
        const designRoot = root();
        if (!designRoot) return new Response('Not found', { status: 404 });
        const buf = await readCapped(req, CLIP_FRAME_MAX_BYTES);
        if (!buf) return json(413, { error: 'too-big', message: CLIP_TOO_BIG });
        const frame = parseFrame(buf);
        if (!frame) return json(400, { error: 'invalid' });
        const out = importFromShell(frame, designRoot);
        return out.ok ? json(200, { handle: out.handle }) : refused(out);
      },
    },
  ];
}

export function createShellRoutes(deps: ShellRouteDeps): RouteSpec[] {
  liveDeps = deps;
  return [
    {
      method: 'GET',
      path: '/_api/shell/status',
      origin: 'main',
      readOnly: 'allowed',
      handle: (req) => {
        const want = (deps.token ?? (() => process.env.MAUDE_SHELL_TOKEN))();
        if (!want) return new Response('Not found', { status: 404 });
        if (fromBrowser(req)) return json(403, { error: 'browser-refused' });
        if (!tokenMatches(req.headers.get(SHELL_TOKEN_HEADER), want))
          return json(401, { error: 'shell-token' });
        return json(200, shellStatus(deps));
      },
    },
    {
      method: 'GET',
      path: '/_api/shell/attest',
      origin: 'main',
      readOnly: 'allowed',
      handle: (req) => {
        let facts: AttestFacts | null = null;
        try {
          facts = (deps.attest ?? defaultAttest)();
        } catch {
          facts = null;
        }
        if (!facts) return new Response('Not found', { status: 404 });
        if (fromBrowser(req)) return json(403, { error: 'browser-refused' });
        const all = new URL(req.url).searchParams.getAll('n');
        const n = all.length === 1 ? all[0] : '';
        if (!n || !ATTEST_NONCE_RE.test(n)) return json(400, { error: 'nonce' });
        return json(200, { mac: attestMac(facts.key, n, facts.rootId, facts.port) });
      },
    },
    ...clipRoutes(deps),
  ];
}
