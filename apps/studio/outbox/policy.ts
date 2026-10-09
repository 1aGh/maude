// The outbox's rules as data — V2-1.14 §5.4–§5.9.
//
// Pure: no IO, no clock of its own. The store persists, the drain schedules;
// everything they DECIDE comes from here, so one table answers "what happens
// to this queued thing, and what does the person read" for every surface
// (chat line, comment pin, Share sheet, Exports row, Diagnostics).
//
// Words are CONTRACT §4 voice, verbatim from the drawn canvases where they
// exist (01, 03, 05, 09, 10). Placeholders: {canvas} {artboard} {element}
// {project} {who} {invitee} {email} {label} {n} {time} {chat}.

import { createHash } from 'node:crypto';

import {
  GATES,
  type Gate,
  ID_RE,
  INTENT_KINDS,
  INTENT_STATES,
  type IntentKind,
  type IntentPayload,
  type IntentRecord,
  type IntentState,
  type IntentView,
  LIMITS,
  OUTBOX_FORMAT,
  OUTBOX_VERSION,
  OUTCOME_CODES,
  type OutcomeCode,
} from './types.ts';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// ─── Lanes (§5.1, §5.5) ──────────────────────────────────────────────────────

/** The lane a record of this kind rides. `ai:<chatId>` is FIFO per chat (O2);
 *  `share` is independent (O3); `export` starts in creation order (O3). */
export function laneFor(payload: IntentPayload): string {
  if (payload.kind === 'ai.prompt') return `ai:${payload.chatId}`;
  if (payload.kind === 'share.invite' || payload.kind === 'share.ask-to-edit') return 'share';
  return 'export';
}

/** True for lanes where only the oldest unfinished record may move (O2). */
export const isFifoLane = (lane: string): boolean => lane.startsWith('ai:');

// ─── Expiry (§5.7) ───────────────────────────────────────────────────────────

export const EXPIRY_MS: Record<IntentKind, number> = {
  'ai.prompt': 7 * DAY,
  'share.invite': 14 * DAY,
  'share.ask-to-edit': 7 * DAY,
  'export.cloud': DAY,
  'export.handoff': DAY,
};

/** `ai.prompt` waits `max(7 days, resetsAt + 1 h)` — a weekly allowance can
 *  reset later than a week after the ask (Q5). */
export function expiresAtFor(
  kind: IntentKind,
  createdAt: number,
  allowanceResetsAt?: number | null
): number {
  const base = createdAt + EXPIRY_MS[kind];
  if (kind === 'ai.prompt' && typeof allowanceResetsAt === 'number')
    return Math.max(base, allowanceResetsAt + HOUR);
  return base;
}

/** The expired line + its one action, per kind (§5.7). */
export const EXPIRED_WORDS: Record<IntentKind, { words: string; action: string }> = {
  'ai.prompt': { words: 'Not sent — it waited a week. Your prompt is still here.', action: 'Send' },
  'share.invite': {
    words: 'Invite to {email} not sent — it waited 14 days.',
    action: 'Invite again',
  },
  // Not drawn — the invite line's shape, at the kind's own 7 days.
  'share.ask-to-edit': { words: 'Ask to edit not sent — it waited a week.', action: 'Ask again' },
  'export.cloud': { words: 'Not exported — it waited a day.', action: 'Export again' },
  'export.handoff': { words: 'Not exported — it waited a day.', action: 'Export again' },
};

// ─── Gates (§5.4) ────────────────────────────────────────────────────────────

/** What the drain knows about the world right now. */
export interface GateFacts {
  /** the shell's reachability + a successful probe */
  online: boolean;
  /** the project's hub answers `/health` (linked projects only) */
  hubReachable: boolean;
  /** the project tab's account has a valid cloud session */
  signedIn: boolean;
  aiConnected: boolean;
  aiReady: boolean;
  /** from the last SDK rate-limit info, kept server-side by the bridge */
  allowanceResetsAt: number | null;
}

const NEEDS_SIGN_IN: readonly IntentKind[] = [
  'share.invite',
  'share.ask-to-edit',
  'export.cloud',
  'export.handoff',
];

