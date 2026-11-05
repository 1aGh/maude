// Internal helper behind _ds-check.mjs — 2.0.5 (#205): ask the project's running studio which canvases it
// refused after their build (`/_index-data` `canvasRefusedInputs`), for `ds-check --canvas`.
//
// The studio is found the one way every in-process verb finds it (cli/lib/studio-locate.mjs): the
// `_server.json` PORT only, on 127.0.0.1, a live pid, and `/_health` naming THIS root — so a planted
// `_server.json` cannot point ds-check at another host or project. Any failure → "no studio": ds-check then
// says so and prints the static reasons only.
import { resolve } from 'node:path';
import { locateStudio } from '../../../cli/lib/studio-locate.mjs';
import { NO_STUDIO, refusedFromIndex } from '../ds/post-build.ts';

/** The project root ds-check will use (`--root`, else $CLAUDE_PROJECT_DIR, else the cwd). */
export function rootOf(argv, env = process.env, cwd = process.cwd()) {
  const i = argv.indexOf('--root');
  return resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : (env.CLAUDE_PROJECT_DIR ?? cwd));
}

/** Only the canvas modes that print a per-canvas report look; a PostToolUse hook never waits on a studio. */
export function wantsLive(argv) {
  if (argv.includes('--hook') || argv.includes('--cheatsheet')) return false;
  return argv.some((a) => a === '--canvas' || a === '--canvases' || a === '--changed');
}

/** `{ live, refused }` — never throws, never touches anything but 127.0.0.1. `locate` is for tests. */
export async function liveRefusals(root, { locate = locateStudio, timeoutMs = 1500 } = {}) {
  try {
    const studio = await locate(root, { timeoutMs });
    if (!studio) return NO_STUDIO;
    const res = await fetch(`${studio.base}/_index-data`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return NO_STUDIO;
    return { live: true, refused: refusedFromIndex(await res.json()) };
  } catch {
    return NO_STUDIO;
  }
}
