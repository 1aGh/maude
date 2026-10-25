// file-names.ts — export file names from the 09 Advanced › File names tokens
// (contract S8-export-spec.md §5.4, S8.1).
//
// Tokens: {project} {folder} {canvas} {artboard} {kind} {size} {scale} {date}. An unknown
// `{x}` stays literal. Then the name is made safe: `/ \ : * ? " < > |` and control
// characters are stripped, whitespace collapses, leading dots go (no hidden files, no `..`),
// it is capped at 120 characters before the extension and is never empty (`export`).
// Duplicates in one job get ` (2)`, ` (3)` before the extension (case-insensitively — the Mac
// file system is). `joinInside` is the last line: a name never leaves the export dir.
//
// Pure apart from `node:path` in `joinInside`.

import path from 'node:path';

import { SPOOF_CHARS_CLASS } from '../spoof-chars.ts';

export const DEFAULT_NAME_TEMPLATE = '{canvas} — {artboard}@{scale}';
export const MAX_NAME_CHARS = 120;

export interface NameFacts {
  project: string;
  /** designRoot-relative canvas path (`ui/2026/Combine.tsx`), or null for a project-wide file. */
  canvas: string | null;
  /** the artboard's label (or id); null for a whole-canvas / region / project file */
  artboard?: string | null;
  kind?: string | null;
  /** CSS px of the artboard, when known */
  w?: number | null;
  h?: number | null;
  /** a print artboard's paper name (`A5`) — wins over px in {size} */
  paper?: string | null;
  size?: { scale: number } | { dpi: number };
  /** the requesting Mac's local day; default now */
  date?: Date;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` in local time (O2: the requesting Mac's local date). */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function canvasName(rel: string): string {
  return path.posix.basename(rel).replace(/\.tsx$/i, '');
}

function folderName(rel: string | null, project: string): string {
  if (!rel) return project;
  const dir = path.posix.dirname(rel);
  return dir === '.' || dir === '' ? project : path.posix.basename(dir);
}

function scaleText(size: NameFacts['size']): string {
  if (size && 'dpi' in size) return `${size.dpi}dpi`;
  const s = size && 'scale' in size ? size.scale : 1;
  return `${Number(s.toFixed(2))}x`;
}

function sizeText(f: NameFacts): string {
  if (f.paper) return f.paper;
  if (typeof f.w === 'number' && typeof f.h === 'number' && f.w > 0 && f.h > 0)
    return `${Math.round(f.w)}×${Math.round(f.h)}`;
  return '';
}

// the separators / bidi controls / tag characters are the one shared set (spoof-chars.ts, V2-8.9 L4)
const UNSAFE = new RegExp(`[\\\\/:*?"<>|\\x00-\\x1f\\x7f${SPOOF_CHARS_CLASS}]`, 'gu');

/** Make one rendered stem safe (no extension). Never empty. */
export function sanitizeStem(raw: string): string {
  // whitespace (tabs, newlines included) becomes one space BEFORE the control strip
  // an aspect ratio keeps its two numbers: "Post 4:5" is "Post 4-5" on disk, not "Post 45" (09 ex-social)
  let s = raw
    .normalize('NFC')
    .replace(/(\d):(?=\d)/g, '$1-')
    .replace(/\s+/g, ' ')
    .replace(UNSAFE, '')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/^\.+/, '').trim();
  if (s.length > MAX_NAME_CHARS) s = s.slice(0, MAX_NAME_CHARS).trim();
  // a cut can leave trailing dots / spaces (Windows-hostile, and `name.` + `.png` reads oddly)
  s = s.replace(/[.\s]+$/, '');
  return s || 'export';
}

/**
 * 09 ex-batch › Folders "One per canvas": the folder a canvas's files go in, inside the result zip — its path
 * under the design root without `.tsx` and without the root's own `ui/` ("social/matchday/DOMA"). Every segment
 * is made safe (no `..`, no empty one); '' for a file that belongs to no canvas.
 */
export function canvasDir(rel: string | null | undefined): string {
  if (!rel) return '';
  const parts = rel
    .replace(/\\/g, '/')
    .replace(/\.tsx$/i, '')
    .split('/')
    .filter((p) => p !== '' && p !== '.' && p !== '..');
  if (parts[0] === 'ui' && parts.length > 1) parts.shift();
  return parts
    .map((p) => sanitizeStem(p.replace(UNSAFE, '')))
    .filter(Boolean)
    .join('/');
}

/** Render a template for one file (no extension). Unknown tokens stay literal. */
export function renderStem(template: string, f: NameFacts): string {
  const values: Record<string, string> = {
    project: f.project,
    folder: folderName(f.canvas, f.project),
    canvas: f.canvas ? canvasName(f.canvas) : f.project,
    artboard: f.artboard ?? '',
    kind: f.kind ?? '',
    size: sizeText(f),
    scale: scaleText(f.size),
    date: localDate(f.date ?? new Date()),
  };
  const out = template.replace(/\{([a-z]+)\}/g, (whole, key: string) =>
    Object.hasOwn(values, key) ? values[key] : whole
  );
  // an empty token leaves a dangling separator ("Board — @2x"): drop it
  return sanitizeStem(
    out
      .replace(/\s+[—–-]\s+(?=@|$)/g, '')
      .replace(/^\s*[—–-]\s+/, '')
      .replace(/@(?=\s*$)/, '')
  );
}

/** Make an extension safe: `png`, `jpg`, … (letters/digits only, ≤ 8). */
export function safeExt(ext: string): string {
  const e = ext.replace(/^\.+/, '').toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(e) ? e : 'bin';
}

/**
 * Dedupe names within one job: the second `Hero.png` is `Hero (2).png`. Stateful: one
 * instance per job. Case-insensitive, NFC.
 */
export function createNameDeduper(
  taken: Iterable<string> = []
): (stem: string, ext: string) => string {
  // `taken`: names an earlier run of the same job already wrote (S8.4 retry), so a re-run
  // item never lands on top of one.
  const seen = new Set<string>([...taken].map((n) => n.toLowerCase()));
  return (stem, ext) => {
    const e = safeExt(ext);
    const base = sanitizeStem(stem);
    let n = 1;
    let name = `${base}.${e}`;
    while (seen.has(name.toLowerCase())) {
      n += 1;
      name = `${base} (${n}).${e}`;
    }
    seen.add(name.toLowerCase());
    return name;
  };
}

/**
 * `dir/name`, or null when the result would not be a direct child of `dir` (a name that
 * survived everything above and still escapes is refused, never written).
 */
export function joinInside(dir: string, name: string): string | null {
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..')
    return null;
  const root = path.resolve(dir);
  const full = path.resolve(root, name);
  return path.dirname(full) === root ? full : null;
}

/**
 * The download header for an export's file name. A printable-ASCII name is exactly the header
 * every v1 export always sent (`attachment; filename="…"`, byte for byte); a v2 name with
 * other characters (`Board — Same@2x.png`, `MVP zápasu.jpg`) adds the RFC 6266 / 5987
 * `filename*` beside an ASCII fallback, because a header value cannot carry them raw.
 */
export function contentDisposition(name: string): string {
  const plain = name.replace(/["\\]/g, '');
  if (/^[\x20-\x7e]*$/.test(plain)) return `attachment; filename="${plain}"`;
  const fallback = plain
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const encoded = encodeURIComponent(plain).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${fallback || 'export'}"; filename*=UTF-8''${encoded}`;
}

/** `<project> <date>` — the one folder a multi-file desktop export writes into (§5.4). */
export function groupFolderName(project: string, date: Date = new Date()): string {
  return sanitizeStem(`${project} ${localDate(date)}`);
}
