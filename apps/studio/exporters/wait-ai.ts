// wait-ai.ts — S8.9: `spec.wait === 'ai'` (contract S8-export-spec.md §5.6).
//
// "Wait for AI" in the Export sheet's Version row: the job stays queued, its items `waiting`,
// until the AI run(s) holding the artboard(s) it exports have ended — then it runs ONCE. If the
// run ends without a finished version (cancelled, failed, interrupted, lease lost) the job dies
// with it: nothing is exported, and the reason says so. Without `wait`, an artboard under an AI
// run exports its last finished version, because an AI run's edits are staged (V2-1.5) and never
// reach the file until its turn ends — so there is nothing to refuse and nothing to special-case.
//
// Everything here is read-only over the run registry (`ai/runs.ts`): `live()` finds the holders at
// submit, `get(id)` reads each holder's outcome, and the `ai:runs {seq}` bus event (emitted on
// every registry change) says when to look. A slow poll backs the event up — a lost event must
// never leave a job waiting for a run that ended.

import { isLive, type RunRecord } from '../ai/run-lifecycle.ts';
import type { Bus } from '../context.ts';

/** The slice of the run registry this reads. */
export interface AiRunReader {
  live(): RunRecord[];
  get(runId: string): RunRecord | null;
}

/** What a unit exports: a canvas (designRoot-relative) and the artboards of it (`[]` = the whole canvas). */
export interface AiWaitTarget {
  canvas: string;
  artboards: readonly string[];
}

/** Only a run that finished its turn left a finished version; a stopped one left half of one. */
const FINISHED_OUTCOMES: ReadonlySet<string> = new Set(['done']);

export const WAIT_REASON = 'Waits for AI to finish';
export const DIED_MESSAGE = 'AI stopped before finishing, so nothing was exported.';

/** Unit → targets. A unit not tied to a canvas (a project zip) is not artboard-bound: no target. */
export function targetsOf(
  units: ReadonlyArray<{ canvas: string | null; artboards: ReadonlyArray<{ id: string }> }>
): AiWaitTarget[] {
  const out = new Map<string, Set<string> | '*'>();
  for (const u of units) {
    if (!u.canvas) continue;
    const have = out.get(u.canvas);
    if (have === '*') continue;
    if (u.artboards.length === 0) {
      out.set(u.canvas, '*');
      continue;
    }
    const set = have ?? new Set<string>();
    for (const b of u.artboards) set.add(b.id);
    out.set(u.canvas, set);
  }
  return [...out].map(([canvas, ids]) => ({
    canvas,
    artboards: ids === '*' ? [] : [...ids],
  }));
}

/** A lease key's canvas is the kernel entry or `path:<designRel>/<canvas>`; the run scope has the plain rel. */
function sameCanvas(keyCanvas: string, rel: string): boolean {
  const k = keyCanvas.startsWith('path:') ? keyCanvas.slice(5) : keyCanvas;
  return k === rel || k.endsWith(`/${rel}`);
}

/** Does this run HOLD (not merely queue for) one of the targets? */
export function holdsTarget(rec: RunRecord, targets: readonly AiWaitTarget[]): boolean {
  if (!isLive(rec) || rec.state === 'waiting') return false;
  return rec.leases.some((l) =>
    targets.some(
      (t) =>
        sameCanvas(l.canvas, t.canvas) &&
        (t.artboards.length === 0 || t.artboards.includes(l.artboard))
    )
  );
}

export function liveHolders(reader: AiRunReader, targets: readonly AiWaitTarget[]): RunRecord[] {
  if (targets.length === 0) return [];
  return reader.live().filter((r) => holdsTarget(r, targets));
}

export type AiWaitResult = { ok: true; runs: string[] } | { ok: false; message: string };

export interface AiWaitOptions {
  bus: Pick<Bus, 'on'>;
  reader: AiRunReader;
  targets: readonly AiWaitTarget[];
  /** the job was cancelled / the studio is closing: stop waiting */
  signal?: AbortSignal;
  /** safety net behind the bus event (ms) */
  pollMs?: number;
  /** called once with the holders found at submit (so the job can say who it waits for) */
  onHolders?: (runIds: string[]) => void;
}

/**
 * Resolves once every run holding the targets at call time has ended with a finished version
 * (`ok`), or the first one that did not (`!ok`). Settles exactly once. No holders → resolves `ok`
 * at once: the artboard is already at its last finished version.
 */
export function waitForAi(opts: AiWaitOptions): Promise<AiWaitResult> {
  const holders = liveHolders(opts.reader, opts.targets).map((r) => r.runId);
  opts.onHolders?.(holders);
  if (holders.length === 0) return Promise.resolve({ ok: true, runs: [] });
  return new Promise<AiWaitResult>((resolve) => {
    const pending = new Set(holders);
    let settled = false;
    let off: (() => void) | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const settle = (res: AiWaitResult) => {
      if (settled) return;
      settled = true;
      off?.();
      if (timer) clearInterval(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(res);
    };
    const onAbort = () => settle({ ok: false, message: DIED_MESSAGE });

    const check = () => {
      if (settled) return;
      for (const id of [...pending]) {
        const rec = opts.reader.get(id);
        // pruned = gone without a trace: not a finished version
        if (!rec) return settle({ ok: false, message: DIED_MESSAGE });
        if (isLive(rec)) continue;
        if (rec.outcome && FINISHED_OUTCOMES.has(rec.outcome)) pending.delete(id);
        else return settle({ ok: false, message: DIED_MESSAGE });
      }
      if (pending.size === 0) settle({ ok: true, runs: holders });
    };

    if (opts.signal?.aborted) return onAbort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    off = opts.bus.on('ai:runs', check);
    timer = setInterval(check, opts.pollMs ?? 5_000);
    (timer as { unref?: () => void }).unref?.();
    // a holder may have ended between the snapshot above and the subscription
    check();
  });
}

/** The structural slice of an ExportJob this touches (avoids a cycle with jobs.ts). */
interface WaitableJob {
  status: string;
  items?: Array<{ status: string; reason?: string }>;
}

/**
 * The job-queue half: for a `wait:'ai'` group, mark the job's items `waiting`, hold until the AI
 * run ends, then restore them to `queued`. Returns `null` when the job should run, else the
 * message it dies with. `emit` pushes the job's state to the owner's shell.
 */
export async function holdJobForAi(
  job: WaitableJob,
  group: { spec: { wait?: 'ai' }; units: Parameters<typeof targetsOf>[0] } | undefined,
  deps: { bus: Pick<Bus, 'on'>; reader: AiRunReader | null; emit: () => void; signal?: AbortSignal }
): Promise<string | null> {
  if (group?.spec.wait !== 'ai' || !deps.reader) return null;
  let waiting = false;
  const res = await waitForAi({
    bus: deps.bus,
    reader: deps.reader,
    targets: targetsOf(group.units),
    signal: deps.signal,
    onHolders: (ids) => {
      if (ids.length === 0) return;
      waiting = true;
      for (const it of job.items ?? []) {
        it.status = 'waiting';
        it.reason = WAIT_REASON;
      }
      deps.emit();
    },
  });
  if (!res.ok) {
    for (const it of job.items ?? []) {
      it.status = 'failed';
      it.reason = res.message;
    }
    return res.message;
  }
  if (waiting) {
    for (const it of job.items ?? []) {
      it.status = 'queued';
      delete it.reason;
    }
    deps.emit();
  }
  return null;
}
