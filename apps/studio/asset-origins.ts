// asset-origins.ts — where a picture came from on THIS Mac (S8.21; contract S8-asset-sidecars §5.4, Q7).
//
// `<designRoot>/_canvas-state/asset-origins.json`:
//   { "v": 1, "origins": { "a1b2c3d4": { "path": "/Users/jonas/Pictures/acko-hero2.heic", "importedAt": 1760000000000 } } }
//
// The path is a home folder of one person's Mac, so the record is PER MAC RUNTIME STATE: `_canvas-state/` is an ignored,
// never-synced class on all four DDR-115 lists (the git service's `isMaudeRuntimeState`, `gitignore-block.mjs`, the repo
// `.gitignore`, and both file-membership copies), so it never reaches a peer, a git push, an export zip or a bug-report
// bundle. Other Macs have no record and show no Original row. It is also never served to the canvas origin: only the
// main-origin details route reads it (`routes/asset-details.ts`).
//
// Written by the import paths that know a local path: `maude design import-asset <file>` (bin/_import-asset.mjs) and any
// shell caller that holds one (`recordAssetOrigin`). Keyed by the picture's sha8, so the same bytes imported again
// (same name) keep ONE record: the latest path wins (the person's newest copy is the one they can still find).
//
// Leaf module (node:fs / node:path only; erasable TypeScript) — the CLI imports it under bun, the route under bun.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const ORIGINS_REL = '_canvas-state/asset-origins.json';
/** Oldest entries are dropped past this. */
export const MAX_ORIGINS = 10_000;
/** A path longer than this is not a path a person keeps a picture at. */
export const MAX_ORIGIN_PATH = 1024;

export interface AssetOrigin {
  path: string;
  importedAt: number;
}

interface OriginsDoc {
  v: 1;
  origins: Record<string, AssetOrigin>;
}

const SHA8 = /^[0-9a-f]{8}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: a control character in a path is the thing refused
const CONTROL = /[\u0000-\u001f\u007f]/;

/** `assets/d34bb59d.jpg` (or a bare name) → `d34bb59d`; null for a name that is not content-addressed. */
export function originKey(assetRel: unknown): string | null {
  if (typeof assetRel !== 'string') return null;
  const name = assetRel.replace(/^\.?\/+/, '').replace(/^assets\//, '');
  if (name.includes('/')) return null;
  const stem = name.split('.')[0] ?? '';
  return SHA8.test(stem) ? stem : null;
}

/** Only an absolute path with no control character and a sane length is kept. */
export function isOriginPath(p: unknown): p is string {
  if (typeof p !== 'string' || !p || p.length > MAX_ORIGIN_PATH) return false;
  if (CONTROL.test(p)) return false;
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

const fileOf = (designRoot: string) => path.join(designRoot, ...ORIGINS_REL.split('/'));

function readDoc(designRoot: string): OriginsDoc {
  try {
    const j = JSON.parse(readFileSync(fileOf(designRoot), 'utf8')) as Partial<OriginsDoc> | null;
    if (j && j.v === 1 && j.origins && typeof j.origins === 'object' && !Array.isArray(j.origins)) {
      const origins: Record<string, AssetOrigin> = {};
      for (const [k, v] of Object.entries(j.origins)) {
        if (SHA8.test(k) && v && isOriginPath(v.path) && Number.isFinite(v.importedAt))
          origins[k] = { path: v.path, importedAt: v.importedAt };
      }
      return { v: 1, origins };
    }
  } catch {
    /* absent or unreadable: nothing is known */
  }
  return { v: 1, origins: {} };
}

/** This Mac's record for `assets/<sha8>.<ext>`, or null (another Mac's import, a drop, a generated take). */
export function readAssetOrigin(designRoot: string, assetRel: string): AssetOrigin | null {
  const key = originKey(assetRel);
  return key ? (readDoc(designRoot).origins[key] ?? null) : null;
}

/**
 * Remember that `assets/<sha8>.<ext>` was imported from `absPath` on this Mac. Never throws: a record that cannot be
 * kept is a missing Original row, not a failed import. Returns whether the file now says so.
 */
export function recordAssetOrigin(
  designRoot: string,
  assetRel: string,
  absPath: string,
  now: number = Date.now()
): boolean {
  const key = originKey(assetRel);
  if (!key || !isOriginPath(absPath)) return false;
  try {
    const doc = readDoc(designRoot);
    if (doc.origins[key]?.path === absPath) return true; // the same copy again: nothing to say twice
    doc.origins[key] = { path: absPath, importedAt: now };
    const keys = Object.keys(doc.origins);
    if (keys.length > MAX_ORIGINS) {
      keys
        .sort((a, b) => (doc.origins[a]?.importedAt ?? 0) - (doc.origins[b]?.importedAt ?? 0))
        .slice(0, keys.length - MAX_ORIGINS)
        .forEach((k) => {
          delete doc.origins[k];
        });
    }
    const file = fileOf(designRoot);
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(doc)}\n`);
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/** `/Users/jonas/Pictures/x.heic` → `~/Pictures/x.heic` (the form a person reads and a shell expands). */
export function homeShort(p: string, home: string | undefined): string {
  if (!home || home === '/') return p;
  const h = home.replace(/\/+$/, '');
  return p === h ? '~' : p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p;
}
