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

import { AcpBridge, MAUDE_DEFAULT_ALLOWED_TOOLS } from '../acp/bridge.ts';
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
