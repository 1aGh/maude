// describe/batch.ts — search in pictures: batches, the describer seam, storage and the search half (S8.20; V2-1.17 §5.9).
//
// Once a person said yes (consent.ts), the studio describes the project's pictures a batch at a time:
//
//   1. budget.ts says how many may go (≤ 10, today's cap) and hands out the Mac's one slot (≥ 20 s apart).
//   2. Each picture goes as the renderer's downscaled JPEG (`prepare`, by default the Assets tile the thumbnail renderer
//      already made — 480 px) into a fresh OS temp dir, named `<sha256>.jpg`. NO project path, file name or folder ever
//      reaches the describer: it gets `{ dir, items: [{ sha256, file }] }` and nothing else.
//   3. `describer(batch)` is the seam. S12.13's `asset-describer` agent fills it (describe/claude.ts: headless `claude`,
//      Read only, cwd = that temp dir); without a `claude` describing waits ("AI not connected"). Tests and the e2e use
//      `stubDescriber` (also behind `MAUDE_DESCRIBE_STUB=1`, the way generation's stub sits behind MAUDE_GENERATE_STUB).
//   4. validate.ts checks every word of the answer; what passes is stored per picture on THIS Mac, outside the project:
//      `~/.maude/index/v1/projects/<pid>/describe/<s0s1>/<sha256>.json` (`maude.describe` v1). Never synced, versioned,
//      sent to the hub or exported.
//
// Pauses (and resumes by itself): no AI · offline · "used up until HH:MM" (the describer throws `{ usedUpUntil }`) ·
// today's cap · Stop. Search (`search(q)`) reads the stored words only while consent is on; off, it is names only.

import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type MatchHit, match } from '../index/match.ts';
import { assetKey } from '../thumbs/keys.ts';
import { readThumb } from '../thumbs/store.ts';
import {
  BATCH_MAX,
  batchRoom,
  claimSlot,
  GAP_MS,
  isDescribable,
  pictureFits,
  projectDescribeDir,
  releaseSlot,
  spend,
} from './budget.ts';
import { realDescriber } from './claude.ts';
import { type Consent, readConsent, setConsent, setStopped } from './consent.ts';
import {
  type Described,
  type DescribeRecord,
  RECORD_FORMAT,
  SHA_RE,
  type Validated,
  validateHandoff,
  validateRecord,
} from './validate.ts';

export interface DescribeBatch {
  /** an OS temp dir holding ONLY this batch's pictures */
  dir: string;
  items: Array<{ sha256: string; file: string }>;
}
/** The seam: what the agent answered (untrusted — validated after). Throw `{ usedUpUntil: ms }` when the account is used up. */
export type Describer = (batch: DescribeBatch) => Promise<unknown>;

export interface DescribeRow {
  rel: string;
  kind: string;
  sha256?: string;
}

export interface DescribeServiceOptions {
  designRoot: string;
  /** the machine index's project id (index/snapshot.ts `pidOf`) */
  pid: string;
  /** the project's asset rows (the index's; `sha256` arrives lazily) */
  rows: () => readonly DescribeRow[];
  /** the describer, or null when no AI is connected */
  describer: () => Describer | null;
  /** the ≤ 1024 px JPEG for one asset, or null to skip it; default: its Assets tile */
  prepare?: (
    row: DescribeRow & { sha256: string }
  ) => Uint8Array | null | Promise<Uint8Array | null>;
  online?: () => boolean;
  now?: () => number;
  tmpRoot?: string;
  /** a describe step happened (the panel re-reads) */
  onChange?: () => void;
  /** run batches by themselves while on (the studio: true; tests drive `runOnce`) */
  auto?: boolean;
}

export type Paused = 'off' | 'stopped' | 'no-ai' | 'offline' | 'used-up' | 'daily-cap' | null;

export interface DescribeStatus {
  consent: Consent;
  /** a describer is connected */
  ai: boolean;
  /** pictures that can be described (their fingerprint is known) */
  total: number;
  /** of those, described */
  done: number;
  running: boolean;
  paused: Paused;
  /** "used up until" (ms), when paused for it */
  until?: number;
}

export type RunOutcome =
  | { ran: false; why: Exclude<Paused, null> | 'nothing-left' | 'in-flight' | 'too-soon' | 'busy' }
  | { ran: true; sent: number; stored: number; dropped: Validated['dropped']; refused?: string };

export interface SeenHit {
  rel: string;
  caption: string;
  tags: string[];
  text: string;
  marks: NonNullable<MatchHit<{ key: string; name: string }>['seenMarks']>;
  close: boolean;
}

