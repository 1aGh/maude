// F3 (universal ACP, plan Task B2) — the bridge spawns from an AgentDescriptor
// (acp/agents/descriptor.ts), and Claude's path stays byte-identical. Proven through a real ACP
// round-trip against fixtures/mock-acp-agent-spawn.mjs, which records its argv, its whole env and
// every request the bridge sends.
//
// (a) byte-identical Claude: the spawn argv + env + session/new params for a fixed fixture env are
//     pinned in fixtures/acp-agent-spawn/claude.<platform>.json, recorded BEFORE the refactor.
//     Refresh only on purpose: MAUDE_UPDATE_SPAWN_SNAPSHOT=1.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { CLAUDE, OPENCODE } from '../acp/agents/catalog.ts';
import type { AgentDescriptor, PolicyCtx } from '../acp/agents/descriptor.ts';
import { agentSpawn } from '../acp/agents/spawn.ts';
import {
  AcpBridge,
  MAUDE_DEFAULT_ALLOWED_TOOLS,
  ModeRefusedError,
  newSessionParams,
  newSessionParamsFor,
} from '../acp/bridge.ts';
import { scrubAgentEnv } from '../acp/env.ts';
import type { AiMay } from '../acp/may-scope.ts';
import { opencodeLaunchPolicy } from '../acp/policy/launch-opencode.ts';
import { DEV_SERVER_ROOT } from '../paths.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'mock-acp-agent-spawn.mjs');
const SNAPSHOT = join(
  import.meta.dir,
  'fixtures',
  'acp-agent-spawn',
  `claude.${process.platform}.json`
);

let tmp: string;
let repo: string;
let logN = 0;

beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'maude-agent-spawn-')));
  repo = join(tmp, 'repo');
  mkdirSync(join(repo, '.design', 'assets'), { recursive: true });
  mkdirSync(join(tmp, 'home'), { recursive: true });
  mkdirSync(join(tmp, 'xdg'), { recursive: true });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

interface LogLine {
  m: string;
  argv?: string[];
  env?: Record<string, string>;
  params?: Record<string, unknown>;
}
const readLog = (path: string): LogLine[] =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

/**
 * Run `fn` with process.env replaced by exactly `env` (restored after). The bridge reads the
 * server's env at construction (credential paths) and at spawn (the scrub), so a fixed env gives
 * a fixed child env.
 */
async function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

/** The fixed server env: harmless vars kept, secrets and stale bindings the scrub must drop. */
function fixtureEnv(logPath: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    HOME: join(tmp, 'home'),
    XDG_CONFIG_HOME: join(tmp, 'xdg'),
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    PATH: '/usr/bin:/bin',
    LANG: 'en_US.UTF-8',
    KEEP_ME: 'kept',
    ANTHROPIC_API_KEY: 'sk-ant-should-go',
    ANTHROPIC_BASE_URL: 'https://evil.test',
    MAUDE_SHELL_TOKEN: 'shell-secret',
    MAUDE_TOKEN_KEY: 'bridge-secret',
    MAUDE_GEN_KEY_KEY: 'gen-secret',
    MAUDE_CLOUD_CONFIG: join(tmp, 'home', 'cloud.json'),
    MAUDE_CHAT_ID: 'stale-chat',
    MAUDE_AGENT_ACTOR: 'stale-actor',
    MAUDE_ACP_ADAPTER_ENTRY: FIXTURE,
    MAUDE_ACP_RUNTIME: process.execPath,
    MAUDE_CLAUDE_BIN: process.execPath,
    MAUDE_TEST_SPAWN_LOG: logPath,
    ...extra,
  };
}

/** Machine paths → tokens, so the snapshot is about the bridge, not this checkout. */
function normalize(value: unknown, scratch: string): unknown {
  const studio = DEV_SERVER_ROOT;
  const maude = resolve(DEV_SERVER_ROOT, '..', '..');
  const reps: Array<[string, string]> = [
    [scratch, '<SCRATCH>'],
    [tmp, '<TMP>'],
    [studio, '<STUDIO>'],
    [maude, '<MAUDE>'],
    [process.execPath, '<BUN>'],
    [dirname(scratch), '<SCRATCH_CHAT>'],
  ];
  let s = JSON.stringify(value);
  for (const [from, to] of reps) s = s.split(from).join(to);
  // The verb registry grows on its own (actions/verbs.ts): the snapshot pins WHERE Maude's default
  // allow-list sits in allowedTools and that it is the live list, not the list itself.
  const live = JSON.stringify(MAUDE_DEFAULT_ALLOWED_TOOLS).slice(1, -1);
  if (live) s = s.split(live).join('"<MAUDE_DEFAULT_ALLOWED_TOOLS>"');
  return JSON.parse(s);
}

