// #168 — the TypeScript e2e switches (`MAUDE_E2E_*`) are honoured only when the build is NOT a release build.
// Each switch is pinned in both halves: honoured when `release` is false, ignored when it is true. The release
// constant itself comes from `build.ts` (`releaseDefines`), pinned below.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { fakeInstallEnabled, installRefusal, wellKnownInstallPath } from '../acp/login-state.ts';
import { isE2eEnv, resolveClaudePath } from '../acp/probe.ts';
import { resolvePort } from '../port.ts';
import { e2eForcedClaudeStatus } from '../readiness.ts';
import { e2eSwitch, IS_RELEASE_BUILD, releaseDefines } from '../release-build.ts';

const whichReal = (bin: string) => (bin === 'claude' ? '/usr/local/bin/claude' : null);

describe('e2e switches are ignored by a release build', () => {
  test('a run from source is not a release build', () => {
    expect(IS_RELEASE_BUILD).toBe(false);
  });

  test('e2eSwitch reads the variable only outside a release build', () => {
    const env = { MAUDE_E2E_X: '1' };
    expect(e2eSwitch(env, 'MAUDE_E2E_X', false)).toBe('1');
    expect(e2eSwitch(env, 'MAUDE_E2E_X', true)).toBeUndefined();
  });

  test('isE2eEnv: any MAUDE_E2E_ marker counts outside a release build, none inside', () => {
    const env = { MAUDE_E2E_RUN_DIR: '/tmp/x' };
    expect(isE2eEnv(env, false)).toBe(true);
    expect(isE2eEnv(env, true)).toBe(false);
  });

  test('forced "claude missing" is ignored by a release build', () => {
    const env = { MAUDE_E2E_FORCE_CLAUDE_STATUS: 'missing' };
    expect(resolveClaudePath(env, whichReal, false)).toBeNull();
    expect(resolveClaudePath(env, whichReal, true)).toBe('/usr/local/bin/claude');
  });

  test('an e2e marker no longer blocks the PATH lookup in a release build', () => {
    const env = { MAUDE_E2E_RUN_DIR: '/tmp/x' };
    expect(resolveClaudePath(env, whichReal, false)).toBeNull();
    expect(resolveClaudePath(env, whichReal, true)).toBe('/usr/local/bin/claude');
  });

  test('readiness forced status is ignored by a release build', () => {
    const env = { MAUDE_E2E_FORCE_CLAUDE_STATUS: 'signed-out' };
    expect(e2eForcedClaudeStatus(env, false)).toBe('signed-out');
    expect(e2eForcedClaudeStatus(env, true)).toBeUndefined();
  });

  test('the install-path redirect and the fake installer are ignored by a release build', () => {
    const env = {
      MAUDE_E2E_CLAUDE_INSTALL_PATH: '/tmp/e2e/claude',
      MAUDE_E2E_FAKE_CLAUDE_INSTALL: '1',
    };
    expect(wellKnownInstallPath(env, false)).toBe('/tmp/e2e/claude');
    expect(wellKnownInstallPath(env, true)).toBe(
      join(process.env.HOME ?? '', '.local', 'bin', 'claude')
    );
    expect(fakeInstallEnabled(env, false)).toBe(true);
    expect(fakeInstallEnabled(env, true)).toBe(false);
  });

  test('the install refusal is an e2e-lane rule only', () => {
    const env = { MAUDE_E2E_RUN_DIR: '/tmp/x' };
    expect(installRefusal(env, false)).not.toBeNull();
    expect(installRefusal(env, true)).toBeNull();
  });

  test('the e2e port ladder is ignored by a release build', () => {
    const env = { MAUDE_E2E_RUN_DIR: '/tmp/x' };
    expect(resolvePort([], env, false).port).toBe(47399);
    expect(resolvePort([], env, true).port).not.toBe(47399);
  });
});

describe('build.ts defines the release constant fail-closed', () => {
  test('--release defines it; a plain build, the e2e sidecar and nothing else do not', () => {
    expect(releaseDefines({ release: true, e2e: false, cloud: false })).toEqual({
      __MAUDE_RELEASE_BUILD__: 'true',
    });
    expect(releaseDefines({ release: false, e2e: false, cloud: false })).toEqual({});
    expect(releaseDefines({ release: true, e2e: true, cloud: false })).toEqual({});
  });

  test('the cloud variant is always a release, even with --e2e', () => {
    expect(releaseDefines({ release: true, e2e: true, cloud: true })).toEqual({
      __MAUDE_RELEASE_BUILD__: 'true',
    });
  });
});
