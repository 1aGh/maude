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

import { SETTLE_WAIT_MS, SHELL_STALE_MS } from '../sync/action-stage.ts';
import { laneValueFromFile } from '../sync/codec.ts';
import { hashBytes } from '../sync/echo-guard.ts';
import { CHAT_HEADER, type CreateClaimRuns, runForCreate } from './create-claim.ts';

import {
  currentWriteClaim,
  noWriteClaim,
  type WriteClaimRun,
  withWriteClaim,
} from './write-claim-scope.ts';

export { currentWriteClaim, noWriteClaim, type WriteClaimRun, withWriteClaim };

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
  const run = runForCreate(req, runs);
  if (!run) return null;
  // D5 — the claim lasts only while that run is this chat's live run
  return { ...run, live: () => runForChat(run.chatId, runs)?.runId === run.runId };
}

/** The slice of a sync runtime a claim needs (sync/index.ts / sync/local-kernel.ts). */
export interface ClaimControl {
  beginAiAction?(
    key: string,
    label: string,
    meta?: { runId?: string; chatId?: string; actor?: string; claimOnly?: boolean }
  ): void;
  claimAiWrite?(key: string, repoRel: string, hash?: string | null): void;
  /** p8-a1-claims (F17) — run `key` is about to delete canvas `repoRel`: the delete joins the run. */
  claimAiDelete?(key: string, repoRel: string): void;
  /**
   * #164 — run `key`'s call `call` settled: its parked writes join that run when their bytes are
   * claimed, or go outside. F5 — false when that run has no window for the call (nothing resolved).
   */
  settleShellCall?(key: string, call: string, claimed?: readonly string[]): boolean;
  /** F5 / F6 — run `key`'s window for call `call` (repo-relative paths), or null. */
  shellCall?(
    key: string,
    call: string
  ): { all: boolean; covers(repoRel: string): boolean; left(repoRel: string): boolean } | null;
}

/** POST /_api/agent/write/claim and a settle — at most this many bytes per call. */
export const CLAIM_MAX_BYTES = 16 * 1024 * 1024;
/** F4 — a settle's pending batches: calls at once, files per call, bytes in all. */
const PENDING_MAX_CALLS = 64;
const PENDING_MAX_FILES = 1_024;
const PENDING_MAX_TOTAL_BYTES = 4 * CLAIM_MAX_BYTES;
/** F4 — failed calls remembered (so their last batch claims nothing), at most this many. */
const FAILED_MAX = 256;

