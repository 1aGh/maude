// V2-8.9 M1 (decision maude/v2-8.9-lead-m1-canvas-navigation-gate): while "AI may › Search the web" is
// off, the agent's session carries MAUDE_NO_EGRESS=1, and every headless browser a `maude design` helper
// starts for it resolves only loopback — agent-browser through a dead loopback proxy (bin/_no-egress.sh),
// Playwright with Chromium host-resolver rules (bin/_pw-launch.mjs). Without the variable nothing changes.

import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { newSessionParams } from '../acp/bridge.ts';
import { MAY_ALL, mayEnv, NO_EGRESS_ENV } from '../acp/may-scope.ts';
import { NO_EGRESS_CHROMIUM_ARGS, noEgressLaunchOptions } from '../bin/_pw-launch.mjs';

const BIN = join(import.meta.dir, '..', 'bin');

const optionsOf = (p: ReturnType<typeof newSessionParams>): Record<string, unknown> =>
  (p._meta?.claudeCode as { options?: Record<string, unknown> } | undefined)?.options ?? {};

describe('the bridge marks a web-off session', () => {
  test('mayEnv: only web off sets it', () => {
    expect(NO_EGRESS_ENV).toBe('MAUDE_NO_EGRESS');
    expect(mayEnv({ assets: true, web: false })).toEqual({ MAUDE_NO_EGRESS: '1' });
    expect(mayEnv({ assets: false, web: true })).toEqual({});
    expect(mayEnv(MAY_ALL)).toEqual({});
  });
  test('newSessionParams carries it as the session env (the adapter merges it over process.env)', () => {
    const off = newSessionParams('/tmp/r', undefined, undefined, {
      may: { assets: true, web: false },
      assetsRoots: [],
    });
    expect(optionsOf(off).env).toEqual({ MAUDE_NO_EGRESS: '1' });
    const on = newSessionParams('/tmp/r', undefined, undefined, { may: MAY_ALL, assetsRoots: [] });
    expect(optionsOf(on).env).toBeUndefined();
  });
});

