// p8-e2e-isolation-r13 — under a desktop e2e lane no code path may resolve a `claude` outside the lane's stub.
//
// The 2026-10-27 V2-8.3 record: the lane put a stub `claude` first on PATH and emptied MAUDE_CLAUDE_BIN, yet a
// project sidecar's ACP adapter spawned the person's real `~/.local/bin/claude` (HOME = the person's, so the real
// keychain). The sidecar's PATH was the person's login-shell PATH (sidecar.rs resolve_login_path), and
// resolveClaudePath fell through to `Bun.which('claude')` on it. Under any MAUDE_E2E_* marker the resolver now
// answers ONLY the explicit MAUDE_CLAUDE_BIN — never a PATH lookup, never the readiness login-shell fallback.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installRefusal } from '../acp/login-state.ts';
import { isE2eEnv, resolveClaudePath } from '../acp/probe.ts';
import { resolveClaudeOnPathForReadiness } from '../readiness.ts';

const REAL = '/Users/someone/.local/bin/claude';
const whichReal = (bin: string) => (bin === 'claude' ? REAL : null);

const E2E = {
  MAUDE_E2E_FAKE_KEYCHAIN: '1',
  MAUDE_E2E_NO_KEYCHAIN: '1',
  MAUDE_CLAUDE_AUTOSETUP_ENABLED: '1',
  MAUDE_CLAUDE_BIN: '',
  MAUDE_E2E_RUN_DIR: '/tmp/maude-e2e-run/app-boots-and-renders-canvas',
};

describe('e2e claude lock', () => {
  test('the e2e markers are any non-empty MAUDE_E2E_* variable', () => {
    expect(isE2eEnv(E2E)).toBe(true);
    expect(isE2eEnv({ MAUDE_E2E_LANE_STARTED: '1761571798000' })).toBe(true);
    expect(isE2eEnv({ MAUDE_E2E_ON_TOP: '' })).toBe(false);
    expect(isE2eEnv({ PATH: '/usr/bin', MAUDE_CLAUDE_BIN: '' })).toBe(false);
  });

  test('V2-8.3 record: e2e env with an empty MAUDE_CLAUDE_BIN never resolves the real ~/.local/bin/claude', () => {
    expect(resolveClaudePath(E2E, whichReal)).toBeNull();
  });

  test('e2e env honours the lane stub named by MAUDE_CLAUDE_BIN', () => {
    const dir = mkdtempSync(join(tmpdir(), 'maude-e2e-stub-'));
    const stub = join(dir, 'claude');
    writeFileSync(stub, '#!/bin/sh\necho \'{"loggedIn":false}\'\n', { mode: 0o755 });
    expect(resolveClaudePath({ ...E2E, MAUDE_CLAUDE_BIN: stub }, whichReal)).toBe(stub);
  });

  test('readiness never falls back to the login shell under e2e', async () => {
    let shelled = false;
    const got = await resolveClaudeOnPathForReadiness(
      E2E,
      async () => {
        shelled = true;
        return REAL;
      },
      whichReal
    );
    expect(got).toBeNull();
    expect(shelled).toBe(false);
  });

  test('a normal launch is unchanged: PATH lookup, then the login-shell fallback', async () => {
    const normal = { PATH: '/usr/bin', MAUDE_CLAUDE_BIN: '' };
    expect(resolveClaudePath(normal, whichReal)).toBe(REAL);
    expect(await resolveClaudeOnPathForReadiness(normal, async () => REAL, whichReal)).toBe(REAL);
  });
});

describe('e2e install lock', () => {
  test('an e2e lane never runs the real `curl | bash` installer (it writes the real ~/.local/bin/claude)', () => {
    expect(installRefusal({ MAUDE_E2E_RUN_DIR: '/r' })).toMatch(/e2e/);
    expect(
      installRefusal({ MAUDE_E2E_RUN_DIR: '/r', MAUDE_E2E_FAKE_CLAUDE_INSTALL: '1' })
    ).toBeNull();
    expect(installRefusal({})).toBeNull();
  });
});
