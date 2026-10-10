// The studio's transaction client — DDR-241 §3, plan T13.
//
// In accepted-revisions mode the studio never writes the shared document. A
// persistent change becomes a PROPOSAL: exact request bytes are written to the
// durable outbox (`<designRoot>/_state/outbox/`, runtime state) BEFORE they are
// sent, so a crash, a dropped ACK or a restart can never turn one action into
// two or lose it. A retry sends the same bytes; an unknown outcome is resolved
// with `GET /transactions/:id` before anything is resent.
//
// Proposals are sent one at a time in creation order — a later edit to the
// same canvas can never overtake an earlier one.

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const PROTOCOL = 1;

export type LaneName = 'html' | 'css' | 'meta' | 'annotations' | 'comments';

export interface Operation {
  op: string;
  [k: string]: unknown;
}

export interface ProposalResult {
  protocol: number;
  status: 'accepted' | 'rejected';
  code?: string;
  transactionId: string | null;
  revision?: number;
  actionId?: string;
  merged?: { doc: string; lane: string; merged: boolean }[];
  skipped?: { doc?: string; lane?: string; reason: string }[];
  head?: string;
  [k: string]: unknown;
}

export interface Bootstrap {
  projectId: string;
  mode: string;
  epoch: number;
  revision: number;
  docs: {
    doc: string;
    entry: string;
    generation: number;
    path: string | null;
    retired: boolean;
    lanes: Record<string, { hash: string; effect: string }>;
  }[];
  dirs: string[];
  you?: { actor: string; readOnly: boolean };
  /** What the project's own config says about itself (UNTRUSTED — a copy
   *  re-validates it; see context.ts `withProjectConfig`). */
  projectConfig?: unknown;
}

interface OutboxAction {
  kind?: string;
  label: string;
  operations: Operation[];
  dependsOn?: string[];
}

interface OutboxEntry {
  transactionId: string;
  createdAt: number;
  /** The exact request body — resent byte-for-byte once it has been sent. */
  bytes: string;
  label: string;
  /** The action, so an epoch-stale entry can be rebased as a new transaction. */
  action?: OutboxAction;
  /** V2-1.12 §5.4 — the file format the entry was written in (absent = undeclared). */
  format?: number;
  /** Written before the project id was known; bound (once) before sending. */
  unbound?: boolean;
  /**
   * B2 (V2-1.14 §5.12b) — the project this entry was made for, recorded as
   * soon as it is known. An entry for another project is never sent (a relink
   * must not deliver a `doc.delete` to whatever project is linked now).
   */
  projectId?: string;
  /** B2 — the link (hub) this entry was written under. An `unbound` entry
   *  binds ONLY to that link's project. Absent on entries from older builds. */
  link?: string;
}

/**
 * 4xx answers that mean "not now" rather than "no". Every OTHER 4xx without a
 * protocol `status` is final (B1): retrying a 413 resends the same bytes to
 * the same refusal forever, and the chain behind it waits forever with it.
 * (401 has its own rule above them: the change is kept, the sign-in is not.)
 */
const TRANSIENT_4XX = new Set([408, 425, 429]);

/** Where a final, non-protocol refusal keeps the exact bytes (design-root
 *  relative; runtime state under `_history/`, DDR-115). */
export const OUTBOX_RECOVERY_REL = path.join('_history', '_outbox-recovery');

export interface TransactionClientOptions {
  hubUrl: string;
  token: () => string | null;
  designRoot: string;
  fetchImpl?: typeof fetch;
  /**
   * V2-1.12 §5.6 — while true no proposal is SENT: each stays in the durable
   * outbox, unchanged, and goes when the gate lifts (after an update). The
   * project now uses a format this build does not write.
   */
  paused?: () => boolean;
  /**
   * V2-1.12 §5.4 — the format a proposal is written in, RECORDED on the entry
   * when it is made and declared when it is sent: an edit made under one build
   * is never relabelled by the next one.
   */
  declaredFormat?: () => number;
  log?: Pick<Console, 'log' | 'warn' | 'error'>;
  deviceId?: string;
  /** Status hook — how many actions are waiting for acceptance. */
  onPending?: (count: number) => void;
  /** Every final result (accepted or rejected), in order. */
  onResult?: (result: ProposalResult, action: { label: string; operations: Operation[] }) => void;
  /** T29 — what a person waits on: pending count, oldest age, ack latency. */
  onStats?: (stats: TransactionStats) => void;
  now?: () => number;
  /** Backoff between retries of an unacknowledged proposal. */
  retryMs?: number;
  /**
   * B2 — the identity of the link this client runs under. Entries record it,
   * and an unbound entry binds only under the same link. Default: the hub URL
   * (one hub serves one project — `hub-integration.mjs` `projectId`), so a
   * relink to another hub never adopts the old link's unsent work.
   */
  linkId?: string;
}

