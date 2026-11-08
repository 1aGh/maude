// generation/spend.ts — the spend cap on paid media generation (Michal, 2026-11-08).
//
// Generation stays open to the AI, but it cannot run up a bill: every priced job is estimated before it is
// sent, counted against a per-run and a per-day cap for THIS project, and a single job above a threshold waits
// for the person's OK in the app. The three numbers are per-Mac settings (prefs.json `generateSpend`) with
// bounds; the defaults are $2 per run, $10 per day, confirm above $1.
//
//   - "run" = this project's server session (one open of the project tab). The day total is on disk, so a
//     restart or a rested tab cannot reset it.
//   - The estimate is conservative (a per-kind figure, higher for the known pro/video models), not the
//     provider's invoice: the cap exists to stop a runaway loop, not to account for cents.
//   - Counted at admission, given back if the job fails. Nothing here ever reads, logs or stores a key or a
//     prompt: the day ledger holds a date and an amount.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Modality } from './types.ts';

export interface SpendSettings {
  /** USD a project may spend in one run (this server session). */
  perRun: number;
  /** USD a project may spend in one local day. */
  perDay: number;
  /** A single job estimated above this waits for the person's OK. 0 = every priced job asks. */
  confirmOver: number;
}

export const SPEND_DEFAULTS: Readonly<SpendSettings> = Object.freeze({
  perRun: 2,
  perDay: 10,
  confirmOver: 1,
});

export const SPEND_BOUNDS: Readonly<Record<keyof SpendSettings, { min: number; max: number }>> =
  Object.freeze({
    perRun: { min: 0.1, max: 100 },
    perDay: { min: 0.1, max: 500 },
    confirmOver: { min: 0, max: 50 },
  });

const KEYS = Object.keys(SPEND_DEFAULTS) as Array<keyof SpendSettings>;

const inBounds = (k: keyof SpendSettings, v: unknown): v is number =>
  typeof v === 'number' &&
  Number.isFinite(v) &&
  v >= SPEND_BOUNDS[k].min &&
  v <= SPEND_BOUNDS[k].max;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The stored settings, each value kept only when it is in bounds (else its default). Never throws. */
export function readSpendSettings(raw: unknown): SpendSettings {
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...SPEND_DEFAULTS };
  for (const k of KEYS) if (inBounds(k, o[k])) out[k] = o[k] as number;
  return out;
}

/** A patch from Settings: known keys only, numbers inside the bounds. */
export function validateSpendSettings(
  raw: unknown
): { ok: true; value: Partial<SpendSettings> } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, error: 'generateSpend must be an object' };
  const o = raw as Record<string, unknown>;
  const value: Partial<SpendSettings> = {};
  for (const key of Object.keys(o)) {
    if (!KEYS.includes(key as keyof SpendSettings))
      return { ok: false, error: `generateSpend has an unknown key: ${key}` };
    const k = key as keyof SpendSettings;
    if (!inBounds(k, o[k]))
      return {
        ok: false,
        error: `generateSpend.${k} must be a number from ${SPEND_BOUNDS[k].min} to ${SPEND_BOUNDS[k].max}`,
      };
    value[k] = round2(o[k] as number);
  }
  return { ok: true, value };
}

// ── the estimate ─────────────────────────────────────────────────────────────────────────────────

/** A conservative USD figure per job. Higher than the list price on purpose (the `costNote`s say ~$0.04). */
const PER_KIND: Record<Modality, number> = {
  image: 0.1,
  audio: 0.25,
  video: 3.5,
  transcription: 0.1,
};
/** Models known to cost more than their kind's figure. */
const PER_MODEL: Record<string, number> = {
  'gemini-3-pro-image-preview': 0.3,
};
/** Providers that run on this Mac and cost nothing. */
const LOCAL_PROVIDERS = new Set(['whisper', 'local', 'gemma']);

export interface EstimateInput {
  modality: Modality | string;
  provider: string;
  model?: string;
}

/** The estimated USD for `n` jobs of this kind (cents). A local engine is 0. */
export function estimateJobCost(job: EstimateInput, n = 1): number {
  if (LOCAL_PROVIDERS.has(job.provider)) return 0;
  const unit =
    (job.model ? PER_MODEL[job.model] : undefined) ?? PER_KIND[job.modality as Modality] ?? 0.25;
  return round2(unit * Math.max(1, Math.floor(n)));
}

// ── the guard ────────────────────────────────────────────────────────────────────────────────────

export interface Approval {
  id: string;
  /** Plain words for the card: "a video from Google". */
  summary: string;
  estimate: number;
  at: number;
}

interface Pending extends Approval {
  key: string;
  approved: boolean;
}

export type Admit =
  | {
      ok: true;
      estimate: number /** give back all of it, or part (one failed take of n) */;
      refund(part?: number): void;
    }
  | {
      ok: false;
      status: 402 | 409;
      reason: 'run-cap' | 'day-cap' | 'needs-confirm';
      message: string;
      estimate: number;
      /** needs-confirm only: the id the person approves in the app. */
      approvalId?: string;
      cap?: number;
      spent?: number;
    };

export interface SpendGuardOptions {
  designRoot: string;
  settings(): SpendSettings;
  /** wall clock as a Date (the day boundary) — tests move it */
  now?(): Date;
  /** monotonic-ish ms (approval expiry) — tests move it */
  clock?(): number;
  /** a new approval is waiting: the app shows it (bus → WebSocket) */
  onApproval?(a: Approval): void;
}

