// Internal: the canvas-rects manifest for `place` / `layout-check` (V2-2.4b). `--rects <file>` reads
// a manifest canvas-rects already printed; otherwise this runs the sibling canvas-rects.sh (live
// render when a studio is up, else the static artboard-only lane).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function parseCommon(argv, extraValueFlags = []) {
  const out = { pos: [], json: false };
  const valued = new Set(['--root', '--rects', ...extraValueFlags]);
  for (let i = 0; i < argv.length; i++) {
    const w = argv[i];
    const [flag, inline] = w.startsWith('--') ? w.split(/=(.*)/s) : [w];
    if (flag === '--json') out.json = true;
    else if (valued.has(flag)) out[flag.slice(2)] = inline !== undefined ? inline : argv[++i];
    else if (flag.startsWith('--')) return { error: `unknown flag ${flag}` };
    else out.pos.push(w);
  }
  return out;
}

function projectRoot(start) {
  let cur = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(cur, '.design', 'config.json'))) return cur;
    const up = path.dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}

/** `{ canvas, manifest }` or `{ error, code }`. */
export function loadRects(args, scriptDir) {
  const root = args.root
    ? path.resolve(args.root)
    : projectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  let canvas = args.pos[0];
  if (!canvas && root) {
    try {
      canvas = JSON.parse(readFileSync(path.join(root, '.design', '_active.json'), 'utf8'))?.active;
    } catch {
      /* no active canvas */
    }
  }
  if (typeof canvas === 'string') canvas = canvas.replace(/^\.design\//, '');
  if (args.rects) {
    try {
      return { canvas: canvas ?? 'canvas', manifest: JSON.parse(readFileSync(args.rects, 'utf8')) };
    } catch {
      return { error: `cannot read --rects ${args.rects}`, code: 2 };
    }
  }
  if (!root)
    return {
      error: 'no .design/config.json here or above — run it inside a Maude project',
      code: 2,
    };
  if (!canvas) return { error: 'name a canvas (no active canvas in _active.json)', code: 2 };
  const r = spawnSync('bash', [path.join(scriptDir, 'canvas-rects.sh'), canvas, '--root', root], {
    encoding: 'utf8',
    env: process.env,
  });
  if (r.status !== 0) return { error: `canvas-rects failed: ${(r.stderr || '').trim()}`, code: 1 };
  try {
    return { canvas, manifest: JSON.parse(r.stdout) };
  } catch {
    return { error: 'canvas-rects printed no manifest', code: 1 };
  }
}
