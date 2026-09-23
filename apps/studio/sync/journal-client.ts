// The journal read client — Sync v2 Increment 2 (DDR-226 §5).
//
// One place that knows how to ask a hub "what changed since <seq>", and one
// place that knows how to ask "do you even have a journal". Increment 2 uses
// both for the cell child's heal path; Increment 3's pull engine uses the same
// two functions rather than growing its own.
//
// EVERYTHING HERE IS UNTRUSTED INPUT. The hub is semi-trusted by design
// (DDR-054): it may read and write synced state, and everything it says about
// that state is a hint. So this module's job is not to fetch — it is to REFUSE.
// A row whose shape is wrong is dropped; a `reanchor` is honoured rather than
// argued with; a page that cannot be parsed is `null`, which every caller reads
// as "ask again later", never as "nothing changed".
//
// FAIL CLOSED ON THE CURSOR. `{ reanchor: true }` is not an error and not an
// empty page — it is the hub saying "your cursor is not in this log". Reading
// it as "no changes" is exactly the shape that lets a stale peer believe it is
// current, which is the failure DDR-214's ordering amendment exists to prevent.

import { isProjectFileShape } from './file-membership.ts';

/** How long to wait for a journal page. Same figure as the manifest fetch. */
const JOURNAL_TIMEOUT_MS = 6000;

/**
 * The hub's own published page ceiling, restated here.
 *
 * A receiver that trusts the sender to respect the sender's cap has no cap.
 */
const MAX_JOURNAL_PAGE = 2000;

/** An epoch is a UUID-ish token; anything longer is not one. */
const MAX_EPOCH_LEN = 128;

/** How long to wait for `/health`. A capability probe must never hang a boot. */
const HEALTH_TIMEOUT_MS = 4000;

/** The shape a peer may act on. Anything else is dropped at parse time. */
export interface JournalEntry {
  seq: number;
  path: string;
  sha256: string | null;
  size: number | null;
  /** DISPLAY ONLY. Never an overwrite authority anywhere (F4). */
  mtimeMs: number | null;
  /** The hub's claimed class — a reporting hint; receivers re-classify. */
  class: string;
  deleted: boolean;
}

export interface JournalPage {
  epoch: string | null;
  head: number;
  entries: JournalEntry[];
  truncated: boolean;
  /** The cursor is not in this log — re-anchor against a full compaction. */
  reanchor: boolean;
  reason?: string;
  /** The hub sent more than its own published ceiling; the rest was dropped. */
  overflowed?: true;
}

// A designRoot-relative path a peer will turn into a real file: the SAME shape
// rule the hub's file door admits (`isProjectFileShape`). A private, narrower
// regex here dropped every journalled path with a space in it — `ui/Studio
// Docs.registry.json` was accepted from its author, journalled, and then
// silently discarded by every other peer, with no ledger row and no refusal
// shown (F3 S14, 2026-09-23).

function parseEntry(raw: unknown): JournalEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const seq = e.seq;
  const p = e.path;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq <= 0) return null;
  if (typeof p !== 'string' || !isProjectFileShape(p)) return null;
  const sha = typeof e.sha256 === 'string' && /^[0-9a-f]{64}$/.test(e.sha256) ? e.sha256 : null;
  return {
    seq,
    path: p,
    sha256: sha,
    size: typeof e.size === 'number' && Number.isFinite(e.size) ? e.size : null,
    mtimeMs: typeof e.mtimeMs === 'number' && Number.isFinite(e.mtimeMs) ? e.mtimeMs : null,
    class: typeof e.class === 'string' ? e.class.slice(0, 32) : '',
    deleted: e.deleted === true,
  };
}

/**
 * Fetch one journal page.
 *
 * Returns null when the hub is unreachable, refuses, or does not have the
 * route — the `fetchRemoteListing` posture: sync continues either way and we
 * ask again later. A null is never "nothing changed".
 *
 * It is also never "and there is nothing to learn from it". The cursor read
 * shares the hub's per-label read bucket with the file pulls, so during a rate
 * limit THIS is the request that meets the wall first — and collapsing that to
 * a bare null is how issue #109 stayed invisible: a held plane and a
 * quiet, ordinary, do-nothing pass are indistinguishable to the caller.
 * `onRefused` hands the response to whoever can tell the difference.
 */