const APPROVAL_TTL_MS = 10 * 60_000;
const money = (n: number) => `$${n.toFixed(2)}`;

export interface SpendGuard {
  /** Check the caps and the threshold; on success the estimate is counted until `refund()`. */
  admit(job: {
    /** identity of the request, so an approval only covers the job it was asked for */
    key: string;
    estimate: number;
    summary?: string;
    approvalId?: string;
    /** the caller already asked the person (the takes consent card): skip the threshold, never a cap */
    confirmed?: boolean;
  }): Admit;
  spent(): { run: number; day: number };
  pending(): Approval[];
  /** The person said yes in the app. */
  approve(id: string): boolean;
  /** The person said no in the app. */
  decline(id: string): boolean;
}

export function createSpendGuard(o: SpendGuardOptions): SpendGuard {
  const now = o.now ?? (() => new Date());
  const clock = o.clock ?? (() => Date.now());
  const ledgerPath = path.join(o.designRoot, '_state', 'generate-spend.json');
  let run = 0;
  const approvals = new Map<string, Pending>();

  const dayKey = () => {
    const d = now();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  function readDay(): number {
    try {
      const j = JSON.parse(readFileSync(ledgerPath, 'utf8')) as { day?: unknown; usd?: unknown };
      if (j.day === dayKey() && typeof j.usd === 'number' && Number.isFinite(j.usd) && j.usd >= 0)
        return j.usd;
    } catch {
      /* no ledger, a torn file, a stranger's JSON: the day starts at zero */
    }
    return 0;
  }

  function writeDay(usd: number): void {
    try {
      mkdirSync(path.dirname(ledgerPath), { recursive: true });
      const tmp = `${ledgerPath}.tmp-${process.pid}`;
      writeFileSync(tmp, `${JSON.stringify({ day: dayKey(), usd: round2(Math.max(0, usd)) })}\n`);
      renameSync(tmp, ledgerPath);
    } catch {
      /* the in-memory run total still holds; a read-only disk must not stop the person working */
    }
  }

  function sweep(): void {
    const t = clock();
    for (const [id, a] of approvals) if (t - a.at > APPROVAL_TTL_MS) approvals.delete(id);
  }

  const stop = (
    reason: 'run-cap' | 'day-cap',
    cap: number,
    spent: number,
    estimate: number
  ): Admit => {
    const when = reason === 'run-cap' ? 'in this session' : 'today';
    const name = reason === 'run-cap' ? 'per-session' : 'daily';
    return {
      ok: false,
      status: 402,
      reason,
      estimate,
      cap,
      spent,
      message: `Nothing was generated and nothing was charged. This would take generation spending ${when} to about ${money(spent + estimate)}, over the ${money(cap)} ${name} limit. Raise the limit in Settings › Advanced › Generation spend.`,
    };
  };

  return {
    admit(job) {
      sweep();
      const s = o.settings();
      const est = round2(Math.max(0, job.estimate));
      const day = readDay();
      if (est > 0) {
        if (day + est > s.perDay + 1e-9) return stop('day-cap', s.perDay, day, est);
        if (run + est > s.perRun + 1e-9) return stop('run-cap', s.perRun, run, est);
      }
      if (est > 0 && est > s.confirmOver + 1e-9 && !job.confirmed) {
        // the id the verb printed, or — asking the same job again after the person approved it — the approval
        // that job already has
        const given = job.approvalId
          ? approvals.get(job.approvalId)
          : [...approvals.values()].find((a) => a.approved && a.key === job.key);
        if (given && given.approved && given.key === job.key) {
          approvals.delete(given.id); // single use
        } else {
          let p = [...approvals.values()].find((a) => a.key === job.key && !a.approved);
          if (!p) {
            p = {
              id: `ok_${crypto.randomUUID().slice(0, 12)}`,
              key: job.key,
              summary: job.summary ?? 'a generation',
              estimate: est,
              at: clock(),
              approved: false,
            };
            approvals.set(p.id, p);
            o.onApproval?.({ id: p.id, summary: p.summary, estimate: p.estimate, at: p.at });
          }
          return {
            ok: false,
            status: 409,
            reason: 'needs-confirm',
            estimate: est,
            approvalId: p.id,
            message: `Needs your OK. ${p.summary[0].toUpperCase()}${p.summary.slice(1)} costs about ${money(est)}. Nothing was generated and nothing was charged. Approve it in Maude, then ask again.`,
          };
        }
      }
      run += est;
      writeDay(day + est);
      let left = est;
      return {
        ok: true,
        estimate: est,
        refund(part) {
          const back = Math.min(left, part === undefined ? left : Math.max(0, part));
          if (back <= 0) return;
          left = round2(left - back);
          run = Math.max(0, run - back);
          writeDay(readDay() - back);
        },
      };
    },
    spent: () => ({ run: round2(run), day: round2(readDay()) }),
    pending: () => {
      sweep();
      return [...approvals.values()]
        .filter((a) => !a.approved)
        .map(({ id, summary, estimate, at }) => ({ id, summary, estimate, at }));
    },
    approve(id) {
      sweep();
      const a = approvals.get(id);
      if (!a) return false;
      a.approved = true;
      return true;
    },
    decline(id) {
      return approvals.delete(id);
    },
  };
}
