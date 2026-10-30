// handoff/blockers.ts — S8.10: "Last review: no blockers" / "The last review found 2 blockers: …"
// (09 Export · ex-handoff, ex-handoff-edges). Blockers inform, they never hold the handoff back:
// they travel with the code as notes for the developer.
//
// The last review is the newest `/design:critic` round on this canvas: the critics' hand-offs
// (`maude.agent-handoff/1`, cli/lib/handoff.schema.json) under `<designRoot>/_runs/<session>/handoff/`.
// The round is the newest `<critic>-<n>.in.json` whose `scope.canvas` is this canvas; its blockers
// are the `severity: "blocker"` findings of every `.out.json` of that run folder and round.
//
// Everything read here was written by an agent that read project content: it is DATA. It is shown as
// text and handed to the drafting run as quoted notes, never as instructions (routes/handoff.ts).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const MAX_RUNS = 200;
const MAX_FILES = 400;
const MAX_BYTES = 256 * 1024;
const MAX_BLOCKERS = 20;
const IN_RE = /^([a-z0-9-]{1,60})-(\d{1,2})\.in\.json$/;

export interface ReviewBlocker {
  /** `<category>:<line>` or a plain place, as the critic wrote it */
  where: string | null;
  what: string;
  fix: string | null;
  /** the critic, without `design:` */
  by: string;
}

export interface LastReview {
  reviewed: boolean;
  /** ms of the newest hand-off of that round */
  at: number | null;
  blockers: ReviewBlocker[];
}

const NONE: LastReview = { reviewed: false, at: null, blockers: [] };

function readJson(file: string): Record<string, unknown> | null {
  try {
    const st = statSync(file);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    const v = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const text = (v: unknown, n: number) =>
  typeof v === 'string'
    ? v
        // biome-ignore lint/suspicious/noControlCharactersInRegex: strips control characters on purpose
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, n)
    : '';

/** The last review of `canvasRepoRel` (e.g. `.design/ui/Pricing.tsx`). Never throws. */
export function lastReview(designRoot: string, canvasRepoRel: string): LastReview {
  const runsDir = path.join(designRoot, '_runs');
  let runs: string[];
  try {
    // by name, not readdir order: which runs the cap keeps, and which wins an mtime tie
    runs = readdirSync(runsDir).sort().slice(0, MAX_RUNS);
  } catch {
    return NONE;
  }
  let best: { dir: string; n: string; at: number } | null = null;
  let seen = 0;
  for (const run of runs) {
    if (run.startsWith('.')) continue;
    const dir = path.join(runsDir, run, 'handoff');
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const m = IN_RE.exec(name);
      if (!m?.[1]?.endsWith('critic')) continue;
      if (++seen > MAX_FILES) break;
      const file = path.join(dir, name);
      const doc = readJson(file);
      const scope = doc?.scope as { canvas?: unknown } | undefined;
      if (doc?.role !== 'in' || scope?.canvas !== canvasRepoRel) continue;
      let at = 0;
      try {
        at = statSync(file).mtimeMs;
      } catch {
        continue;
      }
      if (!best || at > best.at) best = { dir, n: m[2] as string, at };
    }
  }
  if (!best) return NONE;
  const blockers: ReviewBlocker[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(best.dir).sort();
  } catch {
    /* none */
  }
  for (const name of names) {
    if (!name.endsWith(`-${best.n}.out.json`)) continue;
    const doc = readJson(path.join(best.dir, name));
    if (doc?.role !== 'out' || !Array.isArray(doc.findings)) continue;
    const by = text(doc.agent, 80).replace(/^design:/, '') || name.replace(/-\d+\.out\.json$/, '');
    for (const f of doc.findings as Array<Record<string, unknown>>) {
      if (f?.severity !== 'blocker') continue;
      const what = text(f.what, 300);
      if (!what) continue;
      blockers.push({ where: text(f.where, 120) || null, what, fix: text(f.fix, 300) || null, by });
      if (blockers.length >= MAX_BLOCKERS) break;
    }
  }
  return { reviewed: true, at: Math.round(best.at), blockers };
}
