// asset-rename.ts — "Rename…" on an asset (P8 round 7; 12 · ia-assets-keys tile menu).
//
// `assets/<name>.<ext>` becomes `assets/<new name>.<ext>` together with its sidecars (the every-use photo edit, per-use
// edits, the generation record, transcripts…), so nothing that belongs to the picture is left behind under the old name.
// The extension never changes: the kind of a file is not a name.
//
// What is NEVER renamed (the server's call, whatever the client sent) — the same verdict Move to trash uses:
//   • a picture a canvas, the design system or another project file uses  → 'used'
//   • a picture a retained older version still shows (Version history restores it by that name) → 'kept-by-versions'
//   • a picture whose history is still being read, or one the index has not listed yet → 'checking'
// Canvases reference a picture by its path, so renaming a used one would break every artboard that shows it; rewriting
// those references is a cross-canvas edit with its own undo and is not done here (decision v2-p8-c7-asset-rename-refuse-used).
//
// Leaf module (node:fs / node:path only; erasable TypeScript) — the route and the tests import it directly.

import { existsSync, lstatSync, readdirSync, renameSync } from 'node:fs';
import path from 'node:path';

import { type AssetVerdictRow, sidecarsOf } from './asset-trash.ts';
import { assetKindOf } from './index/extractors/asset-usage.ts';

/** A flat file directly under `assets/` — no folder, no `..`, no leading dot (asset-trash.ts ASSET_REL). */
const ASSET_REL = /^assets\/[A-Za-z0-9_][A-Za-z0-9 ._-]*$/;
/** A new base name: letters, digits, space, `.`, `_`, `-`; no leading dot or space; at most 120 characters. */
const NAME = /^[A-Za-z0-9_][A-Za-z0-9 ._-]{0,119}$/;

export type RenameRefusal =
  | 'invalid'
  | 'bad-name'
  | 'missing'
  | 'same'
  | 'exists'
  | 'used'
  | 'kept-by-versions'
  | 'checking'
  /** V2-8.9 attacker L4 — another picture has the same stem (`logo.png` + `logo.jpg`): a per-use edit
   *  names its picture by stem only, so a rename could carry the other picture's edits away */
  | 'shares-stem';

export type RenamedAsset =
  | {
      ok: true;
      rel: string;
      /** the new design-root-relative path */
      to: string;
      /** every [from, to] pair that moved: the picture first, then its sidecars */
      moved: Array<[string, string]>;
    }
  | { ok: false; rel: string; reason: RenameRefusal };

export interface RenameAssetOptions {
  designRoot: string;
  rel: string;
  /** what the person typed; the extension of `rel` is kept (a typed matching extension is dropped) */
  name: string;
  rowOf(rel: string): AssetVerdictRow | null | undefined;
  /** Called with each design-root-relative path that left or joined the project. */
  announce?(rel: string): void;
}

function refusalFor(row: AssetVerdictRow | null | undefined): RenameRefusal | null {
  if (!row) return 'checking';
  if (row.usedIn.length > 0 || row.usedElsewhere) return 'used';
  if (row.olderVersions === true) return 'kept-by-versions';
  if (row.olderVersions === 'checking' || row.notUsed === 'checking') return 'checking';
  return null;
}

const isPlainFile = (abs: string) => {
  try {
    const st = lstatSync(abs);
    return st.isFile() && !st.isSymbolicLink();
  } catch {
    return false;
  }
};

/** Is there another picture in `assets/` whose stem (up to the first dot) is `stem`? */
function sharesStem(assetsDir: string, name: string, stem: string): boolean {
  let names: string[];
  try {
    names = readdirSync(assetsDir);
  } catch {
    return false;
  }
  return names.some(
    (n) =>
      n !== name &&
      !!assetKindOf(n) &&
      (n.indexOf('.') > 0 ? n.slice(0, n.indexOf('.')) : n) === stem
  );
}