describe('Playwright lane: host-resolver rules', () => {
  test('args appear with the variable and not without', () => {
    const rules = '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost';
    expect(NO_EGRESS_CHROMIUM_ARGS).toContain(rules);
    const on = noEgressLaunchOptions({ headless: true, args: ['--x'] }, { MAUDE_NO_EGRESS: '1' });
    expect(on.args).toEqual(['--x', ...NO_EGRESS_CHROMIUM_ARGS]);
    expect(on.headless).toBe(true);
    const off = noEgressLaunchOptions({ headless: true, args: ['--x'] }, {});
    expect(off.args).toEqual(['--x']);
    expect(noEgressLaunchOptions(undefined, { MAUDE_NO_EGRESS: '1' }).args).toEqual([
      ...NO_EGRESS_CHROMIUM_ARGS,
    ]);
    expect(noEgressLaunchOptions(undefined, { MAUDE_NO_EGRESS: '0' })).toEqual({});
  });
  test('launchChromium applies it on every launch, the retry included', () => {
    const src = readFileSync(join(BIN, '_pw-launch.mjs'), 'utf8');
    const at = src.indexOf('export async function launchChromium(');
    const body = src.slice(at, src.indexOf('\n}\n', at));
    expect(body).not.toContain('chromium.launch(opts)');
    expect(body.match(/chromium\.launch\(/g)?.length).toBe(
      body.match(/chromium\.launch\(\{ \.\.\.safe|chromium\.launch\(safe\)/g)?.length
    );
  });
});

/** A stub agent-browser that records its env and argv, then fails (so the helper stops). */
function stubAb() {
  const dir = mkdtempSync(join(tmpdir(), 'm1-ab-'));
  const log = join(dir, 'log.txt');
  const ab = join(dir, 'agent-browser');
  writeFileSync(
    ab,
    `#!/bin/bash\n{ echo "ARGV=$*"; echo "PROXY=\${AGENT_BROWSER_PROXY:-}"; echo "ARGS=\${AGENT_BROWSER_ARGS:-}"; echo "SESSION=\${AGENT_BROWSER_SESSION:-}"; echo "NO_PROXY=\${NO_PROXY:-}"; } >> "${log}"\nexit 1\n`
  );
  chmodSync(ab, 0o755);
  return { dir, ab, log };
}

function runScreenshot(extraEnv: Record<string, string>) {
  const { dir, ab, log } = stubAb();
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: dir,
    MAUDE_AGENT_BROWSER: ab,
    AGENT_BROWSER_EXECUTABLE_PATH: '/usr/bin/true',
    NO_OPEN: '1',
    NO_PROXY: 'corp.example',
    ...extraEnv,
  };
  Bun.spawnSync(
    [
      'bash',
      join(BIN, 'screenshot.sh'),
      '--url',
      'http://localhost:1/_canvas-shell.html',
      '--full',
      '--out',
      join(dir, 'shot.png'),
      '--engine',
      'agent-browser',
      '--timeout',
      '1',
    ],
    { env, stdout: 'pipe', stderr: 'pipe' }
  );
  let text = '';
  try {
    text = readFileSync(log, 'utf8');
  } catch {
    /* the stub never ran */
  }
  return text;
}

describe('agent-browser lane: screenshot.sh', () => {
  test('MAUDE_NO_EGRESS=1 → a dead loopback proxy, WebRTC pinned, a session of its own', () => {
    const log = runScreenshot({ MAUDE_NO_EGRESS: '1' });
    expect(log).toContain('ARGV=');
    expect(log).toContain('PROXY=http://127.0.0.1:9');
    expect(log).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
    expect(log).toContain('SESSION=default-noegress');
    expect(log).not.toContain('NO_PROXY=corp.example');
  }, 30_000);
  test('without it nothing changes', () => {
    const log = runScreenshot({});
    expect(log).toContain('ARGV=');
    expect(log).toContain('PROXY=\n');
    expect(log).not.toContain('webrtc');
    expect(log).not.toContain('noegress');
  }, 30_000);
});

describe('_no-egress.sh sourced on its own', () => {
  const run = (env: Record<string, string>) =>
    Bun.spawnSync(
      [
        'bash',
        '-c',
        `. "${join(BIN, '_no-egress.sh')}"; . "${join(BIN, '_no-egress.sh')}"; printf '%s|%s|%s' "$AGENT_BROWSER_PROXY" "$AGENT_BROWSER_ARGS" "$AGENT_BROWSER_SESSION"`,
      ],
      { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...env } }
    ).stdout.toString();
  test('idempotent when a helper runs another helper', () => {
    expect(run({ MAUDE_NO_EGRESS: '1', AGENT_BROWSER_SESSION: 'maude-shell-shot' })).toBe(
      'http://127.0.0.1:9|--force-webrtc-ip-handling-policy=disable_non_proxied_udp|maude-shell-shot-noegress'
    );
    expect(run({ AGENT_BROWSER_SESSION: 'x' })).toBe('||x');
  });
});

describe('every agent-browser helper sources it before its first browser call', () => {
  for (const name of ['screenshot.sh', 'canvas-rects.sh', 'perf.sh', 'photo-bg-remove.sh']) {
    test(name, () => {
      const src = readFileSync(join(BIN, name), 'utf8');
      const sourced = src.search(/^\. "\$\(dirname "\$0"\)\/_no-egress\.sh"$/m);
      expect(sourced).toBeGreaterThan(-1);
      const firstCall = src.search(/^\s*(?:[A-Z_]+=\$\()?"\$AB" /m);
      const firstNode = src.search(/^\s*node "\$SCRIPT_DIR\/_perf-probe\.mjs"|_perf-probe\.mjs"/m);
      expect(firstCall === -1 || sourced < firstCall).toBe(true);
      expect(firstNode === -1 || sourced < firstNode).toBe(true);
    });
  }
});

describe("perf's Safari lane cannot take a proxy", () => {
  test('refused under MAUDE_NO_EGRESS=1 before safaridriver starts', () => {
    const src = readFileSync(join(BIN, 'perf.sh'), 'utf8');
    const lane = src.indexOf('if [ "$PROBE_ENGINE" = "safari" ]; then');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal shell expansion
    const refuse = src.indexOf('if [ "${MAUDE_NO_EGRESS:-}" = "1" ]; then', lane);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal shell expansion
    const start = src.indexOf('_perf-probe-safari.mjs" "${ARGS[@]}"', lane);
    expect(lane).toBeGreaterThan(-1);
    expect(refuse).toBeGreaterThan(lane);
    expect(refuse).toBeLessThan(start);
    expect(src.slice(refuse, refuse + 300)).toContain('exit 1');
  });
});
