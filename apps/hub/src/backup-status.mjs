// What the last backup attempt was — on disk, so it outlives the process.
//
// The backup schedule's first tick is a whole interval (six hours) after boot.
// A hub that knew about its backups only from memory therefore said "No backup
// yet" for six hours after every restart, beside a bucket full of them (seen
// live, 2026-11-25). Two things together are the truth, and neither is this
// process's memory:
//
//   • THIS FILE — the last attempt (ok or failed, when, why) and the last
//     success. Written at the one place every attempt finishes
//     (`runBackup`'s `onAttempt`). It is what makes a FAILURE survive a
//     restart: a bucket cannot tell you an upload did not arrive.
//   • THE TARGET'S OWN LISTING (`backupSummary`, backup.mjs) — which
//     generations exist, the newest one's time, how many are kept. It is what
//     is right even when this file is gone (a cell's disk) or behind (a hub
//     stopped between the upload and the write below).
//
// `<dataDir>/backup-status.json`, mode 0600, atomic write. No secret, no path
// beyond the generation's own name.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function backupStatusPath(dataDir) {
  return join(dataDir, 'backup-status.json');
}

/** `{ lastOk: {at, prefix, bytes} | null, lastAttempt: {at, ok, message?, code?} | null }` — never throws. */
export function readBackupStatus(dataDir) {
  const empty = { lastOk: null, lastAttempt: null };
  try {
    const path = backupStatusPath(dataDir);
    if (!existsSync(path)) return empty;
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return {
      lastOk: parsed?.lastOk && Number.isFinite(parsed.lastOk.at) ? parsed.lastOk : null,
      lastAttempt:
        parsed?.lastAttempt && Number.isFinite(parsed.lastAttempt.at) ? parsed.lastAttempt : null,
    };
  } catch {
    return empty;
  }
}

/** Merge `patch` into the stored status. Never throws: a status file must not fail a backup. */
export function writeBackupStatus(dataDir, patch) {
  try {
    const next = { ...readBackupStatus(dataDir), ...patch };
    const path = backupStatusPath(dataDir);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, path);
    return next;
  } catch {
    return null;
  }
}

/** Bytes in words, for the activity row. */
export function sizeWords(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