/**
 * The gates still closed for `record`, in `GATES` order. A closed gate is not
 * an attempt and has no backoff (§5.8). `contentPending` = createdAt of every
 * content-lane entry without a final answer (O4: the `after` gate).
 */
export function closedGates(
  record: Pick<IntentRecord, 'kind' | 'project' | 'watermark'>,
  facts: GateFacts,
  contentPending: readonly number[],
  now: number
): Gate[] {
  const closed = new Set<Gate>();
  if (!facts.online) closed.add('online');
  if (record.project.hub !== null && !facts.hubReachable) closed.add('hub');
  if (NEEDS_SIGN_IN.includes(record.kind) && !facts.signedIn) closed.add('signed-in');
  if (record.kind === 'ai.prompt') {
    if (!facts.aiConnected) closed.add('ai-connected');
    if (!facts.aiReady) closed.add('ai-ready');
    if (typeof facts.allowanceResetsAt === 'number' && now < facts.allowanceResetsAt)
      closed.add('ai-allowance');
  }
  const wm = record.watermark;
  if (wm !== null && contentPending.some((c) => c <= wm)) closed.add('after');
  return GATES.filter((g) => closed.has(g));
}

const OFFLINE_WORDS: Record<IntentKind, string> = {
  'ai.prompt': 'Queued — sends when this Mac is online.',
  'share.invite': 'Invites send when this Mac is online.',
  'share.ask-to-edit': 'Queued — sends when this Mac is online.',
  'export.cloud': 'Waits for a connection, then starts by itself.',
  'export.handoff': 'Queued — starts when this Mac is online',
};

export interface Words {
  /** stable key for the surface (and tests) */
  key: string;
  text: string;
  /** at most one action (CONTRACT §4) — two only for the connect sheet */
  actions: string[];
  /** 03: "waits in the field" instead of a sent bubble */
  presentation?: 'field';
}

/** The words a surface shows for the FIRST closed gate, or null (`after`
 *  shows the content lane's own words). */
export function gateWords(gates: readonly Gate[], kind: IntentKind, time = ''): Words | null {
  const g = gates[0];
  if (!g) return null;
  switch (g) {
    case 'online':
    case 'hub':
      // The status machine calls an unreachable hub "Offline — kept on this
      // Mac" (V2-4.3), so both gates tell one story.
      return { key: `gate.offline.${kind}`, text: OFFLINE_WORDS[kind], actions: [] };
    case 'signed-in':
      return { key: 'gate.signed-in', text: 'Sign in to send it.', actions: ['Sign in'] };
    case 'ai-connected':
      return {
        key: 'gate.ai-connected',
        text: "Connect your Claude account to let AI draft this. Your prompt waits here and runs as soon as it's connected.",
        actions: ['Connect', 'Cancel'],
      };
    case 'ai-ready':
      return {
        key: 'gate.ai-ready',
        text: 'Setting up AI on this Mac. About a minute — keep drawing meanwhile.',
        actions: [],
        presentation: 'field',
      };
    case 'ai-allowance':
      return {
        key: 'gate.ai-allowance',
        text: `AI's allowance is used up until ${time}. Your prompt is kept and sends then.`,
        actions: [],
        presentation: 'field',
      };
    case 'after':
      return null;
  }
}

// ─── Retry (§5.8) ────────────────────────────────────────────────────────────

/** 1.5 s → 30 s, doubling, ±20 % jitter. `attempts` ≥ 1. */
export function backoffMs(attempts: number, rand: () => number = Math.random): number {
  const ms = Math.min(1500 * 2 ** Math.max(0, attempts - 1), 30_000);
  return Math.round(ms * (0.8 + 0.4 * rand()));
}

// ─── The replay table — G1–G26 (§5.9) ────────────────────────────────────────

export type ReplayOutcome =
  | { state: IntentState; outcome?: OutcomeCode }
  | { lane: 'recovery' | 'conflict' | 'accepted' | 'gate' | 'waits' | 'unchanged' };

