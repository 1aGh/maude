// generation/takes.ts — Generate with N takes (S8.16; 12 · ia-gen-ask, ia-gen-placed).
//
// One ask makes N takes (default 4) as N parallel jobs on the generation queue (jobs.ts), in the
// artboard's shape. When they are in, every take gets its provenance sidecar
// `assets/<sha8>.gen.json` (`maude.gen` v1, gen-sidecar.ts — one file per take, every take of the
// group carries the same `group` and `takes`), and the first good take is the best one: the client
// places it in the frame, selected. ← → then swaps the neighbouring take in as an `image.replace`
// (one src rewrite = one undo step); `neighbourTake` says which.
//
// Nothing is sent before the consent line: the route issues a QUOTE (how long, whose account pays,
// the licence line) and the run must hand that quote back for the same provider, model, count,
// shape and target. A quote is single-use and lives ten minutes. No quote → no job → no egress.
//
// Pure apart from the injected queue + sidecar writer, so the tests run it with a fake provider.

import {
  GEN_FORMAT,
  GEN_TAKES_MAX,
  GEN_VERSION,
  type GenSidecar,
  validateGen,
} from './gen-sidecar.ts';
import type { ProviderDescriptor } from './types.ts';

export const TAKES_DEFAULT = 4;
export const TAKES_MAX = GEN_TAKES_MAX;
export const QUOTE_TTL_MS = 10 * 60 * 1000;
/** A take of one image when the history has none to go by. */
export const DEFAULT_TAKE_SECONDS = 30;

/** The ratios a provider is asked for when its model lists none. */
export const COMMON_RATIOS: readonly string[] = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
];

const RATIO_RE = /^(\d{1,3}):(\d{1,3})$/;
const SHA8_OF = /^assets\/([0-9a-f]{8})\.[A-Za-z0-9]{1,8}$/;

/** The ratio in `supported` nearest the artboard's `w`×`h` (log distance, so 4:5 ↔ 5:4 are far apart). */
export function aspectFor(
  w: number,
  h: number,
  supported: readonly string[] = COMMON_RATIOS
): string {
  const list = supported.filter((r) => RATIO_RE.test(r));
  const pool = list.length > 0 ? list : COMMON_RATIOS;
  if (!(w > 0) || !(h > 0)) return pool.includes('1:1') ? '1:1' : (pool[0] as string);
  const want = Math.log(w / h);
  let best = pool[0] as string;
  let gap = Number.POSITIVE_INFINITY;
  for (const r of pool) {
    const m = RATIO_RE.exec(r) as RegExpExecArray;
    const d = Math.abs(Math.log(Number(m[1]) / Number(m[2])) - want);
    if (d < gap) {
      gap = d;
      best = r;
    }
  }
  return best;
}

/** The sha8 of a content-addressed `assets/<sha8>.<ext>` path, or null. */
export function sha8Of(rel: string): string | null {
  return SHA8_OF.exec(rel)?.[1] ?? null;
}

const seconds = (s: number) =>
  s < 60 ? `${Math.max(1, Math.round(s))} s` : `${Math.round(s / 60)} min`;

export interface ConsentLines {
  /** "About 30 s · billed to your Google key" — or "· nothing is billed" for a local runtime */
  time: string;
  /** the provider's one licence line, or null (then no line is shown) */
  licence: string | null;
}

/** The two lines shown before anything is sent (ia-gen-ask). */
export function consentLines(d: ProviderDescriptor, estimateSeconds: number): ConsentLines {
  const payer = d.payer ? `billed to ${d.payer}` : 'nothing is billed';
  return {
    time: `About ${seconds(estimateSeconds)} · ${payer}`,
    licence: d.licence?.trim() ? d.licence.trim() : null,
  };
}

/**
 * How long N parallel takes take: one take's time (the median of this provider + model's last
 * finished jobs, else DEFAULT_TAKE_SECONDS) times the rounds the queue's concurrency needs.
 */
export function estimateSeconds(
  past: ReadonlyArray<{ ms: number }>,
  n: number,
  concurrency: number
): number {
  const ms = past
    .map((p) => p.ms)
    .filter((x) => Number.isFinite(x) && x > 0)
    .sort((a, b) => a - b);
  const one =
    ms.length > 0 ? (ms[Math.floor(ms.length / 2)] as number) / 1000 : DEFAULT_TAKE_SECONDS;
  return one * Math.ceil(Math.max(1, n) / Math.max(1, concurrency));
}

