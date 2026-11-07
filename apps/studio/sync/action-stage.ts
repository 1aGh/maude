// AI and multi-file action boundaries — plan T16 (DDR-241), one stage PER RUN
// since V2-1.5 §5.5 (S5.5).
//
// An agent turn (the in-app chat) or a `/design:edit` run changes several
// files, one tool call at a time. Proposed as they land, the project would
// accept a canvas edited against a module the agent has not written yet, and
// an agent that fails half way would leave that half published. So while a
// RUN is open, the file changes it makes are STAGED here instead of proposed:
// kept on disk, remembered with the value each was derived from, and proposed
// together — one transaction, one history action — when the run ends.
//
// ONE STAGE PER RUN. Two of your chats working on two artboards of one canvas
// are two runs, and they land as TWO actions (V2-1.5 U10): each run keeps its
// own `mine` per lane — the accepted base plus THIS run's deltas only — built
// by a three-way merge on every write (`R.mine = merge3(d0, d1, R.mine)`). Two
// runs that change the same characters (shared component code) cannot both be
// right: the second write is refused `run-overlap` and the first is untouched.
//
// Outcomes: `done` publishes; `stopped` (Stop, Quit after the dialog) publishes
// what the run finished as a PARTIAL version (" — stopped", `origin.partial`);
// `failed` (error, token limit, lost heartbeat, crash) HOLDS — nothing is
// published and nothing is thrown away until the person keeps or discards it.
// A held run survives a restart (`_state/ai-stage.json` v2; a v1 file is read
// as one held run), so a crash never turns into a partial publish by the next
// cold start — every open run comes back held.
//
// WHICH RUN A WRITE BELONGS TO. A staged write belongs to the run whose tool
// reported writing THAT exact content (`claim(runId, slug, hash)` — the ACP
// `tool_call_update` or the PostToolUse `edit.touched --hash`). Without a
// matching claim: the run that already claimed or staged that canvas, else the
// only open run (the v1 single-stage behaviour). Several open runs and no
// claim is ambiguous — a person's or an outside write — and is never staged.
//
// What is staged is only a WATCHER change (a tool writing a file). An edit the
// person makes in the UI is theirs and is proposed at once — unless it is made
// on top of staged bytes, in which case it waits behind every run it depends on
// (`dependents`), exactly as U2 waits on U1. A waiting edit is listed (`waiting`)
// as a pending ⌘Z entry; ⌘Z on it queues its inverse as ANOTHER waiting edit that
// depends on it, so it goes out right behind it (S2.20c, V2-1.5 §5.4).

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { hashBytes } from './echo-guard.ts';
import type { LaneProposal, ProposalOutcome } from './projection.ts';
import { mergeSource } from './source-merge.ts';
import type { Operation, ProposalResult } from './transaction-client.ts';

export type StageState = 'open' | 'held';
export type RunOutcome = 'done' | 'failed' | 'stopped';

/** V2-1.15 §5.2 — the leases a publish names; the kernel checks them in its commit. */
export interface RunFence {
  runId: string;
  leases: Array<{ entry: string; artboard: string; token: number }>;
}

export interface StagedLane {
  slug: string;
  doc: string;
  lane: LaneProposal['lane'];
  /** The accepted content when THIS run first touched the lane. */
  base: string;
  /** base + this run's deltas ONLY. */
  mine: string;
  writes: number;
  writeId?: string;
  /** Every staged proposal's transaction id — aliased to the run's on publish. */
  txs: string[];
  resolvers: Array<(o: ProposalOutcome) => void>;
  /** Restored from disk after a restart: the cold start's first write is not a delta. */
  restored?: boolean;
  /**
   * S12.16 — the run CREATED this canvas (it is not in the store yet): its path. The run publishes
   * a `doc.create` carrying every staged lane of the doc instead of a `lane.replace` per lane.
   */
  create?: string;
}

/** V2-1.5 §5.5 `RunStage`. */
export interface RunStage {
  runId: string;
  chatId?: string;
  actor?: string;
  /** The prompt, ≤ 120 chars. */
  label: string;
  state: StageState;
  since: number;
  endedAt?: number;
  lanes: Map<string, StagedLane>;
  /** canvas → artboards (V2-1.5 §5.7 attribution). */
  touched: Record<string, string[]>;
  /**
   * p8-a1-claims (Michal 2026-10-29) — EVERY run is claim-only: it takes a write only when a tool
   * claimed exactly those bytes for it (`claim`), never because it is the one run open. #164 T5.1 — a
   * call that cannot claim (S7 interpreter, terminal-lane verb) no longer lifts that: while its window
   * is open (`shellCalls`, call → the canvases it covers; p8-sec2-attrib A1 `ALL_CANVASES` for a call
   * that names none), and after it closes until its settle (at most SETTLE_WAIT_MS), an unclaimed
   * outside write to a covered canvas is PARKED — neither staged nor proposed. The call's settle
   * (`settleShellCall`, the hook's post-call bytes, claimed first) moves the parked writes whose bytes
   * it claimed into the run as one write and releases every other one as outside. Every failure
   * releases as outside; nothing falls to the AI. A person's studio save is never stageable, so it is
   * never parked.
   */
  shellCalls?: Map<string, ShellCall>;
  /**
   * p8-a1-claims (F17) — canvases this run DELETED (a claimed `maude design trash move`): doc id → the
   * canvas path. Published as `doc.delete` in the run's one action, so its undo brings the canvas back.
   */
  deletes?: Map<string, { slug: string; generation?: number }>;
}

/** What the run list / held card reads (no bytes). */
export interface RunStageSummary {
  runId: string;
  chatId?: string;
  label: string;
  state: StageState;
  since: number;
  endedAt?: number;
  canvases: string[];
  touched: Record<string, string[]>;
}

/** The aggregate the v1 status surface reads (held wins over open). */
export interface StageSummary {
  state: StageState;
  label: string;
  canvases: string[];
  since: number;
  runs?: RunStageSummary[];
}

/**
 * S2.20c (V2-1.5 §5.4) — a person's edit waiting behind a run: what the ⌘Z stack shows as a pending
 * entry (`transactionId` / `label` / `madeAt` / `slug`), and the two sides ⌘Z on it takes back.
 * `undoes` marks the inverse such a ⌘Z queued: another waiting edit, behind the same run, that
 * takes back the waiting edit with that transaction id (decision v2-lead-pending-inverse-via-stage).
 */
export interface WaitingEdit {
  transactionId: string;
  slug: string;
  lane: LaneProposal['lane'];
  label: string;
  madeAt: number;
  content: string;
  baseContent: string;
  undoes?: string;
}

/** A waiting edit without its bytes (what the undo stack reads). */
export type WaitingEditSummary = Omit<WaitingEdit, 'content' | 'baseContent'>;

interface Dependent {
  send: (dependsOn: string[] | undefined) => void;
  drop: (o: ProposalOutcome) => void;
  dependsOn: string[];
  edit?: WaitingEdit;
}

