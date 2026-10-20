// estimate.ts — `POST /_api/export-estimate`'s numbers (contract S8-export-spec.md §5.5, S8.1).
//
// NUMBERS ONLY: the sheet builds its words ("21 files · about 140 MB · about 20 seconds on this
// Mac") from these, never the other way round. Pure: the caller hands in the index rows the
// session sees, the resolved units (scope.ts `resolveSpecV2`) and this Mac's export history.
//
// Bytes and seconds come from a per-format table scaled by the artboard's pixels, unless this
// Mac has enough finished exports of the format to measure its own throughput (`basis:
// 'history'`). The history ledger records no byte counts, so bytes are always `table` today.

import type { ExportHistoryEntry } from './jobs.ts';
import type { SkipReason, SpecArtboard, SpecCanvas, SpecUnit } from './scope.ts';
import type { ExportFormatV2, ExportSpecV2 } from './spec-v2.ts';
import { type VideoFactsReader, type VideoInfo, videoInfo } from './video-cap.ts';

export interface EstimateResult {
  counts: {
    selection: number | null;
    canvas: number | null;
    folder: number | null;
    project: number | null;
  };
  files: number;
  bytes: number;
  seconds: number;
  lane: 'this-mac' | 'cloud';
  byKind: Record<string, { artboards: number; files: number; format: ExportFormatV2 }>;
  skipped: Array<{ name: string; reason: SkipReason }>;
  /** S8.6 — one row per video artboard reached: its length against the cap that export would be held to */
  video: VideoInfo[];
  basis: { bytes: 'history' | 'table'; seconds: 'history' | 'table' };
}

export interface EstimateFacts {
  /** the canvases the session sees (index rows) */
  canvases: readonly SpecCanvas[];
  /** designRoot-relative canvas the counts are about (spec.canvas ?? active) */
  canvas: string | null;
  /** a canvas-only session: Folder and Whole project are not its to count (null) */
  canvasOnly: boolean;
  /** this Mac's finished exports (newest first) */
  history: readonly ExportHistoryEntry[];
  /** where `lane: 'auto'` would render: the local spine, or the render service */
  renderLane: 'local' | 'remote' | 'none';
  /** S8.6 — what the canvases say about a video artboard (length, stored `maxFrames`); absent = unknown */
  video?: VideoFactsReader;
}

/** Fallback artboard size when the index does not know it (CSS px). */
const DEFAULT_W = 1440;
const DEFAULT_H = 900;

/** Bytes per DEVICE pixel, by format — measured on the repo's own canvases, rounded. */
const BYTES_PER_PX: Record<string, number> = {
  png: 0.9,
  jpg: 0.18,
  pdf: 0.25,
  pptx: 0.35,
  canva: 0.35,
};
/** Flat per-file bytes for the formats whose size is not about pixels. */
const FLAT_BYTES: Record<string, number> = {
  svg: 120_000,
  html: 180_000,
  zip: 250_000, // per canvas in the zip
  mp4: 6_000_000,
  webm: 5_000_000,
  gif: 9_000_000,
  audio: 1_500_000,
};
/** Seconds per file, by format, plus one browser boot per unit. */
const SECONDS_PER_FILE: Record<string, number> = {
  png: 1.2,
  jpg: 1.0,
  pdf: 1.6,
  svg: 1.4,
  html: 1.4,
  pptx: 2.0,
  canva: 2.0,
  zip: 0.2,
  mp4: 40,
  webm: 40,
  gif: 45,
  audio: 8,
};
const BOOT_SECONDS = 2.5;
/** Finished exports of one format this Mac needs before its own throughput is believed. */
const HISTORY_MIN_SAMPLES = 3;

const nonEmpty = (n: number): number | null => (n > 0 ? n : null);
const artboardsOf = (cs: readonly SpecCanvas[]) => cs.reduce((n, c) => n + c.artboards.length, 0);

