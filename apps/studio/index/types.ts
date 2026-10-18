// index/types.ts — the project index (V2-2.17, contract V2-1.17 §5.2/§5.3).
// Erasable TypeScript only: imported by the server (Bun), Node 24 scripts and the client bundle.

export type ArtboardKind = 'digital' | 'print' | 'web' | 'video';

export interface ArtboardRow {
  id: string;
  label: string | null;
  kind: ArtboardKind | null;
  w: number | null;
  h: number | null;
}

export type CanvasKind =
  | 'canvas'
  | 'specimen'
  | 'brief-board'
  | 'imported-figma'
  | 'reconstructed-experimental';

export interface CanvasRow {
  /** designRoot-relative, posix: 'ui/2026/combine/Combine-kampan.tsx' */
  rel: string;
  name: string;
  folder: string;
  kind: CanvasKind;
  ds: string | null;
  mtimeMs: number;
  srcHash: string;
  metaHash: string | null;
  depsHash: string;
  artboards: ArtboardRow[];
  /** `runtime` once the renderer harvested this srcHash (V2-1.17 §5.8); `static` until then. */
  artboardsFrom: 'static' | 'runtime';
  hasArtboards: boolean;
  /** Artboards a parse cannot list: inside a callback (.map), a non-literal id, or rendered by an
   *  imported local module. */
  dynamic: boolean;
  cover: { key: string; w: number; h: number; ofSrc: string } | null;
  madeByAi: boolean;
  parse: 'ok' | 'error';
}

export interface ProjectIndexSnapshot {
  format: 'maude.project-index';
  v: 1;
  pid: string;
  project: {
    root: string;
    designRel: string;
    name: string;
    label: string | null;
    formatVersion: number;
    linkedHub: { url: string } | null;
    managed: boolean;
  };
  writer: { pid: number; bootId: string; app: string; at: number; seq: number };
  stamp: Stamp;
  access: { scope: 'full' | 'canvas'; epoch: number };
  canvases: CanvasRow[];
  counts: { canvases: number; artboards: number; byKind: Partial<Record<ArtboardKind, number>> };
}

/** Crash-safety fingerprint over (rel, size, mtime) of every canvas source + meta + config.json. */
export interface Stamp {
  files: number;
  maxMtimeMs: number;
  hash: string;
}

export type SearchGroup = 'canvases' | 'artboards';

export interface SearchRow {
  group: SearchGroup;
  /** canvas rel, or `<rel>#<artboardId>` */
  key: string;
  name: string;
  meta: string;
  score: number;
  close: boolean;
  /** [start, end) ranges into `name` */
  marks: Array<[number, number]>;
}

export interface SearchResult {
  q: string;
  rows: SearchRow[];
  /** every row is a close (typo-tolerant) match — the UI says "Showing close matches for …" */
  closeOnly: boolean;
}

// ── assets (S8.11; contract V2-1.17 §5.3/§5.5, S8-slices) ───────────────────────────────────────

export type AssetKind = 'image' | 'video' | 'audio' | 'font' | 'document';

/** One file in `<designRoot>/assets/`. Sidecars (`.photo.json`, `.gen.json`, …) are not rows. */
export interface AssetRow {
  /** designRoot-relative: 'assets/a1b2c3d4.png' */
  rel: string;
  kind: AssetKind;
  size: number;
  mtimeMs: number;
  /** full sha256 of the bytes; arrives lazily (a background pass), absent until then */
  sha256?: string;
  /** canvases whose source, sidecars or relative-import closure reference the file */
  usedIn: string[];
  usedBy: number;
  /** referenced by something that is not a canvas (design system, config, a module no canvas
   *  imports): used, but there is no canvas to name */
  usedElsewhere: boolean;
  /** a retained older version of a canvas references it; 'checking' while the history scan runs
   *  and nothing has been found yet */
  olderVersions: boolean | 'checking';
  /** today's AI take that nobody placed yet (`assets/<sha8>.gen.json`) — exempt from Not used */
  recentTake: boolean;
  /** the "Not used" verdict: `true` only when every source of use has been ruled out */
  notUsed: boolean | 'checking';
  /** thumbnail key (`assetKey('card', sha256)`), once the bytes are hashed; thumbnailable kinds only */
  tile?: string;
}

/** What a canvas-only session may see (V2-1.16 L9): only these canvases count. */
export interface AssetView {
  canvases: ReadonlySet<string>;
}

export type HistoryScanState = 'idle' | 'checking' | 'ready';

export interface AssetsAnswer {
  seq: number;
  history: HistoryScanState;
  assets: AssetRow[];
}
