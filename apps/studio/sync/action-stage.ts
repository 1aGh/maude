// AI and multi-file action boundaries — plan T16 (DDR-241).
//
// An agent turn (the in-app chat) or a `/design:edit` run changes several
// files, one tool call at a time. Proposed as they land, the project would
// accept a canvas edited against a module the agent has not written yet, and
// an agent that fails half way would leave that half published. So while an
// AI action is OPEN, the file changes it makes are STAGED here instead of
// proposed: kept on disk, remembered with the value each was derived from,
// and proposed together — one transaction, one history action — when the
// action ends well.
//
// When it does not (the agent errors, is cancelled, stops at its token limit,
// or its heartbeat goes silent) the stage is HELD: nothing is published and
// nothing is thrown away. The person decides — publish it as it stands, or
// discard it (the accepted version returns; the candidate stays in the
// recovery slots). A held stage survives a restart (`_state/ai-stage.json`),
// so a crash can never turn into a partial publish by the next cold start.
//
// What is staged is only a WATCHER change (a tool writing a file). An edit the
// person makes in the UI is theirs and is proposed at once — unless it is made
// on top of a staged file, in which case it carries the agent's unpublished
// bytes and waits behind the stage (`dependents`), exactly as U2 waits on U1.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { LaneProposal, ProposalOutcome } from './projection.ts';
import type { Operation, ProposalResult } from './transaction-client.ts';

export type StageState = 'open' | 'held';

export interface StagedLane {
  slug: string;
  doc: string;
  lane: LaneProposal['lane'];
  /** The value the FIRST staged change was derived from — the group's base. */
  baseContent: string;
  /** The latest staged value. */
  content: string;
  writeId?: string;
  /** Every staged proposal's transaction id — aliased to the group's on commit. */
  txs: string[];
  resolvers: Array<(o: ProposalOutcome) => void>;
}

export interface StageSummary {
  state: StageState;
  label: string;
  canvases: string[];
  since: number;
}

interface Dependent {
  send: (dependsOn: string[] | undefined) => void;
  drop: (o: ProposalOutcome) => void;
  dependsOn: string[];
}

export interface ActionStageOptions {
  designRoot: string;
  /** Send one grouped action; resolves with the final result. */
  propose: (action: {
    label: string;
    kind: string;
    operations: Operation[];
    transactionId: string;
  }) => Promise<ProposalResult>;
  newTransactionId: () => string;
  onChange?: (summary: StageSummary | null) => void;
  log?: Pick<Console, 'log' | 'warn'>;
  now?: () => number;
}