/** The hash the stage keys a lane value by (`${slug}|${hashBytes(value)}`), from the file's bytes. */
export function claimHashOf(repoRel: string, text: string): string | null {
  if (/\.(?:tsx|jsx)$/i.test(repoRel)) return hashBytes(text);
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
  designRel: string,
  opts: { log?: Pick<Console, 'warn'> } = {}
) {
  const log = opts.log ?? console;
  /**
   * F4 / D3 — run+call → the batches of its settle that said `more` (claimed only once the last one
   * arrives). Bounded: at most PENDING_MAX_CALLS calls, PENDING_MAX_FILES files and CLAIM_MAX_BYTES
   * bytes per call (PENDING_MAX_TOTAL_BYTES in all); a call idle for SETTLE_WAIT_MS expires. A call that
   * hits any of these FAILS: what it parked goes out as outside at once, its later batches are refused,
   * and the log says so. A live call is never evicted to make room.
   */
  const pending = new Map<
    string,
    { changed: Map<string, string | null>; bytes: number; timer?: ReturnType<typeof setTimeout> }
  >();
  /** Calls that failed (key → when): their last batch claims nothing. */
  const failed = new Map<string, number>();
  const keyOf = (run: string, call: string) => `${run}\u0000${call}`;
  const sizeOf = (t: string | null) => (t === null ? 0 : Buffer.byteLength(t));
  let total = 0;
  const drop = (k: string) => {
    const p = pending.get(k);
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    total -= p.bytes;
    pending.delete(k);
  };
  const fail = (run: string, call: string, why: string) => {
    const k = keyOf(run, call);
    drop(k);
    const t = Date.now();
    for (const [f, at] of failed) if (t - at > SHELL_STALE_MS) failed.delete(f);
    while (failed.size >= FAILED_MAX) failed.delete(failed.keys().next().value as string);
    failed.set(k, t);
    log.warn(
      `[ai/write-claim] an AI call's changes could not be matched (${why}): they are recorded as outside changes.`
    );
    control()?.settleShellCall?.(run, call, []);
  };
  return {
    /**
     * F5 / F6 — run `r`'s window for call `call` (`covers` / `left` take design-root-relative paths), or
     * null when it has none: a settle for it is refused.
     */
    scope(
      r: { run: string },
      call: string
    ): { all: boolean; covers(rel: string): boolean; left(rel: string): boolean } | null {
      const w = control()?.shellCall?.(r.run, call) ?? null;
      if (!w) return null;
      return {
        all: w.all,
        covers: (rel) => w.covers(`${designRel}/${rel}`),
        left: (rel) => w.left(`${designRel}/${rel}`),
      };
    },
    /**
     * #164 — POST /_api/agent/bash/settle's server half: the call's post-call bytes the studio re-read
     * from the disk (`changed`, design-root-relative; `text` null = deleted) are claimed for `r`, then the
     * call settles — its parked writes join the run when their bytes are claimed, else go out as outside.
     * A batch with more to come (`final` false) only waits. `ok: false` = refused (no window of `r` for
     * the call, or the call failed): nothing is claimed.
     */
    settle(
      r: { run: string; label: string | null },
      call: string,
      batch: ReadonlyArray<{ rel: string; text: string | null }>,
      final = true
    ): { ok: boolean; code?: string } {
      const k = keyOf(r.run, call);
      const c = control();
      if (failed.has(k)) {
        if (final) failed.delete(k);
        return { ok: false, code: 'settle-failed' };
      }
      if (!c?.shellCall?.(r.run, call)) {
        drop(k);
        return { ok: false, code: 'no-window' };
      }
      let p = pending.get(k);
      if (!p) {
        if (!final && pending.size >= PENDING_MAX_CALLS) {
          fail(r.run, call, 'too many calls settling at once');
          return { ok: false, code: 'settle-failed' };
        }
        p = { changed: new Map(), bytes: 0 };
        pending.set(k, p);
      }
      // paths dedupe: a later batch's bytes for the same file replace the earlier ones
      for (const w of batch) {
        const prev = p.changed.get(w.rel);
        const delta = sizeOf(w.text) - (prev === undefined ? 0 : sizeOf(prev));
        p.changed.set(w.rel, w.text);
        p.bytes += delta;
        total += delta;
      }
      if (
        p.changed.size > PENDING_MAX_FILES ||
        p.bytes > CLAIM_MAX_BYTES ||
        total > PENDING_MAX_TOTAL_BYTES
      ) {
        fail(r.run, call, 'too large');
        return { ok: false, code: 'settle-failed' };
      }
      if (p.timer) clearTimeout(p.timer);
      if (!final) {
        const live = p;
        live.timer = setTimeout(() => {
          if (pending.get(k) === live) fail(r.run, call, 'its last batch never arrived');
        }, SETTLE_WAIT_MS);
        (live.timer as { unref?: () => void }).unref?.();
        return { ok: true };
      }
      const changed = [...p.changed];
      drop(k);
      const run = { runId: r.run, chatId: '', label: r.label || 'Claude Code' };
      const claimed: string[] = [];
      for (const [rel, text] of changed) {
        // D4 — a delete the stage saw happen is already recorded; it arms no claim that would outlive
        // the settle (a later delete or create of that canvas is not this call's)
        if (text === null) continue;
        const repoRel = `${designRel}/${rel}`;
        claimWrite(c, run, repoRel, text);
        claimed.push(repoRel);
      }
      return c.settleShellCall?.(r.run, call, claimed) === false
        ? { ok: false, code: 'no-window' }
        : { ok: true };
    },
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
      files: readonly string[],
      /** p8-sec2-attrib A1 — the call names no canvas: its window covers every one */
      all = false
    ): void {
      control()?.beginAiAction?.(`run:${r.run}`, r.label || 'Claude Code', {
        runId: r.run,
        claimOnly: true,
        shell: {
          call,
          open,
          files: files.map((f) => `${designRel}/${f}`),
          ...(all ? { all: true } : {}),
        },
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
    shell?: { call: string; open: boolean; files?: string[]; all?: boolean };
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
