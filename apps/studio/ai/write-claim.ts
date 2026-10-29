// write-claim.ts — every AI writer verb claims its own writes (p8-a1-claims, Michal 2026-10-29: "a person's
// own save during an AI run must never end up in that run's undo").
//
// Before this, an AI shell call that ran a `maude design` write verb opened a per-call WINDOW (acp/index.ts,
// V2-8.9 round B A1): while it was open, the run's stage took ANY unclaimed canvas write. A person's own save
// from an outside editor in those seconds therefore joined the AI run and its one-step Undo. Attribution by
// time is gone for the verbs: a write joins a run only when it was CLAIMED for that run, by the bytes, before
// the watcher imports them. A write nobody claimed is the person's. Two ways a verb claims:
//
//   1. ROUTE writes — a verb that writes through a studio route (`_studio-verb.mjs` `call()`, `curl-local`)
//      names its chat: `X-Maude-Chat: <MAUDE_CHAT_ID>`. A main-origin route answers inside `withWriteClaim`
//      (http.ts wraps every main-only table route that writes); the studio's own source-write note
//      (`source-writing` / `source-written`, local home and hub link) then CLAIMS those bytes for the run
//      instead of noting them as the person's edit (sync/local-kernel.ts, sync/index.ts).
//   2. DISK writes — a verb that writes the file itself (`reel-place`, `canvas-edit`, `ds-check --fix`,
//      `import-figma`) posts the bytes it is about to write to `POST /_api/agent/write/claim`
//      (routes/agent.ts, a non-browser hook route) first; `bin/_write-claim.mjs` is the client.
//
// The header and the body field only NAME a chat. The run registry decides (ai/create-claim.ts
// `runForCreate`): this Mac's LIVE run of that chat, else nothing is claimed and the write stays a person's.
// A canvas-origin request never reaches either door — the table routes wrapped here are main-only (an
// `origin: 'canvas'` spec is never wrapped), and the agent routes refuse any browser request.

import { AsyncLocalStorage } from 'node:async_hooks';

import { laneValueFromFile } from '../sync/codec.ts';
import { hashBytes } from '../sync/echo-guard.ts';
import { CHAT_HEADER, type CreateClaimRuns, runForCreate } from './create-claim.ts';

/** The live run a request's writes belong to. */
export interface WriteClaimRun {
  runId: string;
  chatId: string;
  label: string;
}

const scope = new AsyncLocalStorage<WriteClaimRun>();

/** Run `fn` with `run` as the claimant of every studio source write it makes (null: no claimant). */
export function withWriteClaim<T>(run: WriteClaimRun | null, fn: () => T): T {
  return run ? scope.run(run, fn) : fn();
}

/** The run the current request writes for, or null (a person's request, or none at all). */
export function currentWriteClaim(): WriteClaimRun | null {
  return scope.getStore() ?? null;
}

/** The LIVE run of chat `chat` on this Mac (not ended, not queued behind another run of it), or null. */
export function runForChat(
  chat: string,
  runs: CreateClaimRuns | null | undefined
): WriteClaimRun | null {
  return runForCreate(new Request('http://127.0.0.1/', { headers: { [CHAT_HEADER]: chat } }), runs);
}

/** The run a route request claims for (main origin, a write, a live run of the named chat), or null. */
export function routeWriteClaim(
  req: Request,
  runs: CreateClaimRuns | null | undefined
): WriteClaimRun | null {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return null;
  return runForCreate(req, runs);
}

/** The slice of a sync runtime a claim needs (sync/index.ts / sync/local-kernel.ts). */
export interface ClaimControl {
  beginAiAction?(
    key: string,
    label: string,
    meta?: { runId?: string; chatId?: string; actor?: string; claimOnly?: boolean }
  ): void;
  claimAiWrite?(key: string, repoRel: string, hash?: string | null): void;
}

/** The hash the stage keys a lane value by (`${slug}|${hashBytes(value)}`), from the file's bytes. */
export function claimHashOf(repoRel: string, text: string): string | null {
  if (/\.tsx$/i.test(repoRel)) return hashBytes(text);
  const lane = /\.meta\.json$/i.test(repoRel)
    ? 'meta'
    : /\.annotations\.json$/i.test(repoRel)
      ? 'annotations'
      : null;
  if (!lane) return null;
  const value = laneValueFromFile(lane, text);
  return value === null ? null : hashBytes(value);
}

