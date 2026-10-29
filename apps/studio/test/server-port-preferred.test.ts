// p8-port-gc — a project's port survives rest and relaunch (Michal 2026-10-29).
//
// The desktop app records the port each project server bound (app-state.json `projects.<pid>.port`, read from the
// per-spawn shell info file) and asks for it first on the next spawn through PREFERRED_PORT_ENV. The server tries
// that port, then walks the rest of its own ladder; a preferred port outside the ladder is ignored, so the app can
// never move a server out of its range (or into the CLI's). Explicit ports stay a single try.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { scrubAgentEnv } from '../acp/env.ts';
import {
  APP_PORT_BASE,
  APP_SIDECAR_ENV,
  bindFirst,
  CLI_DEFAULT_PORT,
  E2E_PORT_BASE,
  PORT_LADDER,
  PREFERRED_PORT_ENV,
  portCandidates,
} from '../port.ts';

const ARGV = ['maude-server', '--root', '/p'];
const APP = { [APP_SIDECAR_ENV]: '1' };
const ladder = (base: number) => Array.from({ length: PORT_LADDER }, (_, i) => base + i);
const REPO = path.resolve(import.meta.dir, '../../..');

describe('portCandidates — the preferred port first', () => {
  test('no preferred port: the plain ladder', () => {
    expect(portCandidates(ARGV, APP)).toEqual(ladder(APP_PORT_BASE));
  });

  test('a recorded port inside the app ladder is tried first, then the rest of the ladder', () => {
    const c = portCandidates(ARGV, { ...APP, [PREFERRED_PORT_ENV]: String(APP_PORT_BASE + 4) });
    expect(c[0]).toBe(APP_PORT_BASE + 4);
    expect([...c].sort((a, b) => a - b)).toEqual(ladder(APP_PORT_BASE));
    expect(new Set(c).size).toBe(PORT_LADDER);
  });

  test('a preferred port outside the ladder is ignored (never the CLI range, never junk)', () => {
    for (const bad of [
      String(CLI_DEFAULT_PORT),
      String(APP_PORT_BASE + PORT_LADDER),
      '0',
      'x',
      '',
      '46400.5',
    ])
      expect([bad, portCandidates(ARGV, { ...APP, [PREFERRED_PORT_ENV]: bad })]).toEqual([
        bad,
        ladder(APP_PORT_BASE),
      ]);
  });

  test('the e2e ladder honours a preferred port inside ITS ladder', () => {
    const env = {
      ...APP,
      MAUDE_E2E_NO_KEYCHAIN: '1',
      [PREFERRED_PORT_ENV]: String(E2E_PORT_BASE + 2),
    };
    expect(portCandidates(ARGV, env)[0]).toBe(E2E_PORT_BASE + 2);
    // an app-range port is outside the e2e ladder
    const env2 = { ...env, [PREFERRED_PORT_ENV]: String(APP_PORT_BASE + 2) };
    expect(portCandidates(ARGV, env2)).toEqual(ladder(E2E_PORT_BASE));
  });

  test('an explicit port is the only try, whatever is preferred', () => {
    expect(
      portCandidates([...ARGV, '--port', '5000'], { ...APP, [PREFERRED_PORT_ENV]: '46402' })
    ).toEqual([5000]);
  });

  test('the preferred port never reaches the ACP agent', () => {
    expect(
      PREFERRED_PORT_ENV in scrubAgentEnv({ [PREFERRED_PORT_ENV]: '46402', PATH: '/bin' })
    ).toBe(false);
  });
});

describe('bindFirst — reuse, fall back when taken', () => {
  const inUse = () => Object.assign(new Error('in use'), { code: 'EADDRINUSE' });

  test('the preferred port free → bound there', () => {
    const r = bindFirst([46403, 46399, 46400], (p) => ({ port: p }));
    expect(r).toEqual({ bound: { port: 46403 }, port: 46403 });
  });

  test('the preferred port taken → the next free port in the ladder', () => {
    const taken = new Set([46403, 46399]);
    const r = bindFirst([46403, 46399, 46400, 46401], (p) => {
      if (taken.has(p)) throw inUse();
      return { port: p };
    });
    expect(r).toEqual({ bound: { port: 46400 }, port: 46400 });
  });

  test('every port taken → null with the last error; any other error throws at once', () => {
    const r = bindFirst([1, 2], () => {
      throw inUse();
    });
    expect(r.bound).toBeNull();
    expect((r as { error: { code: string } }).error.code).toBe('EADDRINUSE');
    expect(() =>
      bindFirst([1, 2], () => {
        throw new Error('boom');
      })
    ).toThrow('boom');
  });

  test('server.ts binds through portCandidates + bindFirst', () => {
    const src = readFileSync(path.join(REPO, 'apps/studio/server.ts'), 'utf8');
    expect(src).toContain('portCandidates(');
    expect(src).toContain('bindFirst(');
  });

  test('the desktop spawn passes the recorded port under the name the server reads', () => {
    const rs = readFileSync(path.join(REPO, 'apps/desktop/src-tauri/src/sidecar.rs'), 'utf8');
    expect(rs).toContain(`pub(crate) const PREFERRED_PORT_ENV: &str = "${PREFERRED_PORT_ENV}";`);
  });
});