export interface ReplayRow {
  id: string;
  /** what changed while the thing was queued */
  change: string;
  /** `content` = the DDR-241 lane (decided by the kernel; listed for words) */
  applies: 'content' | readonly IntentKind[];
  result: ReplayOutcome;
  /** per-kind words where the row speaks differently per kind */
  words: string | Partial<Record<IntentKind | 'content', string>> | null;
  action: string | null;
  kept: string | null;
}

const ALL: readonly IntentKind[] = INTENT_KINDS;

export const REPLAY_TABLE: readonly ReplayRow[] = [
  {
    id: 'G1',
    change: 'canvas-trashed',
    applies: 'content',
    result: { lane: 'recovery' },
    words:
      '{canvas} was moved to the trash while this Mac was offline. Your {n} changes are kept with it.',
    action: 'Restore',
    kept: 'the bytes, in recovery',
  },
  {
    id: 'G2',
    change: 'canvas-trashed',
    applies: ['ai.prompt'],
    result: { state: 'dropped', outcome: 'target-trashed' },
    words: 'Not sent — {canvas} is in the trash.',
    action: 'Restore {canvas}',
    kept: 'the prompt text in the chat',
  },
  {
    id: 'G3',
    change: 'canvas-trashed',
    applies: ['share.invite', 'export.cloud', 'export.handoff'],
    result: { state: 'dropped', outcome: 'target-trashed' },
    words: {
      'share.invite': 'Invite to {canvas} not sent — {canvas} is in the trash.',
      'export.cloud': "{canvas} is in the trash, so its export didn't start.",
      'export.handoff': "{canvas} is in the trash, so its export didn't start.",
    },
    action: 'Restore',
    kept: 'the row, "Not sent"',
  },
  {
    id: 'G4',
    change: 'artboard-trashed',
    applies: 'content',
    result: { lane: 'conflict' },
    words:
      'You changed {artboard} while it was moved to the trash. Keep yours, or keep it in the trash.',
    action: null,
    kept: 'both versions (Version history)',
  },
  {
    id: 'G5',
    change: 'artboard-trashed',
    applies: ['ai.prompt'],
    result: { state: 'dropped', outcome: 'target-trashed' },
    words: 'Not sent — {artboard} is in the trash.',
    action: 'Restore {artboard}',
    kept: 'prompt in the chat',
  },
  {
    id: 'G6',
    change: 'element-removed',
    applies: ['ai.prompt'],
    result: { state: 'needs-you', outcome: 'target-removed' },
    words: 'The {element} you picked is gone. Send it for the whole {artboard}?',
    action: 'Send',
    kept: 'prompt',
  },
  {
    id: 'G7',
    change: 'canvas-moved',
    applies: ALL,
    result: { lane: 'unchanged' },
    words: null,
    action: null,
    kept: null,
  },
  {
    id: 'G8',
    change: 'access-removed',
    applies: 'content',
    result: { lane: 'recovery' },
    words:
      "You were removed from {project} while this Mac was offline. {n} changes couldn't go up — they're kept on this Mac.",
    action: 'Show in Finder',
    kept: 'bytes in recovery',
  },
  {
    id: 'G9',
    change: 'access-removed',
    applies: ALL,
    result: { state: 'dropped', outcome: 'access-removed' },
    words: "Not sent — you're no longer in {project}.",
    action: null,
    kept: 'the rows, 7 days',
  },
  {
    id: 'G10',
    change: 'role-comment',
    applies: 'content',
    result: { lane: 'recovery' },
    words:
      "{who} changed you to Can comment while this Mac was offline. Your {n} changes couldn't go up — they're kept on this Mac.",
    action: 'Ask to edit',
    kept: 'bytes',
  },
  {
    id: 'G11',
    change: 'role-comment',
    applies: 'content',
    result: { lane: 'accepted' },
    words: null,
    action: null,
    kept: null,
  },
  {
    id: 'G12',
    change: 'role-comment',
    applies: ['ai.prompt'],
    result: { state: 'dropped', outcome: 'access-reduced' },
    words: 'Not sent — you can comment on {project}, not edit it.',
    action: 'Ask to edit',
    kept: 'prompt',
  },
  {
    id: 'G13',
    change: 'role-view',
    applies: 'content',
    result: { lane: 'recovery' },
    words: "{who} changed you to Can view while this Mac was offline. Your comment couldn't go up.",
    action: 'Ask to edit',
    kept: 'bytes',
  },
  {
    id: 'G14',
    change: 'role-view',
    applies: ['export.cloud'],
    result: { state: 'dropped', outcome: 'access-reduced' },
    words: "Not exported — Can view can't download from {project}.",
    action: null,
    kept: 'row',
  },
  {
    id: 'G15',
    change: 'not-owner',
    applies: ['share.invite'],
    result: { state: 'dropped', outcome: 'access-reduced' },
    words: 'Invite not sent — only owners can invite to {project}.',
    action: null,
    kept: 'row',
  },
  {
    id: 'G16',
    change: 'already-member',
    applies: ['share.invite', 'share.ask-to-edit'],
    result: { state: 'done', outcome: 'already' },
    words: '{invitee} is already in {project}.',
    action: null,
    kept: null,
  },
  {
    id: 'G17',
    change: 'project-changed',
    applies: ALL,
    result: { state: 'dropped', outcome: 'project-changed' },
    words: 'Not sent — {project} is connected to another place now.',
    action: null,
    kept: 'rows, 7 days (Diagnostics)',
  },
  {
    id: 'G18',
    change: 'project-changed',
    applies: 'content',
    result: { lane: 'recovery' },
    words:
      "{project} is connected to another place now. {n} changes couldn't go up — they're kept on this Mac.",
    action: 'Show in Finder',
    kept: 'bytes',
  },
  {
    id: 'G19',
    change: 'format',
    applies: 'content',
    result: { lane: 'recovery' },
    words: 'This project now uses Maude 2. Update Maude to edit it.',
    action: null,
    kept: 'bytes',
  },
  {
    id: 'G20',
    change: 'format',
    applies: ALL,
    // paused, not dropped: updating Maude sends them
    result: { state: 'needs-you', outcome: 'format' },
    words: 'This project now uses Maude 2. Update Maude to edit it.',
    action: null,
    kept: 'rows',
  },
  {
    id: 'G21',
    change: 'plan',
    applies: ALL,
    // paused, never dropped by the pause
    result: { state: 'needs-you', outcome: 'plan' },
    words: 'Editing and sync pause until you choose a plan.',
    action: 'Choose a plan',
    kept: 'everything',
  },
  {
    id: 'G22',
    change: 'chat-trashed',
    applies: ['ai.prompt'],
    result: { state: 'dropped', outcome: 'cancelled' },
    // said FIRST, by the trash dialog
    words: 'Move "{chat}" to the trash? Its queued prompt won\'t send.',
    action: 'Move to trash',
    kept: 'the chat, in the trash',
  },
  {
    id: 'G23',
    change: 'ai-disconnected',
    applies: ['ai.prompt'],
    result: { lane: 'gate' },
    words: null,
    action: null,
    kept: 'prompt',
  },
  {
    id: 'G24',
    change: 'artboard-busy',
    applies: ['ai.prompt'],
    result: { lane: 'waits' },
    words: null,
    action: null,
    kept: null,
  },
  {
    id: 'G25',
    change: 'save-folder-missing',
    applies: ['export.cloud'],
    result: { state: 'done', outcome: 'sent' },
    words: 'Saved to Downloads — the folder was missing.',
    action: 'Show in Finder',
    kept: 'the file',
  },
  {
    id: 'G26',
    change: 'other-final',
    applies: ALL,
    result: { state: 'dropped', outcome: 'refused' },
    words: "Couldn't send {label}.",
    action: 'Retry {label}',
    kept: 'row',
  },
];

