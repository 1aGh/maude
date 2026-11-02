// "Bring it up to the schema" — what a stage is doing, for the sheet (S10.15b, V2-1.13 §5.10).
//
// The proof runs wherever the agent runs it (`maude design ds-upgrade <ds> --prove`, a process of its
// own) or inside the studio (`POST /_api/ds/upgrade {step:'prove'}`); the sheet in the app only ever
// sees the stage's record folder, `_state/ds-upgrade/<ds>/<stamp>/`. So the two things the sheet needs
// travel as files in it, which works across processes:
//   progress.json   { phase, current, total, startedAt, updatedAt, pid } — written by the prover with a
//                   heartbeat, so a long canvas never reads as a dead run
//   cancel.json     the person pressed Cancel — the prover polls it and stops both studios and the shim
// `listStages` is the sheet's one read: every stage of the system that still has its throwaway copies,
// with the review when it has been proved and the progress while it is being proved.

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Review } from './upgrade-prove.ts';
import {
  DsUpgradeError,
  readStage,
  STATE_REL,
  type StageManifest,
  stateDirOf,
  treeHash,
} from './upgrade-stage.ts';

export const PROGRESS_FILE = 'progress.json';
export const CANCEL_FILE = 'cancel.json';
/** A prover writes its heartbeat every 2 s; a run silent for this long is not running. */
export const HEARTBEAT_STALE_MS = 15_000;

export interface ProveProgress {
  phase: 'booting' | 'rendering';
  current: number;
  total: number;
  startedAt: number;
  updatedAt: number;
  pid: number;
}

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

export function writeProgress(stateDir: string, p: ProveProgress): void {
  try {
    writeFileSync(join(stateDir, PROGRESS_FILE), `${JSON.stringify(p)}\n`);
  } catch {
    /* the stage was discarded under the prover: it finds out at its next step */
  }
}

export function clearProgress(stateDir: string): void {
  rmSync(join(stateDir, PROGRESS_FILE), { force: true });
}

/** The progress of a stage that is being proved right now, or null (no file, or a dead prover). */
export function readProgress(stateDir: string, now = Date.now()): ProveProgress | null {
  const p = readJson(join(stateDir, PROGRESS_FILE)) as ProveProgress | null;
  if (!p || typeof p !== 'object' || typeof p.updatedAt !== 'number') return null;
  return now - p.updatedAt <= HEARTBEAT_STALE_MS ? p : null;
}

export function requestCancel(stateDir: string, now = Date.now()): void {
  writeFileSync(join(stateDir, CANCEL_FILE), `${JSON.stringify({ at: now })}\n`);
}
export const cancelRequested = (stateDir: string): boolean =>
  existsSync(join(stateDir, CANCEL_FILE));
export const clearCancel = (stateDir: string): void =>
  rmSync(join(stateDir, CANCEL_FILE), { force: true });

/**
 * Cancel a stage: a prover in flight stops (and says `ds-upgrade-cancelled` to whoever asked it); the
 * stage itself is left for `discard`, which the sheet asks next.
 */
export async function cancelStage(
  designRoot: string,
  ds: string,
  stamp: string,
  { waitMs = 8000 }: { waitMs?: number } = {}
): Promise<{ cancelled: string; stopped: boolean }> {
  const stateDir = stateDirOf(designRoot, ds, stamp);
  readStage(designRoot, ds, stamp); // a stage that does not exist is 404
  // nothing is being proved → nothing to stop (the marker would cancel the NEXT prove)
  if (!readProgress(stateDir)) return { cancelled: stamp, stopped: false };
  requestCancel(stateDir);
  // answer once the prover has stopped both studios and the shim (it clears its progress last), so a
  // `discard` that follows never pulls the folder out from under a prover that has not seen the marker
  const t = Date.now();
  while (existsSync(join(stateDir, PROGRESS_FILE)) && Date.now() - t < waitMs)
    await new Promise((r) => setTimeout(r, 40));
  return { cancelled: stamp, stopped: !existsSync(join(stateDir, PROGRESS_FILE)) };
}

export type StagePhase = 'staged' | 'proving' | 'proved';

export interface StageView {
  stamp: string;
  createdAt: number;
  phase: StagePhase;
  /** canvases the plan rewrites */
  canvases: number;
  conformantAfter: boolean;
  progress: ProveProgress | null;
  review: Review | null;
  /** proved, but the project changed since: apply would refuse (`ds-upgrade-stale`) */
  stale: boolean;
}

/** Every stage of `ds` that still has its throwaway copies, newest first. */
export function listStages(designRoot: string, ds: string, now = Date.now()): StageView[] {
  const base = join(designRoot, STATE_REL, ds);
  let names: string[] = [];
  try {
    names = readdirSync(base);
  } catch {
    return [];
  }
  const out: StageView[] = [];
  let live: string | null = null;
  for (const stamp of names) {
    let stage: StageManifest;
    try {
      stage = readStage(designRoot, ds, stamp);
    } catch (e) {
      if (e instanceof DsUpgradeError) continue; // 'applied/', a half-written record, a foreign folder
      throw e;
    }
    if (!existsSync(stage.dir)) continue; // applied: its copies are gone, only the record remains
    const stateDir = stateDirOf(designRoot, ds, stamp);
    const r = readJson(join(stateDir, 'review.json')) as Review | null;
    const review = r && r.format === 'maude.ds-upgrade-review' && r.v === 1 ? r : null;
    const progress = readProgress(stateDir, now);
    let stale = false;
    if (review) {
      live ??= treeHash(designRoot);
      stale = live !== stage.beforeTreeHash;
    }
    out.push({
      stamp,
      createdAt: stage.createdAt,
      phase: progress ? 'proving' : review ? 'proved' : 'staged',
      canvases: stage.canvases.length,
      conformantAfter: stage.conformantAfter,
      progress,
      review,
      stale,
    });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
