// p8-e2e-fix-r11 (decision maude/v2-p8-e2e-fix-r11-rects-own-headless-session): canvas-rects.sh starts a browser
// that cannot outlive its run, and that no other run shares.
//
// The export sheet's print preflight runs `canvas-rects.sh` from the sidecar. It used the shared `default`
// agent-browser session and agent-browser's own Chrome for Testing, with no idle limit: when that daemon died
// mid-run (the e2e harness reaped it while the helper was still polling), the helper's next `eval` started a second
// daemon and a second Chrome on the same shared name, and a Chrome whose daemon was gone stayed up with the canvas
// open. So, unless the caller says otherwise, each run gets
//   - its own session (`maude-rects-<pid>`), so no other helper or agent drives or closes its page;
//   - an idle limit, so a daemon left behind by a killed helper shuts itself and its browser down;
//   - the same headless executable screenshot.sh uses (ensure-browser.sh), not a windowed Chrome for Testing.

import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = join(import.meta.dir, '..', 'bin');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A stub agent-browser that logs, per call, the launch environment it was handed. Answers like a mounted canvas. */
function stubAb() {
  const dir = mkdtempSync(join(tmpdir(), 'r11-ab-'));
  dirs.push(dir);
  const log = join(dir, 'calls.txt');
  const ab = join(dir, 'agent-browser');
  writeFileSync(
    ab,
    `#!/bin/bash
echo "$1|SESSION=\${AGENT_BROWSER_SESSION:-}|IDLE=\${AGENT_BROWSER_IDLE_TIMEOUT_MS:-}|EXE=\${AGENT_BROWSER_EXECUTABLE_PATH:-}" >> "${log}"
case "$1" in
  screenshot) out="\${@: -1}"; printf 'PNGDATA%.0s' {1..40} > "$out" ;;
  eval)
    case "$2" in
      *typeof*) echo '"function"' ;;
      *JSON.stringify*) echo '"{\\"artboards\\":[],\\"elements\\":[],\\"elementsTruncated\\":false}"' ;;
      *) echo 3 ;;
    esac ;;
esac
exit 0
`
  );
  chmodSync(ab, 0o755);
  mkdirSync(join(dir, 'repo', '.design', 'ui'), { recursive: true });
  writeFileSync(join(dir, 'repo', '.design', 'ui', 'A.tsx'), 'export default 1');
  return { dir, ab, log };
}

type Call = { verb: string; session: string; idle: string; exe: string };
const calls = (log: string): Call[] => {
  try {
    return readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [verb, s, i, e] = l.split('|');
        return {
          verb,
          session: s.slice('SESSION='.length),
          idle: i.slice('IDLE='.length),
          exe: e.slice('EXE='.length),
        };
      });
  } catch {
    return [];
  }
};

/** What screenshot.sh resolves as its headless browser on this machine (empty when there is none). */
function headlessExe(): string {
  const r = Bun.spawnSync(['bash', join(BIN, 'ensure-browser.sh'), '--quiet', '--no-download'], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' },
    stdout: 'pipe',
    stderr: 'ignore',
  });
  return r.exitCode === 0 ? r.stdout.toString().trim() : '';
}

async function rects(extra: Record<string, string> = {}) {
  const { dir, ab, log } = stubAb();
  const server = Bun.serve({ port: 0, fetch: () => new Response('ok') });
  let pid = 0;
  try {
    const proc = Bun.spawn(
      [
        'bash',
        join(BIN, 'canvas-rects.sh'),
        'ui/A.tsx',
        '--root',
        join(dir, 'repo'),
        '--port',
        String(server.port),
        '--engine',
        'agent-browser',
        '--timeout',
        '2',
      ],
      {
        env: {
          PATH: `${dir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
          HOME: process.env.HOME ?? dir,
          MAUDE_AGENT_BROWSER: ab,
          NO_OPEN: '1',
          ...extra,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );
    pid = proc.pid;
    await proc.exited;
  } finally {
    server.stop(true);
  }
  return { pid, calls: calls(log) };
}

describe('canvas-rects.sh launches its own short-lived headless browser', () => {
  test('every call of one run uses that run’s own session, an idle limit and the headless executable', async () => {
    const { pid, calls: c } = await rects();
    expect(c.length).toBeGreaterThan(2); // open, eval…, park
    const exe = headlessExe();
    for (const call of c) {
      expect(call.session).toBe(`maude-rects-${pid}`);
      expect(Number(call.idle)).toBeGreaterThan(0);
      expect(call.exe).toBe(exe);
    }
  }, 30_000);

  test('a caller’s session, idle limit and executable are kept', async () => {
    const { calls: c } = await rects({
      AGENT_BROWSER_SESSION: 'agent-own',
      AGENT_BROWSER_IDLE_TIMEOUT_MS: '1234',
      AGENT_BROWSER_EXECUTABLE_PATH: '/usr/bin/true',
    });
    expect(c.length).toBeGreaterThan(2);
    for (const call of c) {
      expect(call.session).toBe('agent-own');
      expect(call.idle).toBe('1234');
      expect(call.exe).toBe('/usr/bin/true');
    }
  }, 30_000);

  test('the idle limit outlasts the longest pause between two calls of a run', () => {
    // canvas-rects polls once a second; screenshot.sh's longest wait between calls is 2 s
    const src = readFileSync(join(BIN, '_ab-headless.sh'), 'utf8');
    const m = /AGENT_BROWSER_IDLE_TIMEOUT_MS:=(\d+)/.exec(src);
    expect(m).not.toBeNull();
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(20_000);
  });
});

describe('screenshot.sh resolves the same headless executable', () => {
  test('through the shared helper', () => {
    const sourced = /^\. "\$\(dirname "\$0"\)\/_ab-headless\.sh"$/m;
    const called = /^\s*(?:\[ [^\]]+ \] && )?ab_headless_browser\b/m;
    for (const name of ['screenshot.sh', 'canvas-rects.sh']) {
      const src = readFileSync(join(BIN, name), 'utf8');
      expect({ name, sourced: sourced.test(src), called: called.test(src) }).toEqual({
        name,
        sourced: true,
        called: true,
      });
    }
  });
});
