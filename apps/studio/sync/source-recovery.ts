// Bounded recovery slots, outside the rolling snapshot queue: a corrupt peer
// cannot evict the last valid source by flooding rejected updates (#121).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './atomic-write.ts';
import { MAX_HTML_BYTES } from './limits.ts';
import { sourceError } from './source-validation.ts';

/**
 * `base` is the body disk and doc last agreed on — the merge base a restart
 * needs, since the journal keeps only its hash (audit 2026-09-13 P0 #1).
 */
export type RecoverySlot = 'last-valid' | 'local' | 'incoming' | 'base';

export function saveRecoveryBody(
  historyDir: string,
  file: string,
  slot: RecoverySlot,
  body: string
): string {
  if (Buffer.byteLength(body, 'utf8') > MAX_HTML_BYTES)
    throw new Error('Recovery source exceeds size limit');
  const target = path.join(historyDir, 'sync-recovery', `${slot}${path.extname(file)}`);
  if (!existsSync(target) || readFileSync(target, 'utf8') !== body) atomicWrite(target, body);
  return target;
}

/** One recovery slot's body, or null when absent/unreadable/oversized. */
export function readRecoveryBody(
  historyDir: string,
  file: string,
  slot: RecoverySlot
): string | null {
  const target = path.join(historyDir, 'sync-recovery', `${slot}${path.extname(file)}`);
  try {
    if (statSync(target).size > MAX_HTML_BYTES) return null;
    return readFileSync(target, 'utf8');
  } catch {
    return null;
  }
}

export function lastValidSource(historyDir: string, file: string): string | null {
  const ext = path.extname(file);
  const retained = path.join(historyDir, 'sync-recovery', `last-valid${ext}`);
  let candidates = [retained];
  try {
    candidates = candidates.concat(
      readdirSync(historyDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(ext))
        .map((e) => e.name)
        .sort()
        .reverse()
        .slice(0, 300)
        .map((name) => path.join(historyDir, name))
    );
  } catch {
    /* no older history */
  }
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).size > MAX_HTML_BYTES) continue;
      const body = readFileSync(candidate, 'utf8');
      if (body.trim() && sourceError(file, body) === null) return body;
    } catch {
      /* try the next snapshot */
    }
  }
  return null;
}
