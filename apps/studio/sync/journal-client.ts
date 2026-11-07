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
  /**
   * p8-held-surface — paths the hub holds back from the code lane, sent to the
   * project OWNER only. Absent for everyone else (and from an older hub); an
   * empty list from the hub is "nothing is held".
   */
  held?: {
    count: number;
    paths: { path: string; reason: HeldReason }[];
    /** #167 T5.3 — the hub's list may be short (its hold cap or a cut walk): more are held. */
    overflow?: true;
  };
}

export type HeldReason = 'canvas-before-folders' | 'changed-as-canvas';

/** How many held paths one page may carry here (the hub sends at most 200). */
const MAX_HELD = 200;

/**
 * The owner's held list, shape-checked like every other journal field (the hub
 * is untrusted to peers, DDR-054): project-file shaped paths, a known reason,
 * capped, with the count clamped so it never reads below the list.
 */
function parseHeld(body: Record<string, unknown>): JournalPage['held'] | undefined {
  if (!Array.isArray(body?.held)) return undefined;
  const paths: { path: string; reason: HeldReason }[] = [];
  // p8-holds-fix (recheck info D): one row per path — the panel keys rows by it.
  const seen = new Set<string>();
  for (const raw of (body.held as unknown[]).slice(0, MAX_HELD)) {
    if (!raw || typeof raw !== 'object') continue;
    const h = raw as Record<string, unknown>;
    if (typeof h.path !== 'string' || !isProjectFileShape(h.path)) continue;
    if (seen.has(h.path)) continue;
    seen.add(h.path);
    const reason: HeldReason =
      h.reason === 'changed-as-canvas' ? 'changed-as-canvas' : 'canvas-before-folders';
    paths.push({ path: h.path, reason });
  }
  const rawCount = body.heldCount;
  const count =
    typeof rawCount === 'number' && Number.isInteger(rawCount) && rawCount >= paths.length
      ? Math.min(rawCount, 1_000_000)
      : paths.length;
  // #167 T5.3 — additive (`heldOverflow`, owner reads only); anything but a strict true is absent.
  return body.heldOverflow === true ? { count, paths, overflow: true } : { count, paths };
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
    const held = parseHeld(body);
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
      ...(held ? { held } : {}),
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
  return (await hubHealth(opts)).capabilities;
}

/**
 * The protocol half of `/health` in ONE request: the capabilities above plus
 * the project's file format (V2-1.12 §5.5 — `formatVersion`, null while the
 * hub has not read its store, absent on a hub older than `format-v2`).
 */
export async function hubHealth(opts: {
  hubUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Override the 4 s ceiling (the lane probe asks with a longer one). */
  timeoutMs?: number;
}): Promise<{
  capabilities: string[] | null;
  formatVersion: number | null;
  /**
   * Did the HUB answer (2.0.5)? False for a timeout, a network error, a 5xx, a
   * 429 or an unreadable body — none of which says anything about what the hub
   * can do. `capabilities: null` with `answered: true` is a real answer: a hub
   * that predates capabilities.
   */
  answered: boolean;
}> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.hubUrl.replace(/\/+$/, '');
  try {
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? HEALTH_TIMEOUT_MS);
    const res = await fetchImpl(`${base}/health`, {
      // a hub answers its own /health: a redirect is never followed (gate-b-sec1 A5 — a bounce to an internal
      // http address from a cell). The other sync requests do not follow one either (`redirect: 'manual'`).
      redirect: 'error',
      signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
    });
    if (!res.ok) {
      // A hub without the route (404) has answered: it has no capabilities. A
      // server error or a rate limit has not.
      const answered = res.status < 500 && res.status !== 429 && res.status !== 408;
      return { capabilities: null, formatVersion: null, answered };
    }
    const body = (await res.json()) as { capabilities?: unknown; formatVersion?: unknown };
    const fv = body?.formatVersion;
    const formatVersion = typeof fv === 'number' && Number.isSafeInteger(fv) && fv >= 1 ? fv : null;
    if (!Array.isArray(body?.capabilities))
      return { capabilities: null, formatVersion, answered: true };
    return {
      capabilities: body.capabilities
        .filter((c): c is string => typeof c === 'string')
        .slice(0, 32),
      formatVersion,
      answered: true,
    };
  } catch {
    return { capabilities: null, formatVersion: null, answered: false };
  }
}

