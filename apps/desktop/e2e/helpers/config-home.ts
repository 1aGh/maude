import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

/**
 * A config home this harness made: a `maude-e2e-*` dir (wdio.conf.ts makes `maude-e2e-xdg-*` under the temp dir) —
 * never the person's `~/.config`, and never a home some other wrapper handed in (scripts/v2-test-lane.sh's
 * `v2-lane-config.*` is one per JOB, so a full run shared it across every lane).
 */
export function isE2eConfigHome(dir: string | undefined): boolean {
  if (!dir) return false;
  const abs = resolve(dir);
  const real = join(homedir(), '.config');
  if (abs === real || abs.startsWith(real + sep)) return false;
  return abs.split(sep).some((p) => p.startsWith('maude-e2e-'));
}