const ROW = new Map(REPLAY_TABLE.map((r) => [r.id, r]));

/** One decision the drain applies to a record. */
export interface Decision {
  state: IntentState;
  outcome: OutcomeCode;
  row?: string;
  ref?: string;
  words: Words | null;
}

/** A row's words for one kind, with the placeholders filled. */
export function rowWords(
  id: string,
  kind: IntentKind | 'content',
  fill: Record<string, string | number> = {}
): Words | null {
  const row = ROW.get(id);
  if (!row?.words) return null;
  const tpl = typeof row.words === 'string' ? row.words : row.words[kind];
  if (!tpl) return null;
  const sub = (s: string) =>
    s.replace(/\{(\w+)\}/g, (m, k: string) => (fill[k] !== undefined ? String(fill[k]) : m));
  return { key: `outbox.${id}`, text: sub(tpl), actions: row.action ? [sub(row.action)] : [] };
}

function decide(
  id: string,
  kind: IntentKind,
  fill: Record<string, string | number>,
  ref?: string
): Decision {
  const row = ROW.get(id);
  const result = row?.result;
  if (!result || !('state' in result) || !result.outcome)
    throw new Error(`replay row ${id} decides no intent state`);
  return {
    state: result.state,
    outcome: result.outcome,
    row: id,
    ...(ref ? { ref } : {}),
    words: rowWords(id, kind, fill),
  };
}

