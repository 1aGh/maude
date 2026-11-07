// screenshot.sh --frame <N> — issue #128 §6 (T1.1).
//
// `maude design screenshot --screen <id> --frame <N>` captures a video-comp artboard at frame N: the
// viewport is sized to the artboard (a tall one is not clipped), the canvas's `__maude_seek__` bridge is
// driven in strict mode, the shot waits for a paint, and a canvas without the bridge fails loud instead
// of shipping the frame-0 black shot the flag exists to avoid. Driven through a stub agent-browser so
// the ORDER of the calls is what is pinned.

import { afterAll, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = join(import.meta.dir, '..', 'bin');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function run(extra: string[], opts: { seekHook: boolean } = { seekHook: true }) {
  const dir = mkdtempSync(join(tmpdir(), 'shotf-'));
  dirs.push(dir);
  const log = join(dir, 'calls.txt');
  const ab = join(dir, 'agent-browser');
  writeFileSync(
    ab,
    `#!/bin/bash
echo "$*" >> "${log}"
case "$1" in
  screenshot) out="\${@: -1}"; printf 'PNGDATA%.0s' {1..40} > "$out" ;;
  eval)
    case "$2" in
      *"typeof window.__maude_seek__"*) echo '"${opts.seekHook ? 'yes' : 'no'}"' ;;
      *"__maude_seek__("*) echo '"seeked"' ;;
      *getBoundingClientRect*) echo '"1080x1900"' ;;
      *) echo 3 ;;
    esac ;;
esac
exit 0
`
  );
  chmodSync(ab, 0o755);
  const sockDir = mkdtempSync(join(tmpdir(), 'shotfs-'));
  dirs.push(sockDir);
  mkdirSync(join(dir, 'home'));
  const out = join(dir, 'shot.png');
  const r = Bun.spawnSync(
    [
      'bash',
      join(BIN, 'screenshot.sh'),
      '--url',
      'http://localhost:1/_canvas-shell.html?canvas=.design/ui/Reel.tsx',
      '--out',
      out,
      '--engine',
      'agent-browser',
      '--timeout',
      '1',
      ...extra,
    ],
    {
      env: {
        PATH: `${dir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        HOME: join(dir, 'home'),
        MAUDE_AGENT_BROWSER: ab,
        AGENT_BROWSER_EXECUTABLE_PATH: '/usr/bin/true',
        AGENT_BROWSER_SOCKET_DIR: sockDir,
        NO_OPEN: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  let lines: string[] = [];
  try {
    lines = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  } catch {}
  return {
    code: r.exitCode,
    lines,
    stderr: r.stderr.toString(),
    stdout: r.stdout.toString(),
    out,
  };
}

const idx = (lines: string[], pred: (l: string) => boolean) => lines.findIndex(pred);

describe('screenshot.sh --frame', () => {
  test('sizes the viewport to the artboard, seeks strictly, waits for paint, then shoots', () => {
    const { code, lines, out } = run(['--screen', 'reel', '--frame', '42']);
    expect(code).toBe(0);
    expect(existsSync(out)).toBe(true);
    const viewport = idx(lines, (l) => l === 'set viewport 1080 1900');
    const seek = idx(lines, (l) => l.startsWith('eval') && l.includes('__maude_seek__(42'));
    const paint = idx(lines, (l) => l.startsWith('eval') && l.includes('requestAnimationFrame'));
    const shot = idx(lines, (l) => l.startsWith('screenshot '));
    expect(viewport).toBeGreaterThan(-1);
    expect(seek).toBeGreaterThan(viewport);
    expect(lines[seek]).toContain('strict: true');
    expect(paint).toBeGreaterThan(seek);
    expect(shot).toBeGreaterThan(paint);
  }, 30_000);

  test('a canvas with no __maude_seek__ bridge fails loud and writes no shot', () => {
    const { code, lines, stderr, out } = run(['--screen', 'reel', '--frame', '7'], {
      seekHook: false,
    });
    expect(code).toBe(3);
    expect(stderr).toContain('__maude_seek__');
    expect(stderr).toContain('--frame');
    expect(lines.some((l) => l.startsWith('screenshot '))).toBe(false);
    expect(existsSync(out)).toBe(false);
  }, 30_000);

  test('without --frame nothing is seeked or resized (unchanged behaviour)', () => {
    const { code, lines } = run(['--screen', 'reel']);
    expect(code).toBe(0);
    expect(lines.some((l) => l.includes('__maude_seek__'))).toBe(false);
    expect(lines.some((l) => l.startsWith('set viewport'))).toBe(false);
  }, 30_000);

  test('refuses a bad frame, and --frame with --all-screens or --shell', () => {
    for (const bad of ['abc', '-1', '1.5', '']) {
      const r = run(['--screen', 'reel', '--frame', bad]);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('--frame');
    }
    expect(run(['--all-screens', '--out-dir', tmpdir(), '--frame', '3']).code).toBe(2);
    expect(run(['--shell', '--frame', '3']).code).toBe(2);
  }, 60_000);
});
