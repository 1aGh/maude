// asset-details.ts — what the Assets tab says about ONE asset (S8.21; 12 · ia-asset-details, ia-advanced).
//
// ⌘I on a tile opens the details: a photo (size, added, where it is used), Made by AI (prompt, provider, the one licence
// line), footage (what AI saw, read-only from `<sha8>.footage.json`) and sound. "Used in" names each canvas and the
// artboards that show the asset, so one click opens the artboard. Under Advanced: Stored as, Original (this Mac only),
// Edits, Cut-out, In canvases and the command. This module reads; it writes nothing (R8: the strict sidecars are only read).
//
// Provenance is `assets/<sha8>.gen.json` (maude.gen v1, a take's own record) or — for sound — the older
// `assets/<sha8>.audio.json` intent record. Both are peer-synced and so untrusted text: every string is capped here and is
// only ever drawn as text. The Original path comes from this Mac's `_canvas-state/asset-origins.json` and is the one
// field that must never leave this Mac (the caller decides who may be told; see routes/asset-details.ts).
//
// Reads the design root only through `designRoot` + the injected `usedIn`/`readCanvas`, so it is testable on a temp dir.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { homeShort, readAssetOrigin } from './asset-origins.ts';
import { sidecarsOf } from './asset-trash.ts';
import { walkIdElements } from './element-ids.ts';
import { readGen } from './generation/gen-sidecar.ts';
import { assetKindOf } from './index/extractors/asset-usage.ts';

/** `assets/<name>` — a flat file under assets/, no folder, no `..`, no leading dot. */
export const DETAIL_ASSET_REL = /^assets\/[A-Za-z0-9_][A-Za-z0-9 ._-]*$/;

const SIDECAR_READ_MAX = 256 * 1024;
const PROMPT_CAP = 4000;
const TEXT_CAP = 600;
const MAX_USES = 50;
const MAX_BOARDS = 24;
const MAX_MOMENTS = 5;
const MAX_TAGS = 12;

export type DetailKind = 'image' | 'video' | 'audio';

export interface MadeByAi {
  prompt: string;
  provider: string;
  model: string;
  /** ISO-8601 UTC */
  at: string;
  /** the provider adapter's one licence line; omitted when the record has none */
  licence?: string;
  /** the asker's display name — never an e-mail */
  by?: string;
}

export interface FootageFacts {
  summary: string;
  tags: string[];
  moments: Array<{ start: number; end: number; note: string }>;
  durationSec?: number;
  width?: number;
  height?: number;
  speech?: string;
}

export interface UseOfAsset {
  /** designRoot-relative canvas, `ui/x.tsx` */
  canvas: string;
  /** the artboards that show the asset (empty when the use is not an element: a background, a stylesheet) */
  boards: Array<{ id: string; label: string }>;
}

