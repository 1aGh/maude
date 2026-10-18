// lease-home.ts — where a project's AI leases live (V2-1.15 §5.4 "Lease home").
//
// ONE interface, two homes:
// - `local`: the in-process store. It is the hub's own runs half of store-core (`runs-core.mjs`)
//   over an in-memory bun:sqlite database, so a local project gets the same L1–L10 invariants
//   as a linked one — each operation one transaction (L10). In memory on purpose: leases are per
//   studio process for a local project (Q9), and a crash frees them the way the hub's TTL does.
// - `hub`: the linked hub's `/api/projects/:p/v1/runs*` (S5.2), bearer auth. A network error or a
//   blown budget answers `{refused: 'unreachable'}` — the registry turns a claim into a
//   provisional one (§5.6), never a hang.
//
// `selectLeaseHome` picks: linked + `runs-v1` → hub; linked without it → local + the
// Diagnostics line (Q2); not linked → local.

import { Database } from 'bun:sqlite';
// The hub's own runs half of store-core (plain JS, zero imports) — one implementation of L1–L10.
import { createRunsCore, RUNS_DDL } from '../../hub/src/project-transactions/runs-core.mjs';
import type { LeaseKey, RunOrigin, RunOutcome, RunPublic } from './run-lifecycle.ts';

export type Granted = LeaseKey & { token: number };
export type Busy = LeaseKey & { position: number | null; heldBy: RunPublic | null; fenced?: true };
export type Refused = {
  refused: 'forbidden' | 'capacity' | 'invalid' | 'ended' | 'unreachable';
  reason?: string;
  outcome?: string;
};
export type Answer<T> = (T & { seq?: number; refused?: undefined }) | Refused;

export interface LeaseHome {
  kind: 'local' | 'hub';
  begin(b: {
    runId: string;
    askId: string;
    chatId: string | null;
    origin: RunOrigin;
    label: string;
    device: string;
    wants: LeaseKey[];
    enqueue: boolean;
  }): Promise<Answer<{ run: RunPublic; granted: Granted[]; busy: Busy[] }>>;
  claim(
    runId: string,
    b: { keys: LeaseKey[]; enqueue?: boolean; expectFence?: Record<string, number> },
    budgetMs?: number
  ): Promise<Answer<{ granted: Granted[]; busy: Busy[] }>>;
  renew(b: {
    device: string;
    runs: Array<{ runId: string; state?: 'running' | 'needs-you'; objects?: unknown[] }>;
  }): Promise<Answer<{ runs: Array<{ run: RunPublic } | { runId: string; ended: string }> }>>;
  end(
    runId: string,
    outcome: RunOutcome
  ): Promise<Answer<{ ended: string; granted: Array<Granted & { runId: string }> }>>;
  list(after?: number): Promise<Answer<{ seq: number; runs?: RunPublic[]; unchanged?: true }>>;
  close?(): void;
}

/** `<canvas>|<artboard>` — the `expectFence` key (runs-core `leaseKeyId`). */
export const leaseKeyId = (k: LeaseKey) => `${k.canvas}|${k.artboard}`;

interface RunsCore {
  runsBegin(b: Record<string, unknown>): Record<string, unknown>;
  runsClaim(b: Record<string, unknown>): Record<string, unknown>;
  runsRenew(b: Record<string, unknown>): Record<string, unknown>;
  runsEnd(b: Record<string, unknown>): Record<string, unknown>;
  runsList(b: Record<string, unknown>): Record<string, unknown>;
}