/**
 * Claim `text` at `repoRel` (repo-relative, `.design/ui/C.tsx`) for `run`: the stage begins (idempotent
 * under the run id) and owns the watcher's import of exactly these bytes. `text` null = a delete.
 */
export function claimWrite(
  control: ClaimControl | null | undefined,
  run: WriteClaimRun,
  repoRel: string,
  text: string | null
): void {
  if (!control) return;
  control.beginAiAction?.(`run:${run.runId}`, run.label, {
    runId: run.runId,
    chatId: run.chatId,
    // a run begun by a claim takes only what is claimed for it — never a person's unclaimed save
    claimOnly: true,
  });
  control.claimAiWrite?.(run.runId, repoRel, text === null ? null : claimHashOf(repoRel, text));
}

/**
 * POST /_api/agent/write/claim's server half: claim `writes` (design-root-relative `rel`, the bytes about to
 * land) for chat `chat`'s LIVE run. null = no such run — nothing is claimed, the write stays a person's.
 */
export function claimWritesForChat(
  runs: CreateClaimRuns | null | undefined,
  control: ClaimControl | null | undefined,
  designRel: string,
  chat: string,
  writes: ReadonlyArray<{ rel: string; content: string }>
): { runId: string } | null {
  const run = runForChat(chat, runs);
  if (!run) return null;
  for (const w of writes) {
    claimWrite(control, run, `${designRel}/${w.rel}`, w.content);
    recordClaim(run.chatId, w.rel);
  }
  return { runId: run.runId };
}

/**
 * p8-a1-claims — the design hook's two claim doors (routes/agent.ts), over one runtime:
 *   - `claim` — PreToolUse `edit/check` replayed an Edit/Write/MultiEdit on the file's current bytes:
 *     those exact bytes are the run's, claimed before the tool writes them (the hook blocks the tool
 *     until it answers, so this is sure to come first);
 *   - `window` — a Bash call that cannot claim (S7 interpreter, a terminal-lane verb) opens/closes its
 *     window for the canvases its command names.
 */
export function hookClaims(
  control: () => (ClaimControl & { beginAiAction?: ShellBegin }) | null | undefined,
  designRel: string
) {
  return {
    claim(r: { run: string; label: string | null }, rel: string, after: string): void {
      claimWrite(
        control(),
        { runId: r.run, chatId: '', label: r.label || 'Claude Code' },
        `${designRel}/${rel}`,
        after
      );
    },
    window(
      r: { run: string; label: string | null },
      call: string,
      open: boolean,
      files: readonly string[]
    ): void {
      control()?.beginAiAction?.(`run:${r.run}`, r.label || 'Claude Code', {
        runId: r.run,
        claimOnly: true,
        shell: { call, open, files: files.map((f) => `${designRel}/${f}`) },
      });
    },
  };
}

type ShellBegin = (
  key: string,
  label: string,
  meta?: {
    runId?: string;
    chatId?: string;
    claimOnly?: boolean;
    shell?: { call: string; open: boolean; files?: string[] };
  }
) => void;

// ── The claims a chat made recently — what a pure-verb shell call may bind afterwards ──────────────
//
// The design hook's post-bash binding (routes/agent.ts `bindBashWrites`) used to bind every design file
// whose mtime fell inside the call, which claimed a person's save made meanwhile. For a call whose only
// writers are claiming verbs it now binds only what those verbs claimed (`claimedSince`).

const CLAIM_TTL_MS = 10 * 60_000;
const MAX_CLAIMS = 256;
const recent = new Map<string, Array<{ rel: string; at: number }>>();

/** Remember that `chatId` claimed `designRootRel` now. */
export function recordClaim(chatId: string, designRootRel: string, at = Date.now()): void {
  const list = (recent.get(chatId) ?? []).filter((c) => at - c.at <= CLAIM_TTL_MS);
  list.push({ rel: designRootRel, at });
  recent.set(chatId, list.slice(-MAX_CLAIMS));
}

/** The design-root-relative files `chatId` claimed at or after `since`. */
export function claimedSince(chatId: string, since: number): Set<string> {
  const out = new Set<string>();
  for (const c of recent.get(chatId) ?? []) if (c.at >= since) out.add(c.rel);
  return out;
}
