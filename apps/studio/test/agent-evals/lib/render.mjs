// agent-evals/lib/render.mjs — render-based grader: boot the trial's studio, screenshot artboards,
// flag blank captures. Uses the worktree CLI directly (not the shim) with the trial studio's env, so
// grading reuses the studio the trial booted (lib/trial.mjs) and never feeds the Stop-gate shot log of
// the run it grades. With no `env` (a re-grade of an old trial) it boots one, as before.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './paths.mjs';
import { pngStats } from './png.mjs';
import { scanCanvas } from './tsx.mjs';

const ENV = (repo) => ({
  ...process.env,
  NO_OPEN: '1',
  MAUDE_NO_AUTOBUILD: '1',
  MAUDE_FORCE_SOURCE: '1',
  MAUDE_PORT_BASE: process.env.MAUDE_PORT_BASE ?? '48399',
  CLAUDE_PROJECT_DIR: repo,
});

/**
 * The headless browser the capture drives, resolved against the PERSON's HOME. A trial's studio env has a
 * throwaway HOME (lib/trial.mjs), where `ensure-browser` cannot see the Playwright headless shell under
 * ~/Library/Caches and falls back to the system Google Chrome — not the browser the live agent's own
 * captures use. Resolve it once here, from the real HOME, and hand the path to the capture so the grader and
 * the agent screenshot with the same engine. null → the caller's own default stays.
 * (The cause of the v2-8.16 "navigation failed" was the daemon's socket path, see `socketDirFor`.)
 */
let headless;
export function headlessBrowser(realEnv = process.env) {
  if (headless !== undefined) return headless;
  const r = spawnSync(
    'bash',
    [join(REPO_ROOT, 'apps', 'studio', 'bin', 'ensure-browser.sh'), '--quiet', '--no-download'],
    { env: realEnv, encoding: 'utf8', timeout: 30_000 }
  );
  const path = String(r.stdout ?? '').trim().split('\n').pop();
  headless = r.status === 0 && path && existsSync(path) ? path : null;
  return headless;
}

/** The env a capture runs in: the trial's, plus the real headless browser unless the caller pinned one. */
function captureEnv(env, project, session) {
  const base = env ? { ...env, CLAUDE_PROJECT_DIR: project } : ENV(project);
  // Its own agent-browser session per capture. screenshot.sh closes its session on exit (_ab-park.sh); the
  // daemon is still going down when the next capture starts on the SAME name, which then dies with
  // "Invalid response: EOF while parsing" — so every capture after the first in a row failed. A caller's pin wins.
  if (session && !base.AGENT_BROWSER_SESSION) base.AGENT_BROWSER_SESSION = session;
  if (base.AGENT_BROWSER_EXECUTABLE_PATH) return base;
  const exe = headlessBrowser();
  return exe ? { ...base, AGENT_BROWSER_EXECUTABLE_PATH: exe } : base;
}

export function serverUp(cli, project, env = null) {
  const r = spawnSync('node', [cli, 'design', 'server-up', '--root', project, '--timeout', '30'], {
    env: env ? { ...env, CLAUDE_PROJECT_DIR: project } : ENV(project),
    encoding: 'utf8',
    timeout: 60_000,
  });
  const port = String(r.stdout ?? '')
    .trim()
    .split('\n')
    .pop();
  return /^\d+$/.test(port) ? Number(port) : null;
}

export function serverDown(project) {
  const p = join(project, '.design', '_server.json');
  if (!existsSync(p)) return;
  try {
    const { pid } = JSON.parse(readFileSync(p, 'utf8'));
    if (pid) process.kill(pid, 'SIGTERM');
  } catch {}
}

/** Which (canvas, artboard) pairs to capture for a task. */
export function renderTargets(task, grade, project) {
  if (!task.render) return [];
  if (Array.isArray(task.render))
    return task.render.flatMap((r) => r.artboards.map((a) => ({ canvas: r.canvas, artboard: a })));
  const out = [];
  for (const [canvas, att] of Object.entries(grade.touchedArtboards ?? {})) {
    for (const a of att.artboards.slice(0, 4)) out.push({ canvas, artboard: a });
  }
  for (const line of grade.changed) {
    const m = /^(\?\?|A) \.design\/(.+\.tsx)$/.exec(line);
    if (!m) continue;
    try {
      const s = scanCanvas(m[2], readFileSync(join(project, '.design', m[2]), 'utf8'));
      for (const ab of s.artboards.slice(0, 6)) out.push({ canvas: m[2], artboard: ab.id });
    } catch {}
  }
  return out.slice(0, 8);
}

export function renderCheck({ cli, project, trialDir, targets, env = null }) {
  const shots = [];
  if (!targets.length) return { ran: false, shots };
  const port = serverUp(cli, project, env);
  if (!port) return { ran: true, error: 'server did not start', shots };
  mkdirSync(join(trialDir, 'shots'), { recursive: true });
  for (const [i, t] of targets.entries()) {
    const out = join(
      trialDir,
      'shots',
      `${t.canvas.replace(/[^A-Za-z0-9]+/g, '_')}--${t.artboard}.png`
    );
    const r = spawnSync(
      'node',
      [
        cli,
        'design',
        'screenshot',
        '--root',
        project,
        '--port',
        String(port),
        '--canvas',
        t.canvas,
        '--screen',
        t.artboard,
        '--out',
        out,
        '--timeout',
        '15',
      ],
      {
        env: captureEnv(env, project, `r${i}`),
        encoding: 'utf8',
        timeout: 90_000,
      }
    );
    let stats = null;
    if (r.status === 0 && existsSync(out)) {
      try {
        stats = pngStats(out);
      } catch (e) {
        stats = { error: String(e.message) };
      }
    }
    shots.push({
      ...t,
      path: existsSync(out) ? out : null,
      exit: r.status,
      stats,
      err:
        r.status === 0
          ? ''
          : String(r.stderr ?? '')
              .split('\n')
              .filter(Boolean)
              .slice(-6)
              .join(' | '),
    });
  }
  return { ran: true, port, shots };
}

export function gitDiff(project, max = 30_000) {
  try {
    const stat = execFileSync('git', ['-c', 'core.quotepath=off', 'diff', '--stat', 'HEAD'], {
      cwd: project,
      encoding: 'utf8',
    });
    const body = execFileSync('git', ['-c', 'core.quotepath=off', 'diff', 'HEAD'], {
      cwd: project,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: project,
      encoding: 'utf8',
    });
    const text = `${stat}\nUntracked (new) files:\n${untracked}\n${body}`;
    return text.length > max ? `${text.slice(0, max)}\n… (diff truncated at ${max} chars)` : text;
  } catch (e) {
    return `(diff failed: ${e.message})`;
  }
}
