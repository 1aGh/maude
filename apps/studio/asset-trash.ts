// asset-trash.ts — "Move to the trash" for an asset (S8.13; 12 · ia-assets-keys, ia-assets-tidy).
//
// A picture goes to `<designRoot>/_trash/<stamp>__asset-<name>/` together with its sidecars (the every-use photo edit,
// the per-use edits, the generation record, transcripts…), beside a `_trash-manifest.json` that names where each file
// lives. That manifest is what `sync/trash.ts` reads, so the per-Mac Trash and Undo put every file back where it was.
// The move is an ordinary local delete: the file plane carries it to peers as a tombstone, and each peer parks its own
// copy in ITS `_trash/` (sync/tombstone-apply.ts) — the same road a trashed canvas takes.
//
// What is NEVER moved (the server's call, whatever the client sent — "Hidden is not refused"):
//   • a picture a canvas, the design system or another project file uses  → 'used'
//   • a picture a retained older version still shows (Version history restores it) → 'kept-by-versions'
//   • a picture whose history is still being read, or one the index has not listed yet → 'checking'
// A wrong "not used" would invite deleting what Version history still shows, so every doubt reads as a refusal.
//
// Leaf module (node:fs / node:path only; erasable TypeScript) — the route and the tests import it directly.

import { mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { assetKindOf } from './index/extractors/asset-usage.ts';

/** Sidecars that ride with `assets/<base>.<ext>` as `assets/<base><suffix>` (access/closure.ts ASSET_SIDECAR_SUFFIXES). */
const SIDECAR_SUFFIXES = [
  '.photo.json',
  '.audio.json',
  '.footage.json',
  '.transcript.json',
  '.beats.json',
  '.gen.json',
  '.srt',
  '.vtt',
  '.json',
] as const;

/** A per-use photo edit `assets/<img8>.<edit8>.photo.json` (S8-asset-sidecars §5.1). */
const PER_USE = /^([^/.]+)\.([0-9a-f]{8,16})\.photo\.json$/;

/** A flat file directly under `assets/` — no folder, no `..`, no leading dot. */
const ASSET_REL = /^assets\/[A-Za-z0-9_][A-Za-z0-9 ._-]*$/;

/** What the verdict needs of an index row (index/types.ts AssetRow). */
export interface AssetVerdictRow {
  usedIn: readonly string[];
  usedElsewhere: boolean;
  olderVersions: boolean | 'checking';
  notUsed: boolean | 'checking';
}

export type TrashRefusal = 'invalid' | 'missing' | 'used' | 'kept-by-versions' | 'checking';

export type TrashedAsset =
  | {
      ok: true;
      rel: string;
      /** every design-root-relative file that moved: the picture first, then its sidecars */
      trashed: string[];
      /** `_trash/<stamp>__asset-<name>` — design-root-relative, what Undo restores from */
      trashDir: string;
    }
  | { ok: false; rel: string; reason: TrashRefusal };

export interface TrashAssetsOptions {
  designRoot: string;
  rels: readonly string[];
  /** The index's row for an asset; null when it has not listed the file (yet). */
  rowOf(rel: string): AssetVerdictRow | null | undefined;
  now?: () => number;
  /** Called with each design-root-relative path that left the project (the studio's change announcement). */
  announce?(rel: string): void;
}

/** The sidecars of `assets/<name>` that exist on disk, design-root-relative (the picture itself excluded). */
export function sidecarsOf(designRoot: string, rel: string): string[] {
  if (!ASSET_REL.test(rel) || !assetKindOf(rel.slice('assets/'.length))) return [];
  const name = rel.slice('assets/'.length);
  const dot = name.indexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const base = name.slice(0, name.lastIndexOf('.'));
  let names: string[];
  try {
    // sorted: readdir order is the filesystem's (APFS sorts, ext4 hashes) — the list is shown and compared
    names = readdirSync(path.join(designRoot, 'assets')).sort();
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const n of names) {
    if (n === name) continue;
    const perUse = PER_USE.exec(n);
    const own = (perUse && perUse[1] === stem) || SIDECAR_SUFFIXES.some((s) => n === `${base}${s}`);
    // another PICTURE with the same stem is not a sidecar — only the known companion shapes ride along
    if (own && !assetKindOf(n)) out.push(`assets/${n}`);
  }
  return out;
}

function refusalFor(row: AssetVerdictRow | null | undefined): TrashRefusal | null {
  if (!row) return 'checking';
  if (row.usedIn.length > 0 || row.usedElsewhere) return 'used';
  if (row.olderVersions === true) return 'kept-by-versions';
  if (row.olderVersions === 'checking' || row.notUsed === 'checking') return 'checking';
  return null;
}

const isFile = (abs: string) => {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
};

/** Move each asset (with its sidecars) to its own `_trash/` bundle. Per-item: one refusal never blocks the others. */
export function trashAssets(o: TrashAssetsOptions): { results: TrashedAsset[] } {
  const now = o.now ?? Date.now;
  const results: TrashedAsset[] = [];
  const seen = new Set<string>();
  for (const rel of o.rels) {
    if (typeof rel !== 'string' || !ASSET_REL.test(rel) || !assetKindOf(rel.slice(7))) {
      results.push({ ok: false, rel: String(rel), reason: 'invalid' });
      continue;
    }
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = path.join(o.designRoot, rel);
    if (!isFile(abs)) {
      results.push({ ok: false, rel, reason: 'missing' });
      continue;
    }
    const refusal = refusalFor(o.rowOf(rel));
    if (refusal) {
      results.push({ ok: false, rel, reason: refusal });
      continue;
    }
    const files = [rel, ...sidecarsOf(o.designRoot, rel)];
    // `new Date().toISOString().replace(/[:.]/g, '-')` is the stamp every trash writer uses (sync/trash.ts reads it back)
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
    const name = rel.slice('assets/'.length);
    const folder = `${stamp}__asset-${name.replace(/[^A-Za-z0-9_-]+/g, '-')}`;
    const trashDirAbs = path.join(o.designRoot, '_trash', folder);
    const moved: string[] = [];
    try {
      mkdirSync(trashDirAbs, { recursive: true });
      for (const f of files) {
        try {
          renameSync(path.join(o.designRoot, f), path.join(trashDirAbs, path.posix.basename(f)));
          moved.push(f);
        } catch {
          // a sidecar that cannot move must not strand the picture half-done: the picture is the first file, and if IT
          // failed nothing moved at all
          if (f === rel) throw new Error('could not move the picture');
        }
      }
    } catch {
      results.push({ ok: false, rel, reason: 'missing' });
      continue;
    }
    writeFileSync(
      path.join(trashDirAbs, '_trash-manifest.json'),
      `${JSON.stringify(
        {
          kind: 'asset',
          asset: rel,
          slug: folder.slice(folder.indexOf('__') + 2),
          deletedAt: new Date(now()).toISOString(),
          trashed: moved,
        },
        null,
        2
      )}\n`
    );
    for (const f of moved) o.announce?.(f);
    results.push({ ok: true, rel, trashed: moved, trashDir: `_trash/${folder}` });
  }
  return { results };
}
