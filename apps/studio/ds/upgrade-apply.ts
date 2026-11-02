// "Bring it up to the schema" — step 8, apply, and its one ⌘Z (V2-1.13 §5.10, S10.15a).
//
// Apply is ONE action. Its preconditions: the stage was proved (review.json), no system-file change
// was visible (`systemFailed`), and the live tree still hashes to the stage's `beforeTreeHash`. Then:
//   1. every codemodded canvas that passed the visual gate goes to the kernel as ONE proposal
//      (labelled "Brought <system> up to schema v1") — one Version-history entry, one ⌘Z;
//   2. only once the kernel accepted it, the system files (tokens CSS, tokens.json, config.json's
//      `schema: 1`) are written on Plane B, tmp + rename, and the action's record lands in
//      `_state/ds-upgrade/<ds>/applied/<actionId>.json` with both versions of each file;
//   3. the throwaway stage folder goes.
// The undo hook (S10.2's `registerUndoHook`, wired through `registerDsUndoHook`) runs after the
// kernel ACCEPTED an undo / redo of that action and puts the system files back (or forward) — the
// same decision as a publish (`v2-S10-undo-hook-across-planes`). It never writes over a later edit:
// a file that is no longer what the action left is a `skipped` row and nothing moves.
//
// A converted system (V2-1.6) never reaches here: stage refuses it (`ds-upgrade-converted`) —
// bring-up of a converted system is a publish with every follower ticked.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { UndoHook } from '../routes/project-undo.ts';
import { atomicWrite } from '../sync/atomic-write.ts';
import { type DsKernelPort, withLock } from './engine.ts';
import type { By } from './head.ts';
import type { Review } from './upgrade-prove.ts';
import {
  assertThrowaway,
  DsUpgradeError,
  readStage,
  STATE_REL,
  stateDirOf,
  systemOf,
  treeHash,
} from './upgrade-stage.ts';

export const APPLIED_FORMAT = 'maude.ds-upgrade-applied';
export const DS_UPGRADE_UNDO_HOOK = 'ds-upgrade';

export interface AppliedRecord {
  format: typeof APPLIED_FORMAT;
  v: 1;
  system: string;
  stamp: string;
  /** the apply action, then every undo / redo of it in order (odd length = applied) */
  chain: string[];
  files: { rel: string; before: string | null; after: string }[];
  at: number;
}