export function createActionStage(opts: ActionStageOptions) {
  const log = opts.log ?? console;
  const now = opts.now ?? Date.now;
  const file = path.join(opts.designRoot, '_state', 'ai-stage.json');

  let state: StageState | null = null;
  let label = '';
  let since = 0;
  const keys = new Set<string>();
  let failed = false;
  const lanes = new Map<string, StagedLane>();
  const dependents: Dependent[] = [];
  /** A staged transaction id → the group transaction that carried it. */
  const alias = new Map<string, string>();
  /** Slugs a restored (held) stage covers — cold-start changes to them are staged. */
  const restoredSlugs = new Set<string>();
  /** Bases restored from disk after a restart: `${slug}|${lane}` → baseContent. */
  const restoredBases = new Map<string, string>();

  function summary(): StageSummary | null {
    if (!state) return null;
    const canvases = new Set<string>([...restoredSlugs]);
    for (const l of lanes.values()) canvases.add(l.slug);
    return { state, label, canvases: [...canvases].sort(), since };
  }

  function persist(): void {
    try {
      if (!state || (lanes.size === 0 && restoredSlugs.size === 0)) {
        rmSync(file, { force: true });
        return;
      }
      mkdirSync(path.dirname(file), { recursive: true });
      const body = {
        v: 1,
        state,
        label,
        since,
        lanes: [...lanes.values()].map((l) => ({
          slug: l.slug,
          doc: l.doc,
          lane: l.lane,
          baseContent: l.baseContent,
        })),
        restored: [...restoredBases.entries()].map(([k, baseContent]) => {
          const [slug, lane] = k.split('|');
          return { slug, lane, baseContent };
        }),
      };
      writeFileSync(`${file}.tmp`, JSON.stringify(body));
      renameSync(`${file}.tmp`, file);
    } catch (err) {
      log.warn(`[sync/ai] could not record the unfinished action: ${(err as Error).message}`);
    }
  }

  function changed(): void {
    persist();
    opts.onChange?.(summary());
  }

  /** A previous process left a stage: it comes back HELD. */
  function restore(): void {
    if (!existsSync(file)) return;
    try {
      const body = JSON.parse(readFileSync(file, 'utf8')) as {
        label?: string;
        since?: number;
        lanes?: { slug: string; lane: string; baseContent: string }[];
        restored?: { slug: string; lane: string; baseContent: string }[];
      };
      const all = [...(body.lanes ?? []), ...(body.restored ?? [])];
      if (all.length === 0) return;
      state = 'held';
      label = typeof body.label === 'string' ? body.label : 'AI edit';
      since = typeof body.since === 'number' ? body.since : now();
      for (const l of all) {
        restoredSlugs.add(l.slug);
        restoredBases.set(`${l.slug}|${l.lane}`, l.baseContent);
      }
      log.warn(
        `[sync/ai] an unfinished AI edit (${label}) to ${restoredSlugs.size} canvas(es) was kept from the last session — it is not published until you choose.`
      );
      opts.onChange?.(summary());
    } catch {
      /* unreadable → nothing to restore */
    }
  }

  function begin(key: string, nextLabel: string): void {
    keys.add(key);
    if (state === 'open') return;
    if (state === 'held') {
      // A new action on top of an unfinished one continues it: its files may
      // already carry the held bytes. It stays one decision for the person.
      state = 'open';
      failed = false;
      changed();
      return;
    }
    state = 'open';
    failed = false;
    label = nextLabel.slice(0, 120) || 'AI edit';
    since = now();
    changed();
  }

  /** Should this proposal be staged instead of sent? */
  function captures(slug: string, stageable: boolean): boolean {
    if (!stageable || !state) return false;
    return state === 'open' || restoredSlugs.has(slug) || [...lanes.values()].some((l) => l.slug === slug);
  }

  function capture(slug: string, doc: string, p: LaneProposal): Promise<ProposalOutcome> {
    const k = `${slug}|${p.lane}`;
    return new Promise((resolve) => {
      const existing = lanes.get(k);
      if (existing) {
        existing.content = p.content;
        existing.txs.push(p.transactionId);
        existing.resolvers.push(resolve);
        if (p.writeId) existing.writeId = p.writeId;
      } else {
        lanes.set(k, {
          slug,
          doc,
          lane: p.lane,
          baseContent: restoredBases.get(k) ?? p.baseContent,
          content: p.content,
          ...(p.writeId ? { writeId: p.writeId } : {}),
          txs: [p.transactionId],
          resolvers: [resolve],
        });
        changed();
      }
    });
  }

  function isStagedTx(id: string): boolean {
    for (const l of lanes.values()) if (l.txs.includes(id)) return true;
    return false;
  }

  /** A non-staged proposal authored on top of a staged one waits behind the stage. */
  function holdsDependency(dependsOn: string[] | undefined): boolean {
    return !!dependsOn?.some((id) => isStagedTx(id));
  }

  function wait(dep: Dependent): void {
    dependents.push(dep);
  }

  /** Rewrite a dependency on a staged proposal to the group that carried it. */
  function mapDeps(dependsOn: string[] | undefined): string[] | undefined {
    if (!dependsOn?.length) return dependsOn;
    return dependsOn.map((id) => alias.get(id) ?? id);
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

  function reset(): void {
    state = null;
    label = '';
    since = 0;
    keys.clear();
    failed = false;
    lanes.clear();
    restoredSlugs.clear();
    restoredBases.clear();
    changed();
  }

  /** Propose everything staged as ONE action. */
  async function publish(): Promise<ProposalResult | null> {
    if (!state) return null;
    const staged = [...lanes.values()];
    const waiting = dependents.splice(0);
    const groupLabel = label || 'AI edit';
    if (staged.length === 0) {
      reset();
      for (const d of waiting) d.send(mapDeps(d.dependsOn));
      return null;
    }
    const transactionId = opts.newTransactionId();
    for (const l of staged) for (const tx of l.txs) alias.set(tx, transactionId);
    const operations: Operation[] = staged.map((l) => ({
      op: 'lane.replace',
      doc: l.doc,
      lane: l.lane,
      content: l.content,
      baseContent: l.baseContent,
      ...(l.writeId ? { writeId: l.writeId } : {}),
    }));
    // The stage is closed before the answer: the next action starts clean,
    // and the dependents go out right behind the group (same ordered outbox).
    reset();
    const sent = opts.propose({ label: groupLabel, kind: 'ai', operations, transactionId });
    for (const d of waiting) d.send(mapDeps(d.dependsOn));
    const r = await sent.catch((err: unknown) => {
      const code = (err as { code?: string })?.code ?? 'retryable';
      return { protocol: 1, status: 'rejected', code, transactionId } as ProposalResult;
    });
    for (const l of staged) for (const fn of l.resolvers) fn(laneOutcome(r, l));
    log.log(
      `[sync/ai] ${groupLabel}: ${staged.length} change(s) ${r.status === 'accepted' ? 'published as one action' : `refused (${r.code ?? 'rejected'})`}.`
    );
    return r;
  }

  /** End one participant. The last `done` publishes; any failure holds. */
  async function end(key: string, outcome: 'done' | 'failed'): Promise<ProposalResult | null> {
    if (!keys.has(key)) return null;
    keys.delete(key);
    if (outcome === 'failed') failed = true;
    if (keys.size > 0 || state !== 'open') return null;
    if (failed) {
      state = 'held';
      changed();
      log.warn(
        `[sync/ai] ${label}: the action did not finish — ${lanes.size} change(s) kept on this device, not published.`
      );
      return null;
    }
    return publish();
  }

  /** Throw the held changes away: every lane returns to the accepted version. */
  function discard(): number {
    if (state !== 'held') return 0;
    const staged = [...lanes.values()];
    const waiting = dependents.splice(0);
    const slugs = new Set([...restoredSlugs, ...staged.map((l) => l.slug)]);
    reset();
    for (const l of staged) for (const fn of l.resolvers) fn({ status: 'rejected', code: 'discarded' });
    for (const d of waiting) d.drop({ status: 'rejected', code: 'discarded' });
    return slugs.size;
  }

  return {
    restore,
    begin,
    end,
    publish,
    discard,
    captures,
    capture,
    holdsDependency,
    wait,
    mapDeps,
    summary,
    get state() {
      return state;
    },
  };
}

export type ActionStage = ReturnType<typeof createActionStage>;
