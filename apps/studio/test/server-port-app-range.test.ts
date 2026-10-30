// p8-app-port-range — the desktop app's project servers own a fixed ladder, 46399–46408 (decision
// maude/v2-michal-desktop-own-port-range).
//
// The app started a project server with only `--root`, so it walked the CLI's 4399 → 4408 and collided with the
// person's own `maude design serve`. The Rust spawn (sidecar.rs spawn_for) now sets APP_SIDECAR_ENV; resolvePort
// maps it to APP_PORT_BASE. Precedence stays: --port > $PORT/$MDCC_DEV_PORT > $MAUDE_PORT_BASE > e2e > app > CLI —
// an e2e sidecar keeps the e2e ladder, so a test run never takes a port inside the person's own app range.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { scrubAgentEnv } from '../acp/env.ts';
import {
  APP_PORT_BASE,
  APP_SIDECAR_ENV,
  CLI_DEFAULT_PORT,
  E2E_PORT_BASE,
  PORT_LADDER,
  resolvePort,
} from '../port.ts';

const APP = { [APP_SIDECAR_ENV]: '1' };
const E2E = { MAUDE_E2E_NO_KEYCHAIN: '1' };
const ARGV = ['maude-server', '--root', '/p'];
const REPO = path.resolve(import.meta.dir, '../../..');
const read = (rel: string) => readFileSync(path.join(REPO, rel), 'utf8');

describe('resolvePort — the app range', () => {
  test('an app sidecar starts its ladder at 46399, not the CLI 4399', () => {
    expect(APP_PORT_BASE).toBe(46399);
    expect(resolvePort(ARGV, APP)).toEqual({ port: APP_PORT_BASE, explicit: false });
  });

  test('the e2e marker wins over the app marker', () => {
    expect(resolvePort(ARGV, { ...APP, ...E2E })).toEqual({ port: E2E_PORT_BASE, explicit: false });
  });

  test('$MAUDE_PORT_BASE still moves the ladder (the journeys / evals harness)', () => {
    expect(resolvePort(ARGV, { ...APP, MAUDE_PORT_BASE: '48399' })).toEqual({
      port: 48399,
      explicit: false,
    });
  });

  test('an explicit port still wins', () => {
    expect(resolvePort([...ARGV, '--port', '5000'], APP)).toEqual({ port: 5000, explicit: true });
    expect(resolvePort(ARGV, { ...APP, PORT: '6000' })).toEqual({ port: 6000, explicit: true });
  });

  test('only "1" marks an app spawn; a normal launch is unchanged', () => {
    expect(resolvePort(ARGV, { [APP_SIDECAR_ENV]: '' }).port).toBe(CLI_DEFAULT_PORT);
    expect(resolvePort(ARGV, { [APP_SIDECAR_ENV]: '0' }).port).toBe(CLI_DEFAULT_PORT);
    expect(resolvePort(ARGV, {}).port).toBe(CLI_DEFAULT_PORT);
  });

  // The agent a tab's server spawns must not inherit the marker: a `maude design serve` it runs for another folder
  // would otherwise take a port in the app's own range (and a crashed sidecar's respawn would find it taken).
  test('the marker never reaches the ACP agent', () => {
    expect(APP_SIDECAR_ENV in scrubAgentEnv({ ...APP, PATH: '/bin' })).toBe(false);
  });
});

describe('the four ladders never overlap', () => {
  // The harness base is hard-coded in each harness launcher; every one must agree.
  const harnessFiles = [
    'apps/studio/test/agent-journeys/lanes/common.mjs',
    'apps/studio/test/agent-evals/lib/agentenv.mjs',
    'apps/studio/test/agent-evals/lib/render.mjs',
    'scripts/check-client-boots-source.mjs',
    'scripts/check-v1-characterization.mjs',
    'scripts/v2-perf-boot.mjs',
  ];
  const harnessBases = harnessFiles.map((f) => {
    const m = /MAUDE_PORT_BASE \?\? '(\d+)'/.exec(read(f));
    if (!m) throw new Error(`${f}: no MAUDE_PORT_BASE default`);
    return Number(m[1]);
  });

  test('every harness launcher uses the same base', () => {
    expect(new Set(harnessBases).size).toBe(1);
  });

  test('CLI · app · e2e · harness are disjoint, in range, and wide enough for the running cap', () => {
    const ladders = [
      ['cli', CLI_DEFAULT_PORT],
      ['app', APP_PORT_BASE],
      ['e2e', E2E_PORT_BASE],
      ['harness', harnessBases[0]],
    ] as const;
    for (const [, base] of ladders) expect(base + PORT_LADDER - 1).toBeLessThan(65536);
    for (let i = 0; i < ladders.length; i++)
      for (let j = i + 1; j < ladders.length; j++) {
        const [a, x] = ladders[i];
        const [b, y] = ladders[j];
        const overlap = x < y + PORT_LADDER && y < x + PORT_LADDER;
        expect(`${a}/${b} ${overlap ? 'overlap' : 'disjoint'}`).toBe(`${a}/${b} disjoint`);
      }
    // A tab past RUNNING_CAP rests, so at most RUNNING_CAP app servers hold a port at once.
    const cap = Number(
      /const RUNNING_CAP: usize = (\d+);/.exec(read('apps/desktop/src-tauri/src/sidecar.rs'))?.[1]
    );
    expect(cap).toBeGreaterThan(0);
    expect(cap).toBeLessThanOrEqual(PORT_LADDER);
  });

  test('the desktop spawn sets the marker the server reads', () => {
    const rs = read('apps/desktop/src-tauri/src/sidecar.rs');
    expect(rs).toContain(`pub(crate) const APP_SIDECAR_ENV: &str = "${APP_SIDECAR_ENV}";`);
    expect(rs).toContain('.env(APP_SIDECAR_ENV, "1")');
  });
});
