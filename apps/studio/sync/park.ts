// The desktop park — an idle desktop lets its cloud cell sleep.
//
// WHY THE CLIENT PARKS, NOT THE CELL. `@cloudflare/containers` renews a cell's
// activity timer on every proxied request and socket message, and an open
// proxied socket blocks expiry outright. So a desktop left open holds its cell
// awake forever: 10.55 instance-hours on the first night after v1.6.12, with
// nobody working. Forcing the cell to stop under an open socket was rejected
// (the hub flushes before it closes sockets — sleep is lossless today only
// because it has always happened with none attached). So the desktop goes
// quiet on its own: it closes its sockets and its poll, and the cell sleeps
// through its ordinary `sleepAfter`.
//
// This file is the POLICY only — a pure reducer with no timers, no I/O and no
// clock of its own, in the shape of `apps/render/idle-policy.mjs`. The runtime
// (`sync/index.ts`) feeds it events and carries out the effects it returns.
//
// NEVER PARK BLIND. The decision to park needs a positive answer from the
// cell's own `/_cell/state` probe first: an old cell (404, or a proxied page)
// makes the phase `unsupported` for the rest of the session, which is today's
// behaviour exactly.

import { isRuntimeStateRel } from './file-membership.ts';

/** Idle this long — no local edit, no studio UI activity — before parking. */
export const PARK_AFTER_MS = 20 * 60_000;
/** How often a parked desktop asks the cell whether anything changed. */
export const PARK_PROBE_MS = 60_000;
/** The ceiling the probe backs off to while the probe itself keeps failing. */
export const PARK_PROBE_MAX_MS = 10 * 60_000;
/**
 * The backstop for a missed change signal: a parked desktop resyncs at least
 * this often even when every probe says nothing changed. A miss costs latency,
 * never data, and this bounds the latency.
 */
export const PARK_MAX_MS = 6 * 60 * 60_000;

/**
 * - `off`         — this runtime never parks (a self-hosted hub, a cell's own
 *                   studio, a hub with no file plane).
 * - `active`      — connected as today.
 * - `parked`      — sockets and polls closed; probing the cell.
 * - `unsupported` — the cell could not answer the probe contract; never park
 *                   again this session.
 */
export type ParkPhase = 'off' | 'active' | 'parked' | 'unsupported';

export interface ParkState {
  phase: ParkPhase;
  /** The later of the last local edit, the last UI activity and the last unpark. */
  lastActivityAt: number;
  /** Outbound work in flight — a park is never allowed over it. */
  pending: boolean;
  /** Local clock, when the current park began. */
  parkedAt: number | null;
  /**
   * The cell's own clock (minute-floored) at the probe that allowed this park.
   * A `changedAt` at or after it means somebody else changed something.
   */
  parkMark: number | null;
  probeInFlight: boolean;
  /** When the next probe is due (local clock). */
  nextProbeAt: number | null;
  /** Consecutive failed probes, for the backoff. */
  probeFailures: number;
}

/** What `GET /_cell/state` said, already parsed by the caller. */
export type ProbeResult =
  | { kind: 'state'; state: 'asleep' | 'running'; changedAt: number | null; at: number | null }
  /** 404, a non-JSON body, a JSON body outside the contract: an old cell. */
  | { kind: 'unsupported' }
  /** No answer at all — offline, DNS, a 5xx. Says nothing about the contract. */
  | { kind: 'network-error' };

export type ParkEvent =
  | { type: 'tick'; now: number }
  | { type: 'localEdit'; now: number }
  | { type: 'uiActivity'; now: number }
  | { type: 'pendingChanged'; pending: boolean; now: number }
  | { type: 'probeResult'; result: ProbeResult; now: number };

export type ParkEffect = 'park' | 'unpark' | 'probe';

/** The thresholds, injectable so a runtime test does not wait 20 minutes. */
export interface ParkTimings {
  afterMs: number;
  probeMs: number;
  probeMaxMs: number;
  maxParkedMs: number;
}

export const PARK_TIMINGS: ParkTimings = {
  afterMs: PARK_AFTER_MS,
  probeMs: PARK_PROBE_MS,
  probeMaxMs: PARK_PROBE_MAX_MS,
  maxParkedMs: PARK_MAX_MS,
};

