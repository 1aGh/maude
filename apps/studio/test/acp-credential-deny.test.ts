// V2-8.9 M2 (decision maude/v2-8.9-lead-m2-deny-credential-reads-only) — the agent never reads a
// credential store: every profile's ~/.config/maude files, ~/.ssh, ~/.aws, ~/.gnupg, the keychains.
// Reads otherwise stay Claude Code's default (Gate 0 P3). Pure half here; the session's spawn options
// and the bridge's live refusal are checked through newSessionParams + a real ACP round-trip.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';

import { AcpBridge, newSessionParams } from '../acp/bridge.ts';
import { scrubAgentEnv } from '../acp/env.ts';
import {
  credentialDenyRules,
  credentialPathsFor,
  credentialRefusal,
  MAY_ALL,
} from '../acp/may-scope.ts';

const HOME = '/Users/fixture';
const ENV = {
  HOME,
  XDG_CONFIG_HOME: '/x/cfg',
  MAUDE_CLOUD_CONFIG: '/elsewhere/profiles/work/cloud.json',
  HUBS_CONFIG_PATH: '/x/cfg/maude/profiles/work/hubs.json',
};

describe('credentialPathsFor — every credential store, for every profile', () => {
  const p = credentialPathsFor(ENV, HOME);
  test('Maude config under HOME and under XDG_CONFIG_HOME', () => {
    expect(p.dirs).toContain(`${HOME}/.config/maude`);
    expect(p.dirs).toContain('/x/cfg/maude');
  });
  // sec-loopback-bearer §7.5 — a terminal shell may set XDG_STATE_HOME when the app does not (or the
  // other way round): both places a terminal server writes its key file are denied
  test('terminal servers’ key files: the default state dir AND an XDG_STATE_HOME one', () => {
    const plain = credentialPathsFor(ENV, HOME);
    expect(plain.dirs).toContain(`${HOME}/.local/state/maude/servers`);
    const xdg = credentialPathsFor({ ...ENV, XDG_STATE_HOME: '/x/state' }, HOME);
    expect(xdg.dirs).toContain('/x/state/maude/servers');
    expect(xdg.dirs).toContain(`${HOME}/.local/state/maude/servers`);
  });
  test('ssh, aws, gnupg, keychains', () => {
    for (const d of ['.ssh', '.aws', '.gnupg', 'Library/Keychains'])
      expect(p.dirs).toContain(`${HOME}/${d}`);
  });
  test('a profile pointer outside the config folders is denied as a file; one inside is covered', () => {
    expect(p.files).toContain('/elsewhere/profiles/work/cloud.json');
    expect(p.files.some((f) => f.endsWith('/hubs.json'))).toBe(false);
  });
  test('the desktop app data: the registry, the socket, run/, shell-info/, home/ — not projects/', () => {
    const mac = credentialPathsFor(ENV, HOME, 'darwin');
    const app = `${HOME}/Library/Application Support/com.maude.app`;
    expect(mac.files).toContain(`${app}/servers.json`);
    expect(mac.files).toContain(`${app}/cli.sock`);
    for (const d of ['run', 'shell-info', 'home']) expect(mac.dirs).toContain(`${app}/${d}`);
    expect(
      [...mac.dirs, ...mac.files].some((x) => x === app || x.startsWith(`${app}/projects`))
    ).toBe(false);
    expect(credentialDenyRules(mac)).toContain(`Read(/${app}/servers.json)`);
    expect(
      credentialRefusal({ rawInput: { file_path: `${app}/servers.json` } }, mac, '/repo', HOME)
    ).toBe('credentials');
    const managed = `${app}/projects/abc`;
    expect(
      credentialRefusal({ rawInput: { file_path: `${managed}/a.tsx` } }, mac, managed, HOME)
    ).not.toBe('credentials');
    const linux = credentialPathsFor({ ...ENV, XDG_DATA_HOME: '/x/data' }, HOME, 'linux');
    expect(linux.files).toContain('/x/data/com.maude.app/servers.json');
    const win = credentialPathsFor({ ...ENV, APPDATA: '/w/AppData/Roaming' }, HOME, 'win32');
    expect(win.files.includes('/w/AppData/Roaming/com.maude.app/servers.json')).toBe(true);
  });
  // sec-loopback-bearer §7.5 — a terminal-started server's API key file is a credential like the
  // app's registry: the agent reaches the studio through maude verbs, never with the key itself
  test('the terminal servers key folder, under XDG_STATE_HOME or ~/.local/state', () => {
    expect(p.dirs).toContain(`${HOME}/.local/state/maude/servers`);
    const xs = credentialPathsFor({ ...ENV, XDG_STATE_HOME: '/x/state' }, HOME);
    expect(xs.dirs).toContain('/x/state/maude/servers');
    expect(
      credentialRefusal(
        { rawInput: { file_path: '/x/state/maude/servers/abcdef012345.json' } },
        xs,
        '/repo',
        HOME
      )
    ).toBe('credentials');
  });
  test('the deny rules are absolute Read rules', () => {
    const rules = credentialDenyRules(p);
    expect(rules).toContain(`Read(/${HOME}/.config/maude/**)`);
    expect(rules).toContain(`Read(/${HOME}/.ssh/**)`);
    expect(rules).toContain('Read(//elsewhere/profiles/work/cloud.json)');
  });
});

