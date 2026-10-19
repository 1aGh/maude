// S5.6 — a chat prompt that cannot go now waits in the outbox (V2-1.14) as an `ai.prompt` intent.
//
// The chat's `prompt` frame asks this queue first. A closed gate — `online`, `ai-connected`,
// `ai-allowance` (and `ai-ready`, `hub`) — or an earlier prompt of the same chat still in the
// outbox (O2: a chat's prompts keep their order) puts the prompt in the outbox instead of the run
// registry. The drain releases it through `sender` into `registry.ask`, idempotent by the intent
// id: the record is persisted `sending` before the call and a crash replays the SAME id, which
// maps to the SAME askId, which the registry folds into the run it already has. So a prompt sent
// offline is sent on reconnect exactly once, and a used-up one at `resetsAt`.
//
// No second queue: the outbox owns the waiting, the registry owns the run (V2-1.15 §8).

import type { RunScope } from '../ai/run-lifecycle.ts';
import type { RunRegistry } from '../ai/runs.ts';
import {
  closedGates,
  FINAL_STATES,
  type Gate,
  type GateFacts,
  gateWords,
  type Outbox,
  type Sender,
} from '../outbox/index.ts';

/**
 * A run's `label` — shared with peers as `RunPublic.label` (V2-1.15 §5.1: "the prompt, shortened
 * ≤ 80") — is the TYPED text only. The bracket lines the composer appends (`[maude-context …]`,
 * `[maude-scope …]`, `[selected: … "<canvas text>" …]`) are context for the agent, never for
 * others: dropping them keeps canvas copy and selectors out of what a teammate sees.
 */