export interface StageProposal {
  label: string;
  kind: string;
  operations: Operation[];
  transactionId: string;
  /** V2-1.5 §5.1 — merged into the envelope's origin by the transaction client. */
  origin?: { runId?: string; chatId?: string; madeAt?: number; partial?: true };
  fence?: RunFence;
}

export interface ActionStageOptions {
  designRoot: string;
  /** Send one grouped action; resolves with the final result. */
  propose: (action: StageProposal) => Promise<ProposalResult>;
  newTransactionId: () => string;
  onChange?: (summary: StageSummary | null) => void;
  /** V2-1.5 §5.7 — the artboards an html write `before → after` to canvas `slug` changed. */
  attribute?: (
    slug: string,
    before: string,
    after: string
  ) => { canvas: string; artboards: string[] } | null;
  log?: Pick<Console, 'log' | 'warn'>;
  now?: () => number;
  /** Where held runs persist (default `_state/ai-stage.json`; the local home keeps its own). */
  stateFile?: string;
  /**
   * S5.15 (A13 rollback) — a write refused `run-overlap` already reached the disk: the home puts
   * `base` (what the lane held before it) back when the disk still holds `content`.
   */
  onRefused?: (w: {
    slug: string;
    lane: LaneProposal['lane'];
    base: string;
    content: string;
  }) => void;
  /**
   * #164 — parked writes to one canvas released as OUTSIDE (no run), in arrival order: send them as
   * the writes they were. Absent: one `edit` proposal per canvas through `propose`.
   */
  release?: (w: { slug: string; doc: string; writes: LaneProposal[] }) => Promise<ProposalOutcome>;
}

/** #164 — one call's window: what it covers, and (once closed) the wait for its settle. */
interface ShellCall {
  slugs: ShellSlugs;
  closedAt?: number;
  settleTimer?: ReturnType<typeof setTimeout>;
  staleTimer?: ReturnType<typeof setTimeout>;
  /** D4 — canvases it covered that left the disk while it was open (a settle may bind only these). */
  gone?: Set<string>;
}

/** #164 — an unclaimed outside write a window holds back until the call settles. */
interface Parked {
  slug: string;
  doc: string;
  p: LaneProposal;
  resolve: (o: ProposalOutcome) => void;
  /** D1 — the transactions merged into this entry (first base, last bytes), first one first. */
  txs: string[];
  /** The windows (`callKey`) that keep it parked; empty = it only waits behind an earlier one. */
  keys: Set<string>;
  /** F1 — the windows that covered it when it parked: only a settle of one of them may claim it. */
  wins: ReadonlySet<string>;
  /** F1 — the settle of this run claimed the canvas: its bytes, when they arrive, take this along. */
  joinRun?: string;
}

const STOPPED = ' — stopped';
/**
 * A1 — the watcher delivers a verb's last write a beat after the call returns (cf. AI settle 250 ms).
 * #164 — it no longer admits unclaimed writes into a run; a person's held save (ai/save-hold.ts) still
 * lands this long after the window closes.
 */
export const SHELL_SETTLE_MS = 1_000;
/**
 * #164 — a closed window parks until its settle arrives, at most this long (the hook's post-call
 * timeout is 5 s); then its parked writes are released as outside.
 */
export const SETTLE_WAIT_MS = 3_000;
/** #164 — a window that never closes (a killed call, no PostToolUse) releases at this age. */
export const SHELL_STALE_MS = 10 * 60_000;
/** D1 — at most this many parked entries, and this many bytes of them, at once. */
export const PARKED_MAX = 1_024;
export const PARKED_MAX_BYTES = 64 * 1024 * 1024;
const unref = (t: ReturnType<typeof setTimeout>) => {
  (t as { unref?: () => void }).unref?.();
  return t;
};
const callKey = (runId: string, call: string) => `${runId}\u0000${call}`;
/** What `runsHolding` names for a dependency on a parked write (never a run id: RUN_ID has no `#`). */
const PARKED = '#parked';

/** p8-sec2-attrib A1 — the window of a call that names no canvas: it covers every one. */
const ALL_CANVASES = '*' as const;
type ShellSlugs = Set<string> | typeof ALL_CANVASES;
const coversShellSlug = (s: ShellSlugs, slug: string) => s === ALL_CANVASES || s.has(slug);
const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const originId = (v: unknown): string | undefined =>
  typeof v === 'string' && RUN_ID.test(v) ? v : undefined;