async function claudeRun(): Promise<{ log: LogLine[]; scratch: string }> {
  const logPath = join(tmp, `claude-${++logN}.ndjson`);
  let scratch = '';
  await withEnv(fixtureEnv(logPath), async () => {
    const bridge = new AcpBridge({
      repoRoot: repo,
      designRoot: join(repo, '.design'),
      chatId: 'c1',
      studioBrief: 'BRIEF',
      grantsFile: join(tmp, 'grants.json'),
      ownPorts: () => [4399, 4400],
      plugins: [{ type: 'local', path: join(tmp, 'plugins', 'design'), skipMcpDiscovery: true }],
      onUpdate: () => {},
    });
    scratch = bridge.scratchDir;
    try {
      await bridge.prompt('hi', 'c1');
    } finally {
      await bridge.stop();
    }
  });
  return { log: readLog(logPath), scratch };
}

describe('(a) Claude spawns byte-identical to before the descriptor refactor', () => {
  test('argv, env and session/new params match the recorded snapshot', async () => {
    const { log, scratch } = await claudeRun();
    const spawn = log.find((l) => l.m === 'spawn');
    const init = log.find((l) => l.m === 'initialize');
    const created = log.find((l) => l.m === 'new');
    expect(spawn).toBeDefined();
    expect(created).toBeDefined();
    const got = normalize(
      {
        argv: spawn?.argv,
        env: spawn?.env,
        clientCapabilities: init?.params?.clientCapabilities,
        newSession: created?.params,
      },
      scratch
    );
    if (process.env.MAUDE_UPDATE_SPAWN_SNAPSHOT === '1') {
      mkdirSync(dirname(SNAPSHOT), { recursive: true });
      writeFileSync(SNAPSHOT, `${JSON.stringify(got, null, 2)}\n`);
    }
    if (!existsSync(SNAPSHOT)) {
      // Recorded on darwin; a platform without its own snapshot has nothing to compare against.
      console.warn(`no Claude spawn snapshot for ${process.platform}; skipping the byte compare`);
      return;
    }
    expect(got).toEqual(JSON.parse(readFileSync(SNAPSHOT, 'utf8')));
  });
});

// ── (b)–(e): agents that are not Claude ──────────────────────────────────────────────────────────

/** Rule 14 — every one of these is gone from every agent's env unless its envAllow names it. */
const VENDOR_SECRETS: Record<string, string> = {
  OPENAI_API_KEY: 'sk-openai',
  OPENAI_BASE_URL: 'https://openai.evil.test',
  CODEX_API_KEY: 'codex',
  GEMINI_API_KEY: 'gemini',
  GOOGLE_API_KEY: 'google',
  GOOGLE_APPLICATION_CREDENTIALS: '/creds.json',
  GITHUB_TOKEN: 'ghp_x',
  GH_TOKEN: 'gho_x',
  COPILOT_TOKEN: 'copilot',
  OPENCODE_API_KEY: 'oc',
  OPENCODE_AUTH_CONTENT: '{}',
  OPENCODE_CONSOLE_TOKEN: 'occ',
};

function fakeAgent(over: Partial<AgentDescriptor> = {}): AgentDescriptor {
  return {
    id: 'custom:fake',
    label: 'Fake',
    vendor: 'Fake Inc',
    detect: {
      bins: ['fake'],
      versionArgs: ['--version'],
      versionRe: /(\d+\.\d+\.\d+)/,
      minVersion: '0.0.0',
      testedMax: '9.9.9',
    },
    launch: { kind: 'native-acp', args: [FIXTURE, '--acp'] },
    auth: { gate: 'none' },
    envAllow: [],
    policy: 'unrestricted',
    plugins: 'none',
    ...over,
  };
}