/** The in-process home: runs-core over in-memory bun:sqlite. `actor` is this Mac's person. */
export function createLocalLeaseHome(opts: { actor: string; now?: () => number }): LeaseHome {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS store_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
  for (const ddl of RUNS_DDL as string[]) db.exec(ddl);
  const sql = {
    exec(query: string, ...params: unknown[]) {
      const s = db.query(query);
      // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite binds positional params
      const p = params as any[];
      return s.columnNames.length ? (s.all(...p) as Record<string, unknown>[]) : (s.run(...p), []);
    },
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },
  };
  const meta = (k: string, fallback: unknown = null) => {
    const row = db.query(`SELECT v FROM store_meta WHERE k = ?`).get(k) as { v: string } | null;
    return row ? row.v : fallback;
  };
  const setMeta = (k: string, v: unknown) =>
    db
      .query(
        `INSERT INTO store_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`
      )
      .run(k, String(v));
  const core = createRunsCore(sql, {
    now: opts.now ?? Date.now,
    meta,
    setMeta,
  }) as unknown as RunsCore;
  const actor = opts.actor;
  // biome-ignore lint/suspicious/noExplicitAny: the core answers plain objects of the declared shapes
  const as = <T>(r: unknown) => Promise.resolve(r as any as T);
  return {
    kind: 'local',
    begin: (b) => as(core.runsBegin({ ...b, actor })),
    claim: (runId, b) => as(core.runsClaim({ runId, actor, ...b })),
    renew: (b) => as(core.runsRenew({ actor, ...b })),
    end: (runId, outcome) => as(core.runsEnd({ runId, actor, outcome })),
    list: (after) => as(core.runsList(after === undefined ? {} : { after })),
    close: () => db.close(),
  };
}

const STATUS_REFUSAL: Record<number, Refused['refused']> = {
  400: 'invalid',
  403: 'forbidden',
  409: 'ended',
  429: 'capacity',
};

/** The linked hub's runs routes. `token()` is read per call (a re-pair swaps it). */
export function createHubLeaseHome(opts: {
  hubUrl: string;
  token: () => string | null;
  projectId?: () => string | null;
  fetchImpl?: typeof fetch;
  budgetMs?: number;
}): LeaseHome {
  const base = opts.hubUrl.replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;
  async function call<T>(
    method: 'GET' | 'POST',
    route: string,
    body?: unknown,
    budgetMs = opts.budgetMs ?? 5_000
  ): Promise<Answer<T>> {
    const token = opts.token();
    try {
      const res = await fetchImpl(
        `${base}/api/projects/${opts.projectId?.() ?? 'current'}/v1/${route}`,
        {
          method,
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(budgetMs),
        }
      );
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (res.ok && json && typeof json === 'object') return json as Answer<T>;
      const refused = STATUS_REFUSAL[res.status] ?? 'unreachable';
      return {
        refused,
        ...(typeof json?.error === 'string' ? { reason: json.error } : {}),
        ...(typeof json?.outcome === 'string' ? { outcome: json.outcome } : {}),
      };
    } catch {
      return { refused: 'unreachable' };
    }
  }
  const id = (runId: string) => encodeURIComponent(runId);
  return {
    kind: 'hub',
    begin: (b) => call('POST', 'runs', b),
    claim: (runId, b, budgetMs) => call('POST', `runs/${id(runId)}/claim`, b, budgetMs),
    renew: (b) => call('POST', 'runs/renew', b),
    end: (runId, outcome) => call('POST', `runs/${id(runId)}/end`, { outcome }),
    list: (after) => call('GET', after === undefined ? 'runs' : `runs?after=${after}`),
  };
}

export const OLD_HUB_LINE =
  'AI takes turns per artboard on this Mac only — the team server needs an update';

/** Q2: a linked hub without `runs-v1` keeps per-Mac leases, and Diagnostics says so. */
export function selectLeaseHome(opts: {
  actor: string;
  linked: { hubUrl: string; token: () => string | null; projectId?: () => string | null } | null;
  capabilities: string[] | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): { home: LeaseHome; diagnostics: string | null } {
  if (opts.linked && opts.capabilities?.includes('runs-v1'))
    return {
      home: createHubLeaseHome({ ...opts.linked, fetchImpl: opts.fetchImpl }),
      diagnostics: null,
    };
  return {
    home: createLocalLeaseHome({ actor: opts.actor, now: opts.now }),
    diagnostics: opts.linked ? OLD_HUB_LINE : null,
  };
}
