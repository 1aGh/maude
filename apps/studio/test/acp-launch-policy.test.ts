// F4 (B3) — the agent-native launch policies Maude writes per session for Codex and opencode.
// Contract: .ai/plans/notes/universal-acp-contract.md § "Launch policies" + DDR-252.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CODEX, isOfferable, OPENCODE } from '../acp/agents/catalog.ts';
import type { PolicyCtx } from '../acp/agents/descriptor.ts';
import { codexLaunchPolicy, runtimeStateDirs, userTrees } from '../acp/policy/launch-codex.ts';
import {
  externalDirectory,
  OPENCODE_EXTERNAL_DIRECTORY_MAP,
  OPENCODE_FLAGS,
  opencodeLaunchPolicy,
} from '../acp/policy/launch-opencode.ts';
import { AGENT_RUNTIME_OUTPUTS } from '../acp/write-scope.ts';
import { RUNTIME_STATE_DIRS } from '../sync/file-membership.ts';

const HOME = '/Users/u';
const MAC = { platform: 'darwin' as const, home: HOME };
const LINUX = { platform: 'linux' as const, home: '/home/u' };

function ctx(over: Partial<PolicyCtx> = {}): PolicyCtx {
  return {
    scopeRoot: '/Users/u/git/proj',
    readRoots: [
      '/Users/u/git/proj',
      '/Users/u/git/proj/.design',
      '/Applications/Maude.app/Contents/Resources',
      '/var/folders/x/T/maude-chat-501/abc/default',
    ],
    writeRoots: ['/Users/u/git/proj', '/var/folders/x/T/maude-chat-501/abc/default'],
    credentialPaths: {
      dirs: ['/Users/u/.config/maude', '/Users/u/.ssh', '/Users/u/git/proj/.secrets'],
      files: ['/Users/u/Library/Application Support/com.maude.app/servers.json'],
    },
    may: { assets: true, web: false },
    designRoots: ['/Users/u/git/proj/.design'],
    agentBin: '/Users/u/.local/bin/codex',
    ...over,
  };
}

/**
 * The runtime-state folders of the fixture's design root (DDR-115 list): `none` unless the agent
 * owns it (`AGENT_RUNTIME_OUTPUTS`, left writable by the scope). A `read` inside a write root does
 * not stop a Seatbelt write (measured, F6b).
 */
const RUNTIME_READ_ONLY: Record<string, string> = Object.fromEntries(
  RUNTIME_STATE_DIRS.filter((d) => !AGENT_RUNTIME_OUTPUTS.includes(`_${d}`)).map((d) => [
    `/Users/u/git/proj/.design/_${d}`,
    'none',
  ])
);

type CodexCfg = {
  web_search: string;
  default_permissions: string;
  permissions: { maude: { extends: string; filesystem: Record<string, string> } };
  mcp_servers: Record<string, unknown>;
  hooks: Record<string, unknown>;
};
const codexCfg = (c: PolicyCtx, host = MAC): CodexCfg =>
  JSON.parse(codexLaunchPolicy(c, host).env.CODEX_CONFIG ?? 'null');