const MODES = {
  currentModeId: 'yolo',
  availableModes: [
    { id: 'safe', name: 'Safe' },
    { id: 'yolo', name: 'Yolo' },
    // S1 (A6) — a mode no descriptor names (a newer adapter's): the allowlist refuses it too
    { id: 'turbo', name: 'Turbo' },
  ],
};

/** S1 — Copilot-shaped config: `allow_all` on at start, plus a boolean switch of the same kind. */
const CONFIG = [
  {
    id: 'allow_all',
    name: 'Allow all',
    type: 'select',
    currentValue: 'on',
    options: [
      { value: 'on', name: 'On' },
      { value: 'off', name: 'Off' },
    ],
  },
  { id: 'auto_approve', name: 'Auto approve', type: 'boolean', currentValue: false },
  {
    id: 'model',
    name: 'Model',
    type: 'select',
    currentValue: 'm1',
    options: [{ group: 'g', name: 'G', options: [{ value: 'm1', name: 'M1' }] }],
  },
];

function enforcedAgent(seen: PolicyCtx[] = []): AgentDescriptor {
  return fakeAgent({
    policy: 'bridge-enforced',
    envAllow: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
    enforcement: {
      launchPolicy: (ctx) => {
        seen.push(ctx);
        return {
          env: {
            FAKE_POLICY: `write=${ctx.writeRoots.length}`,
            // A policy can never hand the agent a secret the scrub drops, nor rename the root.
            MAUDE_SHELL_TOKEN: 'leak',
            MAUDE_SESSION_ROOT: '/somewhere/else',
          },
          args: ['--sandbox'],
        };
      },
      readGate: 'os-sandbox',
      shellGate: 'os-sandbox',
      pinMode: { modeId: 'safe', allow: ['safe'] },
      pinConfig: { allow_all: { allow: ['off'] }, auto_approve: { allow: ['false'] } },
      rejectEndsTurn: true,
      targetKeys: ['path'],
    },
  });
}

async function agentRun(
  agent: AgentDescriptor | undefined,
  opts: {
    extraEnv?: Record<string, string>;
    may?: AiMay;
    store?: string;
    during?: (bridge: AcpBridge) => Promise<void>;
  } = {}
): Promise<{ log: LogLine[]; bridge: AcpBridge }> {
  const logPath = join(tmp, `agent-${++logN}.ndjson`);
  const bridge = await withEnv(
    fixtureEnv(logPath, { ...VENDOR_SECRETS, ...opts.extraEnv }),
    async () => {
      const b = new AcpBridge({
        repoRoot: repo,
        designRoot: join(repo, '.design'),
        chatId: 'c1',
        studioBrief: 'BRIEF',
        agent,
        agentBin: process.execPath,
        ownPorts: () => [4399],
        onUpdate: () => {},
      });
      if (opts.store) b.setSessionStorePath(opts.store);
      if (opts.may) b.setMay(opts.may);
      try {
        await b.prompt('hi', 'c1');
        await opts.during?.(b);
      } finally {
        await b.stop();
      }
      return b;
    }
  );
  return { log: readLog(logPath), bridge };
}

describe('(b) a native-ACP agent spawns its own binary and gets nothing Claude-shaped', () => {
  test('argv is [bin, ...launch.args]; session/new has no _meta; fs stays off', async () => {
    const { log } = await agentRun(fakeAgent());
    const spawn = log.find((l) => l.m === 'spawn');
    expect(spawn?.argv).toEqual(['--acp']);
    expect(spawn?.env?.CLAUDE_CODE_EXECUTABLE).toBeUndefined();
    expect(spawn?.env?.BUN_BE_BUN).toBeUndefined();
    expect(log.find((l) => l.m === 'new')?.params).toEqual({ cwd: repo, mcpServers: [] });
    const caps = log.find((l) => l.m === 'initialize')?.params?.clientCapabilities as
      | { fs?: unknown }
      | undefined;
    expect(caps?.fs).toEqual({ readTextFile: false, writeTextFile: false });
  });

  test('newSessionParamsFor: Claude is newSessionParams, anything else is cwd + no MCP', () => {
    const scope = { may: { assets: true, web: false } };
    expect(newSessionParamsFor(CLAUDE, repo, 'BRIEF', [], scope)).toEqual(
      newSessionParams(repo, 'BRIEF', [], scope)
    );
    expect(newSessionParamsFor(fakeAgent(), repo, 'BRIEF', [], scope)).toEqual({
      cwd: repo,
      mcpServers: [],
    });
  });

  test('a bridge-enforced launch policy appends its args', async () => {
    const { log } = await agentRun(enforcedAgent(), {
      extraEnv: { MAUDE_TEST_MODES: JSON.stringify(MODES) },
    });
    expect(log.find((l) => l.m === 'spawn')?.argv).toEqual(['--acp', '--sandbox']);
  });
});

