// agent-evals/lib/render.mjs — render-based grader: boot the trial's studio, screenshot artboards,
// flag blank captures. Uses the worktree CLI directly (not the shim), so grading never feeds the
// Stop-gate shot log of the run it grades.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { pngStats } from './png.mjs';
import { scanCanvas } from './tsx.mjs';

const ENV = (repo) => ({
  ...process.env,
  NO_OPEN: '1',
  MAUDE_NO_AUTOBUILD: '1',
  MAUDE_FORCE_SOURCE: '1',
  CLAUDE_PROJECT_DIR: repo,
});

export function serverUp(cli, project) {
  const r = spawnSync('node', [cli, 'design', 'server-up', '--root', project, '--timeout', '30'], {
    env: ENV(project),
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

export function renderCheck({ cli, project, trialDir, targets }) {
  const shots = [];
  if (!targets.length) return { ran: false, shots };
  const port = serverUp(cli, project);
  if (!port) return { ran: true, error: 'server did not start', shots };
  mkdirSync(join(trialDir, 'shots'), { recursive: true });
  for (const t of targets) {
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
        env: ENV(project),
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
              .slice(-2)
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