export type ItemState = 'present' | 'trashed' | 'missing';

/** What the studio knows about a record's target right now (its own
 *  manifest, the project's last-known role, chat state) — §5.9 "checked
 *  before sending". */
export interface TargetFacts {
  /** the project id this studio is linked to now (null = a local project) */
  projectId: string | null;
  projectName: string;
  /** your role there now; null = removed. A local project is `owner`. */
  role: 'owner' | 'edit' | 'comment' | 'view' | null;
  formatGated?: boolean;
  planLapsed?: boolean;
  canvas?: { state: ItemState; name: string };
  artboards?: Record<string, { state: ItemState; name: string }>;
  /** ids of `target.elements` that no longer exist */
  missingElements?: Array<{ element: string; name: string; artboard: string }>;
  chat?: { state: ItemState; title: string };
}

/**
 * The pre-send check. `null` = nothing changed that stops it. Checked in
 * decisiveness order: the project, your membership, the pauses, then the
 * kind's own target.
 */
export function judgeTarget(record: IntentRecord, facts: TargetFacts): Decision | null {
  const k = record.kind;
  const fill: Record<string, string> = { project: facts.projectName, label: record.label };
  // O6 / G17 — bound at enqueue, never rebound.
  if (record.project.id !== facts.projectId) return decide('G17', k, fill);
  if (facts.role === null) return decide('G9', k, fill);
  if (facts.formatGated) return decide('G20', k, fill);
  if (facts.planLapsed) return decide('G21', k, fill);

  if (k === 'ai.prompt' && facts.chat) {
    if (facts.chat.state === 'trashed')
      return decide('G22', k, { ...fill, chat: facts.chat.title });
    if (facts.chat.state === 'missing')
      return { state: 'dropped', outcome: 'target-missing', words: rowWords('G26', k, fill) };
  }

  // Access reduced (C30 / A19 / the role matrix).
  if (k === 'ai.prompt' && (facts.role === 'comment' || facts.role === 'view')) {
    const d = decide('G12', k, fill);
    if (facts.role === 'view' && d.words)
      d.words.text = `Not sent — you can view ${facts.projectName}, not edit it.`;
    return d;
  }
  if (k === 'export.cloud' && facts.role === 'view') return decide('G14', k, fill);
  if (k === 'share.invite' && facts.role !== 'owner') return decide('G15', k, fill);

  // The kind's own target.
  if (facts.canvas?.state === 'trashed') {
    const f = { ...fill, canvas: facts.canvas.name };
    if (k === 'ai.prompt') return decide('G2', k, f);
    if (k === 'share.invite' || k === 'export.cloud' || k === 'export.handoff')
      return decide('G3', k, f);
  }
  if (facts.canvas?.state === 'missing')
    return { state: 'dropped', outcome: 'target-missing', words: rowWords('G26', k, fill) };
  if (k === 'ai.prompt') {
    for (const ab of record.target.artboards ?? []) {
      const a = facts.artboards?.[ab];
      if (a?.state === 'trashed') return decide('G5', k, { ...fill, artboard: a.name });
    }
    const gone = facts.missingElements?.[0];
    if (gone) {
      const ab = facts.artboards?.[gone.artboard]?.name ?? gone.artboard;
      return decide('G6', k, { ...fill, element: gone.name, artboard: ab });
    }
  }
  return null;
}

