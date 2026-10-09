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
