// V2-3.4 (old T9) — the server and the CLI resolve hubs.json to the SAME path for every
// profile env. A project tab's server reads hubs.json through sync/hubs-config.ts;
// `maude design link`, run from that tab's AI session (which inherits the tab's env), writes it
// through cli/lib/hubs-config.mjs. If the two disagree on HUBS_CONFIG_PATH / XDG_CONFIG_HOME,
// a link lands in a profile the server never reads — silently. Both resolvers, one matrix.
// (cli/lib/hubs-config.test.mjs pins the same expected paths under node.)

import { afterEach, describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';

// @ts-expect-error — plain .mjs, no declaration file
import { hubsConfigPath as cliHubsConfigPath } from '../../../cli/lib/hubs-config.mjs';
import { hubsConfigPath } from '../sync/hubs-config.ts';

// Bun caches os.homedir() at startup (node re-reads $HOME), so the home case is pinned to the
// real home here and to a fixture HOME in the node test.
const HOME = homedir();
const KEYS = ['HUBS_CONFIG_PATH', 'XDG_CONFIG_HOME'] as const;
const prior = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

const MATRIX: { name: string; env: Record<string, string>; want: string }[] = [
  { name: 'env unset', env: {}, want: `${HOME}/.config/maude/hubs.json` },
  { name: 'XDG_CONFIG_HOME', env: { XDG_CONFIG_HOME: '/x/cfg' }, want: '/x/cfg/maude/hubs.json' },
  {
    name: 'empty XDG_CONFIG_HOME',
    env: { XDG_CONFIG_HOME: '' },
    want: `${HOME}/.config/maude/hubs.json`,
  },
  { name: 'HUBS_CONFIG_PATH', env: { HUBS_CONFIG_PATH: '/p/b/hubs.json' }, want: '/p/b/hubs.json' },
  {
    name: 'empty HUBS_CONFIG_PATH',
    env: { HUBS_CONFIG_PATH: '' },
    want: `${HOME}/.config/maude/hubs.json`,
  },
  {
    name: 'both (HUBS_CONFIG_PATH wins)',
    env: { HUBS_CONFIG_PATH: '/p/b/hubs.json', XDG_CONFIG_HOME: '/x/cfg' },
    want: '/p/b/hubs.json',
  },
];

function setEnv(env: Record<string, string>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
}

afterEach(() => {
  for (const k of KEYS) {
    if (prior[k] === undefined) delete process.env[k];
    else process.env[k] = prior[k];
  }
});

describe('hubs.json path parity (server ↔ CLI)', () => {
  for (const c of MATRIX) {
    test(c.name, () => {
      setEnv(c.env);
      expect(hubsConfigPath()).toBe(c.want);
      expect(cliHubsConfigPath()).toBe(c.want);
    });
  }
});