export function promptLabel(text: string): string {
  return text
    .split('\n')
    .filter((l) => !/^\s*\[(maude-[a-z-]+|selected:)/.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** The askId a released intent asks with: derived, so a replay of the same intent is the same ask. */
export function askIdForIntent(intentId: string): string {
  return `a_${intentId.replace(/^i_/, '')}`;
}

export interface AskQueueDeps {
  outbox: Outbox;
  /** the gate facts the drain reads too (one source, so the two never disagree) */
  gates: () => GateFacts;
  /** read lazily: the registry may be built after the queue */
  runs: () => RunRegistry | null;
  /**
   * S5.18 (G10): settle the slow gate facts (is Claude Code signed in) before the chat decides "send now or
   * keep". The gate facts themselves are sync; without this a signed-out Mac reads as connected and the
   * prompt starts a run that fails. Optional: a queue without it decides on the facts as they stand.
   */
  ready?: () => Promise<unknown> | null;
  actor?: string;
  device?: string;
  project?: () => { id: string | null; hub: string | null };
  now?: () => number;
}

export interface Queued {
  askId: string;
  intentId: string;
  gates: Gate[];
  words: string | null;
  presentation: 'sent' | 'field';
}

export type AskQueue = ReturnType<typeof createAskQueue>;

export function createAskQueue(deps: AskQueueDeps) {
  const now = deps.now ?? Date.now;
  const project = () => deps.project?.() ?? { id: null, hub: null };

  /** The gates closed for a chat prompt right now. */
  function closed(): Gate[] {
    try {
      return closedGates(
        { kind: 'ai.prompt', project: project(), watermark: null },
        deps.gates(),
        [],
        now()
      );
    } catch {
      return ['online']; // can't read the facts → wait, never drop
    }
  }

  /** O2 — an earlier prompt of this chat is still in the outbox. */
  function chatHasQueued(chatId: string): boolean {
    return deps.outbox.store
      .list()
      .some(
        (r) =>
          r.kind === 'ai.prompt' && r.lane === `ai:${chatId}` && !FINAL_STATES.includes(r.state)
      );
  }

  /**
   * Queue the prompt when it cannot go now; null = send it now (the caller asks the registry).
   * `false` in the result's place means the outbox refused it (full / invalid) — the caller
   * shows the words and keeps the prompt in the composer.
   */
  function maybeQueue(p: {
    chatId: string;
    text: string;
    scope: RunScope | null;
  }): Queued | { refused: string } | null {
    const gates = closed();
    if (!gates.length && !chatHasQueued(p.chatId)) return null;
    const words = gateWords(gates, 'ai.prompt', allowanceTime());
    const r = deps.outbox.enqueue({
      kind: 'ai.prompt',
      actor: deps.actor ?? 'you',
      device: deps.device ?? 'studio',
      project: project(),
      label: promptLabel(p.text) || 'Prompt',
      payload: {
        kind: 'ai.prompt',
        chatId: p.chatId,
        text: p.text,
        scope: p.scope,
        attachments: [],
        presentation: words?.presentation === 'field' ? 'field' : 'sent',
      },
      gates,
      allowanceResetsAt: safeFacts()?.allowanceResetsAt ?? null,
    });
    if (!r.ok) return { refused: r.words ?? 'This prompt could not be kept. Try again.' };
    return {
      askId: askIdForIntent(r.record.id),
      intentId: r.record.id,
      gates,
      words: words?.text ?? null,
      presentation: words?.presentation === 'field' ? 'field' : 'sent',
    };
  }

  function safeFacts(): GateFacts | null {
    try {
      return deps.gates();
    } catch {
      return null;
    }
  }

  function allowanceTime(): string {
    const at = safeFacts()?.allowanceResetsAt;
    if (typeof at !== 'number') return '';
    const d = new Date(at);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /** The drain's `ai.prompt` door: release → `registry.ask`, idempotent by the intent id. */
  const sender: Sender = async (record) => {
    const runs = deps.runs();
    if (!runs) return { ok: false, network: true }; // not wired yet — retried with backoff
    if (record.payload.kind !== 'ai.prompt') return { ok: false, status: 400, code: 'invalid' };
    const p = record.payload;
    const rec = await runs.ask({
      askId: askIdForIntent(record.id),
      chatId: p.chatId,
      origin: 'maude-chat',
      label: record.label,
      prompt: p.text,
      scope: p.scope
        ? {
            canvas: p.scope.canvas,
            artboards: p.scope.artboards,
            ...(p.scope.elements?.length ? { elements: p.scope.elements } : {}),
          }
        : null,
    });
    return { ok: true, ref: rec.runId };
  };

  /**
   * Settle the slow gate facts. null = nothing to wait for (the caller stays synchronous); never rejects
   * (a probe that fails leaves the facts as they were).
   */
  function ready(): Promise<void> | null {
    let p: Promise<unknown> | null | undefined;
    try {
      p = deps.ready?.();
    } catch {
      return null;
    }
    return p ? p.then(() => undefined, () => undefined) : null;
  }

  return { closed, chatHasQueued, maybeQueue, sender, ready };
}

// ── the allowance gate's fact (`ai-allowance`, §5.7) ─────────────────────────────────────────
//
// The bridge sees the SDK's rate-limit info on every `usage_update`; the outbox gate reads it
// here. One slot per process (one studio, one project), like acp/running.ts — a PULL, never a
// stale copy in the client.

let allowanceResetsAt: number | null = null;

/** `SDKRateLimitInfo` (raw `_meta["_claude/rateLimit"]`) → the reset time while used up, else null. */
export function allowanceFromRateLimit(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { status?: unknown; resetsAt?: unknown };
  if (o.status !== 'rejected') return null;
  if (typeof o.resetsAt !== 'number' || !Number.isFinite(o.resetsAt) || o.resetsAt <= 0)
    return null;
  return o.resetsAt < 1e12 ? o.resetsAt * 1000 : o.resetsAt; // seconds or ms
}

/** acp/index.ts, on every usage snapshot that carries rate-limit info. */
export function noteRateLimit(raw: unknown): void {
  if (raw === undefined) return;
  allowanceResetsAt = allowanceFromRateLimit(raw);
}

/** The outbox gate facts' `allowanceResetsAt`: null once the reset has passed. */
export function currentAllowanceResetsAt(now = Date.now()): number | null {
  return allowanceResetsAt !== null && allowanceResetsAt > now ? allowanceResetsAt : null;
}