export interface ApplyResult {
  format: 'maude.ds-result';
  v: 1;
  action: 'upgrade';
  rev: null;
  actionId: string | null;
  system: string;
  updated: number;
  /** canvases the gate refused: they stay as they are ("N canvases can't be updated yet") */
  refused: number;
  schema: 1 | null;
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const readText = (abs: string) => {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
};

export interface ApplyInput {
  designRoot: string;
  ds: string;
  stamp: string;
  kernel: () => DsKernelPort | null;
  by: By;
  now?: () => number;
}

export function applyStage(inp: ApplyInput): Promise<ApplyResult> {
  const cfg = systemOf(inp.designRoot, inp.ds);
  return withLock(path.join(inp.designRoot, cfg.path), () => applyLocked(inp));
}

async function applyLocked(inp: ApplyInput): Promise<ApplyResult> {
  const now = inp.now ?? Date.now;
  const stage = readStage(inp.designRoot, inp.ds, inp.stamp);
  const stateDir = stateDirOf(inp.designRoot, inp.ds, inp.stamp);
  const reviewText = readText(path.join(stateDir, 'review.json'));
  if (!reviewText)
    throw new DsUpgradeError('ds-upgrade-not-proved', 'prove the stage before applying it');
  const review = JSON.parse(reviewText) as Review;
  if (review.systemFailed)
    throw new DsUpgradeError(
      'ds-upgrade-proof-failed',
      'a system-file change shows on the canvases — nothing can be applied',
      { refused: review.refused }
    );
  if (treeHash(inp.designRoot) !== stage.beforeTreeHash)
    throw new DsUpgradeError(
      'ds-upgrade-stale',
      'the project changed since this stage was made — stage it again'
    );
  const k = inp.kernel();
  if (!k)
    throw new DsUpgradeError(
      'ds-kernel-unavailable',
      'no project home answers right now — nothing was changed'
    );
  const pass = new Set(review.updatesCanvases.filter((c) => c.diff === 'pass').map((c) => c.path));
  const after = path.join(stage.dir, 'after', '.design');
  const files: { rel: string; text: string }[] = [];
  let updated = 0;
  for (const c of stage.canvases) {
    if (!pass.has(c.path)) continue;
    for (const rel of c.files) {
      const text = readText(path.join(after, rel));
      if (text === null) throw new DsUpgradeError('ds-upgrade-no-stage', `the stage lost ${rel}`);
      files.push({ rel, text });
    }
    updated++;
  }
  let actionId: string | null = null;
  if (files.length) {
    const label = `Brought ${stage.system} up to schema v1`.slice(0, 200);
    const out = await k.propose(files, { kind: 'edit', label });
    if (!out)
      throw new DsUpgradeError(
        'ds-kernel-unavailable',
        'no project home answers right now — nothing was changed'
      );
    if (out.status !== 'accepted')
      throw new DsUpgradeError(
        'ds-kernel-rejected',
        `the project refused the change (${out.code ?? 'rejected'})`,
        { kernel: out.code ?? null }
      );
    actionId = out.actionId ?? null;
  }
  // Plane B, after the kernel accepted: config.json (the schema flag) last
  const ordered = [...stage.systemFiles].sort(
    (a, b) => Number(a.rel === 'config.json') - Number(b.rel === 'config.json')
  );
  for (const f of ordered) atomicWrite(path.join(inp.designRoot, f.rel), f.after);
  const record: AppliedRecord = {
    format: APPLIED_FORMAT,
    v: 1,
    system: stage.system,
    stamp: stage.stamp,
    chain: actionId ? [actionId] : [],
    files: ordered,
    at: now(),
  };
  const appliedDir = path.join(inp.designRoot, STATE_REL, stage.system, 'applied');
  mkdirSync(appliedDir, { recursive: true });
  writeFileSync(
    path.join(
      appliedDir,
      `${actionId && ID_RE.test(actionId) ? actionId : `stage-${stage.stamp}`}.json`
    ),
    `${JSON.stringify(record, null, 2)}\n`
  );
  rmSync(assertThrowaway(stage.dir), { recursive: true, force: true });
  return {
    format: 'maude.ds-result',
    v: 1,
    action: 'upgrade',
    rev: null,
    actionId,
    system: stage.system,
    updated,
    refused: review.refused.length,
    schema: stage.conformantAfter ? 1 : null,
  };
}

/* ------------------------------------------------------------ the ⌘Z */

function records(designRoot: string): { abs: string; rec: AppliedRecord }[] {
  const base = path.join(designRoot, STATE_REL);
  const out: { abs: string; rec: AppliedRecord }[] = [];
  let systems: string[] = [];
  try {
    systems = readdirSync(base);
  } catch {
    return out;
  }
  for (const s of systems) {
    if (!NAME_RE.test(s)) continue;
    const dir = path.join(base, s, 'applied');
    let names: string[] = [];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith('.json'));
    } catch {
      continue;
    }
    for (const n of names) {
      try {
        const rec = JSON.parse(readFileSync(path.join(dir, n), 'utf8')) as AppliedRecord;
        if (rec.format === APPLIED_FORMAT && Array.isArray(rec.chain) && Array.isArray(rec.files))
          out.push({ abs: path.join(dir, n), rec });
      } catch {
        /* not ours */
      }
    }
  }
  return out;
}

/** Inside the design root, never runtime state of another kind, never a path that escapes. */
function safeAbs(designRoot: string, rel: unknown): string | null {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return null;
  const abs = path.resolve(designRoot, rel);
  return abs.startsWith(`${path.resolve(designRoot)}${path.sep}`) ? abs : null;
}

/** The hook: after an accepted undo (or redo) of an apply, the system files follow it. */
export function upgradeUndoHook(designRoot: string): UndoHook {
  return (e) => {
    const skipped: { doc?: string; reason: string }[] = [];
    for (const { abs, rec } of records(designRoot)) {
      const last = rec.chain.at(-1);
      if (!last || !e.undoes.includes(last)) continue;
      const applied = rec.chain.length % 2 === 1;
      // an undo takes an applied record back; a redo re-applies an undone one
      if (e.redo === applied) continue;
      const moves = rec.files.map((f) => ({
        abs: safeAbs(designRoot, f.rel),
        rel: f.rel,
        expect: applied ? f.after : f.before,
        target: applied ? f.before : f.after,
      }));
      const changed = moves.filter((m) => !m.abs || readText(m.abs as string) !== m.expect);
      if (changed.length) {
        for (const m of changed) skipped.push({ doc: m.rel, reason: 'ds-upgrade-changed' });
        continue;
      }
      for (const m of moves) {
        if (m.target === null) {
          if (existsSync(m.abs as string)) unlinkSync(m.abs as string);
        } else atomicWrite(m.abs as string, m.target);
      }
      rec.chain.push(e.actionId);
      writeFileSync(abs, `${JSON.stringify(rec, null, 2)}\n`);
    }
    return skipped.length ? { skipped } : undefined;
  };
}