describe('codex launch policy', () => {
  test('env: the discovered binary, workspace-write mode, a JSON config', () => {
    const env = codexLaunchPolicy(ctx(), MAC).env;
    expect(env.CODEX_PATH).toBe('/Users/u/.local/bin/codex');
    expect(env.INITIAL_AGENT_MODE).toBe('workspace-write');
    expect(Object.keys(env).sort()).toEqual(['CODEX_CONFIG', 'CODEX_PATH', 'INITIAL_AGENT_MODE']);
  });

  test('profile maude extends :workspace and is the default; web search off; own mcp/hooks emptied', () => {
    const cfg = codexCfg(ctx());
    expect(cfg.default_permissions).toBe('maude');
    expect(cfg.permissions.maude.extends).toBe(':workspace');
    expect(cfg.web_search).toBe('disabled');
    expect(cfg.mcp_servers).toEqual({});
    expect(cfg.hooks).toEqual({});
  });

  test('may.web on does not widen it: web search stays disabled', () => {
    const cfg = codexCfg(ctx({ may: { assets: true, web: true } }));
    expect(cfg.web_search).toBe('disabled');
    expect(cfg.permissions.maude.extends).toBe(':workspace');
  });

  test('filesystem: user trees none, read roots read, write roots write, credentials none', () => {
    const fs = codexCfg(ctx()).permissions.maude.filesystem;
    expect(fs).toEqual({
      '/Users': 'none',
      '/Volumes': 'none',
      '/Users/u/git/proj': 'write',
      '/Users/u/git/proj/.design': 'read',
      '/Applications/Maude.app/Contents/Resources': 'read',
      '/var/folders/x/T/maude-chat-501/abc/default': 'write',
      '/Users/u/.config/maude': 'none',
      '/Users/u/.ssh': 'none',
      '/Users/u/git/proj/.secrets': 'none',
      '/Users/u/Library/Application Support/com.maude.app/servers.json': 'none',
      ...RUNTIME_READ_ONLY,
    });
  });

  test('B3: runtime state the agent does not own is denied; its own output folders stay writable', () => {
    const fs = codexCfg(ctx()).permissions.maude.filesystem;
    for (const d of ['_canvas-state', '_state', '_chat', '_comments', '_untrusted', '_trash']) {
      expect([d, fs[`/Users/u/git/proj/.design/${d}`]]).toEqual([d, 'none']);
    }
    for (const d of ['_history', '_draw', '_smoke']) {
      // not named: the writable scope above covers it, as for Claude (AGENT_RUNTIME_OUTPUTS)
      expect([d, fs[`/Users/u/git/proj/.design/${d}`]]).toEqual([d, undefined]);
    }
    // the design root itself keeps what its roots gave it; the scope stays writable
    expect(fs['/Users/u/git/proj']).toBe('write');
  });

  test('B3: every design-root spelling is covered; one outside the write roots is not named', () => {
    const fs = codexCfg(
      ctx({ designRoots: ['/Users/u/git/proj/.design', '/Users/u/elsewhere/.design'] })
    ).permissions.maude.filesystem;
    expect(fs['/Users/u/git/proj/.design/_chat']).toBe('none');
    // naming it would change what Codex may read outside its roots
    expect(fs['/Users/u/elsewhere/.design/_chat']).toBeUndefined();
    expect(runtimeStateDirs(['/a/p/.design'], ['/a/p'])).toContain('/a/p/.design/_chat');
    expect(runtimeStateDirs(['/a/p/.design'], ['/b'])).toEqual([]);
  });

  test('B3: a runtime folder inside a credential store stays denied', () => {
    const fs = codexCfg(
      ctx({
        credentialPaths: { dirs: ['/Users/u/git/proj/.design/_state'], files: [] },
      })
    ).permissions.maude.filesystem;
    expect(fs['/Users/u/git/proj/.design/_state']).toBe('none');
  });

  test('the scope root is writable even when writeRoots omits it', () => {
    const fs = codexCfg(ctx({ writeRoots: [] })).permissions.maude.filesystem;
    expect(fs['/Users/u/git/proj']).toBe('write');
    expect(fs['/var/folders/x/T/maude-chat-501/abc/default']).toBe('read');
  });

  test('a root inside a credential store is dropped (it would out-rank the deny)', () => {
    const fs = codexCfg(
      ctx({ readRoots: ['/Users/u/git/proj', '/Users/u/.ssh/keys'], writeRoots: ['/Users/u/.ssh'] })
    ).permissions.maude.filesystem;
    expect(fs['/Users/u/.ssh/keys']).toBeUndefined();
    expect(fs['/Users/u/.ssh']).toBe('none');
  });

  test('paths are normalised', () => {
    const fs = codexCfg(ctx({ readRoots: ['/Users/u/git/proj/', '/Users/u/git/other/../lib'] }))
      .permissions.maude.filesystem;
    expect(fs['/Users/u/git/lib']).toBe('read');
    expect(Object.keys(fs).every((k) => !k.endsWith('/') && !k.includes('..'))).toBe(true);
  });

  test('a relative root, scope or binary throws', () => {
    expect(() => codexLaunchPolicy(ctx({ readRoots: ['proj'] }), MAC)).toThrow(/absolute/);
    expect(() => codexLaunchPolicy(ctx({ writeRoots: ['./proj'] }), MAC)).toThrow(/absolute/);
    expect(() => codexLaunchPolicy(ctx({ scopeRoot: 'proj' }), MAC)).toThrow(/absolute/);
    expect(() => codexLaunchPolicy(ctx({ agentBin: 'codex' }), MAC)).toThrow(/absolute/);
    expect(() =>
      codexLaunchPolicy(ctx({ credentialPaths: { dirs: ['.ssh'], files: [] } }), MAC)
    ).toThrow(/absolute/);
  });

  test('the disk root as a read or write root throws (it would cancel every deny)', () => {
    expect(() => codexLaunchPolicy(ctx({ readRoots: ['/'] }), MAC)).toThrow(/disk root/);
  });

  test('user trees are derived per platform and from the home folder', () => {
    expect(userTrees(MAC)).toEqual(['/Users', '/Volumes']);
    expect(userTrees(LINUX)).toEqual(['/home']);
    expect(userTrees({ platform: 'linux', home: '/srv/people/u' })).toEqual([
      '/home',
      '/srv/people',
    ]);
    // a home directly under / (root's /root): deny the home itself, never the disk root
    expect(userTrees({ platform: 'linux', home: '/root' })).toEqual(['/home', '/root']);
  });
});