export function createActionStage(opts: ActionStageOptions) {
  const log = opts.log ?? console;
  const now = opts.now ?? Date.now;
  const file = opts.stateFile ?? path.join(opts.designRoot, '_state', 'ai-stage.json');

  /** runId → stage, in begin order. */
  const runs = new Map<string, RunStage>();
  /** begin key → runId (a v1 caller names its participant, not a run). */
  const keyRun = new Map<string, string>();
  /** runId → `${slug}|${hash}` claims and the slugs it claimed. */
  const claims = new Map<
    string,
    { hashes: Set<string>; slugs: Set<string>; deletes?: Set<string> }
  >();
  const dependents: Dependent[] = [];
  /** A staged transaction id → the run transaction that carried it. */
  const alias = new Map<string, string>();
  /** #164 — parked writes, in arrival order (see `RunStage.shellCalls`). */
  const parked: Parked[] = [];

  const runOf = (keyOrRun: string): RunStage | undefined =>
    runs.get(keyRun.get(keyOrRun) ?? keyOrRun);

  function runSummary(r: RunStage): RunStageSummary {
    const canvases = new Set<string>();
    for (const l of r.lanes.values()) canvases.add(l.slug);
    for (const d of r.deletes?.values() ?? []) canvases.add(d.slug);
    return {
      runId: r.runId,
      ...(r.chatId ? { chatId: r.chatId } : {}),
      label: r.label,
      state: r.state,
      since: r.since,
      ...(r.endedAt ? { endedAt: r.endedAt } : {}),
      canvases: [...canvases].sort(),
      touched: r.touched,
    };
  }

  function summary(): StageSummary | null {
    if (runs.size === 0) return null;
    const all = [...runs.values()];
    const held = all.filter((r) => r.state === 'held');
    const lead = held[0] ?? all[0];
    const canvases = new Set<string>();
    for (const r of all) for (const l of r.lanes.values()) canvases.add(l.slug);
    return {
      state: held.length ? 'held' : 'open',
      label: lead.label,
      canvases: [...canvases].sort(),
      since: Math.min(...all.map((r) => r.since)),
      runs: all.map(runSummary),
    };
  }

  function persist(): void {
    try {
      const keep = [...runs.values()].filter((r) => r.lanes.size > 0 || !!r.deletes?.size);
      if (keep.length === 0) {
        rmSync(file, { force: true });
        return;
      }
      mkdirSync(path.dirname(file), { recursive: true });
      const body = {
        v: 2,
        runs: keep.map((r) => ({
          runId: r.runId,
          ...(r.chatId ? { chatId: r.chatId } : {}),
          ...(r.actor ? { actor: r.actor } : {}),
          label: r.label,
          state: r.state,
          since: r.since,
          ...(r.endedAt ? { endedAt: r.endedAt } : {}),
          touched: r.touched,
          lanes: [...r.lanes.values()].map((l) => ({
            slug: l.slug,
            doc: l.doc,
            lane: l.lane,
            base: l.base,
            mine: l.mine,
            writes: l.writes,
            ...(l.create ? { create: l.create } : {}),
          })),
          ...(r.deletes?.size
            ? {
                deletes: [...r.deletes].map(([doc, d]) => ({
                  doc,
                  slug: d.slug,
                  ...(d.generation !== undefined ? { generation: d.generation } : {}),
                })),
              }
            : {}),
        })),
      };
      writeFileSync(`${file}.tmp`, JSON.stringify(body));
      renameSync(`${file}.tmp`, file);
    } catch (err) {
      log.warn(`[sync/ai] could not record the unfinished AI run: ${(err as Error).message}`);
    }
  }

  function changed(): void {
    persist();
    opts.onChange?.(summary());
  }

  /** A previous process left stages: every run comes back HELD (U14). */
  function restore(): void {
    if (!existsSync(file)) return;
    try {
      const body = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      const stages: RunStage[] = [];
      if (body.v === 2 && Array.isArray(body.runs)) {
        for (const raw of body.runs as Record<string, unknown>[]) {
          const runId = originId(raw.runId);
          if (!runId || !Array.isArray(raw.lanes)) continue;
          const lanes = new Map<string, StagedLane>();
          for (const l of raw.lanes as Record<string, unknown>[]) {
            if (typeof l.slug !== 'string' || typeof l.lane !== 'string') continue;
            if (typeof l.base !== 'string' || typeof l.mine !== 'string') continue;
            lanes.set(`${l.slug}|${l.lane}`, {
              slug: l.slug,
              doc: typeof l.doc === 'string' ? l.doc : l.slug,
              lane: l.lane as LaneProposal['lane'],
              base: l.base,
              mine: l.mine,
              writes: typeof l.writes === 'number' ? l.writes : 1,
              txs: [],
              resolvers: [],
              restored: true,
              ...(typeof l.create === 'string' && l.create ? { create: l.create } : {}),
            });
          }
          const deletes = new Map<string, { slug: string; generation?: number }>();
          for (const d of Array.isArray(raw.deletes)
            ? (raw.deletes as Record<string, unknown>[])
            : [])
            if (typeof d?.doc === 'string' && typeof d.slug === 'string')
              deletes.set(d.doc, {
                slug: d.slug,
                ...(typeof d.generation === 'number' ? { generation: d.generation } : {}),
              });
          if (lanes.size === 0 && deletes.size === 0) continue;
          const chatId = originId(raw.chatId);
          stages.push({
            runId,
            ...(chatId ? { chatId } : {}),
            ...(typeof raw.actor === 'string' ? { actor: raw.actor } : {}),
            label: typeof raw.label === 'string' ? raw.label : 'AI edit',
            state: 'held',
            since: typeof raw.since === 'number' ? raw.since : now(),
            ...(typeof raw.endedAt === 'number' ? { endedAt: raw.endedAt } : {}),
            lanes,
            touched:
              raw.touched && typeof raw.touched === 'object'
                ? (raw.touched as Record<string, string[]>)
                : {},
            ...(deletes.size ? { deletes } : {}),
          });
        }
      } else {
        // v1 — one project-wide stage: read as ONE held run. It kept only the
        // bases; the bytes are on disk and the cold start's write brings them.
        const all = [
          ...((body.lanes as { slug: string; doc?: string; lane: string; baseContent: string }[]) ??
            []),
          ...((body.restored as { slug: string; lane: string; baseContent: string }[]) ?? []),
        ];
        const lanes = new Map<string, StagedLane>();
        for (const l of all) {
          if (typeof l?.slug !== 'string' || typeof l.baseContent !== 'string') continue;
          lanes.set(`${l.slug}|${l.lane}`, {
            slug: l.slug,
            doc: (l as { doc?: string }).doc ?? l.slug,
            lane: l.lane as LaneProposal['lane'],
            base: l.baseContent,
            mine: l.baseContent,
            writes: 0,
            txs: [],
            resolvers: [],
            restored: true,
          });
        }
        if (lanes.size) {
          stages.push({
            runId: 'v1-stage',
            label: typeof body.label === 'string' ? body.label : 'AI edit',
            state: 'held',
            since: typeof body.since === 'number' ? body.since : now(),
            lanes,
            touched: {},
          });
        }
      }
      for (const r of stages) runs.set(r.runId, r);
      if (stages.length) {
        log.warn(
          `[sync/ai] ${stages.length} unfinished AI run(s) were kept from the last session — not published until you choose.`
        );
        changed();
      }
    } catch {
      /* unreadable → nothing to restore */
    }
  }

  /**
   * A run begins. `key` is the caller's participant name (v1: `acp:<chat>`,
   * `edit:<file>`, `agent:<session>`); `meta.runId` the registry's run id when
   * there is one (the key otherwise). Beginning a run that is held continues it.
   */
  function begin(
    key: string,
    nextLabel: string,
    meta: {
      runId?: string;
      chatId?: string;
      actor?: string;
      /**
       * A1 — a call that cannot claim opening (`open`) or closing its window, for the canvases its
       * command names (`slugs`, in this stage's slug form; none = it takes nothing).
       */
      shell?: { call: string; open: boolean; slugs?: string[]; all?: boolean };
      /** p8-a1-claims — every run is claim-only now; kept for callers that still say so. */
      claimOnly?: boolean;
    } = {}
  ): void {
    const runId = originId(meta.runId) ?? key;
    keyRun.set(key, runId);
    const existing = runs.get(runId);
    if (existing) {
      if (existing.state === 'held') {
        existing.state = 'open';
        delete existing.endedAt;
        changed();
      }
      shellWindow(existing, meta.shell);
      return;
    }
    const chatId = originId(meta.chatId);
    const fresh: RunStage = {
      runId,
      ...(chatId ? { chatId } : {}),
      ...(meta.actor ? { actor: meta.actor } : {}),
      label: nextLabel.slice(0, 120) || 'AI edit',
      state: 'open',
      since: now(),
      lanes: new Map(),
      touched: {},
    };
    runs.set(runId, fresh);
    shellWindow(fresh, meta.shell);
    changed();
  }

  /**
   * A1 / #164 — open/close the window of one call that cannot claim (no `shell`: nothing changes).
   * The ACP tracker and the design hook may both open the same call (its tool call id): the window
   * covers what either named. Closing it starts the wait for its settle.
   */
  function shellWindow(
    r: RunStage,
    shell: { call: string; open: boolean; slugs?: string[]; all?: boolean } | undefined
  ): void {
    if (!shell) return;
    r.shellCalls ??= new Map();
    const prev = r.shellCalls.get(shell.call);
    if (shell.open) {
      const named = new Set(shell.slugs ?? []);
      if (!shell.all && !named.size && !prev) return;
      const slugs: ShellSlugs =
        shell.all || prev?.slugs === ALL_CANVASES
          ? ALL_CANVASES
          : new Set([...((prev?.slugs as Set<string> | undefined) ?? []), ...named]);
      if (prev?.settleTimer) clearTimeout(prev.settleTimer);
      const call = shell.call;
      r.shellCalls.set(call, {
        slugs,
        ...(prev?.gone ? { gone: prev.gone } : {}),
        staleTimer:
          prev?.staleTimer ??
          unref(setTimeout(() => releaseShellCall(r.runId, call, 'stale'), SHELL_STALE_MS)),
      });
      return;
    }
    if (!prev || prev.closedAt !== undefined) return;
    prev.closedAt = now();
    const call = shell.call;
    prev.settleTimer = unref(
      setTimeout(() => releaseShellCall(r.runId, call, 'no-settle'), SETTLE_WAIT_MS)
    );
  }

  /** #164 — the windows (open, or closed and waiting for their settle) that cover `slug`. */
  function coveringKeys(slug: string): string[] {
    const out: string[] = [];
    for (const r of runs.values()) {
      if (r.state !== 'open') continue;
      for (const [call, c] of r.shellCalls ?? [])
        if (coversShellSlug(c.slugs, slug)) out.push(callKey(r.runId, call));
    }
    return out;
  }

  /** #164 — would an unclaimed write to `slug` park? (a window covers it, or one waits before it) */
  const parks = (slug: string) =>
    parked.some((e) => e.slug === slug) || coveringKeys(slug).length > 0;

  const clearCall = (c: ShellCall) => {
    if (c.settleTimer) clearTimeout(c.settleTimer);
    if (c.staleTimer) clearTimeout(c.staleTimer);
  };

  /**
   * #164 — take call `call`'s window out of run `r` only: its key (none when `r` has no such window).
   * Another run's window under the same call id is not this caller's to end.
   */
  function detachCall(r: RunStage | undefined, call: string): Set<string> {
    const c = r?.shellCalls?.get(call);
    if (!r || !c) return new Set();
    clearCall(c);
    r.shellCalls?.delete(call);
    return new Set([callKey(r.runId, call)]);
  }

  /** #164 — take every window of run `r` out (the run ends): their keys. */
  function detachRunCalls(r: RunStage): Set<string> {
    const keys = new Set<string>();
    for (const [call, c] of r.shellCalls ?? []) {
      clearCall(c);
      keys.add(callKey(r.runId, call));
    }
    r.shellCalls?.clear();
    return keys;
  }

  /** Did run `r` claim exactly `content` for `slug`? */
  const claimedBy = (r: RunStage, slug: string, content: string) =>
    claims.get(r.runId)?.hashes.has(`${slug}|${hashBytes(content)}`) === true;

  const sameKeys = (a: ReadonlySet<string>, b: readonly string[]) =>
    a.size === b.length && b.every((k) => a.has(k));

  function park(slug: string, doc: string, p: LaneProposal): Promise<ProposalOutcome> {
    return new Promise((resolve) => {
      const keys = coveringKeys(slug);
      // D1 — the same canvas lane, parked again under the same windows, is one entry: the first base,
      // the last bytes (a release or a join sends exactly that); its transactions and waiters ride along
      let last: Parked | undefined;
      for (let i = parked.length - 1; i >= 0 && !last; i--)
        if (parked[i].slug === slug && parked[i].p.lane === p.lane) last = parked[i];
      if (last && !last.joinRun && sameKeys(last.keys, keys) && sameKeys(last.wins, keys)) {
        const prev = last.resolve;
        last.p = {
          ...p,
          baseContent: last.p.baseContent,
          transactionId: last.p.transactionId,
          ...(last.p.create ? { create: last.p.create } : {}),
        };
        last.txs.push(p.transactionId);
        last.resolve = (o) => {
          prev(o);
          resolve(o);
        };
        capParked();
        return;
      }
      parked.push({
        slug,
        doc,
        p,
        resolve,
        txs: [p.transactionId],
        keys: new Set(keys),
        wins: new Set(keys),
      });
      capParked();
    });
  }

  const parkedSize = (e: Parked) => e.p.content.length + e.p.baseContent.length;

  /**
   * D1 — parked writes are bounded (entries and bytes). Past a cap the oldest canvas's parked writes go
   * out as outside — the failure every other path has — and the log says so.
   */
  function capParked(): void {
    let bytes = 0;
    for (const e of parked) bytes += parkedSize(e);
    while (parked.length && (parked.length > PARKED_MAX || bytes > PARKED_MAX_BYTES)) {
      const slug = parked[0].slug;
      const out = parked.filter((e) => e.slug === slug);
      for (const e of out) bytes -= parkedSize(e);
      log.warn(
        `[sync/ai] too many writes held for running AI calls: ${slug} is recorded as an outside change.`
      );
      sendOutside(slug, out);
    }
  }

  function unpark(list: readonly Parked[]): void {
    for (const e of list) {
      const i = parked.indexOf(e);
      if (i >= 0) parked.splice(i, 1);
    }
  }

  /**
   * #164 — parked writes `entries` (one lane, arrival order) join run `r` as ONE write: the first
   * one's base → the last one's bytes.
   */
  function joinParked(r: RunStage, entries: readonly Parked[]): void {
    if (!entries.length) return;
    unpark(entries);
    const first = entries[0];
    const last = entries[entries.length - 1];
    const create = entries.find((e) => e.p.create)?.p.create;
    void stageWrite(
      r,
      last.slug,
      last.doc,
      { ...last.p, baseContent: first.p.baseContent, ...(create ? { create } : {}) },
      entries
    );
  }

  /** #164 — parked writes `out` of canvas `slug` go out as OUTSIDE (no run), in arrival order. */
  function sendOutside(slug: string, out: readonly Parked[]): void {
    if (!out.length) return;
    unpark(out);
    let sent: Promise<ProposalOutcome>;
    try {
      sent = release({ slug, doc: out[0].doc, writes: out.map((e) => e.p) });
    } catch (err) {
      sent = Promise.reject(err);
    }
    const settled = sent.catch(
      (err: unknown): ProposalOutcome => ({
        status: 'rejected',
        code: (err as { code?: string })?.code ?? 'retryable',
      })
    );
    for (const e of out) void settled.then(e.resolve);
  }

  /** #164 — the parked writes of `slug` no window keeps any more go out as outside, in order. */
  function releasePrefix(slug: string): void {
    const out: Parked[] = [];
    for (const e of parked) {
      if (e.slug !== slug) continue;
      if (e.keys.size) break;
      out.push(e);
    }
    sendOutside(slug, out);
  }

  /**
   * F1 — `entries` (one lane of `slug`, the call's own parked writes) join run `r`. Every OTHER write
   * parked on that lane before them — a person's save, another run's or another call's write — is not
   * the call's: it goes out as outside FIRST, so the run's write lands on top of it, never absorbs it.
   */
  function joinOwn(r: RunStage, slug: string, lane: string, entries: readonly Parked[]): void {
    const lastAt = parked.indexOf(entries[entries.length - 1]);
    sendOutside(
      slug,
      parked.filter(
        (e, i) => i < lastAt && e.slug === slug && e.p.lane === lane && !entries.includes(e)
      )
    );
    joinParked(r, entries);
  }

  /**
   * #164 — windows `keys` no longer hold their parked writes. Only a SETTLE moves parked writes into
   * a run (F1): the settling run's own call's writes (`settle.key` covered them when they parked), on a
   * canvas it claimed, whose last bytes it claimed. A claimed canvas whose bytes have not reached the
   * watcher yet waits for them (at most SETTLE_WAIT_MS). Everything else is released as outside.
   */
  function resolveKeys(
    keys: ReadonlySet<string>,
    settle?: {
      run: RunStage;
      key: string;
      claimed: ReadonlySet<string>;
      awaitKey: string;
    }
  ): void {
    if (!keys.size) return;
    const slugs = new Set<string>();
    for (const e of parked) {
      let hit = false;
      for (const k of keys) if (e.keys.delete(k)) hit = true;
      if (hit) slugs.add(e.slug);
    }
    let waits = false;
    for (const slug of slugs) {
      const mine =
        settle?.claimed.has(slug) === true
          ? parked.filter((e) => e.slug === slug && e.wins.has(settle.key))
          : [];
      if (settle && mine.length) {
        const lanes = [...new Set(mine.map((e) => e.p.lane))];
        const ofLane = (l: string) => mine.filter((e) => e.p.lane === l);
        const matched = (l: string) => {
          const last = ofLane(l).at(-1);
          return !!last && claimedBy(settle.run, slug, last.p.content);
        };
        // a new canvas follows its source: claimed html bytes take every lane of the create along
        const create = mine.some((e) => e.p.create);
        const join = create ? (matched('html') ? lanes : []) : lanes.filter(matched);
        for (const l of join) joinOwn(settle.run, slug, l, ofLane(l));
        // the settle claimed this canvas, but the watcher has not delivered those bytes yet
        for (const l of lanes) {
          if (join.includes(l)) continue;
          for (const e of ofLane(l)) {
            e.joinRun = settle.run.runId;
            e.keys.add(settle.awaitKey);
          }
          waits = true;
        }
      }
      releasePrefix(slug);
    }
    if (waits && settle) {
      const k = settle.awaitKey;
      unref(setTimeout(() => resolveKeys(new Set([k])), SETTLE_WAIT_MS));
    }
    releaseDependents();
  }

  /**
   * #164 — call `call`'s settle arrived: the hook re-read its post-call bytes and the studio CLAIMED
   * the ones the disk still holds (`claimed`: their canvases). Its window closes; parked writes
   * whose bytes are claimed join the claiming run as one write, the rest go out as outside.
   */
  function settleShellCall(
    keyOrRun: string,
    call: string,
    claimed: readonly string[] = []
  ): boolean {
    const r = runOf(keyOrRun);
    // a settle for a call this run has no window for is refused: it resolves nothing
    if (r?.state !== 'open' || !r.shellCalls?.has(call)) return false;
    const key = callKey(r.runId, call);
    resolveKeys(detachCall(r, call), {
      run: r,
      key,
      claimed: new Set(claimed),
      awaitKey: `${key}\u0000await\u0000${(++awaitSeq).toString(36)}`,
    });
    return true;
  }
  let awaitSeq = 0;

  /**
   * #164 — call `call` ends with no settle (the hook failed, a killed call, the studio was away):
   * every write it parked is released as outside.
   */
  function releaseShellCall(
    keyOrRun: string,
    call: string,
    _reason: 'no-settle' | 'stale' | 'run-end'
  ): void {
    resolveKeys(detachCall(runOf(keyOrRun), call));
  }

  /**
   * #164 — run `keyOrRun`'s window for call `call` (open, or closed and waiting for its settle), or
   * null when it has none: what the settle route may claim for it (F6 — a `named` window covers only
   * its canvases).
   */
  function shellCall(
    keyOrRun: string,
    call: string
  ): {
    all: boolean;
    covers: (slug: string) => boolean;
    left: (slug: string) => boolean;
  } | null {
    const r = runOf(keyOrRun);
    const c = r && r.state === 'open' ? r.shellCalls?.get(call) : undefined;
    if (!c) return null;
    return {
      all: c.slugs === ALL_CANVASES,
      covers: (slug) => coversShellSlug(c.slugs, slug),
      left: (slug) => c.gone?.has(slug) === true,
    };
  }

  /** The release a stage gets without `opts.release`: one `edit` proposal per canvas. */
  function defaultRelease(w: {
    slug: string;
    doc: string;
    writes: LaneProposal[];
  }): Promise<ProposalOutcome> {
    const lanes = [...new Set(w.writes.map((x) => x.lane))];
    const firstOf = (l: string) => w.writes.find((x) => x.lane === l) as LaneProposal;
    const lastOf = (l: string) => w.writes.filter((x) => x.lane === l).at(-1) as LaneProposal;
    const create = w.writes.find((x) => x.create)?.create;
    const operations: Operation[] = create
      ? [
          {
            op: 'doc.create',
            doc: w.doc,
            path: create,
            lanes: Object.fromEntries(
              lanes.map((l) => [l, lastOf(l).content]).filter(([, v]) => v !== '')
            ),
          },
        ]
      : lanes.map((l) => ({
          op: 'lane.replace',
          doc: w.doc,
          lane: l,
          content: lastOf(l).content,
          baseContent: firstOf(l).baseContent,
        }));
    return opts
      .propose({
        label: path.posix.basename(w.slug).replace(/\.tsx$/i, ''),
        kind: 'edit',
        operations,
        transactionId: w.writes[0].transactionId,
      })
      .then((r) => ({
        status: r.status,
        ...(r.code ? { code: r.code } : {}),
        ...(typeof r.actionId === 'string' ? { actionId: r.actionId } : {}),
      }));
  }
  const release = opts.release ?? defaultRelease;

  /** A tool reported writing `hash` (sha256 of the content) to canvas `slug`. */
  function claim(keyOrRun: string, slug: string, hash?: string | null): void {
    const r = runOf(keyOrRun);
    if (!r) return;
    let c = claims.get(r.runId);
    if (!c) {
      c = { hashes: new Set(), slugs: new Set() };
      claims.set(r.runId, c);
    }
    c.slugs.add(slug);
    if (hash) c.hashes.add(`${slug}|${hash}`);
  }

  /** Attribution (V2-1.5 §5.7) — the artboards a run's writes touched. */
  function touch(keyOrRun: string, canvas: string, artboards: string[]): void {
    const r = runOf(keyOrRun);
    if (!r || !artboards.length) return;
    r.touched[canvas] = [...new Set([...(r.touched[canvas] ?? []), ...artboards])].sort();
    changed();
  }

  /**
   * p8-a1-claims (F17) — a tool of run `keyOrRun` is about to delete canvas `slug` (the studio's
   * `DELETE /_api/canvas` named the run). The kernel's delete of it then joins the run (`stagesDelete`).
   */
  function claimDelete(keyOrRun: string, slug: string): void {
    const r = runOf(keyOrRun);
    if (!r) return;
    let c = claims.get(r.runId);
    if (!c) {
      c = { hashes: new Set(), slugs: new Set() };
      claims.set(r.runId, c);
    }
    c.deletes ??= new Set();
    c.deletes.add(slug);
  }

  /** I1 — the delete claimed above did not happen (the studio's delete failed): the claim goes with it. */
  function unclaimDelete(keyOrRun: string, slug: string): void {
    const r = runOf(keyOrRun);
    if (!r) return;
    claims.get(r.runId)?.deletes?.delete(slug);
  }

  /**
   * The canvas `slug` (doc `doc`) left the disk: when an OPEN run claimed that delete, it is staged in
   * that run (published as `doc.delete` with the run's other changes) and true is returned — the caller
   * proposes nothing. An unclaimed delete is the person's (false). The run's staged lanes of the doc
   * go with it: a canvas the run made and then trashed is no change at all.
   */
  function stagesDelete(slug: string, doc: string, generation?: number): boolean {
    // D4 — the windows open over this canvas saw it leave the disk (what their settle may bind)
    for (const x of runs.values())
      if (x.state === 'open')
        for (const c of x.shellCalls?.values() ?? [])
          if (coversShellSlug(c.slugs, slug)) {
            c.gone ??= new Set();
            c.gone.add(slug);
          }
    const r = [...runs.values()].find(
      (x) => x.state === 'open' && claims.get(x.runId)?.deletes?.has(slug)
    );
    if (!r) return false;
    claims.get(r.runId)?.deletes?.delete(slug);
    let created = false;
    for (const [k, l] of r.lanes) {
      if (l.doc !== doc) continue;
      if (l.create) created = true;
      for (const fn of l.resolvers) fn({ status: 'rejected', code: 'deleted' });
      r.lanes.delete(k);
    }
    if (!created) {
      r.deletes ??= new Map();
      r.deletes.set(doc, {
        slug,
        ...(generation !== undefined ? { generation } : {}),
      });
    }
    changed();
    return true;
  }

  const coversSlug = (r: RunStage, slug: string) =>
    claims.get(r.runId)?.slugs.has(slug) || [...r.lanes.values()].some((l) => l.slug === slug);

  /** The run a tool write of `content` to `slug` belongs to, or null. */
  function ownerOf(slug: string, content?: string, explicit = false): RunStage | null {
    const all = [...runs.values()];
    const open = all.filter((r) => r.state === 'open');
    if (content !== undefined) {
      const key = `${slug}|${hashBytes(content)}`;
      const byHash = open.find((r) => claims.get(r.runId)?.hashes.has(key));
      if (byHash) return byHash;
    }
    // S12.16 — a NEW canvas joins a run only when that run said it created it (its slug claim);
    // the create's other lanes follow the canvas the run already staged.
    if (explicit) {
      const covering = open.filter((r) => coversSlug(r, slug));
      return covering.length === 1 ? covering[0] : null;
    }
    // p8-a1-claims — no claim for these bytes: the write is not a run's. Being the only open run is
    // not a claim; #164 — nor is a window of a call that cannot claim (it parks the write instead).
    if (open.length) return null;
    // Nothing open: a held run that covers this canvas keeps its cold start.
    return all.find((r) => r.state === 'held' && coversSlug(r, slug)) ?? null;
  }

  /** Should this proposal be staged instead of sent? */
  function captures(slug: string, stageable: boolean, content?: string, explicit = false): boolean {
    if (!stageable || (runs.size === 0 && parked.length === 0)) return false;
    // #164 — a write a call's window covers is parked (the stage holds it until the call settles)
    return ownerOf(slug, content, explicit) !== null || parks(slug);
  }

  /** The accepted content of a lane: any staged run's base, else the write's own base. */
  function acceptedOf(k: string, fallback: string): string {
    for (const r of runs.values()) {
      const l = r.lanes.get(k);
      if (l) return l.base;
    }
    return fallback;
  }

  /**
   * U11 — would run `runId`'s write `d0 → d1` on this lane touch characters
   * another open run changed? Returns that run's id, or null. The PostToolUse
   * check asks this BEFORE the write lands (A13); `capture` refuses after.
   */
  function overlapWith(
    keyOrRun: string,
    slug: string,
    lane: LaneProposal['lane'],
    d0: string,
    d1: string
  ): string | null {
    const r = runOf(keyOrRun);
    const k = `${slug}|${lane}`;
    const prev = r?.lanes.get(k)?.mine ?? acceptedOf(k, d0);
    if (mergeSource(d0, d1, prev).ok) return null;
    for (const other of runs.values()) {
      if (other === r) continue;
      const l = other.lanes.get(k);
      if (l && l.mine !== l.base) return other.runId;
    }
    return null;
  }

  function capture(slug: string, doc: string, p: LaneProposal): Promise<ProposalOutcome> {
    const r = ownerOf(slug, p.content, !!p.create);
    if (!r) {
      // #164 — unclaimed, inside a call's window (or behind a write parked there): parked
      if (parks(slug)) return park(slug, doc, p);
      return Promise.resolve({ status: 'rejected', code: 'not-staged' });
    }
    // #164 — claimed bytes landing on a lane with parked writes. F1 — only what THIS run's settle
    // claimed of its own call (`joinRun`) folds in: the parked pre → these post bytes are ONE write.
    // Everything else parked on the lane (a person's save, another run's) goes out as outside first.
    const lane = parked.filter((e) => e.slug === slug && e.p.lane === p.lane);
    const before = lane.filter((e) => e.joinRun === r.runId);
    sendOutside(
      slug,
      lane.filter((e) => e.joinRun !== r.runId)
    );
    unpark(before);
    const create = p.create ?? before.find((e) => e.p.create)?.p.create;
    const out = stageWrite(
      r,
      slug,
      doc,
      before.length
        ? { ...p, baseContent: before[0].p.baseContent, ...(create ? { create } : {}) }
        : p,
      before
    );
    // a created canvas's other parked lanes (of the same settle) follow it into the run
    const rest = parked.filter((e) => e.slug === slug && e.p.create && e.joinRun === r.runId);
    if (create && rest.length)
      for (const l of new Set(rest.map((e) => e.p.lane)))
        joinParked(
          r,
          rest.filter((e) => e.p.lane === l)
        );
    if (lane.length) {
      releasePrefix(slug);
      releaseDependents();
    }
    return out;
  }

  /**
   * Stage write `p` in run `r`. `joined` = parked writes it absorbs (#164): their transactions ride
   * with it and they get its outcome.
   */
  function stageWrite(
    r: RunStage,
    slug: string,
    doc: string,
    p: LaneProposal,
    joined: readonly Parked[] = []
  ): Promise<ProposalOutcome> {
    const k = `${slug}|${p.lane}`;
    const txs = [...joined.flatMap((e) => e.txs), p.transactionId];
    return new Promise<ProposalOutcome>((settle) => {
      const resolve = (o: ProposalOutcome) => {
        settle(o);
        for (const e of joined) e.resolve(o);
      };
      const existing = r.lanes.get(k);
      if (existing?.restored) {
        // The cold start after a restart: the disk carries the run's bytes
        // already. A v1 restore kept no bytes, so they come from this write; a
        // v2 one kept them, and the write only rides along to settle.
        if (existing.writes === 0) existing.mine = p.content;
        delete existing.restored;
        existing.txs.push(...txs);
        existing.resolvers.push(resolve);
        changed();
        return;
      }
      const prev = existing?.mine ?? acceptedOf(k, p.baseContent);
      const merged = mergeSource(p.baseContent, p.content, prev);
      if (!merged.ok) {
        const other = overlapWith(r.runId, slug, p.lane, p.baseContent, p.content);
        log.warn(
          `[sync/ai] ${r.label}: a write to ${slug} changes what ${other ? `run ${other}` : 'another run'} changed — refused (run-overlap).`
        );
        try {
          opts.onRefused?.({ slug, lane: p.lane, base: p.baseContent, content: p.content });
        } catch {
          /* the refusal stands whatever the rollback did */
        }
        resolve({ status: 'rejected', code: 'run-overlap' });
        return;
      }
      if (existing) {
        existing.mine = merged.merged;
        existing.writes += 1;
        existing.txs.push(...txs);
        existing.resolvers.push(resolve);
        if (p.writeId) existing.writeId = p.writeId;
        if (p.create) existing.create = p.create;
      } else {
        r.lanes.set(k, {
          slug,
          doc,
          lane: p.lane,
          base: acceptedOf(k, p.baseContent),
          mine: merged.merged,
          writes: 1,
          ...(p.writeId ? { writeId: p.writeId } : {}),
          ...(p.create ? { create: p.create } : {}),
          txs,
          resolvers: [resolve],
        });
      }
      // V2-1.5 §5.7 — the artboards this write changed join the run's `touched`.
      if (p.lane === 'html' && opts.attribute) {
        try {
          const hit = opts.attribute(slug, p.baseContent, p.content);
          if (hit?.artboards.length) {
            r.touched[hit.canvas] = [
              ...new Set([...(r.touched[hit.canvas] ?? []), ...hit.artboards]),
            ].sort();
          }
        } catch {
          /* attribution is bookkeeping: a failure never refuses the write */
        }
      }
      changed();
    });
  }

  /**
   * The runs a proposal waits behind: those that staged a transaction it depends on, and — through
   * a waiting edit it depends on (an edit on top of a waiting edit, the inverse ⌘Z queued) — the
   * runs THAT one waits behind, so the second never overtakes the first.
   */
  function runsHolding(dependsOn: string[] | undefined, seen = new Set<string>()): Set<string> {
    const out = new Set<string>();
    if (!dependsOn?.length) return out;
    for (const r of runs.values())
      for (const l of r.lanes.values())
        if (l.txs.some((t) => dependsOn.includes(t))) out.add(r.runId);
    // #164 — an edit made on top of parked bytes waits for them, as it waits behind staged ones
    if (parked.some((e) => e.txs.some((t) => dependsOn.includes(t)))) out.add(PARKED);
    for (const d of dependents) {
      const tx = d.edit?.transactionId;
      if (!tx || seen.has(tx) || !dependsOn.includes(tx)) continue;
      seen.add(tx);
      for (const id of runsHolding(d.dependsOn, seen)) out.add(id);
    }
    return out;
  }

  /** A non-staged proposal authored on top of a staged one waits behind the stage. */
  function holdsDependency(dependsOn: string[] | undefined): boolean {
    return runsHolding(dependsOn).size > 0;
  }

  function wait(dep: Dependent): void {
    dependents.push(dep);
  }

  const summaryOfEdit = ({ content: _c, baseContent: _b, ...rest }: WaitingEdit) => rest;

  /** S2.20c — the person's edits waiting behind a run (oldest first), optionally of one canvas. */
  function waiting(slug?: string): WaitingEditSummary[] {
    return dependents
      .map((d) => d.edit)
      .filter((e): e is WaitingEdit => !!e && (slug === undefined || e.slug === slug))
      .map(summaryOfEdit);
  }

  /** One waiting edit with its bytes (⌘Z on it computes the inverse), null once it went out. */
  function waitingEdit(transactionId: string): WaitingEdit | null {
    const e = dependents.find((d) => d.edit?.transactionId === transactionId)?.edit;
    return e ? { ...e } : null;
  }

  /** Rewrite a dependency on a staged proposal to the run that carried it. */
  function mapDeps(dependsOn: string[] | undefined): string[] | undefined {
    if (!dependsOn?.length) return dependsOn;
    return dependsOn.map((id) => alias.get(id) ?? id);
  }

  /** Dependents no run holds any more go out (behind the run that just went). */
  function releaseDependents(): void {
    for (let i = 0; i < dependents.length; ) {
      const d = dependents[i];
      if (runsHolding(d.dependsOn).size === 0) {
        dependents.splice(i, 1);
        d.send(mapDeps(d.dependsOn));
      } else i += 1;
    }
  }

  function laneOutcome(r: ProposalResult, l: StagedLane): ProposalOutcome {
    const mine = r.doc === l.doc && r.lane === l.lane;
    return {
      status: r.status,
      ...(r.code ? { code: r.code } : {}),
      ...(mine && typeof r.head === 'string' ? { head: r.head } : {}),
      ...(typeof r.actionId === 'string' ? { actionId: r.actionId } : {}),
    };
  }

  function forget(r: RunStage): void {
    runs.delete(r.runId);
    claims.delete(r.runId);
    for (const [k, v] of keyRun) if (v === r.runId) keyRun.delete(k);
  }

  /** Propose one run's stage as ONE action. */
  async function publishRun(
    r: RunStage,
    o: { partial?: boolean; fence?: RunFence } = {}
  ): Promise<ProposalResult | null> {
    const staged = [...r.lanes.values()].filter((l) => l.mine !== l.base || l.writes > 0);
    const deletes = [...(r.deletes ?? new Map<string, { slug: string; generation?: number }>())];
    // #164 — the run's end ends its calls' windows: what they still park goes out as outside,
    // right behind the run's own action (released below, once the run is proposed)
    const calls = detachRunCalls(r);
    if (staged.length === 0 && deletes.length === 0) {
      forget(r);
      changed();
      resolveKeys(calls);
      releaseDependents();
      return null;
    }
    const transactionId = opts.newTransactionId();
    for (const l of staged) for (const tx of l.txs) alias.set(tx, transactionId);
    // S12.16 — a canvas the run created is not in the store: ONE doc.create carries all of its
    // staged lanes (the same op the watcher sends for a create), so the new canvas and the run's
    // edits to it are one action.
    const created = new Map<string, { path: string; lanes: Record<string, string> }>();
    for (const l of staged) {
      if (!l.create) continue;
      const c = created.get(l.doc) ?? { path: l.create, lanes: {} };
      if (l.mine !== '') c.lanes[l.lane] = l.mine;
      created.set(l.doc, c);
    }
    const operations: Operation[] = [
      ...[...created].map(([doc, c]) => ({
        op: 'doc.create',
        doc,
        path: c.path,
        lanes: c.lanes,
      })),
      ...staged
        .filter((l) => !created.has(l.doc))
        .map((l) => ({
          op: 'lane.replace',
          doc: l.doc,
          lane: l.lane,
          content: l.mine,
          baseContent: l.base,
          ...(l.writeId ? { writeId: l.writeId } : {}),
        })),
      // F17 — the canvases the run trashed, after its edits (an edit to a doc it deleted was dropped)
      ...deletes.map(([doc, d]) => ({
        op: 'doc.delete',
        doc,
        ...(d.generation !== undefined ? { generation: d.generation } : {}),
      })),
    ];
    const madeAt = r.endedAt ?? now();
    const label = `${r.label}${o.partial ? STOPPED : ''}`;
    const origin: StageProposal['origin'] = {
      ...(r.runId !== 'v1-stage' && RUN_ID.test(r.runId) ? { runId: r.runId } : {}),
      ...(r.chatId ? { chatId: r.chatId } : {}),
      madeAt,
      ...(o.partial ? { partial: true as const } : {}),
    };
    // The run is closed before the answer: the dependents go out right behind
    // it (same ordered outbox).
    forget(r);
    changed();
    const sent = opts.propose({
      label,
      kind: 'ai',
      operations,
      transactionId,
      origin,
      ...(o.fence ? { fence: o.fence } : {}),
    });
    resolveKeys(calls);
    releaseDependents();
    const res = await sent.catch((err: unknown) => {
      const code = (err as { code?: string })?.code ?? 'retryable';
      return { protocol: 1, status: 'rejected', code, transactionId } as ProposalResult;
    });
    if (res.status !== 'accepted' && res.code === 'lease-fenced') {
      // V2-1.15 — the artboard changed hands while this Mac was away: the run
      // is HELD (the held card), never lost and never published over the grant.
      runs.set(r.runId, { ...r, state: 'held' });
      changed();
      log.warn(`[sync/ai] ${label}: the artboard was taken over meanwhile — kept, not published.`);
      return res;
    }
    for (const l of staged) for (const fn of l.resolvers) fn(laneOutcome(res, l));
    log.log(
      `[sync/ai] ${label}: ${staged.length + deletes.length} change(s) ${res.status === 'accepted' ? 'published as one action' : `refused (${res.code ?? 'rejected'})`}.`
    );
    return res;
  }

  /**
   * Keep: publish a held (or open) run as it stands. No id = every held run,
   * one action each (the v1 single-stage "Keep").
   */
  async function publish(
    keyOrRun?: string,
    o: { partial?: boolean; fence?: RunFence } = {}
  ): Promise<ProposalResult | null> {
    if (keyOrRun !== undefined) {
      const r = runOf(keyOrRun);
      return r ? publishRun(r, o) : null;
    }
    const held = [...runs.values()].filter((r) => r.state === 'held');
    const targets = held.length ? held : [...runs.values()];
    let last: ProposalResult | null = null;
    for (const r of targets) last = (await publishRun(r, o)) ?? last;
    return last;
  }

  /** End one run. `done` publishes, `stopped` publishes partial, `failed` holds. */
  async function end(
    keyOrRun: string,
    outcome: RunOutcome,
    o: { fence?: RunFence } = {}
  ): Promise<ProposalResult | null> {
    const r = runOf(keyOrRun);
    if (!r || r.state !== 'open') return null;
    r.endedAt = now();
    if (outcome === 'failed') {
      r.state = 'held';
      // #164 — a held run takes nothing more: its calls' parked writes go out as outside
      resolveKeys(detachRunCalls(r));
      changed();
      log.warn(
        `[sync/ai] ${r.label}: the run did not finish — ${r.lanes.size} change(s) kept on this device, not published.`
      );
      return null;
    }
    return publishRun(r, {
      partial: outcome === 'stopped',
      ...(o.fence ? { fence: o.fence } : {}),
    });
  }

  /** Throw a held run away (no id: every held run). Returns the canvases it covered. */
  function discard(keyOrRun?: string): number {
    const targets =
      keyOrRun !== undefined
        ? [runOf(keyOrRun)].filter((r): r is RunStage => !!r && r.state === 'held')
        : [...runs.values()].filter((r) => r.state === 'held');
    if (!targets.length) return 0;
    const slugs = new Set<string>();
    const gone = new Set(targets.map((r) => r.runId));
    const dropped = dependents.filter((d) =>
      [...runsHolding(d.dependsOn)].some((id) => gone.has(id))
    );
    for (const r of targets) {
      for (const l of r.lanes.values()) {
        slugs.add(l.slug);
        for (const fn of l.resolvers) fn({ status: 'rejected', code: 'discarded' });
      }
      forget(r);
    }
    for (const d of dropped) {
      dependents.splice(dependents.indexOf(d), 1);
      d.drop({ status: 'rejected', code: 'discarded' });
    }
    changed();
    releaseDependents();
    return slugs.size;
  }

  return {
    restore,
    begin,
    claim,
    claimDelete,
    unclaimDelete,
    stagesDelete,
    touch,
    end,
    publish,
    discard,
    captures,
    capture,
    settleShellCall,
    releaseShellCall,
    shellCall,
    /** #164 — the writes parked right now (no bytes), in arrival order. */
    parked: (): Array<{ slug: string; lane: LaneProposal['lane'] }> =>
      parked.map((e) => ({ slug: e.slug, lane: e.p.lane })),
    overlapWith,
    holdsDependency,
    wait,
    waiting,
    waitingEdit,
    mapDeps,
    summary,
    runs: (): RunStageSummary[] => [...runs.values()].map(runSummary),
    /** One run's summary (by its begin key or run id), null when no such run is staged. */
    summaryOf: (keyOrRun: string): RunStageSummary | null => {
      const r = runOf(keyOrRun);
      return r ? runSummary(r) : null;
    },
    /** One run's staged lanes (no resolvers) — the local home puts a discarded run's bytes back. */
    lanesOf: (
      keyOrRun: string
    ): Array<{
      slug: string;
      lane: LaneProposal['lane'];
      base: string;
      mine: string;
      create?: string;
    }> => {
      const r = runOf(keyOrRun);
      return r
        ? [...r.lanes.values()].map((l) => ({
            slug: l.slug,
            lane: l.lane,
            base: l.base,
            mine: l.mine,
            ...(l.create ? { create: l.create } : {}),
          }))
        : [];
    },
    /** S5.11b — a lane's accepted value under the staged runs (their base); null = none staged it. */
    accepted(slug: string, lane: LaneProposal['lane']): string | null {
      for (const r of runs.values()) {
        const l = r.lanes.get(`${slug}|${lane}`);
        if (l) return l.base;
      }
      return null;
    },
    /** Held wins over open; null when no run is staged. */
    get state(): StageState | null {
      if (runs.size === 0) return null;
      return [...runs.values()].some((r) => r.state === 'held') ? 'held' : 'open';
    },
  };
}

export type ActionStage = ReturnType<typeof createActionStage>;
