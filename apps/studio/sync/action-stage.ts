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
}

const STOPPED = ' — stopped';
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
  const claims = new Map<string, { hashes: Set<string>; slugs: Set<string> }>();
  const dependents: Dependent[] = [];
  /** A staged transaction id → the run transaction that carried it. */
  const alias = new Map<string, string>();

  const runOf = (keyOrRun: string): RunStage | undefined =>
    runs.get(keyRun.get(keyOrRun) ?? keyOrRun);

  function runSummary(r: RunStage): RunStageSummary {
    const canvases = new Set<string>();
    for (const l of r.lanes.values()) canvases.add(l.slug);
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
      const keep = [...runs.values()].filter((r) => r.lanes.size > 0);
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
          if (lanes.size === 0) continue;
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
    meta: { runId?: string; chatId?: string; actor?: string } = {}
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
      return;
    }
    const chatId = originId(meta.chatId);
    runs.set(runId, {
      runId,
      ...(chatId ? { chatId } : {}),
      ...(meta.actor ? { actor: meta.actor } : {}),
      label: nextLabel.slice(0, 120) || 'AI edit',
      state: 'open',
      since: now(),
      lanes: new Map(),
      touched: {},
    });
    changed();
  }

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
    const covering = open.filter((r) => coversSlug(r, slug));
    // S12.16 — a NEW canvas joins a run only when a run said it wrote it. The lone-open-run
    // fallback below is right for a change to a canvas that exists (a tool wrote it); for a create
    // it would swallow a person's new canvas into whichever AI run happens to be open.
    if (explicit) return covering.length === 1 ? covering[0] : null;
    if (covering.length === 1) return covering[0];
    if (covering.length > 1) return null;
    if (open.length === 1) return open[0];
    if (open.length > 1) return null;
    // Nothing open: a held run that covers this canvas keeps its cold start.
    return all.find((r) => r.state === 'held' && coversSlug(r, slug)) ?? null;
  }

  /** Should this proposal be staged instead of sent? */
  function captures(slug: string, stageable: boolean, content?: string, explicit = false): boolean {
    if (!stageable || runs.size === 0) return false;
    return ownerOf(slug, content, explicit) !== null;
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
    if (!r) return Promise.resolve({ status: 'rejected', code: 'not-staged' });
    const k = `${slug}|${p.lane}`;
    return new Promise((resolve) => {
      const existing = r.lanes.get(k);
      if (existing?.restored) {
        // The cold start after a restart: the disk carries the run's bytes
        // already. A v1 restore kept no bytes, so they come from this write; a
        // v2 one kept them, and the write only rides along to settle.
        if (existing.writes === 0) existing.mine = p.content;
        delete existing.restored;
        existing.txs.push(p.transactionId);
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
        existing.txs.push(p.transactionId);
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
          txs: [p.transactionId],
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
    if (staged.length === 0) {
      forget(r);
      changed();
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
      `[sync/ai] ${label}: ${staged.length} change(s) ${res.status === 'accepted' ? 'published as one action' : `refused (${res.code ?? 'rejected'})`}.`
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
    touch,
    end,
    publish,
    discard,
    captures,
    capture,
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
