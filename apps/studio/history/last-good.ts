// "Go back to 14:05" — the last version this Mac drew without an error (V2-1.9 §5.8, C5; S1.13).
//
// `<designRoot>/_state/render-ok.json` = `{ [canvas]: { ref, srcHash, at } }` — per Mac, runtime state
// (already under `_state/`, ignored by all four DDR-115 lists). `recordRenderOk` is the writer (it runs
// on the canvas's `render-ok` signal); `lastGood` is the reader behind `history.go-back` and
// `maude design history restore <canvas> @last-good`:
//   1. the newest version whose TSX hashes to the recorded `srcHash` — the source this Mac last drew;
//   2. else the newest version OLDER than Now whose TSX passes `sourceError` (no syntax error, no
//      duplicate binding) — Now is the one that broke.
// Go back is then an ordinary whole-canvas restore of that version: a NEW version, one undo step.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { atomicWrite } from '../sync/atomic-write.ts';
import { sourceError } from '../sync/source-validation.ts';
import type { HistoryRowLike, VersionsRuntime } from './versions.ts';
import { isVisibleVersion } from './versions.ts';

export const RENDER_OK_REL = '_state/render-ok.json';
/** Canvases remembered per Mac (oldest dropped first). */
const MAX_ENTRIES = 500;
/** How many versions Go back looks through. */
const LOOK_BACK = 200;

export interface RenderOk {
  /** The accepted version it matched when recorded (`r<n>`), or null (a disk-only source). */
  ref: string | null;
  /** sha256 of the TSX it drew. */
  srcHash: string;
  at: number;
}

export const srcHashOf = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

const fileOf = (designRoot: string) => path.join(designRoot, ...RENDER_OK_REL.split('/'));

export function readRenderOk(designRoot: string | null): Record<string, RenderOk> {
  if (!designRoot) return {};
  try {
    const v = JSON.parse(readFileSync(fileOf(designRoot), 'utf8')) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, RenderOk> = {};
    for (const [k, e] of Object.entries(v as Record<string, unknown>)) {
      const r = e as Partial<RenderOk> | null;
      if (r && typeof r.srcHash === 'string' && /^[0-9a-f]{64}$/.test(r.srcHash))
        out[k] = {
          ref: typeof r.ref === 'string' && /^r\d+$/.test(r.ref) ? r.ref : null,
          srcHash: r.srcHash,
          at: Number.isFinite(r.at) ? Number(r.at) : 0,
        };
    }
    return out;
  } catch {
    return {};
  }
}

/** The writer — `canvas` is design-root relative; `source` is the TSX that drew without an error. */
export function recordRenderOk(
  designRoot: string,
  canvas: string,
  source: string,
  o: { ref?: string | null; now?: number } = {}
): RenderOk {
  const all = readRenderOk(designRoot);
  const entry: RenderOk = {
    ref: o.ref && /^r\d+$/.test(o.ref) ? o.ref : null,
    srcHash: srcHashOf(source),
    at: o.now ?? Date.now(),
  };
  delete all[canvas];
  all[canvas] = entry;
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete all[k];
  mkdirSync(path.dirname(fileOf(designRoot)), { recursive: true });
  atomicWrite(fileOf(designRoot), `${JSON.stringify(all, null, 2)}\n`);
  return entry;
}

export interface LastGood {
  revision: number;
  committedAt: number;
  /** `recorded` = what this Mac drew; `parses` = the fallback (§5.8). */
  how: 'recorded' | 'parses';
}

export async function lastGood(input: {
  runtime: VersionsRuntime | null | undefined;
  designRoot: string | null;
  repoRel: string;
  canvas: string;
}): Promise<LastGood | null> {
  const rt = input.runtime;
  if (!rt?.acceptedHistory || !rt.acceptedVersion) return null;
  const rows = ((await rt.acceptedHistory({ path: input.repoRel, limit: LOOK_BACK })) ??
    []) as HistoryRowLike[];
  const versions = rows
    .filter((r) => isVisibleVersion(r, input.canvas) && r.kind !== 'aside')
    .sort((a, b) => b.revision - a.revision);
  if (!versions.length) return null;
  const recorded = readRenderOk(input.designRoot)[input.canvas];
  const sources = new Map<number, string | null>();
  const at = async (rev: number) => {
    if (!sources.has(rev))
      sources.set(rev, (await rt.acceptedVersion?.(input.repoRel, rev).catch(() => null)) ?? null);
    return sources.get(rev) ?? null;
  };
  if (recorded) {
    for (const v of versions) {
      const src = await at(v.revision);
      if (src !== null && srcHashOf(src) === recorded.srcHash)
        return { revision: v.revision, committedAt: v.committedAt, how: 'recorded' };
    }
  }
  for (const v of versions.slice(1)) {
    const src = await at(v.revision);
    if (src && sourceError(input.canvas, src) === null)
      return { revision: v.revision, committedAt: v.committedAt, how: 'parses' };
  }
  return null;
}