/**
 * What a surface shows for a record right now: its first closed gate while it
 * waits, its expired line, or the row that ended it. `fill` carries the names
 * the surface knows ({canvas}, {project}, {time} …).
 */
export function wordsFor(record: IntentRecord, fill: Record<string, string> = {}): Words | null {
  if (record.state === 'queued' || record.state === 'sending')
    return gateWords(record.gates, record.kind, fill.time ?? '');
  const code = record.outcome?.code;
  if (code === 'expired') {
    const e = EXPIRED_WORDS[record.kind];
    const email = record.payload.kind === 'share.invite' ? maskEmail(record.payload.email) : '';
    return {
      key: `outbox.expired.${record.kind}`,
      text: e.words.replace('{email}', email),
      actions: [e.action],
    };
  }
  if (record.outcome?.row)
    return rowWords(record.outcome.row, record.kind, { label: record.label, ...fill });
  return null;
}

// ─── Answers (§5.8, §5.9 answer side, §5.11 target codes) ────────────────────

export type TargetAnswer =
  | { ok: true; ref?: string; already?: boolean; savedToDownloads?: boolean }
  | { ok: false; network: true }
  | { ok: false; status: number; code?: string; retryAfterMs?: number; message?: string };

export type AnswerVerdict =
  | { kind: 'decision'; decision: Decision }
  | { kind: 'transient'; retryAfterMs?: number }
  | { kind: 'gate'; gate: Gate };

const TRANSIENT_STATUS = new Set([408, 425, 429]);

/** Map a target's answer to what happens next. Final answers are never
 *  retried by themselves (C20). */
export function judgeAnswer(
  record: IntentRecord,
  answer: TargetAnswer,
  fill: Record<string, string> = {}
): AnswerVerdict {
  const k = record.kind;
  const f = { label: record.label, ...fill };
  if (answer.ok) {
    if (answer.already) return { kind: 'decision', decision: decide('G16', k, f, answer.ref) };
    if (answer.savedToDownloads && k === 'export.cloud')
      return { kind: 'decision', decision: decide('G25', k, f, answer.ref) };
    return {
      kind: 'decision',
      decision: {
        state: 'done',
        outcome: 'sent',
        ...(answer.ref ? { ref: answer.ref } : {}),
        words: null,
      },
    };
  }
  if ('network' in answer) return { kind: 'transient' };
  const { status, code } = answer;
  if (status === 401) return { kind: 'gate', gate: 'signed-in' };
  if (status >= 500 || TRANSIENT_STATUS.has(status) || code === 'retryable')
    return {
      kind: 'transient',
      ...(answer.retryAfterMs ? { retryAfterMs: answer.retryAfterMs } : {}),
    };
  if (status === 426 || code === 'format')
    return { kind: 'decision', decision: decide('G20', k, f) };
  if (status === 402 || code === 'plan' || code === 'plan-lapsed')
    return { kind: 'decision', decision: decide('G21', k, f) };
  if (code === 'already-member' || code === 'already-editor' || code === 'already')
    return { kind: 'decision', decision: decide('G16', k, f, code) };
  if (code === 'project-changed' || code === 'unknown-project')
    return { kind: 'decision', decision: decide('G17', k, f, code) };
  if (code === 'access-removed' || code === 'not-a-member')
    return { kind: 'decision', decision: decide('G9', k, f, code) };
  if (code === 'target-trashed') {
    const id = k === 'ai.prompt' ? 'G2' : 'G3';
    if (k === 'share.ask-to-edit') return refused(record, code, answer.message, f);
    return { kind: 'decision', decision: decide(id, k, f, code) };
  }
  if (code === 'forbidden' || status === 403) {
    if (k === 'share.invite') return { kind: 'decision', decision: decide('G15', k, f, code) };
    if (k === 'export.cloud') return { kind: 'decision', decision: decide('G14', k, f, code) };
    if (k === 'ai.prompt') return { kind: 'decision', decision: decide('G12', k, f, code) };
  }
  return refused(record, code ?? `http-${status}`, answer.message, f);
}