export interface ParkStep {
  state: ParkState;
  effects: ParkEffect[];
}

export function initialParkState(opts: { now: number; eligible: boolean }): ParkState {
  return {
    phase: opts.eligible ? 'active' : 'off',
    lastActivityAt: opts.now,
    pending: false,
    parkedAt: null,
    parkMark: null,
    probeInFlight: false,
    nextProbeAt: null,
    probeFailures: 0,
  };
}

/**
 * True when a watcher event on `rel` can be somebody's work: anything outside
 * the runtime-state taxonomy. The ledger's own file (`_state/file-ledger/`),
 * `_canvas-state/`, `_history/` and friends are the studio talking to itself,
 * and must neither trigger a plane pass nor count as presence.
 */
export function isLocalWorkRel(rel: string): boolean {
  const norm = rel.split('\\').join('/');
  return norm.length > 0 && !isRuntimeStateRel(norm);
}

function unpark(state: ParkState, now: number): ParkStep {
  return {
    state: {
      ...state,
      phase: 'active',
      lastActivityAt: now,
      // A probe still out when the person came back is abandoned by the
      // runtime and never reports; left set, it would block every later park
      // this session (attacker review F2).
      probeInFlight: false,
      parkedAt: null,
      parkMark: null,
      nextProbeAt: null,
      probeFailures: 0,
    },
    effects: ['unpark'],
  };
}

function backoff(failures: number, t: ParkTimings): number {
  return Math.min(t.probeMaxMs, t.probeMs * 2 ** Math.max(0, failures - 1));
}

export function parkReducer(
  state: ParkState,
  event: ParkEvent,
  t: ParkTimings = PARK_TIMINGS
): ParkStep {
  if (state.phase === 'off') return { state, effects: [] };
  const now = event.now;

  switch (event.type) {
    case 'localEdit':
    case 'uiActivity': {
      if (state.phase === 'parked') return unpark(state, now);
      return {
        state: { ...state, lastActivityAt: Math.max(state.lastActivityAt, now) },
        effects: [],
      };
    }

    case 'pendingChanged': {
      // Work that appears while parked is somebody's work — a doc update with
      // a local origin, a file the plane must push. It goes now.
      if (state.phase === 'parked' && event.pending) {
        return unpark({ ...state, pending: true }, now);
      }
      return { state: { ...state, pending: event.pending }, effects: [] };
    }

    case 'tick': {
      if (state.phase === 'unsupported') return { state, effects: [] };
      if (state.phase === 'parked') {
        if (state.parkedAt !== null && now - state.parkedAt >= t.maxParkedMs) {
          return unpark(state, now);
        }
        if (state.probeInFlight || (state.nextProbeAt !== null && now < state.nextProbeAt)) {
          return { state, effects: [] };
        }
        return { state: { ...state, probeInFlight: true }, effects: ['probe'] };
      }
      // active
      if (state.pending || state.probeInFlight) return { state, effects: [] };
      if (now - state.lastActivityAt < t.afterMs) return { state, effects: [] };
      if (state.nextProbeAt !== null && now < state.nextProbeAt) return { state, effects: [] };
      // Idle long enough. Ask the cell before parking — never park blind.
      return { state: { ...state, probeInFlight: true }, effects: ['probe'] };
    }

    case 'probeResult': {
      const result = event.result;
      const settled: ParkState = { ...state, probeInFlight: false };

      if (result.kind === 'unsupported') {
        const next: ParkState = { ...settled, phase: 'unsupported', nextProbeAt: null };
        // An old cell under a parked desktop: go back to today's behaviour.
        return state.phase === 'parked'
          ? { state: { ...next, parkedAt: null, parkMark: null }, effects: ['unpark'] }
          : { state: next, effects: [] };
      }

      if (result.kind === 'network-error') {
        const failures = settled.probeFailures + 1;
        // Parked: stay parked and ask again later. Active: do not park on a
        // probe that never answered — try again on the same cadence.
        return {
          state: { ...settled, probeFailures: failures, nextProbeAt: now + backoff(failures, t) },
          effects: [],
        };
      }

      const ok: ParkState = { ...settled, probeFailures: 0, nextProbeAt: now + t.probeMs };

      if (state.phase === 'parked') {
        // Somebody else changed something since this park began: the cell is
        // running by definition, and the change has to arrive.
        const mark = state.parkMark;
        if (result.changedAt !== null && mark !== null && result.changedAt >= mark) {
          return unpark(ok, now);
        }
        return { state: ok, effects: [] };
      }

      if (state.phase !== 'active') return { state: ok, effects: [] };
      // Re-check: an edit or new work may have landed while the probe was out.
      if (ok.pending || now - ok.lastActivityAt < t.afterMs) {
        return { state: { ...ok, nextProbeAt: null }, effects: [] };
      }
      return {
        state: {
          ...ok,
          phase: 'parked',
          parkedAt: now,
          // The cell's clock when possible; the local one floored the same way
          // when the cell did not say. Equal minutes unpark — a same-minute
          // change cannot be told apart, and unparking is the safe direction.
          // A mark from the future (a buggy or hostile hub) would hide every
          // later change; it is not believed beyond a day ahead (F6).
          parkMark:
            result.at !== null && result.at <= now + 86_400_000
              ? result.at
              : Math.floor(now / 60_000) * 60_000,
        },
        effects: ['park'],
      };
    }
  }
}