// ── quotes: no egress without the consent line ─────────────────────────────────────────────────

export interface QuoteParams {
  provider: string;
  model: string;
  n: number;
  aspect: string;
  canvas: string;
  artboard: string;
}

const quoteKey = (p: QuoteParams) =>
  [p.provider, p.model, p.n, p.aspect, p.canvas, p.artboard].join('\u0000');

export interface Quotes {
  issue(p: QuoteParams): string;
  /** Use a quote up: true only once, only for the very parameters it was issued for, only in time. */
  redeem(id: unknown, p: QuoteParams): boolean;
}

export function createQuotes(o: { now?: () => number; ttlMs?: number } = {}): Quotes {
  const now = o.now ?? Date.now;
  const ttl = o.ttlMs ?? QUOTE_TTL_MS;
  const live = new Map<string, { key: string; until: number }>();
  const sweep = () => {
    const t = now();
    for (const [id, q] of live) if (q.until <= t) live.delete(id);
  };
  return {
    issue(p) {
      sweep();
      const id = `q_${crypto.randomUUID().replace(/-/g, '')}`;
      live.set(id, { key: quoteKey(p), until: now() + ttl });
      return id;
    },
    redeem(id, p) {
      sweep();
      if (typeof id !== 'string') return false;
      const q = live.get(id);
      if (!q) return false;
      live.delete(id);
      return q.key === quoteKey(p);
    },
  };
}

// ── a group of takes ────────────────────────────────────────────────────────────────────────────

export type TakeGroupStatus = 'running' | 'done' | 'failed';

export interface TakeGroup {
  group: string;
  status: TakeGroupStatus;
  n: number;
  /** jobs finished either way */
  finished: number;
  failed: number;
  /** the good takes, `assets/<sha8>.<ext>`, in generation order (repeats dropped) */
  takes: string[];
  /** the take that goes in the frame — the first good one; null until done */
  best: string | null;
  jobIds: string[];
  target: { canvas: string; artboard: string };
  provider: string;
  model: string;
  aspect: string;
  at: string;
  error?: string;
}

/** What one job does: submit take #`take` and land it; resolves to its `assets/<sha8>.<ext>` paths. */
export type TakeRun = (take: number, signal: AbortSignal) => Promise<{ assets: string[] }>;

export interface TakeGroupsDeps {
  /** generation/jobs.ts `enqueue` (throws GenerationQueueFullError when full) */
  enqueue(a: {
    provider: string;
    modality: 'image';
    model?: string;
    run: (signal: AbortSignal) => Promise<{ assets: string[] }>;
  }): { id: string; result: Promise<unknown> };
  /** write `assets/<sha8>.gen.json` (designRoot-relative path, the file's text) */
  writeSidecar(rel: string, text: string): Promise<void>;
  /** a group changed (the studio's bus) */
  emit?(g: TakeGroup): void;
  now?: () => Date;
}

export interface StartTakes {
  prompt: string;
  provider: string;
  model: string;
  n: number;
  aspect: string;
  target: { canvas: string; artboard: string };
  licence?: string | null;
  /** the asker's display name (never an e-mail) */
  by?: string | null;
  run: TakeRun;
}

const MAX_GROUPS = 50;

export interface TakeGroups {
  start(s: StartTakes): TakeGroup;
  get(group: string): TakeGroup | undefined;
  /** resolves when the group is done or failed (tests, the CLI) */
  settled(group: string): Promise<TakeGroup | undefined>;
}

/** The sidecar text of one take. Validated before it is written; never more than the reader takes. */
export function sidecarFor(
  s: Pick<StartTakes, 'prompt' | 'provider' | 'model' | 'licence' | 'by'>,
  group: string,
  takes: readonly string[],
  at: string
): GenSidecar {
  const doc: GenSidecar = {
    format: GEN_FORMAT,
    v: GEN_VERSION,
    prompt: s.prompt,
    provider: s.provider,
    model: s.model,
    at,
    group,
    takes: [...takes],
  };
  if (s.licence) doc.licence = s.licence;
  if (s.by && !s.by.includes('@')) doc.by = s.by;
  return doc;
}