function refused(
  record: IntentRecord,
  code: string,
  message: string | undefined,
  fill: Record<string, string>
): AnswerVerdict {
  const d = decide('G26', record.kind, fill, code);
  // The target's own words when it sent CONTRACT-voice copy.
  if (message && d.words) d.words.text = message;
  return { kind: 'decision', decision: d };
}

// ─── Dedupe (§5.6) ───────────────────────────────────────────────────────────

/** How a duplicate at enqueue is folded into the queued record it repeats. */
export type DedupeRule = 'same' | 'replace';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 32);

/** Canonical JSON (sorted keys) — so two equal export sheets hash equal. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

const scopeKey = (s: unknown) =>
  s === 'project' ? 'project' : `canvas:${(s as { canvas?: string })?.canvas ?? ''}`;

/** The semantic dedupe key and its folding rule, per kind. */
export function dedupeFor(
  projectId: string | null,
  payload: IntentPayload
): { key: string; rule: DedupeRule; windowMs?: number } {
  const p = projectId ?? 'local';
  switch (payload.kind) {
    case 'ai.prompt':
      // the double "Try again": same chat + same text within 2 s → one
      return { key: `ai:${payload.chatId}:${sha(payload.text)}`, rule: 'same', windowMs: 2000 };
    case 'share.invite':
      return {
        // hashed: the key is shown in lists and Diagnostics, the e-mail never is (§5.3)
        key: `invite:${p}:${scopeKey(payload.scope)}:${sha(payload.email.toLowerCase())}`,
        rule: 'replace',
      };
    case 'share.ask-to-edit':
      return { key: `ask:${p}:${scopeKey(payload.scope)}`, rule: 'same' };
    case 'export.cloud':
      return { key: `export:${p}:${sha(canonicalJson(payload.spec))}`, rule: 'same' };
    case 'export.handoff':
      return { key: `handoff:${p}:${payload.canvas}:${payload.target}`, rule: 'replace' };
  }
}

// ─── Validation + redaction ──────────────────────────────────────────────────

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function payloadErrors(p: unknown): string[] {
  if (!p || typeof p !== 'object') return ['payload: not an object'];
  const o = p as Record<string, unknown>;
  const e: string[] = [];
  const need = (k: string, ok: boolean) => {
    if (!ok) e.push(`payload.${k}`);
  };
  switch (o.kind) {
    case 'ai.prompt':
      need('chatId', isStr(o.chatId) && o.chatId.length > 0);
      need('text', isStr(o.text) && Buffer.byteLength(o.text) <= LIMITS.promptBytes);
      need('attachments', Array.isArray(o.attachments) && o.attachments.every(isStr));
      need('presentation', o.presentation === 'sent' || o.presentation === 'field');
      need(
        'scope',
        o.scope === null ||
          (typeof o.scope === 'object' && isStr((o.scope as { canvas?: unknown }).canvas))
      );
      break;
    case 'share.invite':
      need('email', isStr(o.email) && /^[^\s@]+@[^\s@]+$/.test(o.email));
      need('role', o.role === 'view' || o.role === 'comment' || o.role === 'edit');
      need(
        'scope',
        o.scope === 'project' ||
          (typeof o.scope === 'object' && isStr((o.scope as { canvas?: unknown })?.canvas))
      );
      need('message', o.message === undefined || isStr(o.message));
      break;
    case 'share.ask-to-edit':
      need(
        'scope',
        o.scope === 'project' ||
          (typeof o.scope === 'object' && isStr((o.scope as { canvas?: unknown })?.canvas))
      );
      need('note', o.note === undefined || isStr(o.note));
      break;
    case 'export.cloud':
      need('spec', !!o.spec && typeof o.spec === 'object' && !Array.isArray(o.spec));
      need('saveTo', isStr(o.saveTo));
      break;
    case 'export.handoff':
      need('canvas', isStr(o.canvas));
      need('target', isStr(o.target));
      break;
    default:
      e.push('payload.kind');
  }
  return e;
}