export interface DescribeService {
  status(): DescribeStatus;
  setConsent(on: boolean): DescribeStatus;
  setStopped(stopped: boolean): DescribeStatus;
  runOnce(): Promise<RunOutcome>;
  /** rows whose picture matched at least one word only by what AI saw; [] while consent is off */
  search(q: string, limit?: number): SeenHit[];
  description(sha256: string): DescribeRecord | null;
  /** the background loop (auto) looks again soon: a picture arrived, consent changed */
  poke(): void;
  dispose(): void;
}

export const describePath = (pid: string, sha: string) =>
  path.join(projectDescribeDir(pid), sha.slice(0, 2), `${sha}.json`);

export function readDescription(pid: string, sha: string): DescribeRecord | null {
  if (!SHA_RE.test(sha)) return null;
  try {
    return validateRecord(JSON.parse(readFileSync(describePath(pid, sha), 'utf8')), sha);
  } catch {
    return null;
  }
}

export function writeDescription(
  pid: string,
  d: Described,
  meta: { source: 'image' | 'video'; model?: string; at: number }
): DescribeRecord {
  const rec: DescribeRecord = {
    format: RECORD_FORMAT,
    v: 1,
    sha256: d.sha256,
    source: meta.source,
    caption: d.caption,
    tags: d.tags,
    text: d.text,
    ...(d.lang ? { lang: d.lang } : {}),
    ...(meta.model ? { model: meta.model } : {}),
    at: meta.at,
  };
  const file = describePath(pid, d.sha256);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    writeFileSync(tmp, `${JSON.stringify(rec)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  return rec;
}

/** The test / e2e describer: a fixed answer per sha (or a plain one), in the agent's handoff shape. Never a network. */
export function stubDescriber(
  table: Record<string, { caption: string; tags?: string[]; text?: string }> = {}
): Describer {
  return async (batch) => ({
    format: 'maude.agent-handoff/1',
    model: 'stub',
    results: batch.items.map((it) => ({
      sha256: it.sha256,
      caption: table[it.sha256]?.caption ?? 'A picture',
      tags: table[it.sha256]?.tags ?? [],
      text: table[it.sha256]?.text ?? '',
    })),
  });
}

/** The studio's describer (and `maude design describe`'s): the stub under MAUDE_DESCRIBE_STUB=1 (read per call), else
 *  S12.13's asset-describer agent through the person's own `claude` (describe/claude.ts), or none without one. Consent
 *  is the service's to check — no describer is called while it is off. */
export function envDescriber(): Describer | null {
  return process.env.MAUDE_DESCRIBE_STUB === '1' ? stubDescriber() : realDescriber();
}

const defaultPrepare = (pid: string) => (row: { sha256: string }) =>
  readThumb(pid, assetKey('card', row.sha256));

const usedUpUntil = (err: unknown): number | null => {
  const v = (err as { usedUpUntil?: unknown } | null)?.usedUpUntil;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function createDescribeService(o: DescribeServiceOptions): DescribeService {
  const now = o.now ?? Date.now;
  const prepare = o.prepare ?? defaultPrepare(o.pid);
  const cache = new Map<string, DescribeRecord | null>();
  /** pictures that may not go this session (too big, or the answer said nothing valid): not retried until a restart */
  const skipped = new Set<string>();
  let running = false;
  let usedUp = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  // only what was found is kept: a description another process wrote (S12.13's verb) shows up on the next read
  const record = (sha: string) => {
    const hit = cache.get(sha);
    if (hit) return hit;
    const read = readDescription(o.pid, sha);
    if (read) cache.set(sha, read);
    return read;
  };
  const candidates = () => {
    const seen = new Set<string>();
    const out: Array<DescribeRow & { sha256: string }> = [];
    for (const r of o.rows()) {
      if (!r.sha256 || !SHA_RE.test(r.sha256) || !isDescribable(r) || seen.has(r.sha256)) continue;
      seen.add(r.sha256);
      out.push(r as DescribeRow & { sha256: string });
    }
    return out;
  };

  function pausedNow(consent: Consent): { paused: Paused; until?: number } {
    if (!consent.on) return { paused: 'off' };
    if (consent.stopped) return { paused: 'stopped' };
    if (!o.describer()) return { paused: 'no-ai' };
    if (o.online && !o.online()) return { paused: 'offline' };
    if (usedUp > now()) return { paused: 'used-up', until: usedUp };
    if (batchRoom(o.pid, consent.dailyCap, now()) === 0) return { paused: 'daily-cap' };
    return { paused: null };
  }

  function status(): DescribeStatus {
    const consent = readConsent(o.designRoot);
    const all = candidates();
    const done = all.filter((r) => record(r.sha256)).length;
    return {
      consent,
      ai: !!o.describer(),
      total: all.length,
      done,
      running,
      ...pausedNow(consent),
    };
  }

  async function runOnce(): Promise<RunOutcome> {
    if (running) return { ran: false, why: 'busy' };
    const consent = readConsent(o.designRoot);
    const p = pausedNow(consent);
    if (p.paused) return { ran: false, why: p.paused };
    const describer = o.describer();
    if (!describer) return { ran: false, why: 'no-ai' };
    const todo = candidates().filter((r) => !record(r.sha256) && !skipped.has(r.sha256));
    if (!todo.length) return { ran: false, why: 'nothing-left' };
    const room = Math.min(BATCH_MAX, batchRoom(o.pid, consent.dailyCap, now()));
    const slot = claimSlot(now());
    if (!slot.ok) return { ran: false, why: slot.reason };
    running = true;
    o.onChange?.();
    let dir = '';
    try {
      dir = mkdtempSync(path.join(o.tmpRoot ?? tmpdir(), 'maude-describe-'));
      const items: DescribeBatch['items'] = [];
      const source = new Map<string, 'image' | 'video'>();
      for (const r of todo) {
        if (items.length >= room) break;
        let bytes: Uint8Array | null = null;
        try {
          bytes = await prepare(r);
        } catch {
          bytes = null;
        }
        // no tile yet: the renderer makes it later (a poke brings the loop back) · one that does not fit never goes
        if (!bytes) continue;
        if (!pictureFits(bytes).ok) {
          skipped.add(r.sha256);
          continue;
        }
        const file = `${r.sha256}.jpg`;
        writeFileSync(path.join(dir, file), bytes, { mode: 0o600 });
        items.push({ sha256: r.sha256, file });
        source.set(r.sha256, r.kind === 'video' ? 'video' : 'image');
      }
      if (!items.length) return { ran: false, why: 'nothing-left' };
      // counted before they go: a crash mid-batch still spends them
      spend(o.pid, items.length, now());
      let answer: unknown;
      try {
        answer = await describer({ dir, items: items.map((i) => ({ ...i })) });
      } catch (err) {
        const until = usedUpUntil(err);
        if (until) usedUp = until;
        return {
          ran: true,
          sent: items.length,
          stored: 0,
          dropped: [],
          refused: 'describer-failed',
        };
      }
      const v = validateHandoff(
        answer,
        items.map((i) => i.sha256)
      );
      const at = now();
      for (const d of v.results) {
        cache.set(
          d.sha256,
          writeDescription(o.pid, d, {
            source: source.get(d.sha256) ?? 'image',
            model: v.model,
            at,
          })
        );
      }
      // a picture the answer said nothing (valid) about is not asked again this session
      const got = new Set(v.results.map((d) => d.sha256));
      for (const i of items) if (!got.has(i.sha256)) skipped.add(i.sha256);
      return {
        ran: true,
        sent: items.length,
        stored: v.results.length,
        dropped: v.dropped,
        ...(v.ok ? {} : { refused: v.refused }),
      };
    } finally {
      if (dir) rmSync(dir, { recursive: true, force: true });
      releaseSlot(slot.token, now());
      running = false;
      o.onChange?.();
    }
  }

  function schedule(ms: number) {
    if (!o.auto || disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      const out = await runOnce().catch(() => ({ ran: false as const, why: 'busy' as const }));
      if (out.ran) schedule(GAP_MS);
      else if (out.why === 'too-soon' || out.why === 'in-flight' || out.why === 'busy')
        schedule(GAP_MS);
      else if (out.why === 'used-up') schedule(Math.max(GAP_MS, usedUp - now()));
      else if (out.why === 'offline' || out.why === 'no-ai' || out.why === 'daily-cap')
        schedule(5 * 60_000);
      // off / stopped / nothing-left: wait for a poke
    }, ms);
    (timer as { unref?: () => void }).unref?.();
  }

  function search(q: string, limit = 200): SeenHit[] {
    if (!readConsent(o.designRoot).on) return [];
    const rows: Array<{
      key: string;
      name: string;
      seen: { caption: string; tags: string[]; text: string };
    }> = [];
    for (const r of o.rows()) {
      if (!r.sha256) continue;
      const d = record(r.sha256);
      if (!d) continue;
      rows.push({
        key: r.rel,
        name: r.rel.split('/').pop() ?? r.rel,
        seen: { caption: d.caption, tags: d.tags, text: d.text },
      });
    }
    return match(rows, q, limit)
      .filter((h) => h.seenOnly && h.seenMarks)
      .map((h) => ({
        rel: h.row.key,
        caption: h.row.seen.caption,
        tags: h.row.seen.tags,
        text: h.row.seen.text,
        marks: h.seenMarks as SeenHit['marks'],
        close: h.close,
      }));
  }

  const svc: DescribeService = {
    status,
    setConsent(on) {
      setConsent(o.designRoot, on, now());
      svc.poke();
      return status();
    },
    setStopped(stopped) {
      setStopped(o.designRoot, stopped);
      svc.poke();
      return status();
    },
    runOnce,
    search,
    description: (sha) => record(sha),
    poke() {
      schedule(0);
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
  return svc;
}