function folderOf(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

function deviceScale(unit: SpecUnit): number {
  const size = unit.v2.size;
  if (size && 'dpi' in size) return size.dpi / 96;
  if (size && 'scale' in size) return size.scale;
  return unit.format === 'png' || unit.format === 'jpg' ? 2 : 1; // the engine's v1 default
}

/** How many files one unit writes. */
export function unitFiles(unit: SpecUnit): number {
  if (unit.format === 'pptx' || unit.format === 'canva') return 1; // one deck
  if (unit.scope === 'canvas-as-separate') return Math.max(1, unit.artboards.length);
  return 1;
}

function unitPixels(unit: SpecUnit, board: SpecArtboard | null): number {
  const w = board?.w ?? DEFAULT_W;
  const h = board?.h ?? DEFAULT_H;
  const s = deviceScale(unit);
  return w * h * s * s;
}

function unitBytes(unit: SpecUnit, canvasesInZip: number): number {
  if (unit.format === 'zip') return FLAT_BYTES.zip * Math.max(1, canvasesInZip);
  const flat = FLAT_BYTES[unit.format];
  const files = unitFiles(unit);
  if (flat !== undefined) return flat * files;
  const per = BYTES_PER_PX[unit.format] ?? 0.5;
  if (!unit.artboards.length) return per * unitPixels(unit, null) * files;
  return unit.artboards.reduce((n, b) => n + per * unitPixels(unit, b), 0);
}

/** This Mac's seconds per export job of `format`, when it has enough of them. */
function historySeconds(history: readonly ExportHistoryEntry[], format: string): number | null {
  const samples: number[] = [];
  for (const h of history) {
    if (h.format !== format || h.status !== 'done' || h.deliveredInBrowser) continue;
    const a = h.startedAt ? Date.parse(h.startedAt) : Number.NaN;
    const b = h.finishedAt ? Date.parse(h.finishedAt) : Number.NaN;
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) samples.push((b - a) / 1000);
  }
  if (samples.length < HISTORY_MIN_SAMPLES) return null;
  samples.sort((x, y) => x - y);
  return samples[Math.floor(samples.length / 2)] ?? null; // median
}

export function estimateSpec(
  spec: ExportSpecV2,
  resolved: {
    units: readonly SpecUnit[];
    skipped: ReadonlyArray<{ name: string; reason: SkipReason }>;
  },
  facts: EstimateFacts
): EstimateResult {
  const target = facts.canvas ? facts.canvases.find((c) => c.rel === facts.canvas) : undefined;
  const selected =
    (spec.selection?.artboards?.length ?? 0) + (spec.selection?.elements?.length ?? 0);
  const folder = spec.folder ?? (facts.canvas ? folderOf(facts.canvas) : null);
  const inFolder =
    folder === null
      ? []
      : facts.canvases.filter((c) => (folder === '' ? true : c.rel.startsWith(`${folder}/`)));
  const counts = {
    selection: nonEmpty(selected),
    canvas: target ? nonEmpty(target.artboards.length) : null,
    folder: facts.canvasOnly || folder === null ? null : nonEmpty(artboardsOf(inFolder)),
    project: facts.canvasOnly ? null : nonEmpty(artboardsOf(facts.canvases)),
  };

  const byKind: EstimateResult['byKind'] = {};
  let files = 0;
  let bytes = 0;
  let seconds = 0;
  let secondsBasis: 'history' | 'table' = 'table';
  const zipCanvases =
    spec.scope === 'folder'
      ? inFolder.length
      : spec.scope === 'project'
        ? facts.canvases.length
        : 0;
  for (const unit of resolved.units) {
    const n = unitFiles(unit);
    files += n;
    bytes += unitBytes(unit, zipCanvases);
    const measured = historySeconds(facts.history, unit.format);
    if (measured !== null) {
      seconds += measured; // one past job of this format ≈ one unit
      secondsBasis = 'history';
    } else seconds += BOOT_SECONDS + (SECONDS_PER_FILE[unit.format] ?? 2) * n;
    const kinds = unit.artboards.length
      ? unit.artboards.map((b) => b.kind ?? 'digital')
      : [unit.kind ?? 'canvas'];
    // one file per artboard, or the unit's file(s) on its first kind (a deck, a region, a zip)
    const filePerArtboard = unit.artboards.length > 0 && n === unit.artboards.length;
    kinds.forEach((k, i) => {
      let row = byKind[k];
      if (!row) {
        row = { artboards: 0, files: 0, format: unit.format };
        byKind[k] = row;
      }
      if (unit.artboards.length) row.artboards += 1;
      if (filePerArtboard) row.files += 1;
      else if (i === 0) row.files += n;
    });
  }

  const p3 = spec.options?.colorProfile === 'display-p3';
  const askedLane = spec.options?.lane ?? 'auto';
  const lane: 'this-mac' | 'cloud' = p3
    ? 'this-mac'
    : askedLane === 'cloud' || (askedLane === 'auto' && facts.renderLane === 'remote')
      ? 'cloud'
      : 'this-mac';

  return {
    counts,
    files,
    bytes: Math.round(bytes),
    seconds: Math.round(seconds * 10) / 10,
    lane,
    byKind,
    skipped: [...resolved.skipped],
    video: videoInfo(resolved.units, facts.video ?? null),
    basis: { bytes: 'table', seconds: secondsBasis },
  };
}
