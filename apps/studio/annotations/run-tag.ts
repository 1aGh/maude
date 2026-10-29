// run-tag.ts — annotation writes inside an AI run (contract S4-S5-ai-annotations §2, T-S4.5b).
//
// An op batch whose `actionId` is `run:<runId>` belongs to that AI run: it is staged with the run's
// other changes and published as ONE `ai` action, so the result card's Undo, ⌘Z and "Undo this
// chat" revert it with the rest of the run. Because that tag makes a write AI work (undone,
// attributed and published as the run's), it is accepted only when:
//
//   1. it reaches the MAIN origin's listener (the canvas listener answers 400
//      `run-tag-main-origin-only`) as a same-origin or non-browser request on a trusted Host — a
//      planted canvas posting cross-origin to the main port is refused the same way; and
//   2. the run is one of this Mac's LIVE runs in the registry (not ended, not queued behind another
//      run of its chat, not a member's, not unknown) — else 409 `run-not-open`.
//
// A refused tag writes NOTHING. It is never downgraded to a person's edit: that write would escape
// the chat's undo. An untagged batch is untouched by this file.

import { isLive, type RunRecord } from '../ai/run-lifecycle.ts';
import { laneValueFromFile } from '../sync/codec.ts';
import { hashBytes } from '../sync/echo-guard.ts';

export const RUN_TAG = /^run:([A-Za-z0-9_-]{1,64})$/;

/** The run id a batch's `actionId` names, or null for any other id. */
export function runTagOf(actionId: unknown): string | null {
  if (typeof actionId !== 'string') return null;
  const m = RUN_TAG.exec(actionId);
  return m ? m[1] : null;
}

export type RunTagRefusal = {
  status: 400 | 409;
  error: 'run-tag-main-origin-only' | 'run-not-open';
};

export interface RunTagGateDeps {
  /** which listener the request reached */
  listener: 'main' | 'canvas';
  /** the registry: this Mac's run records */
  runs: { get(runId: string): RunRecord | null } | null | undefined;
  /** http.ts `sameOriginWrite` + `sameOriginRead` + `isTrustedRequestHost`, injected */
  sameOrigin: (req: Request) => boolean;
}

/**
 * The gate. `{ runId: null }` = untagged (today's path); `{ runId, chatId }` = an open run's batch;
 * `{ refusal }` = answer it and write nothing.
 */
export function runTagGate(
  req: Request,
  actionId: unknown,
  deps: RunTagGateDeps
):
  | { runId: null }
  | { runId: string; chatId: string | null; label: string }
  | { refusal: RunTagRefusal } {
  const runId = runTagOf(actionId);
  if (runId === null) return { runId: null };
  if (deps.listener !== 'main' || !deps.sameOrigin(req)) {
    return { refusal: { status: 400, error: 'run-tag-main-origin-only' } };
  }
  const rec = deps.runs?.get(runId) ?? null;
  if (!rec || rec.runId !== runId || !isLive(rec) || rec.behind) {
    return { refusal: { status: 409, error: 'run-not-open' } };
  }
  return { runId, chatId: rec.chatId ?? null, label: rec.label || 'AI edit' };
}

/** The registry's view of a tagged write's run at the moment it is staged. */
export function runContext(
  runs: { get(runId: string): RunRecord | null } | null | undefined,
  runId: string
): { open: boolean; chatId: string | null; label: string } {
  const rec = runs?.get(runId) ?? null;
  return {
    open: !!rec && isLive(rec) && !rec.behind,
    chatId: rec?.chatId ?? null,
    label: rec?.label || 'AI edit',
  };
}

export function runTagRefusalResponse(r: RunTagRefusal): Response {
  return Response.json(
    { ok: false, changed: false, rejected: [], error: r.error },
    { status: r.status, headers: { 'Cache-Control': 'no-store' } }
  );
}

/** The slice of the sync runtime a tagged write needs (sync/index.ts SyncRuntime). */
export interface RunStageRuntime {
  beginAiAction?(
    key: string,
    label: string,
    meta?: { runId?: string; chatId?: string; actor?: string; claimOnly?: boolean }
  ): void;
  claimAiWrite?(key: string, repoRel: string, hash?: string | null): void;
  proposeLane?(
    slug: string,
    lane: 'annotations',
    text: string,
    opts?: { baseText?: string; writeId?: string; stageable?: boolean }
  ): Promise<{ status: 'accepted' | 'rejected'; code?: string }> | null;
}

/**
 * Stage a tagged batch's board into its run (contract §2 "Staging"): make sure the run has a stage
 * (idempotent when its turn already began one under the same runId), claim THIS content by hash so
 * `ownerOf` picks this run even when several are open, then propose the lane stageable. Returns the
 * proposal, or null when the project has no accepted-revisions runtime (no stage exists to join).
 */
export function stageRunAnnotations(
  runtime: RunStageRuntime | null | undefined,
  w: {
    runId: string;
    /**
     * The run is still live. A run that ended while the batch was being applied gets no new stage
     * (that would be one nobody ends); its claim still lands while the stage settles.
     */
    open: boolean;
    chatId: string | null;
    label: string;
    slug: string;
    /** the canvas, designRoot- or repo-relative (claimAiWrite resolves either) */
    canvasRel: string;
    text: string;
    base?: string;
    writeId: string;
  }
): Promise<{ status: 'accepted' | 'rejected'; code?: string }> | null {
  if (!runtime) return null;
  const value = laneValueFromFile('annotations', w.text);
  if (value === null) return null;
  // Begin + claim even without `proposeLane` (a local home): there the board file reaches the
  // stage through the watcher, and the claim is what binds it to THIS run.
  if (w.open) {
    runtime.beginAiAction?.(`run:${w.runId}`, w.label, {
      runId: w.runId,
      ...(w.chatId ? { chatId: w.chatId } : {}),
      // p8-a1-claims — claim-only: the run takes what was claimed for it, never a person's save
      claimOnly: true,
    });
  }
  runtime.claimAiWrite?.(w.runId, w.canvasRel, hashBytes(value));
  return (
    runtime.proposeLane?.(w.slug, 'annotations', w.text, {
      writeId: w.writeId,
      ...(w.base !== undefined ? { baseText: w.base } : {}),
      stageable: true,
    }) ?? null
  );
}
