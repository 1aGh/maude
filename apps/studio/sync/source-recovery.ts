// Bounded recovery slots, outside the rolling snapshot queue: a corrupt peer
// cannot evict the last valid source by flooding rejected updates (#121).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './atomic-write.ts';
import { MAX_HTML_BYTES } from './limits.ts';
import { sourceError } from './source-validation.ts';

export function saveRecoveryBody(
  historyDir: string,
  file: string,
  slot: 'last-valid' | 'local' | 'incoming',
  body: string
): string {
  if (Buffer.byteLength(body, 'utf8') > MAX_HTML_BYTES)
    throw new Error('Recovery source exceeds size limit');
  const target = path.join(historyDir, 'sync-recovery', `${slot}${path.extname(file)}`);
  if (!existsSync(target) || readFileSync(target, 'utf8') !== body) atomicWrite(target, body);
  return target;
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