/** The lane probe's patience: a longer ceiling than the 4 s boot probe. */
const LANE_PROBE_TIMEOUT_MS = 10_000;
/** Waits between attempts — a cold cell or a busy hub gets a moment. */
const LANE_PROBE_BACKOFF_MS = [2_000, 5_000] as const;

/**
 * Which file lane this hub needs, decided only from an ANSWER (2.0.5).
 *
 * The boot used to ask `/health` once with a 4 s ceiling and read a timeout as
 * "no journal here" — so a hub that was merely slow sent a 2.0 desktop down the
 * legacy v1 lane on a ledger hub for the whole boot: no ledger, no held
 * states, files the person had deleted pulled back, and (with the poll's
 * overlapping passes) a core pinned at 2–4 GB. Now: up to `attempts` tries
 * with a backoff and a longer ceiling; `legacy` only from a hub that answered
 * without `ledger`; `unknown` when it never answered — the caller asks again
 * later and runs no file lane meanwhile.
 */
export async function probeFileLane(opts: {
  hubUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  attempts?: number;
  timeoutMs?: number;
  backoffMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}): Promise<{
  lane: 'plane' | 'legacy' | 'unknown';
  capabilities: string[] | null;
  formatVersion: number | null;
}> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const backoff = opts.backoffMs ?? LANE_PROBE_BACKOFF_MS;
  const sleep =
    opts.sleep ??
    ((ms: number) =>
      new Promise<void>((r) => {
        const t = setTimeout(r, ms);
        (t as { unref?: () => void }).unref?.();
      }));
  for (let i = 0; i < attempts; i++) {
    if (opts.signal?.aborted) break;
    const h = await hubHealth({
      hubUrl: opts.hubUrl,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      timeoutMs: opts.timeoutMs ?? LANE_PROBE_TIMEOUT_MS,
    });
    if (h.answered) {
      return {
        lane: hasLedger(h.capabilities) ? 'plane' : 'legacy',
        capabilities: h.capabilities,
        formatVersion: h.formatVersion,
      };
    }
    if (i < attempts - 1) await sleep(backoff[Math.min(i, backoff.length - 1)] ?? 5_000);
  }
  return { lane: 'unknown', capabilities: null, formatVersion: null };
}

/** Does this hub keep annotations as the v2 element model (DDR-242)? */
export function hasAnnotationsV2(capabilities: string[] | null): boolean {
  return Array.isArray(capabilities) && capabilities.includes('annotations-v2');
}

/** Does this hub carry the journal file plane? */
export function hasLedger(capabilities: string[] | null): boolean {
  return Array.isArray(capabilities) && capabilities.includes('ledger');
}

/** The capability a hub advertises when its file door takes the 2.0 file classes (issue #175). */
export const FILE_CLASSES_V2_CAPABILITY = 'file-classes-v2';

/**
 * Does this hub's file door take the 2.0 file classes (`.transcript.json`, `.beats.json`,
 * `.gen.json`, the design-system manifests)? Every 1.x hub answers those with `400 invalid path`,
 * and it is deployed, so the desktop must not offer them (`olderDoorRefuses`, file-membership.ts).
 */
export function hasFileClassesV2(capabilities: string[] | null): boolean {
  return Array.isArray(capabilities) && capabilities.includes(FILE_CLASSES_V2_CAPABILITY);
}

/** The capability a hub advertises when its doors take paths up to 32 segments deep (fix/205). */
export const FILE_DEPTH_V2_CAPABILITY = 'file-depth-v2';

/**
 * Does this hub take paths deeper than 8 segments? Every hub before fix/205 answers them
 * `400 invalid path`, so the desktop holds them for it with a reason (`olderDoorRefusesDepth`).
 */
export function hasFileDepthV2(capabilities: string[] | null): boolean {
  return Array.isArray(capabilities) && capabilities.includes(FILE_DEPTH_V2_CAPABILITY);
}

/** The capability a hub advertises when it stamps every presence role itself (T5.2, #165). */
export const PRESENCE_ROLE_CAPABILITY = 'presence-role-v1';

/**
 * Does this hub stamp presence roles (`roleBy: 'hub'`, apps/hub access-docs.mjs `stampHubRole`)? An
 * older hub relays the mark as a peer sent it, so a hub-relayed role is kept only where this is true
 * (collab/awareness-bridge.ts `rolesVouched`).
 */
export function hasPresenceRoleV1(capabilities: unknown): boolean {
  return Array.isArray(capabilities) && capabilities.includes(PRESENCE_ROLE_CAPABILITY);
}
