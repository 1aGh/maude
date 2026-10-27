// p8-e2e-fix-r10 (decision maude/v2-p8-e2e-fix-r10-captures-close-their-page): a headless capture never
// outlives itself as a collab peer.
//
// An agent-browser session is a daemon. A canvas page a capture left open in it keeps reconnecting to
// whatever server answers on that port next and pushes its copy of the canvas document into that room: a
// Print canvas left open on :4400 by a 03:36 capture merged one more copy of its source into every later
// e2e run's room, 22 copies by 05:38, until the sync refused the body (the cloud lane's "1 source change was
// not applied" red). So every helper that opens a page parks it on about:blank and closes the session on
// exit — success, failure or a timeout alike — and a helper that never opened one starts no browser.

import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = join(import.meta.dir, '..', 'bin');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/**
 * A stub agent-browser that records each call, one per line. `works`: it answers like a page that mounted
 * (a canvas with screens, the rects hook, a written PNG); otherwise every call fails.
 */
function stubAb(works: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'r10-ab-'));
  dirs.push(dir);
  const log = join(dir, 'calls.txt');
  const ab = join(dir, 'agent-browser');
  writeFileSync(
    ab,
    `#!/bin/bash
echo "$*" >> "${log}"
${works ? '' : 'exit 1'}
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
  return { dir, ab, log };
}

const calls = (log: string) => {
  try {
    return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
};

/** The page it opened is parked and its session closed — the last two calls, in that order. */
function expectParked(lines: string[]) {
  expect(lines.some((l) => /^open http:\/\/localhost:/.test(l))).toBe(true);
  expect(lines.slice(-2)).toEqual(['open about:blank', 'close']);
}

function env(dir: string, ab: string, extra: Record<string, string> = {}) {
  return {
    PATH: `${dir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    HOME: dir,
    MAUDE_AGENT_BROWSER: ab,
    AGENT_BROWSER_EXECUTABLE_PATH: '/usr/bin/true',
    NO_OPEN: '1',
    ...extra,
  };
}

function screenshot(works: boolean) {
  const { dir, ab, log } = stubAb(works);
  const r = Bun.spawnSync(
    [
      'bash',
      join(BIN, 'screenshot.sh'),
      '--url',
      'http://localhost:1/_canvas-shell.html?canvas=.design/ui/Print.tsx',
      '--full',
      '--out',
      join(dir, 'shot.png'),
      '--engine',
      'agent-browser',
      '--timeout',
      '1',
    ],
    { env: env(dir, ab), stdout: 'pipe', stderr: 'pipe' }
  );
  return { code: r.exitCode, lines: calls(log) };
}

describe('screenshot.sh', () => {
  test('a capture that worked parks its page and closes the session — and still succeeds', () => {
    const { code, lines } = screenshot(true);
    expect(lines.some((l) => l.startsWith('screenshot --full '))).toBe(true);
    expectParked(lines);
    expect(code).toBe(0);
  }, 30_000);
  test('a capture that failed parks and closes too — and still fails', () => {
    const { code, lines } = screenshot(false);
    expectParked(lines);
    expect(code).not.toBe(0);
  }, 30_000);
});

describe('canvas-rects.sh', () => {
  test('the live lane parks its page and closes the session', async () => {
    const { dir, ab, log } = stubAb(true);
    mkdirSync(join(dir, 'repo', '.design', 'ui'), { recursive: true });
    writeFileSync(join(dir, 'repo', '.design', 'ui', 'A.tsx'), 'export default 1');
    // a live "dev server" for its /_health probe — the helper must run async, or this loop cannot answer
    const server = Bun.serve({ port: 0, fetch: () => new Response('ok') });
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
        { env: env(dir, ab), stdout: 'pipe', stderr: 'pipe' }
      );
      await proc.exited;
    } finally {
      server.stop(true);
    }
    expectParked(calls(log));
  }, 30_000);
  test('the static lane (no server) starts no browser at all', () => {
    const { dir, ab, log } = stubAb(true);
    mkdirSync(join(dir, 'repo', '.design', 'ui'), { recursive: true });
    writeFileSync(join(dir, 'repo', '.design', 'ui', 'A.tsx'), 'export default 1');
    Bun.spawnSync(
      [
        'bash',
        join(BIN, 'canvas-rects.sh'),
        'ui/A.tsx',
        '--root',
        join(dir, 'repo'),
        '--port',
        '1',
      ],
      { env: env(dir, ab), stdout: 'pipe', stderr: 'pipe' }
    );
    expect(calls(log)).toEqual([]);
  }, 30_000);
});

describe('every helper that opens a page arms the park before its first open', () => {
  for (const name of ['screenshot.sh', 'canvas-rects.sh', 'smoke.sh']) {
    test(name, () => {
      const src = readFileSync(join(BIN, name), 'utf8');
      const sourced = src.search(/^\. "\$\(dirname "\$0"\)\/_ab-park\.sh"$/m);
      expect(sourced).toBeGreaterThan(-1);
      const armed = src.search(/^\s*(?:\[ [^\]]+ \] && )?ab_park_arm\b/m);
      expect(armed).toBeGreaterThan(sourced);
      // whether the arm runs before the main flow's first open is behaviour — the runtime tests above
      // cover it; here: no later `trap … EXIT` may replace the park's
      expect(src.search(/^\s*trap /m)).toBe(-1);
    });
  }
  test('_perf-probe.mjs closes its own session on exit', () => {
    const src = readFileSync(join(BIN, '_perf-probe.mjs'), 'utf8');
    expect(src).toMatch(/process\.on\('exit', parkSession\)/);
    expect(src).toContain("[['open', 'about:blank'], ['close']]");
    // armed before the first open
    expect(src.indexOf('opened = true;')).toBeLessThan(src.indexOf("ab(['open', opts.url])"));
  });
});
