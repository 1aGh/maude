// agent-evals/lib/trial.mjs — the throwaway studio one trial runs against (V2-8.16b).
//
// The released design plugin's hooks and the shipped verbs (`maude design check|runs|screenshot`, the
// trash route) talk to a RUNNING studio. A trial therefore boots its own, on the trial's unlinked
// fixture clone, exactly as agent-journeys' terminal lane does (lanes/common.mjs):
//   - NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 MAUDE_FORCE_SOURCE=1 and its own MAUDE_MACHINE_FILE;
//   - a THROWAWAY HOME / XDG_CONFIG_HOME with the stub `claude` first on PATH (scripts/lib/stub-claude.mjs),
//     so the studio never reads ~/.config/maude, the real keychain or the real `claude`;
//   - the busy fixture's "another AI holds the hub artboard" is made REAL: a second hook session claims it
//     through run/begin + edit/check, so `maude design runs list` and the hook's `artboard-busy` deny read
//     the real registry.
// Only the model process (`claude -p`, run.mjs) gets the person's real HOME — it needs the login.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { stubClaudeEnv } from '../../../../../scripts/lib/stub-claude.mjs';
import {
  CLI,
  harnessEnv,
  holdArtboard,
  studioDown,
  studioUp,
} from '../../agent-journeys/lanes/common.mjs';
import { holdInForce } from './runstate.mjs';
import { scanCanvas } from './tsx.mjs';

export { CLI };

/** The env every process of the trial's STUDIO side gets (studio, check, runs, screenshots, graders). */
export function studioEnv(trialDir, base = process.env) {
  const home = join(trialDir, 'home');
  mkdirSync(join(home, '.config'), { recursive: true });
  return harnessEnv(
    {
      ...base,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_DATA_HOME: join(home, '.local', 'share'),
      XDG_CACHE_HOME: join(home, '.cache'),
      ...stubClaudeEnv(home, base.PATH),
    },
    join(home, 'machine.json')
  );
}

/**
 * A replayable edit that changes ONLY `artboard` of `canvas` (designRoot-relative): a text literal that
 * occurs once in the file and sits in the component the artboard renders (or in the artboard itself),
 * not one of `skip`. → { old, new }.
 */
export function uniqueTextIn(project, canvas, artboard, skip = []) {
  const src = readFileSync(join(project, '.design', canvas), 'utf8');
  const scan = scanCanvas(canvas, src);
  const ab = scan.artboards.find((a) => a.id === artboard);
  if (!ab) throw new Error(`no artboard ${artboard} in ${canvas}`);
  const regions = [src.slice(ab.start, ab.end)];
  for (const m of regions[0].matchAll(/<([A-Z]\w*)/g)) {
    const decl = scan.decls.find((d) => d.names.includes(m[1]));
    if (decl) regions.push(src.slice(decl.start, decl.end));
  }
  for (const body of regions.reverse()) {
    for (const m of body.matchAll(/>([A-Za-z][^<>{}\n]{5,60})</g)) {
      const text = m[1];
      if (!skip.includes(text) && src.split(text).length === 2)
        return { old: text, new: `${text}!` };
    }
  }
  throw new Error(`no unique text in ${canvas} › ${artboard}`);
}

/** The edit that claims the busy artboard (the first such text). */
export const holdEditFor = (project, canvas, artboard) => uniqueTextIn(project, canvas, artboard);

/** `maude design runs list --json` on the trial's studio → parsed JSON, or { error }. */
export function runsList(project, env) {
  const r = spawnSync('node', [CLI, 'design', 'runs', 'list', '--json', '--root', project], {
    env: { ...env, CLAUDE_PROJECT_DIR: project },
    encoding: 'utf8',
    timeout: 30_000,
  });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { error: `${r.status}: ${String(r.stderr || r.stdout).slice(0, 300)}` };
  }
}

/**
 * Boot the trial's studio on `project` and make the fixture's world real. `manifest.busy` →
 * another AI session holds the busy artboard. → { port, env, view, stop() }.
 */
export async function startTrial(project, trialDir, manifest = {}) {
  const env = studioEnv(trialDir);
  const port = studioUp(project, env);
  const held = [];
  try {
    if (manifest.busy) {
      const edit = holdEditFor(project, manifest.busy.canvas, manifest.busy.artboard);
      held.push(
        await holdArtboard(project, {
          canvas: manifest.busy.canvas,
          old: edit.old,
          new: edit.new,
        })
      );
    }
  } catch (e) {
    studioDown(project);
    throw e;
  }
  const trial = {
    port,
    env,
    held,
    view: () => runsList(project, env),
    async stop() {
      for (const h of held.splice(0)) await h.end().catch(() => null);
      await stopStudio(project);
    },
  };
  if (manifest.busy) {
    const view = trial.view();
    if (!holdInForce(view, manifest.busy.canvas, manifest.busy.artboard)) {
      await trial.stop();
      throw new Error(
        `busy fixture: the hold on ${manifest.busy.artboard} is not in the registry: ${JSON.stringify(view).slice(0, 300)}`
      );
    }
  }
  return trial;
}

/** SIGTERM the project's studio and wait for it to be gone (SIGKILL after 10 s). */
export async function stopStudio(project) {
  const p = join(project, '.design', '_server.json');
  let pid = null;
  try {
    pid = JSON.parse(readFileSync(p, 'utf8')).pid;
  } catch {}
  studioDown(project);
  if (!pid) return;
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (let i = 0; i < 100 && alive(); i++) await new Promise((r) => setTimeout(r, 100));
  if (alive()) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
}