type OcPerm = Record<string, unknown>;
type OcCfg = {
  permission: OcPerm;
  agent: { build: { permission: OcPerm }; plan: { permission: OcPerm } };
  mcp: Record<string, unknown>;
};
const ocCfg = (c: PolicyCtx): OcCfg =>
  JSON.parse(opencodeLaunchPolicy(c).env.OPENCODE_CONFIG_CONTENT ?? 'null');

describe('opencode launch policy', () => {
  test('permission block: read allow, edit/bash ask, web tools denied, outside dirs denied', () => {
    const p = ocCfg(ctx()).permission;
    expect(p.read).toBe('allow');
    expect(p.edit).toBe('ask');
    expect(p.bash).toBe('ask');
    expect(p.webfetch).toBe('deny');
    expect(p.websearch).toBe('deny');
    // security review 2026-11-12 (A4): no sub-agents — a `task` child runs under whatever
    // permission block the person's own config gives that agent, never Maude's
    expect((p as Record<string, unknown>).task).toBe('deny');
    const c = ocCfg(ctx());
    expect((c.agent.build.permission as Record<string, unknown>).task).toBe('deny');
    expect((c.agent.plan.permission as Record<string, unknown>).task).toBe('deny');
    // F4 measured the map (contract note, "F4 measurement"): it is the default
    expect(OPENCODE_EXTERNAL_DIRECTORY_MAP).toBe(true);
    expect(typeof p.external_directory).toBe('object');
  });

  test('external_directory map: deny all, re-allow read roots, then deny credentials (last match wins)', () => {
    const ext = externalDirectory(ctx(), true) as Record<string, string>;
    expect(Object.entries(ext)).toEqual([
      ['*', 'deny'],
      // '/Users/u/git/proj' holds the credential store '.secrets': never re-allowed (grep would reach it)
      ['/Users/u/git/proj/.design/**', 'allow'],
      ['/Applications/Maude.app/Contents/Resources/**', 'allow'],
      ['/var/folders/x/T/maude-chat-501/abc/default/**', 'allow'],
      ['/Users/u/.config/maude', 'deny'],
      ['/Users/u/.config/maude/**', 'deny'],
      ['/Users/u/.ssh', 'deny'],
      ['/Users/u/.ssh/**', 'deny'],
      ['/Users/u/git/proj/.secrets', 'deny'],
      ['/Users/u/git/proj/.secrets/**', 'deny'],
      ['/Users/u/Library/Application Support/com.maude.app/servers.json', 'deny'],
      ['/Users/u/Library/Application Support/com.maude.app/servers.json/**', 'deny'],
    ]);
  });

  test('a read root around or inside a credential store is not re-allowed', () => {
    const ext = externalDirectory(
      ctx({ readRoots: ['/Users/u', '/Users/u/.ssh/keys', '/Users/u/git/lib'] }),
      true
    ) as Record<string, string>;
    expect(ext['/Users/u/**']).toBeUndefined();
    expect(ext['/Users/u/.ssh/keys/**']).toBeUndefined();
    expect(ext['/Users/u/git/lib/**']).toBe('allow');
  });

  test('the string form when the map is off', () => {
    expect(externalDirectory(ctx(), false)).toBe('deny');
    expect(
      JSON.parse(opencodeLaunchPolicy(ctx(), false).env.OPENCODE_CONFIG_CONTENT ?? '{}').permission
        .external_directory
    ).toBe('deny');
  });

  test('the disk root as a read root throws (it would re-allow everything)', () => {
    expect(() => opencodeLaunchPolicy(ctx({ readRoots: ['/'] }))).toThrow(/disk root/);
  });

  test('the same block at the global, agent.build and agent.plan levels', () => {
    const cfg = ocCfg(ctx());
    expect(cfg.agent.build.permission).toEqual(cfg.permission);
    expect(cfg.agent.plan.permission).toEqual(cfg.permission);
  });

  test('web stays denied when may.web is on', () => {
    const p = ocCfg(ctx({ may: { assets: true, web: true } })).permission;
    expect(p.webfetch).toBe('deny');
    expect(p.websearch).toBe('deny');
  });

  test('its own MCP servers are emptied', () => {
    expect(ocCfg(ctx()).mcp).toEqual({});
  });

  test('flags: project config, Claude Code import, autoupdate, share and LSP download off', () => {
    const env = opencodeLaunchPolicy(ctx()).env;
    for (const k of [
      'OPENCODE_DISABLE_PROJECT_CONFIG',
      'OPENCODE_DISABLE_CLAUDE_CODE',
      'OPENCODE_DISABLE_AUTOUPDATE',
      'OPENCODE_DISABLE_SHARE',
      'OPENCODE_DISABLE_LSP_DOWNLOAD',
    ]) {
      expect(env[k]).toBe('1');
      expect(OPENCODE_FLAGS[k]).toBe('1');
    }
  });

  test('a relative root throws', () => {
    expect(() => opencodeLaunchPolicy(ctx({ readRoots: ['proj'] }))).toThrow(/absolute/);
    expect(() => opencodeLaunchPolicy(ctx({ scopeRoot: 'proj' }))).toThrow(/absolute/);
  });
});