export function createTakeGroups(deps: TakeGroupsDeps): TakeGroups {
  const groups = new Map<string, TakeGroup>();
  const done = new Map<string, Promise<TakeGroup>>();
  const now = deps.now ?? (() => new Date());
  const emit = (g: TakeGroup) => deps.emit?.({ ...g, takes: [...g.takes], jobIds: [...g.jobIds] });

  function evict(): void {
    if (groups.size <= MAX_GROUPS) return;
    for (const [id, g] of groups) {
      if (groups.size <= MAX_GROUPS) break;
      if (g.status !== 'running') {
        groups.delete(id);
        done.delete(id);
      }
    }
  }

  function start(s: StartTakes): TakeGroup {
    const n = Math.min(TAKES_MAX, Math.max(1, Math.floor(s.n)));
    const group = `g_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const at = now()
      .toISOString()
      .replace(/\.\d+Z$/, 'Z');
    const g: TakeGroup = {
      group,
      status: 'running',
      n,
      finished: 0,
      failed: 0,
      takes: [],
      best: null,
      jobIds: [],
      target: { ...s.target },
      provider: s.provider,
      model: s.model,
      aspect: s.aspect,
      at,
    };
    const results: Array<Promise<string | null>> = [];
    try {
      for (let take = 0; take < n; take++) {
        const job = deps.enqueue({
          provider: s.provider,
          modality: 'image',
          model: s.model,
          run: (signal) => s.run(take, signal),
        });
        g.jobIds.push(job.id);
        results.push(
          job.result
            .then(
              (j) => {
                const assets = (j as { assets?: unknown }).assets;
                const first = Array.isArray(assets)
                  ? assets.find((a) => typeof a === 'string')
                  : null;
                return typeof first === 'string' && sha8Of(first) ? first : null;
              },
              () => null
            )
            .finally(() => {
              g.finished += 1;
              emit(g);
            })
        );
      }
    } catch (err) {
      // the queue is full part-way: the takes already queued still run; none if it was the first
      if (g.jobIds.length === 0) throw err;
    }
    g.n = g.jobIds.length;
    groups.set(group, g);
    evict();
    emit(g);

    const settled = (async (): Promise<TakeGroup> => {
      const outs = await Promise.all(results);
      const seen = new Set<string>();
      for (const rel of outs) {
        if (!rel) continue;
        const sha = sha8Of(rel) as string;
        if (seen.has(sha)) continue;
        seen.add(sha);
        g.takes.push(rel);
      }
      g.failed = outs.filter((x) => !x).length;
      if (g.takes.length === 0) {
        g.status = 'failed';
        g.error = 'No take came back. Try again.';
        emit(g);
        return g;
      }
      const shas = g.takes.map((t) => sha8Of(t) as string);
      for (const sha of shas) {
        const doc = sidecarFor(s, group, shas, at);
        if (!validateGen(doc, { self: sha }).ok) continue;
        try {
          await deps.writeSidecar(`assets/${sha}.gen.json`, `${JSON.stringify(doc, null, 2)}\n`);
        } catch {
          /* provenance only — the picture itself already landed */
        }
      }
      g.best = g.takes[0] as string;
      g.status = 'done';
      emit(g);
      return g;
    })();
    done.set(group, settled);
    return g;
  }

  return {
    start,
    get: (id) => groups.get(id),
    settled: async (id) => {
      const p = done.get(id);
      return p ? await p : groups.get(id);
    },
  };
}

// ── ← → ───────────────────────────────────────────────────────────────────────────────────────

export interface Neighbour {
  /** the take to show, `assets/<sha8>.<ext>` */
  asset: string;
  /** its place, 0-based */
  index: number;
  of: number;
  /** "Take 3 of 4" */
  label: string;
}

export const takeLabel = (index: number, of: number) => `Take ${index + 1} of ${of}`;

/**
 * The take ← (`prev`) or → (`next`) of `current` among `takes` (resolved asset paths, generation
 * order), wrapping round. Null when `current` is not one of them or there is no other take.
 */
export function neighbourTake(
  takes: readonly string[],
  current: string,
  dir: 'next' | 'prev'
): Neighbour | null {
  const cur = sha8Of(current);
  const at = cur ? takes.findIndex((t) => sha8Of(t) === cur) : -1;
  if (at < 0 || takes.length < 2) return null;
  const index = (at + (dir === 'next' ? 1 : -1) + takes.length) % takes.length;
  return {
    asset: takes[index] as string,
    index,
    of: takes.length,
    label: takeLabel(index, takes.length),
  };
}
