// create-claim.ts — a canvas an AI session creates is that run's AI write (S12.16, live journey S1).
//
// The AI chat makes a canvas the documented way: `maude design curl-local` → `POST /_api/canvas`.
// That call is an HTTP write with no tool-call behind it, so the chat tracker (acp/index.ts) never
// saw a path to claim, and with more than one run open the stage could not tell whose file the
// watcher had imported: Version history recorded the create as `outside`.
//
// `curl-local` (bin/_curl-local.mjs) therefore names the chat it runs in — `X-Maude-Chat:
// <MAUDE_CHAT_ID>`, on `POST /_api/canvas` only. This file is the server's half:
//
//   - the header only NAMES a chat. The registry decides: the claim lands for that chat's LIVE run
//     (not ended, not queued behind another run of the chat), else nothing is claimed and the create
//     stays a person's create. A header never creates or extends a run.
//   - main origin only. `/_api/canvas` is absent from the canvas listener (DDR-054) and from
//     CANVAS_SAFE_API, and the route refuses a cross-origin or rebound-Host write before this runs,
//     so a planted canvas cannot name a chat (`test/create-claim.test.ts` pins both).
//   - the terminal lane needs none of this: its PostToolUse hook binds the files a `maude design`
//     write verb created in the call's window to the session's run (routes/agent.ts bindBashWrites).

import { readFileSync } from 'node:fs';

import { hashBytes } from '../sync/echo-guard.ts';
import { isLive, type RunRecord } from './run-lifecycle.ts';

/** The request header `curl-local` sets from `MAUDE_CHAT_ID`. */
export const CHAT_HEADER = 'x-maude-chat';

/** acp/bridge.ts `chatSpawnEnv` — the id pattern of a chat. */
const CHAT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface CreateClaimRuns {
  resolve(b: { chat?: string | null; session?: string | null }): RunRecord | null;
}

/**
 * The live run of the chat the request names, or null (no header, a malformed one, an unknown
 * chat, a run that ended or is queued). Pure over the registry.
 */
export function runForCreate(
  req: Request,
  runs: CreateClaimRuns | null | undefined
): { runId: string; chatId: string; label: string } | null {
  const raw = req.headers.get(CHAT_HEADER);
  if (raw === null || !CHAT_ID.test(raw)) return null;
  const rec = runs?.resolve({ chat: raw }) ?? null;
  if (!rec || rec.chatId !== raw || !isLive(rec) || rec.behind) return null;
  return { runId: rec.runId, chatId: raw, label: rec.label || 'AI edit' };
}

/**
 * Claim a created canvas for `runId`: the stage then owns the watcher's import of it and publishes
 * it with the run's other changes (sync/local-kernel.ts `syncCanvas`, a create) — one history row
 * attributed AI, folded into the run's single undo step.
 *
 * The run's stage may not exist yet: the chat tracker opens it at the turn's first canvas EDIT, and
 * a chat's first move is often this very create (live journey S1). `beginAiAction` under the
 * registry's run id is idempotent, so the tracker's later begin finds this stage and joins it.
 */
export function claimCreatedCanvas(
  control:
    | {
        beginAiAction?(
          key: string,
          label: string,
          meta?: { runId?: string; chatId?: string; actor?: string; claimOnly?: boolean }
        ): void;
        claimAiWrite?(key: string, repoRel: string, hash?: string | null): void;
      }
    | null
    | undefined,
  w: { runId: string; chatId: string; label: string; repoRel: string; abs: string }
): void {
  // p8-a1-claims — claim-only: the run takes what was claimed for it, never a person's unclaimed save
  control?.beginAiAction?.(`run:${w.runId}`, w.label, {
    runId: w.runId,
    chatId: w.chatId,
    claimOnly: true,
  });
  let hash: string | null = null;
  if (/\.tsx$/i.test(w.repoRel)) {
    try {
      hash = hashBytes(readFileSync(w.abs, 'utf8'));
    } catch {
      hash = null; // unreadable: the canvas is still this run's
    }
  }
  control?.claimAiWrite?.(w.runId, w.repoRel, hash);
}