export async function fetchJournal(opts: {
  hubUrl: string;
  token: string;
  since?: number;
  /** Send the epoch a cursor belongs to so a mismatch fails closed hub-side. */
  epoch?: string | null;
  fetchImpl?: typeof fetch;
  /** Called with the response before a non-ok status becomes `null`. */
  onRefused?: (res: Response) => void | Promise<void>;
}): Promise<JournalPage | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.hubUrl.replace(/\/+$/, '');
  const params = new URLSearchParams();
  params.set('since', String(Math.max(0, Math.trunc(opts.since ?? 0))));
  if (opts.epoch) params.set('epoch', opts.epoch);
  try {
    const res = await fetchImpl(`${base}/api/journal?${params}`, {
      headers: { authorization: `Bearer ${opts.token}` },
      signal: AbortSignal.timeout(JOURNAL_TIMEOUT_MS),
    });
    if (!res.ok) {
      await opts.onRefused?.(res);
      return null;
    }
    const body = (await res.json()) as Record<string, unknown>;
    // The head and the epoch are the anchor the whole cursor protocol rests
    // on, and both arrive from a component DDR-054 calls untrusted. A
    // fractional or negative head, or an unbounded epoch string, gets
    // persisted into the ledger verbatim otherwise.
    const rawHead = body?.head;
    const head =
      typeof rawHead === 'number' && Number.isInteger(rawHead) && rawHead >= 0 ? rawHead : 0;
    const epoch =
      typeof body?.epoch === 'string' && body.epoch.length > 0 && body.epoch.length <= MAX_EPOCH_LEN
        ? body.epoch
        : null;
    if (body?.reanchor === true) {
      return {
        epoch,
        head,
        entries: [],
        truncated: false,
        reanchor: true,
        ...(typeof body.reason === 'string' ? { reason: body.reason.slice(0, 120) } : {}),
      };
    }
    // CAP THE PAGE at the hub's own published ceiling. An honest hub never
    // exceeds it; a hostile one ignores its own cap, and every entry past this
    // point becomes a ledger row on disk, a key in `_sync.json`, and a member
    // of the union every future pass re-walks. One response should not be able
    // to grow this machine's state without bound.
    const rawEntries = Array.isArray(body?.entries) ? body.entries : [];
    const overflowed = rawEntries.length > MAX_JOURNAL_PAGE;
    const entries: JournalEntry[] = [];
    for (const raw of rawEntries.slice(0, MAX_JOURNAL_PAGE)) {
      const parsed = parseEntry(raw);
      if (parsed !== null) entries.push(parsed);
    }
    return {
      epoch,
      head,
      entries,
      // An over-long page is treated as truncated, which is already the signal
      // meaning "there is more; come back" — so the pass converges instead of
      // silently believing it saw everything.
      truncated: body?.truncated === true || overflowed,
      reanchor: false,
      ...(overflowed ? { overflowed: true } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * What protocol features a hub advertises — the compat matrix's gate
 * (DDR-226 §10, BINDING).
 *
 * Returns null when `/health` is unreachable or unparseable. A caller must
 * treat BOTH null and a set without `ledger` as "this hub has no journal":
 * attach no control channel, relax no polling, keep every legacy lane. The
 * distinction between "an old hub that omits the field" and "a new hub with no
 * checkout" matters for diagnostics, not for behaviour.
 */
export async function hubCapabilities(opts: {
  hubUrl: string;
  fetchImpl?: typeof fetch;
  /**
   * Cancel the probe when the caller goes away.
   *
   * A boot-time probe that outlives its runtime is a timer holding a dying
   * process open and a promise resolving into torn-down state. The caller
   * aborts this in `stop()`; without it the 4 s timeout alone decides.
   */
  signal?: AbortSignal;
}): Promise<string[] | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.hubUrl.replace(/\/+$/, '');
  try {
    const timeout = AbortSignal.timeout(HEALTH_TIMEOUT_MS);
    const res = await fetchImpl(`${base}/health`, {
      signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { capabilities?: unknown };
    if (!Array.isArray(body?.capabilities)) return null;
    return body.capabilities.filter((c): c is string => typeof c === 'string').slice(0, 32);
  } catch {
    return null;
  }
}

/** Does this hub carry the journal file plane? */
export function hasLedger(capabilities: string[] | null): boolean {
  return Array.isArray(capabilities) && capabilities.includes('ledger');
}
