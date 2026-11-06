// sync/settings.ts — read/write the three user-facing sync toggles in
// `.design/config.json` `linkedHub` (feature-before-first-external-users
// Task 2). Until this module, every breaker remediation string told the user
// to edit `linkedHub.*` JSON by hand — and the target user has no terminal and
// no JSON editor (DDR-177). The Sync panel's Settings section persists here.
//
// Mirrors generation/prefs.ts: additive merge over the parsed JSON (a
// hand-authored config is never clobbered), fail CLOSED on an
// existing-but-unparseable file. This module only ever touches the three
// NON-SECRET toggles below — the hub token never lives in this file at all
// (per-machine ~/.config/maude/hubs.json), and `url`/`linkedAt` are the link
// operation's own keys, not a setting.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { normalizeIgnoreFolders } from './file-plane.ts';

export const FIRST_ANCHOR_MODES = ['ask', 'keep-local', 'keep-cloud'] as const;
export type FirstAnchorMode = (typeof FIRST_ANCHOR_MODES)[number];

export interface SyncSettings {
  /** Plane B file sync (default ON — absent means true). */
  syncFiles: boolean;
  /** Deletions propagate (default ON — absent means true). */
  propagateDeletes: boolean;
  /** First-anchor resolution; 'ask' = the key is absent = hold and keep asking. */
  resolveFirstAnchor: FirstAnchorMode;
  /** Issue #207 — folders this project does not sync (`linkedHub.ignoreFolders`); [] = every folder. */
  ignoreFolders: string[];
}

/** Issue #207 — a change to the ignore list: one folder in or out (never a wholesale rewrite). */
export interface IgnoreFolderPatch {
  addIgnoreFolder?: string;
  removeIgnoreFolder?: string;
}

export function isFirstAnchorMode(v: unknown): v is FirstAnchorMode {
  return typeof v === 'string' && (FIRST_ANCHOR_MODES as readonly string[]).includes(v);
}

function configPath(repoRoot: string): string {
  return join(repoRoot, '.design', 'config.json');
}

function readConfig(repoRoot: string): Record<string, unknown> {
  const p = configPath(repoRoot);
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** The current toggles, with the runtime's own defaults (absent = ON, absent =
 *  ask). Returns null when the project has no linked hub — there is nothing to
 *  set and the panel should not render dead controls. */
export function readSyncSettings(repoRoot: string): SyncSettings | null {
  const cfg = readConfig(repoRoot);
  const hub = cfg.linkedHub as Record<string, unknown> | undefined;
  if (!hub || typeof hub.url !== 'string') return null;
  return {
    syncFiles: hub.syncFiles !== false,
    propagateDeletes: hub.propagateDeletes !== false,
    resolveFirstAnchor: isFirstAnchorMode(hub.resolveFirstAnchor) ? hub.resolveFirstAnchor : 'ask',
    ignoreFolders: normalizeIgnoreFolders(hub.ignoreFolders),
  };
}

/**
 * Patch ONLY the provided keys into `linkedHub`, preserving everything else.
 * Booleans are written explicitly when false and REMOVED when true (true is
 * the default — a config that says nothing gets the default, and an explicit
 * `true` would suggest someone chose it). `resolveFirstAnchor: 'ask'` removes
 * the key — absence IS the ask state, per the runtime's contract.
 * Throws when no hub is linked or the config file is corrupt.
 */
export async function writeSyncSettings(
  repoRoot: string,
  patch: Partial<Omit<SyncSettings, 'ignoreFolders'>> & IgnoreFolderPatch
): Promise<SyncSettings> {
  const p = configPath(repoRoot);
  if (existsSync(p)) {
    try {
      JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      throw new Error(
        '.design/config.json is present but not valid JSON — fix it before changing sync settings (refusing to overwrite it)'
      );
    }
  }
  const cfg = readConfig(repoRoot);
  const hub = cfg.linkedHub as Record<string, unknown> | undefined;
  if (!hub || typeof hub.url !== 'string') {
    throw new Error('no linked hub — link a workspace before changing sync settings');
  }
  const next: Record<string, unknown> = { ...hub };
  if ('syncFiles' in patch) {
    if (patch.syncFiles === false) next.syncFiles = false;
    else delete next.syncFiles;
  }
  if ('propagateDeletes' in patch) {
    if (patch.propagateDeletes === false) next.propagateDeletes = false;
    else delete next.propagateDeletes;
  }
  if ('resolveFirstAnchor' in patch) {
    if (patch.resolveFirstAnchor === 'ask') delete next.resolveFirstAnchor;
    else if (isFirstAnchorMode(patch.resolveFirstAnchor))
      next.resolveFirstAnchor = patch.resolveFirstAnchor;
    else throw new Error(`invalid resolveFirstAnchor: ${String(patch.resolveFirstAnchor)}`);
  }
  if (patch.addIgnoreFolder !== undefined || patch.removeIgnoreFolder !== undefined) {
    const list = normalizeIgnoreFolders(hub.ignoreFolders);
    if (patch.addIgnoreFolder !== undefined) {
      const [add] = normalizeIgnoreFolders([patch.addIgnoreFolder]);
      if (!add) throw new Error(`not a folder inside the design root: ${patch.addIgnoreFolder}`);
      if (!list.includes(add)) list.push(add);
    }
    const [drop] =
      patch.removeIgnoreFolder !== undefined
        ? normalizeIgnoreFolders([patch.removeIgnoreFolder])
        : [];
    const kept = drop ? list.filter((f) => f !== drop) : list;
    // undefined, not delete: JSON.stringify drops it, so an empty list leaves no key behind.
    next.ignoreFolders = kept.length > 0 ? kept : undefined;
  }
  await Bun.write(p, `${JSON.stringify({ ...cfg, linkedHub: next }, null, 2)}\n`);
  const settings = readSyncSettings(repoRoot);
  if (!settings) throw new Error('settings write did not persist');
  return settings;
}