export interface AssetDetails {
  rel: string;
  name: string;
  kind: DetailKind;
  ext: string;
  size: number;
  mtimeMs: number;
  madeByAi: MadeByAi | null;
  footage: FootageFacts | null;
  uses: UseOfAsset[];
  advanced: {
    storedAs: string;
    /** `~/Pictures/x.heic` — only when THIS Mac imported it from a path it remembers */
    original?: string;
    /** the photo edit files beside it: the every-use edit and one per use that has its own */
    edits: string[];
    /** the cut-out masks those edits point at (`assets/<sha8>.png`) */
    cutOuts: string[];
    inCanvases: string;
    /** import the same way from a terminal; only when the original is known and the verb takes it */
    command?: string;
  };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this strips
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const clip = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(CONTROL, '').slice(0, max) : '';

function readSmall(file: string): string | null {
  try {
    const st = statSync(file);
    if (!st.isFile() || st.size > SIDECAR_READ_MAX) return null;
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

const stemOf = (name: string) => name.split('.')[0] ?? name;

/** Generation record of a picture/clip (`.gen.json`) or a sound (`.audio.json`), or null. */
export function madeByAiOf(designRoot: string, rel: string): MadeByAi | null {
  const name = rel.slice('assets/'.length);
  const stem = stemOf(name);
  const gen = readSmall(path.join(designRoot, 'assets', `${stem}.gen.json`));
  const doc = gen === null ? null : readGen(gen, { self: stem });
  if (doc) {
    const out: MadeByAi = {
      prompt: clip(doc.prompt, PROMPT_CAP),
      provider: clip(doc.provider, 80),
      model: clip(doc.model, 80),
      at: clip(doc.at, 40),
    };
    const licence = clip(doc.licence, 300);
    if (licence) out.licence = licence;
    const by = clip(doc.by, 120);
    if (by && !by.includes('@')) out.by = by;
    return out;
  }
  const intent = readSmall(path.join(designRoot, 'assets', `${stem}.audio.json`));
  if (intent !== null) {
    try {
      const j: unknown = JSON.parse(intent);
      if (isObject(j) && typeof j.prompt === 'string' && j.prompt) {
        return {
          prompt: clip(j.prompt, PROMPT_CAP),
          provider: clip(j.provider, 80),
          model: clip(j.model, 80),
          at: clip(j.at, 40),
        };
      }
    } catch {
      /* a damaged record is no record */
    }
  }
  return null;
}

const finite = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;

/** What AI saw in a clip, from `assets/<sha8>.footage.json`. Read only; null when there is no usable analysis. */
export function footageOf(designRoot: string, rel: string): FootageFacts | null {
  const stem = stemOf(rel.slice('assets/'.length));
  const text = readSmall(path.join(designRoot, 'assets', `${stem}.footage.json`));
  if (text === null) return null;
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(j)) return null;
  const summary = clip(j.summary, TEXT_CAP);
  const tags = (Array.isArray(j.tags) ? j.tags : [])
    .map((t) => clip(t, 40))
    .filter(Boolean)
    .slice(0, MAX_TAGS);
  const shots = (Array.isArray(j.shots) ? j.shots : [])
    .filter(isObject)
    .filter(
      (s) => s.usable !== false && finite(s.start) !== undefined && finite(s.end) !== undefined
    )
    .sort((a, b) => (finite(b.quality) ?? 0) - (finite(a.quality) ?? 0))
    .slice(0, MAX_MOMENTS)
    .map((s) => ({
      start: s.start as number,
      end: s.end as number,
      note: clip(s.note ?? s.subject ?? s.kind, 80),
    }))
    .sort((a, b) => a.start - b.start);
  // the empty stub a generated clip starts with says nothing a person can read
  if (!summary && !tags.length && !shots.length) return null;
  const out: FootageFacts = { summary, tags, moments: shots };
  const d = finite(j.durationSec);
  if (d !== undefined) out.durationSec = d;
  const w = finite(j.width);
  const h = finite(j.height);
  if (w !== undefined && h !== undefined) {
    out.width = w;
    out.height = h;
  }
  const speech = clip(j.speech, TEXT_CAP);
  if (speech) out.speech = speech;
  return out;
}

const norm = (v: string): string =>
  v
    .replace(/[?#].*$/, '')
    .replace(/^(?:\.{1,2}\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/^\.design\//, '');

/** The artboards of one canvas that show `assetRel` (a `src`/`href`/`poster`/tile attribute names it). */
export function boardsShowing(
  source: string,
  file: string,
  assetRel: string
): UseOfAsset['boards'] {
  const w = walkIdElements(source, file);
  if (!w.ok) return [];
  const labels = new Map<string, string>();
  for (const e of w.elements)
    if (e.tag === 'DCArtboard' && e.artboard)
      labels.set(e.artboard, e.attrs.find(([k]) => k === 'label')?.[1] || e.artboard);
  const seen = new Map<string, string>();
  for (const e of w.elements) {
    if (!e.artboard) continue;
    const hit = e.attrs.some(
      ([k, v]) =>
        (k === 'src' ||
          k === 'href' ||
          k === 'xlinkHref' ||
          k === 'poster' ||
          k === 'data-image-tile') &&
        norm(v) === assetRel
    );
    if (hit && !seen.has(e.artboard)) seen.set(e.artboard, labels.get(e.artboard) ?? e.artboard);
  }
  return [...seen].slice(0, MAX_BOARDS).map(([id, label]) => ({ id, label }));
}

const PER_USE_EDIT = /^assets\/[^/.]+\.[0-9a-f]{8,16}\.photo\.json$/;

/** The reference a canvas writes to show this asset, by kind. */
function referenceOf(kind: DetailKind, rel: string): string {
  return kind === 'video'
    ? `<video src="${rel}">`
    : kind === 'audio'
      ? `<audio src="${rel}">`
      : `<img src="${rel}">`;
}

/** A path as one shell word; `~/` stays expandable (`"$HOME/…"`) and anything unusual is quoted. */
export function shellPath(p: string): string {
  if (/^[A-Za-z0-9_@%+=:,./~-]+$/.test(p)) return p;
  const q = (s: string) => s.replace(/(["\\$`])/g, '\\$1');
  return p.startsWith('~/') ? `"$HOME/${q(p.slice(2))}"` : `"${q(p)}"`;
}

const COMMAND_KIND: Record<string, string> = {
  png: 'raster',
  jpg: 'raster',
  jpeg: 'raster',
  svg: 'svg',
};

export interface AssetDetailsOptions {
  designRoot: string;
  /** designRoot-relative canvases that use the asset, already narrowed to what the session may see */
  usedIn: readonly string[];
  /** A canvas's source (designRoot-relative), or null */
  readCanvas: (canvasRel: string) => string | null;
  /** Tell this session the Original path? Only this Mac's own project session may hear it. */
  includeOriginal: boolean;
  home?: string;
}

/** Everything the details sheet draws, or null when `rel` is not an asset this project keeps. */
export function assetDetails(rel: string, o: AssetDetailsOptions): AssetDetails | null {
  if (!DETAIL_ASSET_REL.test(rel)) return null;
  const name = rel.slice('assets/'.length);
  const kind = assetKindOf(name);
  if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return null;
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(path.join(o.designRoot, ...rel.split('/')));
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();

  const uses: UseOfAsset[] = [];
  for (const canvas of [...o.usedIn].slice(0, MAX_USES)) {
    const src = o.readCanvas(canvas);
    uses.push({ canvas, boards: src === null ? [] : boardsShowing(src, canvas, rel) });
  }

  const sidecars = sidecarsOf(o.designRoot, rel);
  const edits = sidecars.filter(
    (s) =>
      s.endsWith('.photo.json') &&
      (PER_USE_EDIT.test(s) || s === `assets/${stemOf(name)}.photo.json`)
  );
  const cutOuts = new Set<string>();
  for (const e of edits) {
    const text = readSmall(path.join(o.designRoot, ...e.split('/')));
    if (text === null) continue;
    try {
      const j: unknown = JSON.parse(text);
      const bg = isObject(j) && isObject(j.backgroundRemoved) ? j.backgroundRemoved : null;
      const mask = bg && bg.enabled !== false ? bg.maskAsset : null;
      if (typeof mask === 'string' && DETAIL_ASSET_REL.test(norm(mask))) cutOuts.add(norm(mask));
    } catch {
      /* an unreadable edit has no cut-out to name */
    }
  }

  const origin = o.includeOriginal ? readAssetOrigin(o.designRoot, rel) : null;
  const advanced: AssetDetails['advanced'] = {
    storedAs: rel,
    edits,
    cutOuts: [...cutOuts],
    inCanvases: referenceOf(kind, rel),
  };
  if (origin) {
    advanced.original = homeShort(origin.path, o.home);
    const k = COMMAND_KIND[ext];
    if (kind === 'image' && k)
      advanced.command = `maude design import-asset ${shellPath(advanced.original)} --kind ${k}`;
  }

  return {
    rel,
    name,
    kind,
    ext,
    size: st.size,
    mtimeMs: Math.round(st.mtimeMs),
    madeByAi: madeByAiOf(o.designRoot, rel),
    footage: kind === 'video' ? footageOf(o.designRoot, rel) : null,
    uses,
    advanced,
  };
}
