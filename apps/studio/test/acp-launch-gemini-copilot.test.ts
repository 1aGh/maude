// B8 — Gemini CLI / GitHub Copilot CLI launch policies and the Maude-owned agent homes they run
// with. Contract: .ai/plans/notes/universal-acp-contract.md § "B8 — Gemini and Copilot".
// Every home is made under a scratch HOME; the person's real files are never touched.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { COPILOT, GEMINI, isOfferable } from '../acp/agents/catalog.ts';
import { conversationOf } from '../acp/agents/conformance.ts';
import type { PolicyCtx } from '../acp/agents/descriptor.ts';
import { MAY_ALL } from '../acp/may-scope.ts';
import {
  ensureMaudeAgentHome,
  maudeAgentHomePath,
  refuseProjectEntries,
  upToGitRoot,
} from '../acp/policy/agent-home.ts';
import {
  copilotLaunchPolicy,
  copilotLaunchPolicyFor,
  ensureMaudeCopilotHome,
  refuseProjectCopilotConfig,
} from '../acp/policy/launch-copilot.ts';
import {
  ensureMaudeGeminiHome,
  geminiLaunchPolicy,
  geminiSettings,
} from '../acp/policy/launch-gemini.ts';

let root: string;
let home: string;
let env: Record<string, string>;
let project: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'b8-launch-')));
  home = join(root, 'home');
  project = join(root, 'proj');
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  env = { HOME: home };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const ctx = (): PolicyCtx => ({
  scopeRoot: project,
  readRoots: [project],
  writeRoots: [project],
  credentialPaths: { dirs: [], files: [] },
  may: MAY_ALL,
  designRoots: [join(project, '.design')],
  agentBin: '/opt/agent',
  hostEnv: env,
});

describe('Maude-owned agent home', () => {
  test('per profile, under ~/.config/maude', () => {
    expect(maudeAgentHomePath('gemini-home', env)).toBe(
      join(home, '.config', 'maude', 'agents', 'gemini-home')
    );
    expect(maudeAgentHomePath('gemini-home', { ...env, MAUDE_PROFILE_ID: 'work' })).toBe(
      join(home, '.config', 'maude', 'profiles', 'work', 'agents', 'gemini-home')
    );
    expect(() => maudeAgentHomePath('../x', env)).toThrow();
  });

  test('owner-only folder, links, Maude files, foreign config removed', () => {
    const target = join(root, 'person-creds.json');
    const h = maudeAgentHomePath('t-home', env);
    mkdirSync(join(h, 'hooks'), { recursive: true });
    writeFileSync(join(h, 'hooks', 'x.json'), '{}');
    ensureMaudeAgentHome(
      {
        name: 't-home',
        links: { 'sub/creds.json': target },
        files: { 'a.json': '{"a":1}' },
        foreign: ['hooks'],
      },
      env
    );
    expect(lstatSync(h).mode & 0o777).toBe(0o700);
    expect(readlinkSync(join(h, 'sub', 'creds.json'))).toBe(target);
    expect(readFileSync(join(h, 'a.json'), 'utf8')).toBe('{"a":1}');
    expect(lstatSync(join(h, 'a.json')).mode & 0o777).toBe(0o600);
    expect(existsSync(join(h, 'hooks'))).toBe(false);
    // Idempotent, and a wrong link is replaced.
    rmSync(join(h, 'sub', 'creds.json'));
    symlinkSync('/elsewhere', join(h, 'sub', 'creds.json'));
    ensureMaudeAgentHome({ name: 't-home', links: { 'sub/creds.json': target } }, env);
    expect(readlinkSync(join(h, 'sub', 'creds.json'))).toBe(target);
  });

  test('fails closed: a symlinked home, a bad entry, a link into the home itself', () => {
    const h = maudeAgentHomePath('t-home', env);
    mkdirSync(join(h, '..'), { recursive: true });
    mkdirSync(join(root, 'elsewhere'));
    symlinkSync(join(root, 'elsewhere'), h);
    expect(() => ensureMaudeAgentHome({ name: 't-home' }, env)).toThrow(/not a plain folder/);
    rmSync(h);
    expect(() => ensureMaudeAgentHome({ name: 't-home', files: { '../x': '' } }, env)).toThrow(
      /bad entry/
    );
    expect(() => ensureMaudeAgentHome({ name: 't-home', links: { a: join(h, 'b') } }, env)).toThrow(
      /into Maude's own folder/
    );
  });

  test('upToGitRoot: the folder up to the nearest .git, or the folder alone', () => {
    const sub = join(project, 'a', 'b');
    mkdirSync(sub, { recursive: true });
    expect(upToGitRoot(sub)).toEqual([sub]);
    mkdirSync(join(project, '.git'));
    expect(upToGitRoot(sub)).toEqual([sub, join(project, 'a'), project]);
  });

  test('refuseProjectEntries: a dangling link counts', () => {
    symlinkSync('/nowhere', join(project, '.mcp.json'));
    expect(() => refuseProjectEntries(project, ['.mcp.json'], 'X')).toThrow(/does not start X/);
    expect(() => refuseProjectEntries(project, ['.other'], 'X')).not.toThrow();
  });
});

