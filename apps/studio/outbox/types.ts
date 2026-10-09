// The offline outbox's intent record — `maude.outbox/1` (V2-1.14 §5.2).
//
// One outbox per project under `<designRoot>/_state/outbox/`. The DDR-241
// proposal chain at its root is the CONTENT lane (sync/transaction-client.ts,
// bytes unchanged); this module is the other record kind: INTENTS — things
// that must leave this Mac for a target that is not the kernel (AI on this Mac,
// the invite doors, the render service, the handoff publish). A change to a
// project file is never an intent.
//
// Intents live in `_state/outbox/intents/<createdAt>-<id>.json`. 1.x drains
// only `*.json` at the outbox root, so a downgrade never reads one as a
// proposal (V2-1.14 §6 probe). `_state/` is runtime in all four DDR-115 lists.

export const OUTBOX_FORMAT = 'maude.outbox';
export const OUTBOX_VERSION = 1;

/** Design-root-relative directory of the intent records. */
export const INTENTS_REL = '_state/outbox/intents';

export const INTENT_KINDS = [
  'ai.prompt',
  'share.invite',
  'share.ask-to-edit',
  'export.cloud',
  'export.handoff',
] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

export const GATES = [
  'online',
  'hub',
  'signed-in',
  'ai-connected',
  'ai-ready',
  'ai-allowance',
  'after',
] as const;
export type Gate = (typeof GATES)[number];

export const INTENT_STATES = ['queued', 'sending', 'needs-you', 'done', 'dropped'] as const;
export type IntentState = (typeof INTENT_STATES)[number];

/** Final states — never sent again by the drain itself (C20: a manual Retry
 *  may re-open a `dropped: refused` / `needs-you` record once). */
export const FINAL_STATES: readonly IntentState[] = ['done', 'dropped'];

export const OUTCOME_CODES = [
  'sent', // handed to the target, which answered
  'already', // the target already had it (idempotent replay, already a member…)
  'expired',
  'cancelled', // by you
  'target-trashed',
  'target-removed',
  'target-missing',
  'access-removed',
  'access-reduced',
  'project-changed',
  'format',
  'plan',
  'refused', // any other final answer from the target (its code in `ref`)
] as const;
export type OutcomeCode = (typeof OUTCOME_CODES)[number];

/** V2-1.4 `ElementRef`. */
export interface ElementRef {
  canvas: string;
  artboard: string;
  element: string;
  occurrence?: number;
}

export type Role = 'view' | 'comment' | 'edit';
export type ShareScope = 'project' | { canvas: string };

/** S8's export sheet fields — opaque here; hashed for dedupe. */
export type ExportSpec = Record<string, unknown>;

export type IntentPayload =
  | {
      kind: 'ai.prompt';
      chatId: string;
      text: string;
      scope: { canvas: string; artboards: string[] | '*'; elements?: ElementRef[] } | null;
      /** content-addressed names in the chat's attachments */
      attachments: string[];
      /** 'field' = 03's "waits in the field" (setting up, used up) */
      presentation: 'sent' | 'field';
    }
  | { kind: 'share.invite'; email: string; role: Role; scope: ShareScope; message?: string }
  | { kind: 'share.ask-to-edit'; scope: ShareScope; note?: string }
  | { kind: 'export.cloud'; spec: ExportSpec; saveTo: string }
  | { kind: 'export.handoff'; canvas: string; target: string };

export interface IntentTarget {
  /** kernel doc entry (follows moves), or `path:<repoRel>` before the op log */
  canvas?: string;
  artboards?: string[];
  elements?: ElementRef[];
  chatId?: string;
}

export interface IntentOutcome {
  code: OutcomeCode;
  at: number;
  /** askId / inviteId / jobId on success; the target's own code on `refused` */
  ref?: string;
  /** The replay-table row that decided it (`G2`, …) — Diagnostics + words. */
  row?: string;
}

export interface IntentRecord {
  format: typeof OUTBOX_FORMAT;
  v: typeof OUTBOX_VERSION;
  /** `/^i_[a-z0-9]{20}$/` — crypto random; the idempotency key end to end */
  id: string;
  kind: IntentKind;
  /** this Mac's clock; the order key within a lane */
  createdAt: number;
  /** who asked (the signed-in person of this project tab) */
  actor: string;
  /** V2-1.5 origin.deviceId */
  device: string;
  /** null/null = local project; bound at enqueue, never rebound (O6) */
  project: { id: string | null; hub: string | null };
  /** `ai:<chatId>` | `share` | `export` */
  lane: string;
  target: IntentTarget;
  /** createdAt of the newest content-lane entry pending when this was enqueued */
  watermark: number | null;
  /** still closed, recomputed on every wake */
  gates: Gate[];
  dedupeKey: string | null;
  expiresAt: number;
  state: IntentState;
  /** counted only while every gate is open */
  attempts: number;
  nextAttemptAt: number | null;
  outcome?: IntentOutcome;
  /** the row's words: "Three reel covers", "Invite tereza@… · Can edit" */
  label: string;
  payload: IntentPayload;
}

/** `GET /_api/outbox` row — the record without personal payload text. */
export type IntentView = Omit<IntentRecord, 'payload'> & {
  payload: Record<string, unknown>;
};

export const ID_RE = /^i_[a-z0-9]{20}$/;

/** §5.13 caps. */
export const LIMITS = {
  queued: 500,
  total: 500,
  promptBytes: 100 * 1024,
  recordBytes: 256 * 1024,
  /** done / dropped records stay this long after `outcome.at` (Diagnostics). */
  keepFinishedMs: 7 * 24 * 3600 * 1000,
} as const;