export interface TransactionStats {
  pending: number;
  /** When the oldest unanswered change was made (ms epoch), or null. */
  oldestPendingAt: number | null;
  /** Durable acknowledgment latency — change made → accepted answer. */
  ackMs: { last: number | null; p95: number | null; n: number };
  /** Final rejections this session (conflicts, invalid source, rights…). */
  rejected: number;
  /**
   * The project answered the last attempt "sign in first": this sign-in was
   * revoked or its person disabled. The change stays in the outbox and is
   * retried with whatever credential `token()` returns next — it is not lost,
   * but it cannot be shared until someone signs in again, which is what a
   * person must be told instead of "check your connection".
   */
  credentialRefused: boolean;
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** The hub's lane hash: sha256 of the canonical UTF-8 lane text. */
export function laneHash(content: string): string {
  return sha256(content);
}

export const EMPTY_LANE_HASH = laneHash('');

export class TransactionError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = 'TransactionError';
  }
}

export function createTransactionClient(opts: TransactionClientOptions) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const log = opts.log ?? console;
  const now = opts.now ?? Date.now;
  const retryMs = opts.retryMs ?? 1500;
  const outboxDir = path.join(opts.designRoot, '_state', 'outbox');
  const deviceId = opts.deviceId ?? 'studio';
  const sessionId = randomUUID();
  const base = opts.hubUrl.replace(/\/+$/, '');
  const linkId = opts.linkId ?? base;
  const recoveryDir = path.join(opts.designRoot, OUTBOX_RECOVERY_REL);

  let projectId: string | null = null;
  let epoch = 0;
  let stopped = false;
  let chain: Promise<unknown> = Promise.resolve();
  let pending = 0;

  /** transactionId → when the change was made; the unanswered ones. */
  const waiting = new Map<string, number>();
  const acks: number[] = [];
  let rejectedCount = 0;
  let credentialRefused = false;
  const setCredentialRefused = (next: boolean) => {
    if (credentialRefused === next) return;
    credentialRefused = next;
    opts.onStats?.(stats());
  };
  function stats(): TransactionStats {
    const sorted = [...acks].sort((a, b) => a - b);
    return {
      pending,
      oldestPendingAt: waiting.size ? Math.min(...waiting.values()) : null,
      ackMs: {
        last: acks.length ? (acks[acks.length - 1] as number) : null,
        p95: sorted.length
          ? (sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] as number)
          : null,
        n: acks.length,
      },
      rejected: rejectedCount,
      credentialRefused,
    };
  }
  const setPending = (delta: number) => {
    pending = Math.max(0, pending + delta);
    opts.onPending?.(pending);
    opts.onStats?.(stats());
  };

  function headers(format?: number): Record<string, string> {
    const token = opts.token();
    return {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(typeof format === 'number' ? { 'x-maude-format': String(format) } : {}),
    };
  }

  async function request(method: string, route: string, body?: string, format?: number) {
    const res = await fetchImpl(`${base}/api/projects/${projectId ?? 'current'}/v1/${route}`, {
      method,
      headers: headers(format),
      ...(body !== undefined ? { body } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => null)) as unknown;
    return { status: res.status, json };
  }

  async function bootstrap(): Promise<Bootstrap> {
    const { status, json } = await request('GET', 'bootstrap');
    if (status === 404 || status === 405) {
      // A hub without the route (or with the project unknown to it) speaks
      // only the legacy protocol — an answer, not a failure.
      throw new TransactionError(`bootstrap absent (${status})`, 'absent');
    }
    if (status !== 200 || !json || typeof json !== 'object') {
      throw new TransactionError(`bootstrap failed (${status})`, 'bootstrap');
    }
    const b = json as Bootstrap;
    projectId = b.projectId;
    epoch = b.epoch;
    return b;
  }

  function writeOutbox(entry: OutboxEntry): string {
    mkdirSync(outboxDir, { recursive: true });
    const file = path.join(outboxDir, `${entry.createdAt}-${entry.transactionId}.json`);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(entry));
    renameSync(tmp, file);
    return file;
  }

  function readOutbox(): { file: string; entry: OutboxEntry }[] {
    let names: string[] = [];
    try {
      names = readdirSync(outboxDir).filter((n) => n.endsWith('.json'));
    } catch {
      return [];
    }
    return names
      .sort()
      .map((n) => {
        const file = path.join(outboxDir, n);
        try {
          return { file, entry: JSON.parse(readFileSync(file, 'utf8')) as OutboxEntry };
        } catch {
          return null;
        }
      })
      .filter((x): x is { file: string; entry: OutboxEntry } => x !== null);
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /**
   * End an entry WITHOUT an answer from the kernel — a final refusal that is
   * not a protocol result (B1), or an entry that belongs to another project
   * (B2). The exact bytes move to `_history/_outbox-recovery/<name>.<code>.json`
   * ("kept on this Mac", V2-1.14 G8/G18) so nothing made here is lost and the
   * chain behind it moves on. If even the move fails, the entry stays where it
   * is — unsent, re-judged next drain — rather than being deleted.
   */
  function park(file: string, entry: OutboxEntry, code: string): ProposalResult {
    try {
      mkdirSync(recoveryDir, { recursive: true });
      const name = path.basename(file).replace(/\.json$/, `.${code}.json`);
      renameSync(file, path.join(recoveryDir, name));
    } catch (err) {
      log.warn(`[sync/tx] ${entry.label}: could not keep it aside (${(err as Error).message})`);
    }
    return { protocol: PROTOCOL, status: 'rejected', code, transactionId: entry.transactionId };
  }

  /** B2 — the project an entry was made for: recorded, or (entries from older
   *  builds) the id inside its own bytes. `null` = never bound. */
  function madeFor(entry: OutboxEntry): string | null {
    if (typeof entry.projectId === 'string') return entry.projectId;
    try {
      const id = (JSON.parse(entry.bytes) as { projectId?: unknown }).projectId;
      return typeof id === 'string' ? id : null;
    } catch {
      return null;
    }
  }

  /** B2 — true when this entry may go to the project this client talks to. */
  function belongsHere(entry: OutboxEntry): boolean {
    // Unbound: it binds only under the link it was written under. An entry
    // from a build that did not record its link cannot be proven to belong
    // here, so it is kept, not sent (the disk still holds the change).
    if (entry.unbound) return entry.link === linkId;
    const id = madeFor(entry);
    return id === null || id === projectId;
  }

  /**
   * Deliver one outbox entry to a FINAL result. Never gives up on an unknown
   * outcome: a transport failure is resolved by asking for the transaction's
   * result before the same bytes are sent again.
   */
  async function deliver(file: string, entry: OutboxEntry): Promise<ProposalResult> {
    let attempt = 0;
    for (;;) {
      if (stopped) throw new TransactionError('client stopped', 'stopped');
      if (opts.paused?.()) {
        // Held, not failed: nothing is sent, no attempt is counted.
        await sleep(Math.max(retryMs, 1000));
        continue;
      }
      try {
        if (attempt > 0) {
          const known = await request('GET', `transactions/${entry.transactionId}`);
          if (known.status === 200 && known.json) {
            setCredentialRefused(false);
            rmSync(file, { force: true });
            return known.json as ProposalResult;
          }
        }
        const { status, json } = await request('POST', 'proposals', entry.bytes, entry.format);
        // Not an answer about the change — about who is asking. Kept and
        // retried (a new sign-in supplies a new token), and said out loud.
        if (status === 401) {
          setCredentialRefused(true);
          throw new TransactionError(
            'the project no longer accepts this sign-in',
            'unauthenticated'
          );
        }
        const result = json as ProposalResult | null;
        if (result && (result.status === 'accepted' || result.status === 'rejected')) {
          setCredentialRefused(false);
          if (result.status === 'rejected' && (result.code === 'retryable' || status >= 500)) {
            throw new TransactionError('hub asked to retry', 'retryable');
          }
          // V2-1.12 §5.4 — refused for its FORMAT: final, but the bytes are a
          // person's edit, so they are kept aside (recovery), never deleted.
          if (result.status === 'rejected' && result.code === 'format') {
            log.warn(
              `[sync/tx] ${entry.label}: the project now uses another file format; kept aside, not sent`
            );
            return park(file, entry, 'format');
          }
          rmSync(file, { force: true });
          return result;
        }
        // B1 — no protocol answer, but a 4xx is still an answer: final.
        if (status >= 400 && status < 500 && !TRANSIENT_4XX.has(status)) {
          setCredentialRefused(false);
          log.warn(`[sync/tx] ${entry.label}: refused (${status}); kept aside, not retried`);
          return park(file, entry, `http-${status}`);
        }
        throw new TransactionError(`unexpected response ${status}`, 'retryable');
      } catch (err) {
        attempt++;
        if (attempt === 1 || attempt % 10 === 0) {
          log.warn(
            `[sync/tx] ${entry.label}: not acknowledged yet (${(err as Error).message}); retrying`
          );
        }
        await sleep(Math.min(retryMs * 2 ** Math.min(attempt - 1, 4), 30_000));
      }
    }
  }

  // Outbox files sort by this stamp, so it must be strictly increasing — two
  // proposals in one millisecond must not replay in random-id order.
  let lastStamp = 0;
  const stamp = (): number => {
    lastStamp = Math.max(now(), lastStamp + 1);
    return lastStamp;
  };

  const newTransactionId = (): string => `tx_${randomUUID().replace(/-/g, '')}`;

  /** Entries this process created — delivered by their own `propose`, never by a drain. */
  const owned = new Set<string>();
  /** epoch-stale rebases: old transaction id → the id it was re-proposed under. */
  const aliases = new Map<string, string>();

  function envelope(action: OutboxAction, transactionId: string): string {
    return JSON.stringify({
      protocol: PROTOCOL,
      projectId,
      epoch,
      transactionId,
      ...(action.dependsOn?.length ? { dependsOn: action.dependsOn } : {}),
      origin: { deviceId, sessionId, client: 'studio' },
      action: { kind: action.kind ?? 'edit', label: action.label, operations: action.operations },
    });
  }

  function makeEntry(action: OutboxAction, transactionId: string): OutboxEntry {
    return {
      transactionId,
      createdAt: stamp(),
      bytes: envelope(action, transactionId),
      label: action.label,
      action,
      link: linkId,
      ...(opts.declaredFormat ? { format: opts.declaredFormat() } : {}),
      ...(projectId === null ? { unbound: true } : { projectId }),
    };
  }

  /**
   * Take one outbox entry to its FINAL result. An entry written before this
   * process knew the project is bound first — it was never sent, so its bytes
   * may still change; once sent, they never do.
   */
  /**
   * Learn the project (id + epoch) before binding or rebasing an entry. A
   * transport failure is WAITED OUT like an unknown delivery — a desktop that
   * restarts offline drains its outbox before the hub is reachable, and a
   * throw here was an unhandled rejection that ended the process (F3/S06).
   * An answer — a legacy hub (`absent`), a refused sign-in — is still thrown.
   */
  async function bootstrapWhenReachable(): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      if (stopped) throw new TransactionError('client stopped', 'stopped');
      try {
        await bootstrap();
        return;
      } catch (err) {
        if (err instanceof TransactionError) throw err;
        if (attempt === 1 || attempt % 10 === 0)
          log.warn(
            `[sync/tx] the project is not reachable yet (${(err as Error).message}); waiting`
          );
        await sleep(Math.min(retryMs * 2 ** Math.min(attempt - 1, 4), 30_000));
      }
    }
  }

  async function settle(file: string, entry: OutboxEntry): Promise<ProposalResult> {
    if (projectId === null) await bootstrapWhenReachable();
    if (!belongsHere(entry)) {
      // B2 — never sent to a project it was not made for (G18).
      log.warn(`[sync/tx] ${entry.label}: made for another project; kept aside, not sent`);
      const parked = park(file, entry, 'project-changed');
      rejectedCount++;
      opts.onResult?.(parked, { label: entry.label, operations: entry.action?.operations ?? [] });
      return parked;
    }
    if (entry.unbound && entry.action) {
      entry = {
        ...entry,
        bytes: envelope(entry.action, entry.transactionId),
        ...(projectId !== null ? { projectId } : {}),
      };
      delete entry.unbound;
      writeFileSync(`${file}.tmp`, JSON.stringify(entry));
      renameSync(`${file}.tmp`, file);
    }
    let result = await deliver(file, entry);
    if (result.status === 'rejected' && result.code === 'epoch-stale' && entry.action) {
      // A rebase is a NEW transaction under the current epoch, never a mutated
      // retry — and anything that depended on the old id now depends on this.
      await bootstrapWhenReachable();
      const action = {
        ...entry.action,
        ...(entry.action.dependsOn
          ? { dependsOn: entry.action.dependsOn.map((id) => aliases.get(id) ?? id) }
          : {}),
      };
      const next = makeEntry(action, newTransactionId());
      aliases.set(entry.transactionId, next.transactionId);
      const nextFile = writeOutbox(next);
      owned.add(nextFile);
      try {
        result = await deliver(nextFile, next);
      } finally {
        owned.delete(nextFile);
      }
    }
    if (result.status === 'accepted') {
      acks.push(Math.max(0, now() - entry.createdAt));
      if (acks.length > 200) acks.shift();
    } else rejectedCount++;
    opts.onResult?.(result, {
      label: entry.label,
      operations: entry.action?.operations ?? [],
    });
    return result;
  }

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = chain.then(work, work);
    chain = next.catch(() => {});
    return next;
  }

  /**
   * Propose one action. Resolves with the FINAL result.
   *
   * The proposal is written to the durable outbox SYNCHRONOUSLY, before this
   * returns — not when its turn to be sent comes. A proposal waiting behind an
   * unanswered one is exactly the one a crash would otherwise lose.
   *
   * `transactionId` may be chosen by the caller (`newTransactionId()`) so a
   * later proposal can name this one in `dependsOn` before it is answered.
   */
  function propose(action: {
    kind?: string;
    label: string;
    operations: Operation[];
    transactionId?: string;
    dependsOn?: string[];
  }): Promise<ProposalResult> {
    const { transactionId, ...rest } = action;
    let entry: OutboxEntry;
    let file: string;
    try {
      entry = makeEntry(rest, transactionId ?? newTransactionId());
      file = writeOutbox(entry);
    } catch (err) {
      // Local persistence failed — say so; never pretend the edit is safe.
      return Promise.reject(
        new TransactionError(
          `could not save the change locally: ${(err as Error).message}`,
          'local-persistence'
        )
      );
    }
    owned.add(file);
    waiting.set(entry.transactionId, entry.createdAt);
    setPending(1);
    return enqueue(() =>
      settle(file, entry).finally(() => {
        owned.delete(file);
        waiting.delete(entry.transactionId);
        setPending(-1);
      })
    );
  }

  /**
   * Resend what a previous process left in the outbox — in creation order, the
   * same bytes, each resolved first in case its answer was simply lost.
   */
  function drainOutbox(
    onEach?: (result: ProposalResult, operations: Operation[]) => void
  ): Promise<ProposalResult[]> {
    return enqueue(async () => {
      const entries = readOutbox().filter(({ file }) => !owned.has(file));
      const results: ProposalResult[] = [];
      for (const { file, entry } of entries) {
        waiting.set(entry.transactionId, entry.createdAt);
        setPending(1);
        try {
          const result = await settle(file, entry);
          results.push(result);
          onEach?.(result, entry.action?.operations ?? []);
        } finally {
          waiting.delete(entry.transactionId);
          setPending(-1);
        }
      }
      return results;
    });
  }

  /**
   * Is `content` a value the project store holds — i.e. one it accepted at
   * some revision? `null` when it cannot tell (unreachable, older hub).
   */
  async function holdsValue(content: string): Promise<boolean | null> {
    try {
      if (projectId === null) await bootstrap();
      const hash = createHash('sha256').update(content, 'utf8').digest('hex');
      const { status, json } = await request('GET', `blobs/${hash}`);
      if (status === 200) return (json as { body?: unknown } | null)?.body === content;
      return status === 404 ? false : null;
    } catch {
      return null;
    }
  }

  /** A read route (`history`, `lane`, `revisions`) — no retry, bounded. */
  async function read(route: string, params: Record<string, string | number>): Promise<unknown> {
    if (projectId === null) await bootstrap();
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
    );
    const { status, json } = await request('GET', `${route}?${qs.toString()}`);
    if (status !== 200) throw new TransactionError(`${route} failed (${status})`, 'read');
    return json;
  }

  return {
    bootstrap,
    propose,
    read,
    newTransactionId,
    drainOutbox,
    holdsValue,
    /** The epoch proposals are currently made under. */
    get epoch() {
      return epoch;
    },
    get projectId() {
      return projectId;
    },
    get pending() {
      return pending;
    },
    outboxSize: () => readOutbox().length,
    stats,
    stop() {
      stopped = true;
    },
  };
}

export type TransactionClient = ReturnType<typeof createTransactionClient>;