describe('(c) the agent env: shared scrub, envAllow, launch policy, actor env', () => {
  test('Claude loses every vendor secret too', async () => {
    const { log } = await agentRun(undefined);
    const env = log.find((l) => l.m === 'spawn')?.env ?? {};
    for (const k of Object.keys(VENDOR_SECRETS)) expect([k, k in env]).toEqual([k, false]);
    expect(env.KEEP_ME).toBe('kept');
    expect(env.CLAUDE_CODE_EXECUTABLE).toBe(process.execPath);
  });

  test('a non-Claude agent: secrets gone, envAllow back, policy env + actor env present', async () => {
    const ctxs: PolicyCtx[] = [];
    const { log } = await agentRun(enforcedAgent(ctxs), {
      may: { assets: true, web: false },
      extraEnv: { MAUDE_TEST_MODES: JSON.stringify(MODES) },
    });
    const env = log.find((l) => l.m === 'spawn')?.env ?? {};
    for (const k of Object.keys(VENDOR_SECRETS)) {
      expect([k, k in env]).toEqual([k, k === 'OPENAI_API_KEY']);
    }
    // envAllow can never bring back Anthropic billing keys or Maude's own secrets.
    for (const k of [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_BASE_URL',
      'MAUDE_SHELL_TOKEN',
      'MAUDE_TOKEN_KEY',
      'MAUDE_GEN_KEY_KEY',
      'MAUDE_CLOUD_CONFIG',
    ]) {
      expect([k, k in env]).toEqual([k, false]);
    }
    // the launch policy's env, built from the bridge's own scope
    expect(env.FAKE_POLICY).toBe('write=2');
    expect(ctxs[0]?.scopeRoot).toBe(repo);
    expect(ctxs[0]?.may).toEqual({ assets: true, web: false });
    expect(ctxs[0]?.agentBin).toBe(process.execPath);
    // the actor env, last: the policy cannot rename the session root
    expect(env.MAUDE_AGENT_ACTOR).toBe('maude-chat');
    expect(env.MAUDE_SESSION_ROOT).toBe(repo);
    expect(env.MAUDE_READ_ROOTS?.split(':')).toContain(repo);
    expect(env.MAUDE_OWN_PORTS).toBe('4399');
    expect(env.MAUDE_CHAT_ID).toBe('c1');
    expect(env.TMPDIR?.endsWith('/')).toBe(true);
    // web off rides the spawn env (no _meta channel); teams are Claude's only
    expect(env.MAUDE_NO_EGRESS).toBe('1');
    expect(env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBeUndefined();
  });

  // Security review 2026-11-12 (defender M7): opencode reads OPENCODE_PERMISSION / OPENCODE_CONFIG*
  // from its env and they may override Maude's launch policy; codex reads CODEX_HOME / CODEX_CONFIG.
  test('inherited OPENCODE_* / CODEX_* never reach the agent; only the launch policy sets them', () => {
    const inherited = {
      PATH: '/bin',
      OPENCODE_PERMISSION: '{"bash":"allow","edit":"allow"}',
      OPENCODE_CONFIG: '/evil/opencode.json',
      OPENCODE_CONFIG_DIR: '/evil',
      OPENCODE_DISABLE_PROJECT_CONFIG: '0',
      OPENCODE_PURE: '0',
      CODEX_HOME: '/evil/codex',
      CODEX_CONFIG: '{"sandbox_mode":"danger-full-access"}',
    };
    const d: AgentDescriptor = {
      ...OPENCODE,
      enforcement: {
        ...(OPENCODE.enforcement as NonNullable<AgentDescriptor['enforcement']>),
        launchPolicy: (ctx) => opencodeLaunchPolicy(ctx),
      },
    };
    const out = agentSpawn({
      descriptor: d,
      scrubbed: scrubAgentEnv(inherited, d.envAllow),
      agentBin: '/opt/opencode',
      policyCtx: {
        scopeRoot: '/p',
        readRoots: ['/p'],
        writeRoots: ['/p'],
        credentialPaths: { dirs: [], files: [] },
        may: { assets: true, web: true },
        designRoots: ['/p/.design'],
        agentBin: '/opt/opencode',
      },
      actor: { sessionRoot: '/p', readRoots: ['/p'] },
      teams: false,
      delimiter: ':',
      chatKeyEnv: {},
    });
    for (const k of ['OPENCODE_PERMISSION', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'CODEX_HOME'])
      expect([k, k in out.env]).toEqual([k, false]);
    expect(out.env.CODEX_CONFIG).toBeUndefined();
    expect(out.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('1');
    expect(out.env.OPENCODE_PURE).toBe('1');
    expect(JSON.parse(out.env.OPENCODE_CONFIG_CONTENT ?? '{}').permission.bash).toBe('ask');
    // Claude loses them too (the shared scrub)
    const claude = scrubAgentEnv(inherited, CLAUDE.envAllow);
    expect(Object.keys(claude)).toEqual(['PATH']);
  });

  test('agentSpawn (pure): an adapter-js agent gets its binary in agentBinEnv and runs the adapter', () => {
    const d = fakeAgent({
      launch: { kind: 'adapter-js', adapterPkg: 'x', adapterBin: 'x', agentBinEnv: 'FAKE_PATH' },
    });
    const out = agentSpawn({
      descriptor: d,
      scrubbed: scrubAgentEnv({ PATH: '/bin', OPENAI_API_KEY: 'k' }, d.envAllow),
      agentBin: '/opt/fake',
      adapterEntry: '/adapter.js',
      runtime: { bin: '/bun', bunBeBun: true },
      policyCtx: {
        scopeRoot: '/p',
        readRoots: ['/p'],
        writeRoots: ['/p'],
        credentialPaths: { dirs: [], files: [] },
        may: { assets: true, web: true },
        designRoots: ['/p/.design'],
        agentBin: '/opt/fake',
      },
      actor: { sessionRoot: '/p', readRoots: ['/p', '/q'] },
      teams: true,
      chatId: 'c9',
      delimiter: ':',
    });
    expect(out.cmd).toEqual(['/bun', '/adapter.js']);
    expect(out.env).toEqual({
      PATH: '/bin',
      FAKE_PATH: '/opt/fake',
      BUN_BE_BUN: '1',
      MAUDE_AGENT_ACTOR: 'maude-chat',
      MAUDE_SESSION_ROOT: '/p',
      MAUDE_READ_ROOTS: '/p:/q',
      MAUDE_CHAT_ID: 'c9',
    });
  });
});

describe('(d) an agent without loadSession starts a new session at once', () => {
  test('a persisted session id is not loaded; session/new answers with no wait', async () => {
    const store = join(tmp, `store-${++logN}.json`);
    writeFileSync(store, JSON.stringify({ sessionId: 'persisted-1', updatedAt: 1 }));
    const started = Date.now();
    const { log } = await agentRun(fakeAgent(), {
      store,
      extraEnv: { MAUDE_TEST_LOAD_SESSION: '0' },
    });
    expect(log.some((l) => l.m === 'load')).toBe(false);
    expect(log.some((l) => l.m === 'new')).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 20000);

  test('an agent WITH loadSession still resumes', async () => {
    const store = join(tmp, `store-${++logN}.json`);
    writeFileSync(store, JSON.stringify({ sessionId: 'persisted-2', updatedAt: 1 }));
    const { log } = await agentRun(fakeAgent(), { store });
    expect(log.find((l) => l.m === 'load')?.params?.sessionId).toBe('persisted-2');
    expect(log.some((l) => l.m === 'new')).toBe(false);
  });
});

describe('(e) the pinned mode: set after session/new, refused modes rejected and hidden', () => {
  test('set_mode(pin) is sent; the roster drops the refused mode; a switch to it throws', async () => {
    let refusedMode: unknown;
    let refusedConfig: unknown;
    let shown: string[] = [];
    let current: string | undefined;
    const { log, bridge } = await agentRun(enforcedAgent(), {
      extraEnv: { MAUDE_TEST_MODES: JSON.stringify(MODES) },
      during: async (b) => {
        current = b.modes?.currentModeId;
        shown = b.modes?.availableModes.map((m) => m.id) ?? [];
        refusedMode = await b.setMode('c1', 'yolo').catch((e) => e);
        refusedConfig = await b.setConfigOption('c1', 'mode', 'yolo').catch((e) => e);
      },
    });
    expect(current).toBe('safe');
    // S1 (A6) — the allowlist hides `turbo`, which a refuse list naming `yolo` would have shown
    expect(shown).toEqual(['safe']);
    expect(log.filter((l) => l.m === 'set_mode').map((l) => l.params?.modeId)).toEqual(['safe']);
    expect(refusedMode).toBeInstanceOf(ModeRefusedError);
    expect(refusedConfig).toBeInstanceOf(ModeRefusedError);
    expect(log.some((l) => l.m === 'set_config_option')).toBe(false);
    expect(bridge.refusesMode('yolo')).toBe(true);
    expect(bridge.refusesMode('turbo')).toBe(true);
    expect(bridge.refusesMode('safe')).toBe(false);
    expect(bridge.agentInfo).toEqual({ id: 'custom:fake', label: 'Fake', vendor: 'Fake Inc' });
  });

  // S1 — Copilot exposes `allow_all` through set_config_option, which the mode pin never sees.
  test('a pinned config option: moved off a refused start value, refused value hidden and refused', async () => {
    let refused: unknown;
    let options: Array<{ id: string; currentValue?: unknown; options?: unknown }> = [];
    const { log, bridge } = await agentRun(enforcedAgent(), {
      extraEnv: { MAUDE_TEST_CONFIG: JSON.stringify(CONFIG) },
      during: async (b) => {
        options = b.configOptions as typeof options;
        refused = await b.setConfigOption('c1', 'allow_all', 'on').catch((e) => e);
      },
    });
    const sets = log.filter((l) => l.m === 'set_config_option').map((l) => l.params);
    // pinned once at session start, never set back to `on`
    expect(sets).toEqual([expect.objectContaining({ configId: 'allow_all', value: 'off' })]);
    expect(refused).toBeInstanceOf(ModeRefusedError);
    const allowAll = options.find((o) => o.id === 'allow_all');
    expect(allowAll?.currentValue).toBe('off');
    expect(allowAll?.options).toEqual([{ value: 'off', name: 'Off' }]);
    // a pinned boolean whose `true` is refused is not offered at all
    expect(options.some((o) => o.id === 'auto_approve')).toBe(false);
    // an option nobody pinned passes untouched (grouped options included)
    expect(options.find((o) => o.id === 'model')).toEqual(CONFIG[2]);
    expect(bridge.refusesConfig('allow_all', 'on')).toBe(true);
    expect(bridge.refusesConfig('allow_all', 'off')).toBe(false);
    expect(bridge.refusesConfig('auto_approve', true)).toBe(true);
    expect(bridge.refusesConfig('mode', 'yolo')).toBe(true);
    expect(bridge.refusesConfig('model', 'anything')).toBe(false);
  });

  test('no set_mode when the agent already sits in the pinned mode', async () => {
    const { log } = await agentRun(enforcedAgent(), {
      extraEnv: { MAUDE_TEST_MODES: JSON.stringify({ ...MODES, currentModeId: 'safe' }) },
    });
    expect(log.some((l) => l.m === 'set_mode')).toBe(false);
  });

  test('Claude has no pin: no set_mode, nothing refused', async () => {
    const { log, bridge } = await agentRun(undefined, {
      extraEnv: { MAUDE_TEST_MODES: JSON.stringify(MODES) },
    });
    expect(log.some((l) => l.m === 'set_mode')).toBe(false);
    expect(bridge.refusesMode('yolo')).toBe(false);
  });
});