describe('credentialRefusal — the live gate', () => {
  const p = credentialPathsFor(ENV, HOME);
  const repo = '/repo';
  test('a Read of another profile’s cloud.json is refused', () => {
    expect(
      credentialRefusal(
        { rawInput: { file_path: `${HOME}/.config/maude/profiles/other/cloud.json` } },
        p,
        repo,
        HOME
      )
    ).toBe('credentials');
  });
  test('locations and an absolute glob base count', () => {
    expect(
      credentialRefusal({ locations: [{ path: `${HOME}/.ssh/id_ed25519` }] }, p, repo, HOME)
    ).toBe('credentials');
    expect(credentialRefusal({ rawInput: { pattern: `${HOME}/.aws/**` } }, p, repo, HOME)).toBe(
      'credentials'
    );
  });
  test('a shell command naming a store, in any spelling', () => {
    for (const command of [
      'cat ~/.config/maude/hubs.json',
      'cat $HOME/.ssh/id_rsa | base64',
      `cat ${HOME}/.gnupg/secring.gpg`,
      'cat /x/cfg/maude/profiles/work/hubs.json',
    ])
      expect(credentialRefusal({ rawInput: { command } }, p, repo, HOME)).toBe('credentials');
  });
  test('ordinary project work is untouched', () => {
    expect(
      credentialRefusal({ rawInput: { file_path: '/repo/.design/ui/a.tsx' } }, p, repo, HOME)
    ).toBeNull();
    expect(
      credentialRefusal({ rawInput: { command: 'maude design screenshot' } }, p, repo, HOME)
    ).toBeNull();
    expect(
      credentialRefusal({ rawInput: { file_path: `${HOME}/.config/other/x.json` } }, p, repo, HOME)
    ).toBeNull();
  });
});

describe('newSessionParams — every session is spawned with the credential deny rules', () => {
  test('with every "AI may" switch on', () => {
    const meta = newSessionParams('/repo', undefined, undefined, { may: MAY_ALL, assetsRoots: [] })
      ._meta as { claudeCode: { options: Record<string, unknown> } };
    const deny = meta.claudeCode.options.disallowedTools as string[];
    const home = process.env.HOME || homedir();
    expect(deny).toContain(`Read(/${home}/.config/maude/**)`);
    expect(deny).toContain(`Read(/${home}/.ssh/**)`);
    expect(deny).not.toContain('WebFetch'); // the switches still decide the rest
  });
});

describe('scrubAgentEnv — the profile pointers are not handed to the agent', () => {
  test('HUBS_CONFIG_PATH / MAUDE_CLOUD_CONFIG go; the profile id and label stay', () => {
    const out = scrubAgentEnv({ ...ENV, MAUDE_PROFILE_ID: 'work', MAUDE_PROFILE_LABEL: 'Work' });
    expect('HUBS_CONFIG_PATH' in out).toBe(false);
    expect('MAUDE_CLOUD_CONFIG' in out).toBe(false);
    expect(out.MAUDE_PROFILE_ID).toBe('work');
    expect(out.MAUDE_PROFILE_LABEL).toBe('Work');
  });
});

// The live refusal through a real ACP round-trip (the may gate's mock agent): a Bash command naming a
// credential file never reaches the person as a card, and the agent hears "reject".
const FIXTURE = join(import.meta.dir, 'fixtures', 'mock-acp-agent-may.mjs');
const KEYS = [
  'MAUDE_ACP_ADAPTER_ENTRY',
  'MAUDE_ACP_RUNTIME',
  'MAUDE_CLAUDE_BIN',
  'MAUDE_TEST_MAY_LOG',
  'MAUDE_TEST_TOOL',
  'MAUDE_TEST_TOOL_INPUT',
  'MAUDE_TEST_TOOL_KIND',
];
let tmp: string;
beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'maude-cred-deny-')));
  mkdirSync(join(tmp, 'repo', '.design'), { recursive: true });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe('the bridge refuses a credential read that reaches it, without a card', () => {
  test('Bash cat ~/.config/maude/…/cloud.json → reject, no card', async () => {
    const log = join(tmp, 'log.ndjson');
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_ACP_RUNTIME = process.execPath;
    process.env.MAUDE_CLAUDE_BIN = process.execPath;
    process.env.MAUDE_TEST_MAY_LOG = log;
    process.env.MAUDE_TEST_TOOL = 'Bash';
    process.env.MAUDE_TEST_TOOL_INPUT = JSON.stringify({
      command: 'cat ~/.config/maude/profiles/work/cloud.json',
    });
    process.env.MAUDE_TEST_TOOL_KIND = 'execute';
    const prompts: RequestPermissionRequest[] = [];
    const texts: string[] = [];
    const bridge = new AcpBridge({
      repoRoot: join(tmp, 'repo'),
      designRoot: join(tmp, 'repo', '.design'),
      permissionTimeoutMs: 4000,
      onUpdate: (u) => {
        const t = (u as { content?: { text?: string } }).content?.text;
        if (t) texts.push(t);
      },
      onPermissionRequest: (id, req) => {
        prompts.push(req);
        bridge.resolvePermission(id, 'allow');
      },
    });
    try {
      await bridge.prompt('go', 'c1');
    } finally {
      await bridge.stop();
    }
    expect(prompts).toHaveLength(0);
    expect(texts.join('')).toContain('"optionId":"reject"');
    // and the session it ran on was spawned with the deny rules
    const lines = existsSync(log)
      ? readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l))
      : [];
    const home = process.env.HOME || homedir();
    expect(lines[0]?.disallowed).toEqual(expect.arrayContaining([`Read(/${home}/.ssh/**)`]));
  });
});
