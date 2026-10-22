// photo-bg-remove.sh --asset validation — fix-photo-editor-followup-debt Task
// 21. Drives the real bash script as a subprocess (mirrors annotate-write.test.ts's
// spawn-a-bin pattern) against a temp design root, asserting the strict
// `assets/<sha8>.<ext>` shape check (Task 1) rejects path traversal and
// injection-shaped values with exit 2, while a well-formed reference proceeds
// PAST validation (a missing on-disk asset then fails for a different, later
// reason — exit 1 — proving the regex, not the filesystem check, isn't what
// stopped it).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
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

const BIN = new URL('../bin/photo-bg-remove.sh', import.meta.url).pathname;

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'photo-bg-remove-test-'));
  mkdirSync(join(root, '.design'), { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(asset: string): { code: number; err: string } {
  const proc = Bun.spawnSync(['bash', BIN, '--asset', asset, '--root', root]);
  return {
    code: proc.exitCode,
    err: new TextDecoder().decode(proc.stderr),
  };
}

describe('photo-bg-remove.sh --asset validation', () => {
  test('rejects path traversal', () => {
    const res = run('assets/../../../etc/passwd');
    expect(res.code).toBe(2);
    expect(res.err).toContain('must look like assets/<sha8>.<ext>');
  });

  test('rejects an injection-shaped value (quotes/braces breaking out of the JSX splice)', () => {
    const res = run('assets/aaaaaaaa.png" }; alert(1); ({ "y.png');
    expect(res.code).toBe(2);
  });

  test('rejects backtick-embedded values', () => {
    const res = run('assets/aaaaaaaa$(whoami).png');
    expect(res.code).toBe(2);
  });

  test('rejects uppercase hex (sha8 is always lowercase in this codebase)', () => {
    const res = run('assets/DEADBEEF.png');
    expect(res.code).toBe(2);
  });

  test('rejects a bare prefix with no hex body', () => {
    const res = run('assets/');
    expect(res.code).toBe(2);
  });

  test('a well-formed reference proceeds past validation (fails later, not with exit 2)', () => {
    const res = run('assets/deadbeef.png');
    expect(res.code).not.toBe(2);
    // No asset on disk under this temp root — fails at the existence check
    // (exit 1), proving the regex accepted the shape and let it through.
    expect(res.code).toBe(1);
    expect(res.err).toContain('asset not found');
  });
});

// V2-2.4b gate — the harness must never render on the MAIN origin (where a
// planted `_photo/<slug>.bgremove.tsx` reached git push, `/_config`, paid
// generation). It opens on the canvas origin, whose canvas-safe asset +
// photo-edit writes are all it needs. A fake agent-browser records the URL.
describe('photo-bg-remove.sh opens its harness on the canvas origin', () => {
  // gate-b-c4c — the open URL carries a one-time nonce the generated harness also holds (the
  // main origin mints the frame only when they match), so a canvas that frames the guessable
  // harness URL gets no capability.
  const NONCE_URL =
    /^http:\/\/localhost:4399\/_canvas-shell\.html\?canvas=_photo\/deadbeef\.bgremove\.tsx&nonce=([0-9a-f]{32})$/;

  function drive(server: Record<string, unknown>, status = 'done') {
    const sandbox = mkdtempSync(join(tmpdir(), 'photo-bg-remove-origin-'));
    const design = join(sandbox, '.design');
    mkdirSync(join(design, 'assets'), { recursive: true });
    writeFileSync(join(design, 'assets', 'deadbeef.png'), 'png');
    writeFileSync(join(design, '_server.json'), JSON.stringify(server));
    const log = join(sandbox, 'ab.log');
    const harness = join(design, '_photo', 'deadbeef.bgremove.tsx');
    const snap = join(sandbox, 'harness.snap');
    const ab = join(sandbox, 'fake-ab.sh');
    writeFileSync(
      ab,
      [
        '#!/usr/bin/env bash',
        'case "$*" in',
        `  *" open "*) printf '%s\\n' "\${@: -1}" >> "${log}"; cp "${harness}" "${snap}" ;;`,
        '  *" data-photo-bgremove-result"*) echo assets/cafef00d.png ;;',
        `  *" data-photo-bgremove-status"*) echo ${status} ;;`,
        'esac',
        'exit 0',
        '',
      ].join('\n')
    );
    chmodSync(ab, 0o755);
    const proc = Bun.spawnSync(
      ['bash', BIN, '--asset', 'assets/deadbeef.png', '--root', sandbox, '--timeout', '2'],
      { env: { ...process.env, MAUDE_AGENT_BROWSER: ab, AGENT_BROWSER_EXECUTABLE_PATH: '/x' } }
    );
    const opened = existsSync(log) ? readFileSync(log, 'utf8').trim() : '';
    const written = existsSync(snap) ? readFileSync(snap, 'utf8') : '';
    const left = existsSync(harness);
    rmSync(sandbox, { recursive: true, force: true });
    return { code: proc.exitCode, opened, written, left };
  }

  test('split on: through the main origin, which 307s to the canvas origin with the frame', () => {
    // gate-b-c4 — the canvas origin answers nothing per canvas without the frame's capability,
    // which only the main origin mints: the helper opens the main origin's URL and its 307
    // (exactly this harness shape — photo-edit-api.test.ts pins the redirect + the PUT behind it)
    // lands on the canvas origin from _server.json.
    const res = drive({ port: 4399, canvasOrigin: 'http://localhost:51234' });
    expect(res.code).toBe(0);
    const nonce = NONCE_URL.exec(res.opened)?.[1];
    expect(nonce).toBeTruthy();
    // …the same nonce the harness holds, on its own line.
    expect(res.written).toContain(`\n// maude-harness-nonce: ${nonce}\n`);
  });

  test('every run draws a fresh nonce', () => {
    const a = NONCE_URL.exec(drive({ port: 4399 }).opened)?.[1];
    const b = NONCE_URL.exec(drive({ port: 4399 }).opened)?.[1];
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  test('split off (no canvasOrigin): the main origin, as before', () => {
    const res = drive({ port: 4399 });
    expect(res.code).toBe(0);
    expect(res.opened).toMatch(NONCE_URL);
  });

  test('the harness is deleted on every exit — success, harness error and timeout', () => {
    // A harness left behind on a failed run kept its nonce on disk for the next caller.
    for (const [status, code] of [
      ['done', 0],
      ['error', 4],
      ['pending', 5],
    ] as const) {
      const res = drive({ port: 4399, canvasOrigin: 'http://localhost:51234' }, status);
      expect(`${status} ${res.code}`).toBe(`${status} ${code}`);
      expect(res.written).toContain('maude-harness-nonce');
      expect(`${status} left=${res.left}`).toBe(`${status} left=false`);
    }
  }, 30_000);

  test('a non-loopback canvasOrigin is refused before any navigation', () => {
    const res = drive({ port: 4399, canvasOrigin: 'https://evil.example' });
    expect(res.code).toBe(1);
    expect(res.opened).toBe('');
  });
});
