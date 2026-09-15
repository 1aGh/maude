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
  /** Written before the project id was known; bound (once) before sending. */
  unbound?: boolean;
}

export interface TransactionClientOptions {
  hubUrl: string;
  token: () => string | null;
  designRoot: string;
  fetchImpl?: typeof fetch;
  log?: Pick<Console, 'log' | 'warn' | 'error'>;
  deviceId?: string;
  /** Status hook — how many actions are waiting for acceptance. */
  onPending?: (count: number) => void;
  /** Every final result (accepted or rejected), in order. */
  onResult?: (result: ProposalResult, action: { label: string; operations: Operation[] }) => void;
  now?: () => number;
  /** Backoff between retries of an unacknowledged proposal. */
  retryMs?: number;
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

  let projectId: string | null = null;
  let epoch = 0;
  let stopped = false;
  let chain: Promise<unknown> = Promise.resolve();
  let pending = 0;

  const setPending = (delta: number) => {
    pending = Math.max(0, pending + delta);
    opts.onPending?.(pending);
  };

  function headers(): Record<string, string> {
    const token = opts.token();
    return {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  }

  async function request(method: string, route: string, body?: string) {
    const res = await fetchImpl(`${base}/api/projects/${projectId ?? 'current'}/v1/${route}`, {
      method,
      headers: headers(),
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
   * Deliver one outbox entry to a FINAL result. Never gives up on an unknown
   * outcome: a transport failure is resolved by asking for the transaction's
   * result before the same bytes are sent again.
   */
  async function deliver(file: string, entry: OutboxEntry): Promise<ProposalResult> {
    let attempt = 0;
    for (;;) {
      if (stopped) throw new TransactionError('client stopped', 'stopped');
      try {
        if (attempt > 0) {
          const known = await request('GET', `transactions/${entry.transactionId}`);
          if (known.status === 200 && known.json) {
            rmSync(file, { force: true });
            return known.json as ProposalResult;
          }
        }
        const { status, json } = await request('POST', 'proposals', entry.bytes);
        const result = json as ProposalResult | null;
        if (result && (result.status === 'accepted' || result.status === 'rejected')) {
          if (result.status === 'rejected' && (result.code === 'retryable' || status >= 500)) {
            throw new TransactionError('hub asked to retry', 'retryable');
          }
          rmSync(file, { force: true });
          return result;
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
      ...(projectId === null ? { unbound: true } : {}),
    };
  }

  /**
   * Take one outbox entry to its FINAL result. An entry written before this
   * process knew the project is bound first — it was never sent, so its bytes
   * may still change; once sent, they never do.
   */
  async function settle(file: string, entry: OutboxEntry): Promise<ProposalResult> {
    if (entry.unbound || projectId === null) {
      if (projectId === null) await bootstrap();
      if (entry.unbound && entry.action) {
        entry = { ...entry, bytes: envelope(entry.action, entry.transactionId) };
        delete entry.unbound;
        writeFileSync(`${file}.tmp`, JSON.stringify(entry));
        renameSync(`${file}.tmp`, file);
      }
    }
    let result = await deliver(file, entry);
    if (result.status === 'rejected' && result.code === 'epoch-stale' && entry.action) {
      // A rebase is a NEW transaction under the current epoch, never a mutated
      // retry — and anything that depended on the old id now depends on this.
      await bootstrap();
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
    setPending(1);
    return enqueue(() =>
      settle(file, entry).finally(() => {
        owned.delete(file);
        setPending(-1);
      })
    );
  }

  /**
   * Resend what a previous process left in the outbox — in creation order, the
   * same bytes, each resolved first in case its answer was simply lost.
   */
  function drainOutbox(): Promise<ProposalResult[]> {
    return enqueue(async () => {
      const entries = readOutbox().filter(({ file }) => !owned.has(file));
      const results: ProposalResult[] = [];
      for (const { file, entry } of entries) {
        setPending(1);
        try {
          results.push(await settle(file, entry));
        } finally {
          setPending(-1);
        }
      }
      return results;
    });
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
    stop() {
      stopped = true;
    },
  };
}

export type TransactionClient = ReturnType<typeof createTransactionClient>;
