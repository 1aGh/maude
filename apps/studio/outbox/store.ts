// The intent store — V2-1.14 §5.3. One file per record under
// `<designRoot>/_state/outbox/intents/<createdAt>-<id>.json`, written tmp +
// rename BEFORE anything else happens (the DDR-241 rule); a state change
// rewrites the same name. The in-memory map is authoritative after `load()`.
//
// No route enqueues: each feature's own route decides "send now or queue" and
// calls `enqueue` in-process (§4.9). The client never posts a raw intent.

import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { dedupeFor, expiresAtFor, laneFor, toView, validateIntentRecord } from './policy.ts';
import {
  FINAL_STATES,
  type Gate,
  INTENTS_REL,
  type IntentKind,
  type IntentOutcome,
  type IntentPayload,
  type IntentRecord,
  type IntentState,
  type IntentTarget,
  type IntentView,
  LIMITS,
  OUTBOX_FORMAT,
  OUTBOX_VERSION,
} from './types.ts';

export interface EnqueueInput {
  kind: IntentKind;
  actor: string;
  device: string;
  project: { id: string | null; hub: string | null };
  target?: IntentTarget;
  label: string;
  payload: IntentPayload;
  /** createdAt of the newest PENDING content-lane entry (see `contentWatermark`) */
  watermark?: number | null;
  /** the gates the caller already knows are closed */
  gates?: Gate[];
  /** ai.prompt: extends expiry past a late allowance reset (§5.7) */
  allowanceResetsAt?: number | null;
}

export type EnqueueResult =
  | { ok: true; record: IntentRecord; deduped: false | 'same' | 'replaced' }
  | { ok: false; code: 'queue-full' | 'invalid'; words?: string; errors?: string[] };

export interface OutboxStoreOptions {
  designRoot: string;
  now?: () => number;
  /** the record id; default crypto random `i_` + 20 [a-z0-9] */
  newId?: () => string;
  /** bus hook — `outbox:changed {seq}` (§5.10) */
  onChange?: (seq: number) => void;
  log?: Pick<Console, 'warn'>;
}

/** Fields a feature may revise on a queued / needs-you record (G6 "Send it
 *  for the whole artboard?" drops `target.elements`). */
