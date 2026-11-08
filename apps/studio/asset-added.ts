// asset-added.ts — who brought an asset into the project, as every peer sees it (#172; contract
// client/v2/contracts/172-asset-origins.md).
//
// `assets/<sha8>.added.json` — `{ "format": "maude.added", "v": 1, "by": "Tereza", "at": "2026-11-08T09:12:00Z" }`
//
// Versioned project content: a companion sidecar of the asset (file plane `companion-text`, both classifier copies), so
// it syncs, moves to the Trash and renames with its asset. It holds a DISPLAY NAME only — never a path (that stays in
// the per-Mac `_canvas-state/asset-origins.json`), never an e-mail, never an account id. Write-once: the first person who
// brought the bytes in is the one who added them; the same bytes again are the same asset and keep the record.
//
// Peer-synced, so untrusted on read: small, the right format and version, a clean name — else absent.
//
// Leaf module (node:fs / node:path + the leaf asset-origins.ts; erasable TypeScript) — the CLI imports it under bun.

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cleanOriginBy } from './asset-origins.ts';

export const ADDED_SUFFIX = '.added.json';
export const ADDED_FORMAT = 'maude.added';
/** A record past this is not one we wrote. */
export const ADDED_MAX_BYTES = 4096;

export interface AssetAdded {
  /** a display name ("Tereza") */
  by: string;
  /** ISO-8601 UTC, when the record has one */
  at?: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** A flat file under assets/ (asset-details.ts DETAIL_ASSET_REL): no folder, no `..`, no leading dot. */
const ASSET_REL = /^assets\/([A-Za-z0-9_][A-Za-z0-9 ._-]*)$/;

/**
 * `assets/<stem>.<ext>` → `assets/<stem>.added.json` (the asset-trash stem rule, so a rename carries it); null for
 * anything that is not a flat asset name. An import names the asset by its sha8; a renamed one keeps its record.
 */
export function addedRelOf(assetRel: unknown): string | null {
  if (typeof assetRel !== 'string') return null;
  const m = ASSET_REL.exec(assetRel.replace(/^\.?\/+/, ''));
  const stem = m?.[1]?.split('.')[0] ?? '';
  return stem ? `assets/${stem}${ADDED_SUFFIX}` : null;
}

/**
 * The name to write for a person: an e-mail becomes the words of its local part ("tereza.novak@…" → "Tereza Novak",
 * the history `displayNameOf` rule), a machine actor (`local:…`, `operator`, `anon`) names nobody. Null when nothing
 * fit to show is left.
 */
export function addedByName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let v = raw.trim();
  if (!v || /^local:/.test(v) || v === 'operator' || v === 'anon') return null;
  const at = v.indexOf('@');
  if (at >= 0) {
    v = v
      .slice(0, at)
      .split(/[._+-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return cleanOriginBy(v.slice(0, 80));
}

/** The record beside `assets/<sha8>.<ext>`, or null (none, unreadable, or not one this version reads). */
export function readAssetAdded(designRoot: string, assetRel: string): AssetAdded | null {
  const rel = addedRelOf(assetRel);
  if (!rel) return null;
  const file = path.join(designRoot, ...rel.split('/'));
  try {
    const st = statSync(file);
    if (!st.isFile() || st.size > ADDED_MAX_BYTES) return null;
    const j = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> | null;
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    if (j.format !== ADDED_FORMAT || j.v !== 1) return null;
    const by = cleanOriginBy(j.by);
    if (!by) return null;
    return typeof j.at === 'string' && ISO.test(j.at) ? { by, at: j.at } : { by };
  } catch {
    return null;
  }
}

/**
 * Say that `who` brought `assets/<sha8>.<ext>` in. Write-once: an existing record (even one this version cannot read)
 * is never replaced. Never throws — a record that cannot be kept is a missing line, not a failed import. Returns
 * whether this call wrote the file.
 */
export function recordAssetAdded(
  designRoot: string,
  assetRel: string,
  who: unknown,
  now: number = Date.now()
): boolean {
  const rel = addedRelOf(assetRel);
  const by = addedByName(who);
  if (!rel || !by) return false;
  const file = path.join(designRoot, ...rel.split('/'));
  try {
    const doc = { format: ADDED_FORMAT, v: 1, by, at: new Date(now).toISOString() };
    // `wx`: an exclusive create IS the write-once rule (a record already there, or one racing in, wins). No temp file
    // beside it: `assets/` is on the file plane and a stray temp name would be offered to peers.
    writeFileSync(file, `${JSON.stringify(doc)}\n`, { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}
