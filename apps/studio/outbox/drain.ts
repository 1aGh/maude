// The intent drain — V2-1.14 §5.5–§5.9.
//
// Event-driven: it runs a pass on `wake()` (gate events: reachability,
// sign-in, AI login state, content-lane progress; enqueue; boot) and on ONE
// timer for the earliest backoff / expiry / allowance reset. No polling.
//
// A pass, per record in creation order:
//   1. expiry (and the ai.prompt allowance extension, §5.7);
//   2. a paused record (G20 format, G21 plan) resumes when its pause is gone;
//   3. FIFO per chat (O2) — an earlier unfinished prompt of the same chat
//      holds the next one;
//   4. the gone-target check (§5.9) BEFORE sending;
//   5. closed gates — not an attempt, no backoff (§5.8);
//   6. send: the record is persisted `sending` (attempts + 1) BEFORE the call,
//      so a crash replays the SAME id — the idempotency key end to end;
//   7. the answer → done / dropped / needs-you (final, never retried by
//      itself), or back to queued with backoff (transient), or a gate (401).

import {
  backoffMs,
  closedGates,
  expiresAtFor,
  type GateFacts,
  isFifoLane,
  judgeAnswer,
  judgeTarget,
  type TargetAnswer,
  type TargetFacts,
} from './policy.ts';
import type { OutboxStore } from './store.ts';
import { FINAL_STATES, type IntentKind, type IntentRecord } from './types.ts';

export type Sender = (record: IntentRecord) => Promise<TargetAnswer>;

export interface DrainOptions {
  store: OutboxStore;
  /** One per kind — each feature's own door (V2-1.15 `registry.ask`, the
   *  invite doors, the render service, the handoff publish). A kind with no
   *  sender waits (no attempt is counted). */
  senders: Partial<Record<IntentKind, Sender>>;
  gates: () => GateFacts;
  target: (record: IntentRecord) => TargetFacts;
  /** createdAt of every content entry without a final answer (O4). */
  contentPending: () => readonly number[];
  now?: () => number;
  rand?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  log?: Pick<Console, 'warn'>;
}

export interface PassReport {
  sent: string[];
  settled: string[];
  waiting: string[];
}

const PAUSES = new Set(['format', 'plan']);