export interface Revision {
  label?: string;
  payload?: IntentPayload;
  target?: IntentTarget;
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function newIntentId(): string {
  const bytes = randomBytes(20);
  let s = 'i_';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

export const QUEUE_FULL_WORDS =
  'Too much is waiting to send. Go online or clear some in Diagnostics.';

export function createOutboxStore(opts: OutboxStoreOptions) {
  const dir = path.join(opts.designRoot, INTENTS_REL);
  const now = opts.now ?? Date.now;
  const newId = opts.newId ?? newIntentId;
  const log = opts.log ?? console;
  const records = new Map<string, IntentRecord>();
  /** Files that failed validation at load — left on disk, never sent. */
  const invalid: string[] = [];
  let seq = 0;
  let lastStamp = 0;

  const fileOf = (r: Pick<IntentRecord, 'createdAt' | 'id'>) =>
    path.join(dir, `${r.createdAt}-${r.id}.json`);
  const changed = () => {
    seq += 1;
    opts.onChange?.(seq);
  };

  function write(r: IntentRecord): void {
    mkdirSync(dir, { recursive: true });
    const file = fileOf(r);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(r));
    renameSync(tmp, file);
  }

  /** Read every record from disk. An orphan `.tmp` (a crash mid-write) is
   *  ignored — its rename never happened, so the previous state stands. */
  function load(): { loaded: number; invalid: string[] } {
    records.clear();
    invalid.length = 0;
    let names: string[] = [];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith('.json'));
    } catch {
      return { loaded: 0, invalid: [] };
    }
    for (const n of names.sort()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(path.join(dir, n), 'utf8'));
      } catch {
        invalid.push(n);
        continue;
      }
      const v = validateIntentRecord(parsed);
      if (!v.ok || `${v.record.createdAt}-${v.record.id}.json` !== n) {
        invalid.push(n);
        continue;
      }
      records.set(v.record.id, v.record);
      lastStamp = Math.max(lastStamp, v.record.createdAt);
    }
    if (invalid.length) log.warn(`[outbox] ${invalid.length} unreadable intent file(s) left aside`);
    changed();
    return { loaded: records.size, invalid: [...invalid] };
  }

  const stamp = (): number => {
    lastStamp = Math.max(now(), lastStamp + 1);
    return lastStamp;
  };

  const sorted = (): IntentRecord[] =>
    [...records.values()].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));

  function enqueue(input: EnqueueInput): EnqueueResult {
    const t = now();
    const { key, rule, windowMs } = dedupeFor(input.project.id, input.payload);
    // §5.6 semantic dedupe — only against records still waiting (`queued`):
    // one already in flight keeps its bytes.
    const twin = sorted().find(
      (r) =>
        r.state === 'queued' &&
        r.dedupeKey === key &&
        r.project.id === input.project.id &&
        (windowMs === undefined || Math.abs(t - r.createdAt) <= windowMs)
    );
    if (twin) {
      if (rule === 'same') return { ok: true, record: twin, deduped: 'same' };
      // `replace`: the newer one's content, the older one's place (and id —
      // which is its idempotency key, never yet sent).
      const next: IntentRecord = {
        ...twin,
        label: input.label,
        payload: input.payload,
        target: input.target ?? twin.target,
      };
      const v = validateIntentRecord(next);
      if (!v.ok) return { ok: false, code: 'invalid', errors: v.errors };
      write(next);
      records.set(next.id, next);
      changed();
      return { ok: true, record: next, deduped: 'replaced' };
    }
    const waiting = [...records.values()].filter((r) => !FINAL_STATES.includes(r.state)).length;
    if (waiting >= LIMITS.queued) return { ok: false, code: 'queue-full', words: QUEUE_FULL_WORDS };

    const createdAt = stamp();
    const record: IntentRecord = {
      format: OUTBOX_FORMAT,
      v: OUTBOX_VERSION,
      id: newId(),
      kind: input.kind,
      createdAt,
      actor: input.actor,
      device: input.device,
      project: { id: input.project.id, hub: input.project.hub },
      lane: laneFor(input.payload),
      target: input.target ?? {},
      watermark: input.watermark ?? null,
      gates: input.gates ?? [],
      dedupeKey: key,
      expiresAt: expiresAtFor(input.kind, createdAt, input.allowanceResetsAt),
      state: 'queued',
      attempts: 0,
      nextAttemptAt: null,
      label: input.label,
      payload: input.payload,
    };
    const v = validateIntentRecord(record);
    if (!v.ok) return { ok: false, code: 'invalid', errors: v.errors };
    write(record);
    records.set(record.id, record);
    pruneTotal();
    changed();
    return { ok: true, record, deduped: false };
  }

  /** Apply a change to one record and persist it (tmp + rename). */
  function update(id: string, patch: Partial<IntentRecord>): IntentRecord | null {
    const cur = records.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, createdAt: cur.createdAt } as IntentRecord;
    if (patch.outcome === undefined && 'outcome' in patch) delete next.outcome;
    write(next);
    records.set(id, next);
    changed();
    return next;
  }

  /** End a record: `done` / `dropped` / `needs-you`, with its outcome. */
  function settle(
    id: string,
    state: IntentState,
    outcome: Omit<IntentOutcome, 'at'>
  ): IntentRecord | null {
    return update(id, {
      state,
      outcome: { ...outcome, at: now() },
      nextAttemptAt: null,
      gates: [],
    });
  }

  /** `POST /_api/outbox/:id/cancel` — withdraws a waiting record. One in
   *  flight cannot be un-sent: `in-flight`. */
  function cancel(
    id: string
  ): { ok: true; record: IntentRecord } | { ok: false; code: 'not-found' | 'final' | 'in-flight' } {
    const r = records.get(id);
    if (!r) return { ok: false, code: 'not-found' };
    if (FINAL_STATES.includes(r.state)) return { ok: false, code: 'final' };
    if (r.state === 'sending') return { ok: false, code: 'in-flight' };
    return { ok: true, record: settle(id, 'dropped', { code: 'cancelled' }) as IntentRecord };
  }

  /** `POST /_api/outbox/:id/retry` — C20's manual "Retry <name>": re-opens a
   *  `dropped: refused` or a `needs-you` record once. Optionally revised
   *  (G6's "Send it for the whole artboard?"). */
  function retry(
    id: string,
    revision: Revision = {}
  ):
    | { ok: true; record: IntentRecord }
    | { ok: false; code: 'not-found' | 'not-retryable' | 'invalid' } {
    const r = records.get(id);
    if (!r) return { ok: false, code: 'not-found' };
    const reopenable =
      r.state === 'needs-you' || (r.state === 'dropped' && r.outcome?.code === 'refused');
    if (!reopenable) return { ok: false, code: 'not-retryable' };
    const next: IntentRecord = {
      ...r,
      ...(revision.label !== undefined ? { label: revision.label } : {}),
      ...(revision.payload ? { payload: revision.payload } : {}),
      ...(revision.target ? { target: revision.target } : {}),
      state: 'queued',
      attempts: 0,
      nextAttemptAt: null,
      gates: [],
    };
    delete next.outcome;
    const v = validateIntentRecord(next);
    if (!v.ok) return { ok: false, code: 'invalid' };
    write(next);
    records.set(id, next);
    changed();
    return { ok: true, record: next };
  }

  /** Keep the total ≤ 500: oldest finished first (`done`, then `dropped`);
   *  waiting records are never pruned by the cap. */
  function pruneTotal(): number {
    let removed = 0;
    const over = () => records.size - LIMITS.total;
    if (over() <= 0) return 0;
    for (const state of ['done', 'dropped'] as const) {
      for (const r of sorted().filter((x) => x.state === state)) {
        if (over() <= 0) return removed;
        remove(r);
        removed++;
      }
    }
    return removed;
  }

  function remove(r: IntentRecord): void {
    rmSync(fileOf(r), { force: true });
    records.delete(r.id);
  }

  /** Finished records leave 7 days after their outcome (Diagnostics shows
   *  recent ones), then the 500 cap. */
  function prune(): number {
    const t = now();
    let removed = 0;
    for (const r of sorted()) {
      if (FINAL_STATES.includes(r.state) && r.outcome && t - r.outcome.at > LIMITS.keepFinishedMs) {
        remove(r);
        removed++;
      }
    }
    removed += pruneTotal();
    if (removed) changed();
    return removed;
  }

  return {
    load,
    enqueue,
    update,
    settle,
    cancel,
    retry,
    prune,
    get: (id: string): IntentRecord | null => records.get(id) ?? null,
    list: (): IntentRecord[] => sorted(),
    /** `GET /_api/outbox` rows — redacted (§5.3). */
    views: (): IntentView[] => sorted().map(toView),
    get seq() {
      return seq;
    },
    invalidFiles: () => [...invalid],
    dir,
  };
}

export type OutboxStore = ReturnType<typeof createOutboxStore>;
