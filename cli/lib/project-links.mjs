// cli/lib/project-links.mjs — the CLI's writer half of the per-Mac link record (gate-b-sec4, M1).
//
// Mirror of apps/studio/sync/link-consent.ts `recordProjectLink` / `deleteProjectLink` (the studio
// owns the reader): `project-links.json` beside hubs.json, mode 0600, keyed by the repo root's
// realpath. `maude design link` is a person linking this folder on this Mac, so it writes a record;
// unlink / detach forget it. Same shape, same key, same path rule — keep the two in step
// (cli/lib/project-links.test.mjs pins the shape against the studio's).

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { hubsConfigPath, normalizeUrl } from './hubs-config.mjs';

/** `project-links.json` beside hubs.json (`MAUDE_PROJECT_LINKS_PATH` overrides). */
export function projectLinksPath() {
  return (
    process.env.MAUDE_PROJECT_LINKS_PATH || join(dirname(hubsConfigPath()), 'project-links.json')
  );
}

function folderKey(root) {
  try {
    return realpathSync(root);
  } catch {
    return resolve(root);
  }
}

function load(file) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object' && raw.links && typeof raw.links === 'object') {
      return { v: 1, since: Number.isFinite(raw.since) ? raw.since : 0, links: raw.links };
    }
  } catch {
    /* absent or malformed */
  }
  return null;
}

function save(file, data) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    /* best effort */
  }
  renameSync(tmp, file);
}

/** A person linked `repoRoot` to `url` on this Mac (`maude design link`). */
export function recordProjectLink(repoRoot, url, { workspaceId, how = 'link' } = {}) {
  const file = projectLinksPath();
  const now = Date.now();
  const store = load(file) ?? { v: 1, since: now, links: {} };
  store.links[folderKey(repoRoot)] = {
    hub: normalizeUrl(url),
    ...(workspaceId ? { workspaceId } : {}),
    at: now,
    how,
  };
  save(file, store);
}

/** Forget `repoRoot`'s record (unlink / detach). Best-effort. */
export function deleteProjectLink(repoRoot) {
  const file = projectLinksPath();
  if (!existsSync(file)) return;
  const store = load(file);
  const key = folderKey(repoRoot);
  if (!store || !(key in store.links)) return;
  delete store.links[key];
  try {
    save(file, store);
  } catch {
    /* best effort */
  }
}