/** Total validator for a stored or about-to-be-stored record. */
export function validateIntentRecord(
  x: unknown
): { ok: true; record: IntentRecord } | { ok: false; errors: string[] } {
  if (!x || typeof x !== 'object') return { ok: false, errors: ['not an object'] };
  const r = x as Record<string, unknown>;
  const e: string[] = [];
  if (r.format !== OUTBOX_FORMAT) e.push('format');
  if (r.v !== OUTBOX_VERSION) e.push('v');
  if (!isStr(r.id) || !ID_RE.test(r.id)) e.push('id');
  if (!INTENT_KINDS.includes(r.kind as IntentKind)) e.push('kind');
  if (!isNum(r.createdAt)) e.push('createdAt');
  if (!isStr(r.actor)) e.push('actor');
  if (!isStr(r.device)) e.push('device');
  const proj = r.project as { id?: unknown; hub?: unknown } | undefined;
  if (!proj || (proj.id !== null && !isStr(proj.id)) || (proj.hub !== null && !isStr(proj.hub)))
    e.push('project');
  if (!isStr(r.lane)) e.push('lane');
  if (!r.target || typeof r.target !== 'object') e.push('target');
  if (r.watermark !== null && !isNum(r.watermark)) e.push('watermark');
  if (!Array.isArray(r.gates) || !r.gates.every((g) => GATES.includes(g as Gate))) e.push('gates');
  if (r.dedupeKey !== null && !isStr(r.dedupeKey)) e.push('dedupeKey');
  if (!isNum(r.expiresAt)) e.push('expiresAt');
  if (!INTENT_STATES.includes(r.state as IntentState)) e.push('state');
  if (!isNum(r.attempts) || (r.attempts as number) < 0) e.push('attempts');
  if (r.nextAttemptAt !== null && !isNum(r.nextAttemptAt)) e.push('nextAttemptAt');
  if (r.outcome !== undefined) {
    const o = r.outcome as { code?: unknown; at?: unknown };
    if (!o || !OUTCOME_CODES.includes(o.code as OutcomeCode) || !isNum(o.at)) e.push('outcome');
  }
  if (!isStr(r.label)) e.push('label');
  e.push(...payloadErrors(r.payload));
  if (!e.length && (r.payload as { kind: string }).kind !== r.kind) e.push('payload.kind ≠ kind');
  if (!e.length && r.lane !== laneFor(r.payload as IntentPayload)) e.push('lane ≠ kind lane');
  if (!e.length && Buffer.byteLength(JSON.stringify(r)) > LIMITS.recordBytes)
    e.push('record too large');
  return e.length ? { ok: false, errors: e } : { ok: true, record: r as unknown as IntentRecord };
}

/** `tereza@studio.cz` → `tereza@…` (the drawn form). */
export const maskEmail = (email: string): string => `${email.split('@')[0] ?? ''}@…`;

const PERSONAL_KEYS = ['text', 'email', 'message', 'note'] as const;

/**
 * The record a list or Diagnostics may show: no prompt text, e-mail, invite
 * message or ask note (§5.3 "Never", §5.10) — also scrubbed out of the label,
 * in case a caller built the label from them.
 */
export function toView(record: IntentRecord): IntentView {
  const payload: Record<string, unknown> = { ...(record.payload as Record<string, unknown>) };
  let label = record.label;
  for (const k of PERSONAL_KEYS) {
    const v = payload[k];
    if (typeof v !== 'string') continue;
    delete payload[k];
    if (!v) continue;
    const masked = k === 'email' ? maskEmail(v) : '…';
    label = label.split(v).join(masked);
    if (k === 'email') label = label.replace(new RegExp(escapeRe(v), 'gi'), masked);
  }
  return { ...record, label, payload };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
