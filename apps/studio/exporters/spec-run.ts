// spec-run.ts — run one ExportSpec v2 as ONE group job (contract S8-export-spec.md §5.4, §5.6).
//
// `resolveSpecV2` (scope.ts) turns a spec into engine units; this runs them one after the
// other through the caller's `render` (the job queue's local-or-remote spine), keeps a status
// per item, and names every file from the template (file-names.ts: tokens, sanitising,
// ` (2)` dedupe). One file → that file; several → one zip of the named files (the browser
// shell downloads one zip; the desktop's folder write is S8.23). A failed item never fails
// the group while another item succeeded — the job ends `done` with the item `failed`
// ("Exported 114 of 115"); only an all-failed group fails.

import JSZip from 'jszip';
import {
  createNameDeduper,
  DEFAULT_NAME_TEMPLATE,
  groupFolderName,
  type NameFacts,
  renderStem,
} from './file-names.ts';
import type { ExportDegradation, ExportResult } from './index.ts';
import type { Scope, SpecArtboard, SpecUnit } from './scope.ts';
import type { ExportSpecV2 } from './spec-v2.ts';

/** The degradation lines a unit carries from the resolver (contract §5.8). */
export const DEGRADATION_LINES: Record<string, string> = {
  'annotations-print': 'Print never includes annotations.',
};

export type ExportItemStatus = 'queued' | 'running' | 'ok' | 'failed' | 'waiting';

export interface ExportJobItem {
  id: string;
  name: string;
  status: ExportItemStatus;
  reason?: string;
  /** the file names this item wrote (inside the job's result) */
  files?: string[];
}

export interface GroupPlan {
  spec: ExportSpecV2;
  units: SpecUnit[];
  /** the project's display name ({project}) */
  project: string;
  /** stamped at submit (O2: the requesting Mac's local date) */
  date: Date;
}

export type RenderUnit = (u: {
  format: string;
  scope: Scope;
  options: Record<string, unknown>;
}) => Promise<ExportResult>;

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  pdf: 'application/pdf',
  svg: 'image/svg+xml',
  html: 'text/html',
  zip: 'application/zip',
  mp4: 'video/mp4',
  webm: 'video/webm',
  gif: 'image/gif',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const extOf = (name: string) => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : 'bin';
};
const stemOf = (name: string) => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
};