/**
 * Parse a `/_cell/state` answer. Anything outside the contract is
 * `unsupported` — an old cell proxies `/_cell/state` to its hub, which answers
 * a 404 or a page, and a desktop must read that as "this cell cannot tell me
 * it is asleep", never as "asleep".
 */
export function parseCellState(
  status: number,
  contentType: string | null,
  body: string
): ProbeResult {
  // A 5xx, a timeout, a rate limit or an edge challenge says nothing about the
  // contract — only that this probe did not get through. Reading one as
  // "unsupported" would switch parking off for the session (F6).
  if (status >= 500 || status === 408 || status === 429 || status === 403) {
    return { kind: 'network-error' };
  }
  if (status !== 200) return { kind: 'unsupported' };
  if (!contentType || !/^application\/json\b/i.test(contentType)) return { kind: 'unsupported' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { kind: 'unsupported' };
  }
  if (!parsed || typeof parsed !== 'object') return { kind: 'unsupported' };
  const p = parsed as { state?: unknown; changedAt?: unknown; at?: unknown };
  if (p.state !== 'asleep' && p.state !== 'running') return { kind: 'unsupported' };
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  return { kind: 'state', state: p.state, changedAt: num(p.changedAt), at: num(p.at) };
}

/** Rows already delivered, or parked on something only a person can change. */
const SETTLED_STATES = new Set([
  'on-hub',
  'durable',
  'at-peer',
  'ui-healed',
  'everywhere',
  'refused',
  'referenced-but-unoffered',
  'conflict',
  'stuck',
]);

/**
 * Is the file plane still delivering something a park would cut off?
 *
 * - A row being pushed right now always is.
 * - Other outstanding rows (not yet sent, not backed off) are only while the
 *   plane is actually making progress: something landed within `windowMs`. A
 *   lane that has delivered nothing for that long is stalled, not moving, and
 *   holding a cell awake for it buys nothing — it resumes on the next edit,
 *   click, change signal or the backstop. (The night after v1.6.13: five
 *   `stuck` rows kept Alligators "seeding", and awake, until morning.)
 */
export function fileLaneBusy(
  rows: Record<string, { state?: string; nextAttemptAt?: number }>,
  opts: { now: number; lastProgressAt: number; windowMs: number }
): boolean {
  let outstanding = false;
  for (const row of Object.values(rows)) {
    const state = row.state;
    if (state === 'pushing') return true;
    if (state && SETTLED_STATES.has(state)) continue;
    if (Number.isFinite(row.nextAttemptAt) && (row.nextAttemptAt as number) > opts.now) continue;
    outstanding = true;
  }
  return outstanding && opts.now - opts.lastProgressAt < opts.windowMs;
}