/** The new base name the person meant: trimmed, single spaces, the old extension dropped when typed. */
export function cleanAssetName(typed: string, ext: string): string {
  let n = String(typed ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
  if (ext && n.toLowerCase().endsWith(ext.toLowerCase())) n = n.slice(0, -ext.length).trim();
  return n;
}

/** Rename one asset and its sidecars, or say why not. Nothing moves unless the picture itself can. */
export function renameAsset(o: RenameAssetOptions): RenamedAsset {
  const rel = o.rel;
  if (typeof rel !== 'string' || !ASSET_REL.test(rel) || !assetKindOf(rel.slice(7)))
    return { ok: false, rel: String(rel), reason: 'invalid' };
  const oldName = rel.slice('assets/'.length);
  const ext = path.posix.extname(oldName);
  const base = ext ? oldName.slice(0, -ext.length) : oldName;
  const name = cleanAssetName(o.name, ext);
  if (!NAME.test(name) || name.includes('..')) return { ok: false, rel, reason: 'bad-name' };
  const to = `assets/${name}${ext}`;
  if (!ASSET_REL.test(to) || !assetKindOf(to.slice(7)))
    return { ok: false, rel, reason: 'bad-name' };
  if (to === rel) return { ok: false, rel, reason: 'same' };

  const assetsDir = path.resolve(o.designRoot, 'assets');
  const absFrom = path.resolve(o.designRoot, rel);
  const absTo = path.resolve(o.designRoot, to);
  // belt and braces: both ends stay directly inside `<designRoot>/assets/`
  if (path.dirname(absFrom) !== assetsDir || path.dirname(absTo) !== assetsDir)
    return { ok: false, rel, reason: 'invalid' };
  if (!isPlainFile(absFrom)) return { ok: false, rel, reason: 'missing' };
  // a different-case-only rename on a case-insensitive disk is the same file: allowed
  const caseOnly = to.toLowerCase() === rel.toLowerCase();
  if (!caseOnly && existsSync(absTo)) return { ok: false, rel, reason: 'exists' };

  const refusal = refusalFor(o.rowOf(rel));
  if (refusal) return { ok: false, rel, reason: refusal };

  // the sidecars move with it: `<base><suffix>` → `<name><suffix>`, per-use `<stem>.<edit8>.photo.json` → new stem
  const oldStem = oldName.indexOf('.') > 0 ? oldName.slice(0, oldName.indexOf('.')) : oldName;
  // V2-8.9 attacker L4: a per-use edit names its picture by stem only — while another picture shares
  // the stem, whose edit is whose cannot be told, so the rename is refused (the smaller change than
  // recording the source extension in every per-use edit).
  if (sharesStem(assetsDir, oldName, oldStem)) return { ok: false, rel, reason: 'shares-stem' };
  const newStem = name.indexOf('.') > 0 ? name.slice(0, name.indexOf('.')) : name;
  const pairs: Array<[string, string]> = [[rel, to]];
  for (const s of sidecarsOf(o.designRoot, rel)) {
    const n = s.slice('assets/'.length);
    let nn: string | null = null;
    if (n.startsWith(`${base}.`)) nn = `${name}${n.slice(base.length)}`;
    else if (n.startsWith(`${oldStem}.`)) nn = `${newStem}${n.slice(oldStem.length)}`;
    if (!nn || !ASSET_REL.test(`assets/${nn}`)) continue;
    if (existsSync(path.join(assetsDir, nn))) return { ok: false, rel, reason: 'exists' };
    pairs.push([s, `assets/${nn}`]);
  }

  const moved: Array<[string, string]> = [];
  try {
    renameSync(absFrom, absTo);
    moved.push([rel, to]);
  } catch {
    return { ok: false, rel, reason: 'missing' };
  }
  for (const [from, dest] of pairs.slice(1)) {
    try {
      renameSync(path.join(o.designRoot, from), path.join(o.designRoot, dest));
      moved.push([from, dest]);
    } catch {
      // a sidecar that cannot move stays under the old name; the picture is already renamed
    }
  }
  for (const [from, dest] of moved) {
    o.announce?.(from);
    o.announce?.(dest);
  }
  return { ok: true, rel, to, moved };
}
