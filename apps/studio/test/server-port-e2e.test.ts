// p8-e2e-isolation-r13 — an e2e studio never binds the CLI's default range 4399–4408.
//
// A desktop sidecar starts with only `--root` (sidecar.rs spawn_for), so server.ts walked 4399 → 4408: whenever the
// person's own `maude design serve` was briefly down, an e2e sidecar took :4399 and their next start had to move
// ("the e2e fixture took over its server on :4399"). Under any MAUDE_E2E_* marker the ladder starts at
// E2E_PORT_BASE instead; an explicit --port / $PORT still wins, and a normal launch is unchanged.
import { describe, expect, test } from 'bun:test';

import { CLI_DEFAULT_PORT, E2E_PORT_BASE, PORT_LADDER, resolvePort } from '../port.ts';

const E2E = { MAUDE_E2E_NO_KEYCHAIN: '1', MAUDE_E2E_RUN_DIR: '/r' };
const inCliRange = (p: number) => p >= CLI_DEFAULT_PORT && p < CLI_DEFAULT_PORT + PORT_LADDER;

describe('resolvePort', () => {
  test('a desktop sidecar under e2e (`--root` only) never lands in 4399–4408', () => {
    const got = resolvePort(['bun', 'server.ts', '--root', '/fx'], E2E);
    expect(got.explicit).toBe(false);
    for (let i = 0; i < PORT_LADDER; i++) expect(inCliRange(got.port + i)).toBe(false);
    expect(got.port).toBe(E2E_PORT_BASE);
  });

  test('a person’s launch keeps the CLI default and its ladder', () => {
    expect(resolvePort(['bun', 'server.ts', '--root', '/p'], {})).toEqual({
      port: 4399,
      explicit: false,
    });
  });

  test('an explicit port always wins, e2e or not', () => {
    expect(resolvePort(['x', '--port', '5000'], E2E)).toEqual({ port: 5000, explicit: true });
    expect(resolvePort(['x', '--port', '0'], {})).toEqual({ port: 0, explicit: true });
    expect(resolvePort(['x'], { ...E2E, PORT: '6000' })).toEqual({ port: 6000, explicit: true });
    expect(resolvePort(['x'], { MDCC_DEV_PORT: '6001' })).toEqual({ port: 6001, explicit: true });
  });
});