describe('catalog wiring', () => {
  // F6b: the catalog's launch policies read the agent's own home/config from `hostEnv`; a scratch
  // HOME keeps this test off the real ~/.codex and ~/.config/opencode.
  const scratch = mkdtempSync(join(tmpdir(), 'acp-launch-policy-'));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const wired = () => ctx({ hostEnv: { HOME: scratch, XDG_CONFIG_HOME: join(scratch, 'xdg') } });

  test('Codex and opencode passed the conformance probe in full (F6b) and are bridge-enforced', () => {
    expect(CODEX.policy).toBe('bridge-enforced');
    expect(OPENCODE.policy).toBe('bridge-enforced');
    expect(isOfferable(CODEX)).toBe(true);
    expect(isOfferable(OPENCODE)).toBe(true);

    const cx = CODEX.enforcement;
    const oc = OPENCODE.enforcement;
    if (!cx || !oc) throw new Error('enforcement missing');
    expect(cx.readGate).toBe('os-sandbox');
    expect(cx.shellGate).toBe('os-sandbox');
    expect(cx.pinMode).toEqual({
      modeId: 'workspace-write',
      refuse: ['agent', 'agent-full-access'],
    });
    expect(cx.rejectEndsTurn).toBe(true);
    expect(oc.readGate).toBe('agent-permission-engine');
    expect(oc.shellGate).toBe('command-text');
    expect(oc.rejectEndsTurn).toBe(false);
    expect(cx.targetKeys).toContain('path');
    expect(oc.targetKeys).toContain('filePath');

    expect(cx.launchPolicy(wired()).env.INITIAL_AGENT_MODE).toBe('workspace-write');
    expect(cx.launchPolicy(wired()).env.CODEX_HOME).toBe(
      join(scratch, '.config', 'maude', 'agents', 'codex-home')
    );
    expect(oc.launchPolicy(wired()).env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('1');
  });
});
