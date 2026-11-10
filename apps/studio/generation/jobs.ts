// generation/jobs.ts — the background AI-media generation job queue (DDR-16x).
//
// Modelled on exporters/jobs.ts: `enqueue()` returns immediately with a job id +
// a Promise, the job progresses queued → running → done|failed in the
// background, and `bus.emit('generate:job', job)` fires on every transition so
// ws.ts can push a live snapshot to the notification center (reusing the
// export-center chrome). Concurrency is capped by the same hand-rolled counting
// semaphore (no new dependency).
//
// Unlike exports there is NO per-job byte store — a generation's output is a set
// of `assets/<sha8>.<ext>` rel paths that already live in the durable,
// content-addressed asset store (the job just records the paths). The only
// on-disk state is a small `_generate-history.json` ledger (DDR-115 runtime
// state — registered in all three ignore lists) so the notification center
// survives a restart. Job records themselves are in-memory only.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Bus } from '../context.ts';
import type { Modality } from './types.ts';

export type GenerationJobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface GenerationJob {
  id: string;
  provider: string;
  modality: Modality;
  model?: string;
  status: GenerationJobStatus;
  progress?: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** `assets/<sha8>.<ext>` rel paths produced by this job. */
  assets?: string[];
  usage?: { cost?: number; ms?: number };
  error?: string;
}

/** The one job's work — submit → result → localize each asset. Given the abort
 *  signal so a timed-out/cancelled job tears down its provider request. */
export type GenerationRun = (
  signal: AbortSignal
) => Promise<{ assets: string[]; usage?: { cost?: number; ms?: number } }>;

export interface EnqueueGenArgs {
  provider: string;
  modality: Modality;
  model?: string;
  run: GenerationRun;
}

export interface GenerationHistoryEntry {
  id: string;
  provider: string;
  modality: string;
  model?: string;
  status: 'done' | 'failed';
  assets?: string[];
  at: string;
  error?: string;
}

export interface GenerationJobQueue {
  enqueue(args: EnqueueGenArgs): { id: string; result: Promise<GenerationJob> };
  get(id: string): GenerationJob | undefined;
  list(): GenerationJob[];
  loadHistory(): GenerationHistoryEntry[];
}

const HISTORY_DEPTH = 20;
const MAX_JOB_AGE_MS = 24 * 60 * 60 * 1000;
// Generation spans sync image (seconds) → async video (minutes). Size generously
// but bound it so a wedged provider request can't hold a slot forever.
const DEFAULT_JOB_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.MAUDE_GENERATE_TIMEOUT_MS) || 10 * 60 * 1000
);

export class GenerationQueueFullError extends Error {
  constructor() {
    super('generation queue is full — too many pending jobs, try again shortly');
    this.name = 'GenerationQueueFullError';
  }
}

/** Small counting semaphore — mirrors exporters/jobs.ts's Semaphore. */
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      const next = this.waiters.shift();
      if (next) next();
    };
  }
}

function isFinished(job: GenerationJob): boolean {
  return job.status === 'done' || job.status === 'failed';
}