/** The item label the Exports panel shows: the artboard, else the canvas, else the project. */
export function unitLabel(unit: SpecUnit, project: string): string {
  const b = unit.artboards[0];
  if (unit.artboards.length === 1 && b) return b.label ?? b.id;
  if (unit.canvas) return unit.canvas.replace(/^.*\//, '').replace(/\.tsx$/i, '');
  return project;
}

export function itemsFor(plan: GroupPlan): ExportJobItem[] {
  return plan.units.map((u) => ({ id: u.id, name: unitLabel(u, plan.project), status: 'queued' }));
}

function factsFor(plan: GroupPlan, unit: SpecUnit, board: SpecArtboard | null): NameFacts {
  return {
    project: plan.project,
    canvas: unit.canvas,
    artboard: board ? (board.label ?? board.id) : null,
    kind: board?.kind ?? unit.kind,
    w: board?.w ?? null,
    h: board?.h ?? null,
    size: unit.v2.size,
    date: plan.date,
  };
}

/** One adapter result → its files, each tied to the artboard it is (when known). */
async function splitResult(
  res: ExportResult,
  unit: SpecUnit
): Promise<Array<{ bytes: Uint8Array; ext: string; board: SpecArtboard | null }>> {
  const multi =
    res.contentType === 'application/zip' &&
    unit.format !== 'zip' &&
    unit.scope === 'canvas-as-separate';
  if (!multi) {
    const board = unit.artboards.length === 1 ? (unit.artboards[0] ?? null) : null;
    return [{ bytes: res.body, ext: extOf(res.filename), board }];
  }
  const zip = await JSZip.loadAsync(res.body);
  const byId = new Map(unit.artboards.map((b) => [b.id, b]));
  const out: Array<{ bytes: Uint8Array; ext: string; board: SpecArtboard | null }> = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const stem = stemOf(entry.name.replace(/^.*\//, ''));
    const nth = /^artboard-(\d+)$/.exec(stem);
    const byIndex = nth ? unit.artboards[Number(nth[1]) - 1] : undefined;
    const board: SpecArtboard = byId.get(stem) ??
      byIndex ?? { id: stem, label: null, kind: unit.kind, w: null, h: null };
    out.push({ bytes: await entry.async('uint8array'), ext: extOf(entry.name), board });
  }
  return out;
}

export interface GroupFile {
  name: string;
  bytes: Uint8Array;
}

export interface GroupCollected {
  files: GroupFile[];
  degraded?: ExportDegradation;
}

/**
 * Run the plan's units, one after the other. `onItem` fires on every item status change (the job
 * emits it). A unit that throws marks only its item `failed`. `taken` = file names an earlier
 * run of this job already wrote (S8.4 retry), so a re-run never repeats a name.
 */
export async function collectGroup(
  plan: GroupPlan,
  items: ExportJobItem[],
  render: RenderUnit,
  onItem: () => void,
  signal?: AbortSignal,
  taken: Iterable<string> = []
): Promise<GroupCollected> {
  const template = plan.spec.options?.nameTemplate ?? DEFAULT_NAME_TEMPLATE;
  const dedupe = createNameDeduper(taken);
  const files: GroupFile[] = [];
  const reasons = new Set<string>();
  const merged: Omit<ExportDegradation, 'reason'> = {};
  for (let i = 0; i < plan.units.length; i++) {
    const unit = plan.units[i] as SpecUnit;
    const item = items[i] as ExportJobItem;
    if (signal?.aborted) {
      item.status = 'failed';
      item.reason = 'cancelled';
      continue;
    }
    item.status = 'running';
    delete item.reason;
    onItem();
    try {
      const res = await render({ format: unit.format, scope: unit.scope, options: unit.options });
      const parts = await splitResult(res, unit);
      item.files = [];
      for (const p of parts) {
        if (!p.bytes.byteLength) continue;
        const name = dedupe(renderStem(template, factsFor(plan, unit, p.board)), p.ext);
        files.push({ name, bytes: p.bytes });
        item.files.push(name);
      }
      for (const d of unit.degraded) reasons.add(DEGRADATION_LINES[d] ?? d);
      if (res.degraded) {
        reasons.add(res.degraded.reason);
        if (res.degraded.audioDropped) merged.audioDropped = true;
        if (res.degraded.fontsNotEmbedded?.length)
          merged.fontsNotEmbedded = [
            ...new Set([...(merged.fontsNotEmbedded ?? []), ...res.degraded.fontsNotEmbedded]),
          ];
        if (res.degraded.remedy) merged.remedy ??= res.degraded.remedy;
      }
      item.status = 'ok';
    } catch (err) {
      item.status = 'failed';
      item.reason = err instanceof Error ? err.message : String(err);
    }
    onItem();
  }
  return {
    files,
    ...(reasons.size ? { degraded: { ...merged, reason: [...reasons].join(' ') } } : {}),
  };
}

/** The named files as the job's one result: that file, or one zip of them. */
export async function packGroup(
  plan: GroupPlan,
  { files, degraded }: GroupCollected
): Promise<ExportResult> {
  const deg: { degraded?: ExportDegradation } = degraded ? { degraded } : {};
  if (files.length === 1) {
    const f = files[0] as GroupFile;
    return {
      filename: f.name,
      contentType: MIME[extOf(f.name)] ?? 'application/octet-stream',
      body: f.bytes,
      ...deg,
    };
  }
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.bytes);
  const body = files.length
    ? await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    : new Uint8Array(0);
  return {
    filename: `${groupFolderName(plan.project, plan.date)}.zip`,
    contentType: 'application/zip',
    body,
    ...deg,
  };
}

/**
 * Run the plan. Returns the job's one result: a single named file, or one zip of every named
 * file. Throws only when no item made it.
 */
export async function runGroup(
  plan: GroupPlan,
  items: ExportJobItem[],
  render: RenderUnit,
  onItem: () => void,
  signal?: AbortSignal
): Promise<ExportResult> {
  const got = await collectGroup(plan, items, render, onItem, signal);
  const okCount = items.filter((x) => x.status === 'ok').length;
  if (plan.units.length && okCount === 0) {
    throw new Error(items.find((x) => x.reason)?.reason ?? 'export failed');
  }
  return packGroup(plan, got);
}