export function createOutboxDrain(opts: DrainOptions) {
  const { store } = opts;
  const now = opts.now ?? Date.now;
  const rand = opts.rand ?? Math.random;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const log = opts.log ?? console;
  const inFlight = new Set<string>();
  let timer: unknown = null;
  let running: Promise<PassReport> | null = null;
  let again = false;
  let stopped = false;

  const isFinal = (r: IntentRecord) => FINAL_STATES.includes(r.state);

  async function send(r: IntentRecord, sender: Sender, report: PassReport): Promise<void> {
    inFlight.add(r.id);
    const sending = store.update(r.id, {
      state: 'sending',
      attempts: r.attempts + 1,
      gates: [],
      nextAttemptAt: null,
    }) as IntentRecord;
    report.sent.push(r.id);
    let answer: TargetAnswer;
    try {
      answer = await sender(sending);
    } catch {
      answer = { ok: false, network: true };
    } finally {
      inFlight.delete(r.id);
    }
    const cur = store.get(r.id);
    if (!cur || isFinal(cur)) return;
    const verdict = judgeAnswer(cur, answer);
    if (verdict.kind === 'decision') {
      const d = verdict.decision;
      store.settle(cur.id, d.state, {
        code: d.outcome,
        ...(d.ref ? { ref: d.ref } : {}),
        ...(d.row ? { row: d.row } : {}),
      });
      report.settled.push(cur.id);
      return;
    }
    if (verdict.kind === 'transient') {
      store.update(cur.id, {
        state: 'queued',
        nextAttemptAt: now() + (verdict.retryAfterMs ?? backoffMs(cur.attempts, rand)),
      });
      return;
    }
    // A 401: the `signed-in` gate closes. Backoff too, so a stale "signed in"
    // fact can never turn into a hot loop of refused sends.
    store.update(cur.id, {
      state: 'queued',
      gates: [verdict.gate],
      nextAttemptAt: now() + backoffMs(cur.attempts, rand),
    });
  }

  async function pass(): Promise<PassReport> {
    const report: PassReport = { sent: [], settled: [], waiting: [] };
    const t = now();
    const facts = opts.gates();
    const pending = opts.contentPending();

    for (const r0 of store.list()) {
      let r = r0;
      if (isFinal(r) || inFlight.has(r.id)) continue;

      // 1. expiry — an expired intent is not sent (§5.7).
      if (r.kind === 'ai.prompt' && typeof facts.allowanceResetsAt === 'number') {
        const ext = expiresAtFor(r.kind, r.createdAt, facts.allowanceResetsAt);
        if (ext > r.expiresAt) r = store.update(r.id, { expiresAt: ext }) as IntentRecord;
      }
      if (t >= r.expiresAt && r.state !== 'sending') {
        store.settle(r.id, 'dropped', { code: 'expired' });
        report.settled.push(r.id);
        continue;
      }

      // 2. a pause resumes by itself once its cause is gone.
      if (r.state === 'needs-you') {
        if (!r.outcome || !PAUSES.has(r.outcome.code)) {
          report.waiting.push(r.id); // waits for the person (G6)
          continue;
        }
        const d = judgeTarget(r, opts.target(r));
        if (d && d.outcome === r.outcome.code) {
          report.waiting.push(r.id);
          continue;
        }
        r = store.update(r.id, { state: 'queued', outcome: undefined }) as IntentRecord;
      }
    }

    // 3–7 in creation order, after expiry settled.
    const all = store.list();
    for (const r of all) {
      if (stopped) break;
      if (isFinal(r) || inFlight.has(r.id) || r.state === 'needs-you') continue;
      if (isFifoLane(r.lane)) {
        const earlier = all.find(
          (x) => x.lane === r.lane && x.createdAt < r.createdAt && !isFinal(store.get(x.id) ?? x)
        );
        if (earlier) {
          report.waiting.push(r.id);
          continue;
        }
      }
      if (r.nextAttemptAt !== null && t < r.nextAttemptAt) {
        report.waiting.push(r.id);
        continue;
      }
      const d = judgeTarget(r, opts.target(r));
      if (d) {
        store.settle(r.id, d.state, { code: d.outcome, ...(d.row ? { row: d.row } : {}) });
        report.settled.push(r.id);
        continue;
      }
      const closed = closedGates(r, facts, pending, t);
      if (closed.length) {
        if (closed.join() !== r.gates.join())
          store.update(r.id, { gates: closed, state: 'queued' });
        report.waiting.push(r.id);
        continue;
      }
      const sender = opts.senders[r.kind];
      if (!sender) {
        report.waiting.push(r.id);
        continue;
      }
      // Sequential: exports START in creation order (O3), and one pass never
      // floods a door that just reopened.
      await send(r, sender, report);
    }
    schedule();
    return report;
  }

  /** The one timer: the earliest backoff, expiry or allowance reset ahead. */
  function schedule(): void {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (stopped) return;
    const t = now();
    let at = Number.POSITIVE_INFINITY;
    for (const r of store.list()) {
      if (isFinal(r)) continue;
      if (r.nextAttemptAt !== null && r.nextAttemptAt > t) at = Math.min(at, r.nextAttemptAt);
      if (r.expiresAt > t) at = Math.min(at, r.expiresAt);
    }
    const reset = opts.gates().allowanceResetsAt;
    if (typeof reset === 'number' && reset > t) at = Math.min(at, reset);
    if (!Number.isFinite(at)) return;
    timer = setTimer(
      () => {
        timer = null;
        void wake();
      },
      Math.max(0, at - t)
    );
  }

  /** Run a pass now; a wake during a pass runs one more right after it. */
  async function wake(): Promise<PassReport> {
    if (stopped) return { sent: [], settled: [], waiting: [] };
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      let report: PassReport;
      do {
        again = false;
        try {
          report = await pass();
        } catch (err) {
          log.warn(`[outbox] drain pass failed: ${(err as Error).message}`);
          report = { sent: [], settled: [], waiting: [] };
        }
      } while (again && !stopped);
      return report;
    })();
    try {
      return await running;
    } finally {
      running = null;
    }
  }

  return {
    wake,
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    /** ids being sent right now (tests, Diagnostics). */
    inFlight: () => [...inFlight],
  };
}

export type OutboxDrain = ReturnType<typeof createOutboxDrain>;