export function createGenerationJobQueue(bus: Bus, designRoot: string): GenerationJobQueue {
  const historyPath = path.join(designRoot, '_generate-history.json');
  const maxConcurrent = Math.max(1, Number(process.env.MAUDE_GENERATE_MAX_CONCURRENT) || 2);
  // Bound queued+running jobs — a flood of POSTs must not grow the Map unbounded
  // (the backpressure the background export queue added). Read per-instance so
  // it's env-overridable at construction (mirrors maxConcurrent).
  const maxPending = Math.max(1, Number(process.env.MAUDE_GENERATE_MAX_QUEUED) || 12);
  const semaphore = new Semaphore(maxConcurrent);
  const jobs = new Map<string, GenerationJob>();

  // Seed the ledger from disk ONCE (the only read). Every later persist derives
  // fresh from `jobs` and overwrites — no read-modify-write, so concurrent
  // completions can't drop entries.
  try {
    const parsed = JSON.parse(readFileSync(historyPath, 'utf8')) as unknown;
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        const id = typeof e.id === 'string' && e.id ? e.id : crypto.randomUUID();
        jobs.set(id, {
          id,
          provider: String(e.provider ?? ''),
          modality: (e.modality as Modality) ?? 'image',
          model: e.model as string | undefined,
          status: e.status === 'failed' ? 'failed' : 'done',
          createdAt: (e.at as string) ?? new Date().toISOString(),
          finishedAt: e.at as string | undefined,
          assets: Array.isArray(e.assets) ? (e.assets as string[]) : undefined,
          error: e.error as string | undefined,
        });
      }
    }
  } catch {
    /* no ledger yet — start empty */
  }

  function emit(job: GenerationJob): void {
    bus.emit('generate:job', { ...job });
  }

  function deriveHistory(): GenerationHistoryEntry[] {
    return Array.from(jobs.values())
      .filter(isFinished)
      .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))
      .slice(0, HISTORY_DEPTH)
      .map((j) => ({
        id: j.id,
        provider: j.provider,
        modality: j.modality,
        model: j.model,
        status: j.status as 'done' | 'failed',
        assets: j.assets,
        at: j.finishedAt ?? j.createdAt,
        error: j.error,
      }));
  }

  async function persistAndEvict(): Promise<void> {
    await Bun.write(historyPath, JSON.stringify(deriveHistory(), null, 2));
    const finished = Array.from(jobs.values())
      .filter(isFinished)
      .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));
    const now = Date.now();
    for (const [i, job] of finished.entries()) {
      const finishedAt = job.finishedAt ? Date.parse(job.finishedAt) : Number.NaN;
      const aged = Number.isFinite(finishedAt) && now - finishedAt > MAX_JOB_AGE_MS;
      if (i >= HISTORY_DEPTH || aged) jobs.delete(job.id);
    }
  }

  function enqueue(args: EnqueueGenArgs): { id: string; result: Promise<GenerationJob> } {
    let pending = 0;
    for (const job of jobs.values()) {
      if (job.status === 'queued' || job.status === 'running') pending += 1;
    }
    if (pending >= maxPending) throw new GenerationQueueFullError();

    const id = `gen_${crypto.randomUUID()}`;
    const job: GenerationJob = {
      id,
      provider: args.provider,
      modality: args.modality,
      model: args.model,
      status: 'queued',
      createdAt: new Date().toISOString(),
    };
    jobs.set(id, job);
    emit(job);

    const controller = new AbortController();
    const result = (async (): Promise<GenerationJob> => {
      const release = await semaphore.acquire();
      const timer = setTimeout(() => controller.abort(), DEFAULT_JOB_TIMEOUT_MS);
      try {
        job.status = 'running';
        job.startedAt = new Date().toISOString();
        emit(job);

        const out = await args.run(controller.signal);

        job.status = 'done';
        job.finishedAt = new Date().toISOString();
        job.assets = out.assets;
        job.usage = out.usage;
        emit(job);
        await persistAndEvict();
        return job;
      } catch (err) {
        job.status = 'failed';
        job.finishedAt = new Date().toISOString();
        job.error = err instanceof Error ? err.message : String(err);
        emit(job);
        await persistAndEvict();
        throw err;
      } finally {
        clearTimeout(timer);
        release();
      }
    })();
    // #220 — the failure is on the job record (status, error, the generate:job push), so a caller
    // that drops `result` — POST /_api/generate-jobs answers 202 and never awaits it — must not leave
    // a rejection nobody handles: the server has no unhandledRejection handler and Bun would end the
    // whole project server (exit 1) on every failed generation. This marks it handled; a caller that
    // awaits `result` still gets the rejection.
    result.catch(() => {});

    return { id, result };
  }

  return {
    enqueue,
    get: (id) => jobs.get(id),
    list: () => Array.from(jobs.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    loadHistory: deriveHistory,
  };
}
