import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

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

/**
 * p8-e2e-fix-r12 — the config pointers a studio reads before XDG (`MAUDE_UI_PREFS_PATH`, `MAUDE_CLOUD_CONFIG`) that
 * point outside any `maude-e2e-*` dir, moved into the lane's own home. wdio.conf.ts used to move them only out of the
 * home it replaced, so a lane config that named its own `maude-e2e-xdg-*` home before importing it
 * (wdio.invite-landing.conf.ts) kept the test-lane wrapper's `v2-lane-config.*` prefs — one dir for a whole job.
 */
export function e2ePointers(env: Record<string, string | undefined>): Record<string, string> {
  const home = env.XDG_CONFIG_HOME;
  if (!home || !isE2eConfigHome(home)) return {};
  const out: Record<string, string> = {};
  for (const [key, file] of [
    ['MAUDE_UI_PREFS_PATH', 'prefs.json'],
    ['MAUDE_CLOUD_CONFIG', 'cloud.json'],
  ] as const) {
    const cur = env[key];
    if (cur !== undefined && !isE2eConfigHome(dirname(cur))) out[key] = join(home, 'maude', file);
  }
  return out;
}