describe('Copilot launch policy', () => {
  test('args: no MCP servers of its own, no web tool, every URL denied, no temp folder', () => {
    const p = copilotLaunchPolicy(ctx(), '/h/copilot-home');
    expect(p.env).toEqual({ COPILOT_HOME: '/h/copilot-home', COPILOT_AUTO_UPDATE: 'false' });
    expect(p.args).toEqual([
      '--disable-builtin-mcps',
      '--excluded-tools=web_fetch',
      '--excluded-tools=web_search',
      '--deny-tool=url',
      '--disallow-temp-dir',
      '--no-auto-update',
    ]);
    for (const a of p.args ?? []) expect(a).not.toMatch(/allow-all|yolo|--allow-tool|--add-dir/);
  });

  test("Maude's home: hooks off, no trusted folder, no MCP server", () => {
    const h = ensureMaudeCopilotHome(env);
    const s = JSON.parse(readFileSync(join(h, 'settings.json'), 'utf8'));
    expect(s.disableAllHooks).toBe(true);
    expect(s.trustedFolders).toEqual([]);
    expect(JSON.parse(readFileSync(join(h, 'mcp-config.json'), 'utf8'))).toEqual({
      mcpServers: {},
    });
    expect(copilotLaunchPolicyFor(ctx()).env.COPILOT_HOME).toBe(h);
  });

  test('refuses project Copilot config, in the folder and up to its git root', () => {
    mkdirSync(join(project, '.github', 'hooks'), { recursive: true });
    expect(() => refuseProjectCopilotConfig(project)).toThrow(/Copilot/);
    rmSync(join(project, '.github'), { recursive: true });
    expect(() => copilotLaunchPolicyFor(ctx())).not.toThrow();
    // The session folder inside a repository whose root carries hooks (measured: they ran).
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, '.github', 'hooks'), { recursive: true });
    expect(() => copilotLaunchPolicyFor(ctx())).toThrow(/Copilot/);
    // A workflow folder alone is not Copilot config.
    rmSync(join(root, '.github', 'hooks'), { recursive: true });
    mkdirSync(join(root, '.github', 'workflows'));
    expect(() => copilotLaunchPolicyFor(ctx())).not.toThrow();
  });
});

describe('Gemini launch policy', () => {
  test('env: Maude home + the system settings layer; approval mode default', () => {
    const p = geminiLaunchPolicy(ctx(), '/h/gemini-home');
    expect(p.env).toEqual({
      GEMINI_CLI_HOME: '/h/gemini-home',
      GEMINI_CLI_SYSTEM_SETTINGS_PATH: '/h/gemini-home/system-settings.json',
    });
    expect(p.args).toEqual(['--approval-mode', 'default']);
  });

  test('settings: MCP, extensions, skills, hooks off; web tools out; folder trust on', () => {
    const s = geminiSettings();
    expect(s.admin).toEqual({
      mcp: { enabled: false },
      extensions: { enabled: false },
      skills: { enabled: false },
    });
    expect(s.hooksConfig.enabled).toBe(false);
    expect(s.mcpServers).toEqual({});
    expect(s.tools.exclude).toEqual(['web_fetch', 'google_web_search']);
    expect(s.security).toEqual({
      folderTrust: { enabled: true },
      disableYoloMode: true,
      disableAlwaysAllow: true,
    });
  });

  test("Maude's home: both settings layers, the person's sign-in linked, trust list removed", () => {
    const h0 = maudeAgentHomePath('gemini-home', env);
    mkdirSync(join(h0, '.gemini', 'extensions', 'x'), { recursive: true });
    writeFileSync(
      join(h0, '.gemini', 'trustedFolders.json'),
      JSON.stringify({ [project]: 'TRUST_FOLDER' })
    );
    const h = ensureMaudeGeminiHome(env);
    expect(h).toBe(h0);
    const user = JSON.parse(readFileSync(join(h, '.gemini', 'settings.json'), 'utf8'));
    const sys = JSON.parse(readFileSync(join(h, 'system-settings.json'), 'utf8'));
    expect(user).toEqual(geminiSettings());
    expect(sys).toEqual(geminiSettings());
    expect(readlinkSync(join(h, '.gemini', 'oauth_creds.json'))).toBe(
      join(home, '.gemini', 'oauth_creds.json')
    );
    expect(existsSync(join(h, '.gemini', 'trustedFolders.json'))).toBe(false);
    expect(existsSync(join(h, '.gemini', 'extensions'))).toBe(false);
  });
});

describe('catalog (B8 flip)', () => {
  test('Gemini and Copilot are bridge-enforced with their dangerous modes refused', () => {
    expect(GEMINI.policy).toBe('bridge-enforced');
    // S1 (A6) — allowlists: yolo / autoEdit / #autopilot and any newer mode are refused
    expect(GEMINI.enforcement?.pinMode).toEqual({ modeId: 'default', allow: ['default', 'plan'] });
    expect(GEMINI.auth.apiKeyEnv).toEqual(['GEMINI_API_KEY']);
    expect(COPILOT.policy).toBe('bridge-enforced');
    expect(COPILOT.enforcement?.pinMode?.allow).toEqual([
      'https://agentclientprotocol.com/protocol/session-modes#agent',
      'https://agentclientprotocol.com/protocol/session-modes#plan',
    ]);
    // S1 — `allow_all` (set_config_option) is pinned off
    expect(COPILOT.enforcement?.pinConfig).toEqual({ allow_all: { allow: ['off', 'false'] } });
    expect(isOfferable(GEMINI) && isOfferable(COPILOT)).toBe(true);
  });
});

describe('conformance wire: the Gemini API', () => {
  test('user text and function responses, in order', () => {
    expect(
      conversationOf({
        contents: [
          { role: 'user', parts: [{ text: 'MAUDE-CONFORMANCE check=secret-read' }] },
          { role: 'model', parts: [{ functionCall: { name: 'read_file', args: {} } }] },
          {
            role: 'user',
            parts: [{ functionResponse: { name: 'read_file', response: { error: 'no' } } }],
          },
        ],
      })
    ).toEqual([
      { kind: 'user', text: 'MAUDE-CONFORMANCE check=secret-read' },
      { kind: 'tool', text: '{"error":"no"}' },
    ]);
  });
});
