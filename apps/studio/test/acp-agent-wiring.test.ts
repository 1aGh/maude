// B3 wiring + B4 brief (universal ACP, DDR-252) — a chat that runs an agent other than Claude,
// end to end through /_ws/acp frames (acp/index.ts) and a real ACP round-trip against
// fixtures/mock-acp-agent-wiring.mjs (a scripted agent that logs what it is spawned with, what it
// is asked and what it is answered).
//
//   • the chat's agent: picked at first attach, recorded, never switched; 'unrestricted' needs
//     this project's consent (app-owned file);
//   • the gate (acp/policy/bridge-gate.ts over enforce.ts): out-of-scope → card with only
//     allow_once / reject_once; credential path → refused, no card; rule 13 turn-end notice;
//   • rule 11: fs/* and terminal/* → JSON-RPC error; rule 12: tripwire ends the session and marks
//     the agent unavailable (acp/agents/health.ts);
//   • "AI may" switch → the agent process restarts with the new launch policy and resumes;
//   • B4: the studio brief once — as a systemPrompt when advertised, else a first-prompt preamble
//     that the transcript never shows as the person's text.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerWebSocket } from 'bun';

import { CLAUDE } from '../acp/agents/catalog.ts';
import { hasAgentConsent } from '../acp/agents/consent.ts';
import type { AgentDescriptor } from '../acp/agents/descriptor.ts';
import { agentHealth, clearAgentHealth } from '../acp/agents/health.ts';
import { createAcp } from '../acp/index.ts';
import { FORBIDDEN_METHOD_ERROR } from '../acp/policy/enforce.ts';
import type { Context } from '../context.ts';
import type { WsData } from '../ws.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'mock-acp-agent-wiring.mjs');
const ENV = [
  'MAUDE_TEST_WIRING_LOG',
  'MAUDE_TEST_SCRIPT',
  'MAUDE_TEST_LOAD_SESSION',
  'MAUDE_TEST_SYSTEM_PROMPT',
  'MAUDE_TEST_STOP',
];

let tmp: string;
let repo: string;
let outside: string;
let consentFile: string;
let logPath: string;
let n = 0;

beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'maude-agent-wiring-')));
  repo = join(tmp, 'repo');
  outside = join(tmp, 'outside');
  mkdirSync(join(repo, '.design', 'assets'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  consentFile = join(tmp, 'app', 'agent-consent.json');
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
afterEach(() => {
  for (const k of ENV) delete process.env[k];
  clearAgentHealth();
});

function setScript(steps: unknown[] = [], extra: Record<string, string> = {}) {
  logPath = join(tmp, `log-${++n}.ndjson`);
  process.env.MAUDE_TEST_WIRING_LOG = logPath;
  process.env.MAUDE_TEST_SCRIPT = JSON.stringify(steps);
  Object.assign(process.env, extra);
}

interface LogLine {
  m: string;
  pid: number;
  sessionId?: string;
  argv?: string[];
  env?: Record<string, string>;
  params?: Record<string, unknown>;
  prompt?: Array<{ type: string; text: string }>;
  outcome?: { outcome: string; optionId?: string };
  method?: string;
  error?: { code?: number; message?: string };
}
const readLog = (): LogLine[] =>
  existsSync(logPath)
    ? readFileSync(logPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

function fakeCodex(over: Partial<AgentDescriptor> = {}): AgentDescriptor {
  return {
    id: 'codex',
    label: 'Codex',
    vendor: 'OpenAI',
    statusUrl: 'https://status.openai.com',
    detect: {
      bins: ['codex'],
      versionArgs: ['--version'],
      versionRe: /(\d+\.\d+\.\d+)/,
      minVersion: '0.0.0',
      testedMax: '9.9.9',
    },
    launch: { kind: 'native-acp', args: [FIXTURE] },
    auth: { gate: 'none' },
    envAllow: [],
    policy: 'bridge-enforced',
    enforcement: {
      launchPolicy: (ctx) => ({ env: { FAKE_POLICY_WEB: String(ctx.may.web) } }),
      readGate: 'os-sandbox',
      shellGate: 'os-sandbox',
      rejectEndsTurn: true,
      targetKeys: ['path'],
    },
    plugins: 'none',
    ...over,
  };
}

const ROGUE: AgentDescriptor = {
  ...fakeCodex(),
  id: 'gemini',
  label: 'Gemini CLI',
  vendor: 'Google',
  policy: 'unrestricted',
  enforcement: undefined,
};

const PINNED: AgentDescriptor = fakeCodex({
  id: 'opencode',
  label: 'opencode',
  enforcement: {
    ...(fakeCodex().enforcement as NonNullable<AgentDescriptor['enforcement']>),
    pinMode: { modeId: 'workspace-write', refuse: ['agent'] },
  },
});

const AGENTS: Record<string, AgentDescriptor> = {
  codex: fakeCodex(),
  opencode: PINNED,
  gemini: ROGUE,
  claude: CLAUDE,
};

async function until<T>(fn: () => T | undefined | false, timeoutMs = 12000): Promise<T> {
  const start = performance.now();
  for (;;) {
    const v = fn();
    if (v !== undefined && v !== false) return v as T;
    if (performance.now() - start > timeoutMs) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

type Frame = Record<string, unknown>;
function fakeWs(id: string) {
  const frames: Frame[] = [];
  const ws = {
    data: { id } as WsData,
    send: (raw: string) => {
      frames.push(JSON.parse(raw));
    },
  } as unknown as ServerWebSocket<WsData>;
  return { ws, frames };
}

const ctxFor = () =>
  ({
    paths: { repoRoot: repo, designRoot: join(repo, '.design'), designRel: '.design' },
  }) as unknown as Context;

function makeAcp(readOnly = false) {
  return createAcp(ctxFor(), undefined, {
    permissionTimeoutMs: 4000,
    readOnly: () => readOnly,
    agents: {
      byId: (id) => AGENTS[id],
      resolveBin: () => process.execPath,
      consentFile,
    },
  });
}

const errors = (frames: Frame[]) => frames.filter((f) => f.t === 'error');
const turnEnds = (frames: Frame[]) => frames.filter((f) => f.t === 'turn-end');

describe('the chat agent: picked once, recorded, never switched', () => {
  test('attach {agent:codex} spawns the agent itself with no Claude _meta; the chat records it', async () => {
    setScript();
    const acp = makeAcp();
    const a = fakeWs('w-spawn');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(a.ws, JSON.stringify({ t: 'attach', chat: 'w1', seq: 0, agent: 'codex' }));
      const attached = await until(() => a.frames.find((f) => f.t === 'attached'));
      expect((attached.agent as { id: string }).id).toBe('codex');
      acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', chat: 'w1', text: 'hi' }));
      await until(() => turnEnds(a.frames).length >= 1);
      const log = readLog();
      const spawn = log.find((l) => l.m === 'spawn');
      expect(spawn?.argv).toEqual([]);
      expect(spawn?.env?.CLAUDE_CODE_EXECUTABLE).toBeUndefined();
      expect(spawn?.env?.FAKE_POLICY_WEB).toBeDefined();
      expect(spawn?.env?.MAUDE_AGENT_ACTOR).toBe('maude-chat');
      const created = log.find((l) => l.m === 'new');
      expect(created?.params?._meta).toBeUndefined();
      expect(created?.params?.mcpServers).toEqual([]);
      const caps = log.find((l) => l.m === 'initialize')?.params?.clientCapabilities as {
        fs?: unknown;
        terminal?: unknown;
      };
      expect(caps.fs).toEqual({ readTextFile: false, writeTextFile: false });
      expect(caps.terminal).toBeFalsy();
      const meta = JSON.parse(readFileSync(join(repo, '.design', '_chat', 'w1.meta.json'), 'utf8'));
      expect(meta.agent).toBe('codex');
      expect(errors(a.frames)).toEqual([]);
    } finally {
      acp.stopAll();
    }
  }, 20000);

  test('a chat with nothing said yet may change its agent; one with history may not', async () => {
    setScript();
    const acp = makeAcp();
    const a = fakeWs('w-switch');
    const metaFile = join(repo, '.design', '_chat', 'w2.meta.json');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(a.ws, JSON.stringify({ t: 'attach', chat: 'w2', agent: 'codex' }));
      await until(() => a.frames.find((f) => f.t === 'attached'));
      // the picker before the first message: allowed, re-recorded
      acp.onMessage(a.ws, JSON.stringify({ t: 'attach', chat: 'w2', agent: 'claude' }));
      await until(() => JSON.parse(readFileSync(metaFile, 'utf8')).agent === 'claude' || undefined);
      expect(errors(a.frames)).toEqual([]);
      // once the chat has history it keeps its agent
      writeFileSync(join(repo, '.design', '_chat', 'w2.jsonl'), '{"role":"user","text":"x"}\n');
      acp.onMessage(a.ws, JSON.stringify({ t: 'attach', chat: 'w2', agent: 'codex' }));
      const refused = await until(() => errors(a.frames)[0]);
      expect(refused).toMatchObject({
        code: 'agent-switch-refused',
        chat: 'w2',
        agent: 'claude',
        requested: 'codex',
      });
    } finally {
      acp.stopAll();
    }
    // a fresh server: the recorded agent still wins for a chat with history
    const acp2 = makeAcp();
    const b = fakeWs('w-switch-2');
    try {
      acp2.onOpen(b.ws);
      acp2.onMessage(b.ws, JSON.stringify({ t: 'prompt', chat: 'w2', text: 'x', agent: 'codex' }));
      const refused = await until(() => errors(b.frames)[0]);
      expect(refused.code).toBe('agent-switch-refused');
    } finally {
      acp2.stopAll();
    }
  }, 20000);

  test('caps lists only the allowed modes for a pinned agent (allowedModes)', async () => {
    setScript([], { MAUDE_TEST_MODES: '1' });
    const acp = makeAcp();
    const a = fakeWs('w-modes');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(a.ws, JSON.stringify({ t: 'warm', chat: 'w-modes', agent: 'opencode' }));
      const caps = await until(() => a.frames.find((f) => f.t === 'caps' && f.allowedModes));
      expect(caps.allowedModes).toEqual(['read-only', 'workspace-write']);
    } finally {
      acp.stopAll();
      delete process.env.MAUDE_TEST_MODES;
    }
  }, 20000);

  test('a chat with history and no record is a Claude chat: codex is refused for it', async () => {
    mkdirSync(join(repo, '.design', '_chat'), { recursive: true });
    writeFileSync(join(repo, '.design', '_chat', 'legacy.jsonl'), '{"role":"user","text":"x"}\n');
    const acp = makeAcp();
    const a = fakeWs('w-legacy');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(a.ws, JSON.stringify({ t: 'attach', chat: 'legacy', agent: 'codex' }));
      const refused = await until(() => errors(a.frames)[0]);
      expect(refused).toMatchObject({ code: 'agent-switch-refused', agent: 'claude' });
    } finally {
      acp.stopAll();
    }
  });

  test('an unknown agent id is refused', async () => {
    const acp = makeAcp();
    const a = fakeWs('w-unknown');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(a.ws, JSON.stringify({ t: 'attach', chat: 'w3', agent: 'nope' }));
      expect((await until(() => errors(a.frames)[0])).code).toBe('agent-unknown');
    } finally {
      acp.stopAll();
    }
  });
});

describe('an unrestricted agent needs this project consent', () => {
  test('no consent → agent-needs-consent, nothing spawned; read-only consent ignored; consent:true records it', async () => {
    setScript();
    const ro = makeAcp(true);
    const r = fakeWs('w-ro');
    try {
      ro.onOpen(r.ws);
      ro.onMessage(
        r.ws,
        JSON.stringify({ t: 'attach', chat: 'u1', agent: 'gemini', consent: true })
      );
      const refused = await until(() => errors(r.frames)[0]);
      expect(refused).toMatchObject({ code: 'agent-needs-consent', chat: 'u1' });
      expect((refused.agent as { id: string }).id).toBe('gemini');
    } finally {
      ro.stopAll();
    }
    const acp = makeAcp();
    const a = fakeWs('w-consent');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', chat: 'u1', text: 'hi', agent: 'gemini' }));
      expect((await until(() => errors(a.frames)[0])).code).toBe('agent-needs-consent');
      await new Promise((res) => setTimeout(res, 200));
      expect(readLog().some((l) => l.m === 'spawn')).toBe(false);
      expect(hasAgentConsent({ projectRoot: repo, file: consentFile }, 'gemini')).toBe(false);

      acp.onMessage(
        a.ws,
        JSON.stringify({ t: 'attach', chat: 'u1', agent: 'gemini', consent: true })
      );
      await until(() => a.frames.find((f) => f.t === 'attached'));
      expect(hasAgentConsent({ projectRoot: repo, file: consentFile }, 'gemini')).toBe(true);
      // the consent lives outside the project
      expect(consentFile.startsWith(repo)).toBe(false);
    } finally {
      acp.stopAll();
    }
  }, 20000);
});

describe('the bridge gate on a non-Claude agent', () => {
  test('an edit outside the scope → the card offers only allow_once / reject_once; a No ends the turn with the notice', async () => {
    setScript([
      {
        perm: {
          toolCallId: 'e1',
          kind: 'edit',
          title: 'edit',
          locations: [{ path: join(outside, 'x.txt') }],
          rawInput: { path: join(outside, 'x.txt') },
        },
      },
    ]);
    const acp = makeAcp();
    const a = fakeWs('w-card');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', chat: 'g1', text: 'go', agent: 'codex' }));
      const card = await until(() => a.frames.find((f) => f.t === 'permission-request'));
      const options = card.options as Array<{ optionId: string; kind: string }>;
      expect(options.map((o) => o.kind).sort()).toEqual(['allow_once', 'reject_once']);
      expect((card.scope as { resolvedPaths: string[] }).resolvedPaths).toContain(
        join(outside, 'x.txt')
      );
      // a forged "always" answer is not honoured
      acp.onMessage(
        a.ws,
        JSON.stringify({ t: 'permission-response', id: card.id, chat: 'g1', decision: 'abort' })
      );
      const end = await until(() => turnEnds(a.frames)[0]);
      expect(end).toMatchObject({
        reason: 'refused',
        notice: 'Codex stopped: you refused this step',
      });
      expect(readLog().find((l) => l.m === 'perm')?.outcome).toEqual({
        outcome: 'selected',
        optionId: 'abort',
      });
    } finally {
      acp.stopAll();
    }
  }, 20000);

  test('a forged allow_always answer to the card is cancelled', async () => {
    setScript([
      {
        perm: {
          toolCallId: 'e2',
          kind: 'edit',
          locations: [{ path: join(outside, 'y.txt') }],
        },
      },
    ]);
    const acp = makeAcp();
    const a = fakeWs('w-forged');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', chat: 'g2', text: 'go', agent: 'codex' }));
      const card = await until(() => a.frames.find((f) => f.t === 'permission-request'));
      acp.onMessage(
        a.ws,
        JSON.stringify({
          t: 'permission-response',
          id: card.id,
          chat: 'g2',
          decision: 'approved-always',
        })
      );
      await until(() => turnEnds(a.frames)[0]);
      expect(readLog().find((l) => l.m === 'perm')?.outcome).toEqual({ outcome: 'cancelled' });
    } finally {
      acp.stopAll();
    }
  }, 20000);

  test('an in-project edit is granted once with no card', async () => {
    setScript([
      {
        perm: {
          toolCallId: 'e3',
          kind: 'edit',
          locations: [{ path: join(repo, 'src', 'a.ts') }],
        },
      },
    ]);
    const acp = makeAcp();
    const a = fakeWs('w-inside');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', chat: 'g3', text: 'go', agent: 'codex' }));
      const end = await until(() => turnEnds(a.frames)[0]);
      expect(end.reason).toBeUndefined();
      expect(a.frames.find((f) => f.t === 'permission-request')).toBeUndefined();
      expect(readLog().find((l) => l.m === 'perm')?.outcome).toEqual({
        outcome: 'selected',
        optionId: 'approved',
      });
    } finally {
      acp.stopAll();
    }
  }, 20000);

  test('a credential path → refused with no card; the turn ends with the refusal notice', async () => {
    const key = join(homedir(), '.ssh', 'id_ed25519');
    setScript([{ perm: { toolCallId: 'c1', kind: 'read', locations: [{ path: key }] } }]);
    const acp = makeAcp();
    const a = fakeWs('w-cred');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', chat: 'g4', text: 'go', agent: 'codex' }));
      const end = await until(() => turnEnds(a.frames)[0]);
      expect(a.frames.find((f) => f.t === 'permission-request')).toBeUndefined();
      expect(readLog().find((l) => l.m === 'perm')?.outcome).toEqual({
        outcome: 'selected',
        optionId: 'abort',
      });
      expect(end).toMatchObject({
        reason: 'refused',
        notice: 'Codex stopped: Maude refused a credential store',
      });
    } finally {
      acp.stopAll();
    }
  }, 20000);

  test('rule 11: fs/* and terminal/* get a JSON-RPC error', async () => {
    setScript([
      { client: 'fs/read_text_file', params: { path: join(repo, 'a.txt') } },
      { client: 'fs/write_text_file', params: { path: join(repo, 'a.txt'), content: 'x' } },
      { client: 'terminal/create', params: { command: 'cat', args: ['/etc/hosts'] } },
    ]);
    const acp = makeAcp();
    const a = fakeWs('w-fs');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', chat: 'g5', text: 'go', agent: 'codex' }));
      await until(() => turnEnds(a.frames)[0]);
      const calls = readLog().filter((l) => l.m === 'client');
      expect(calls.map((c) => c.method)).toEqual([
        'fs/read_text_file',
        'fs/write_text_file',
        'terminal/create',
      ]);
      for (const c of calls) {
        expect(c.error?.code).toBe(FORBIDDEN_METHOD_ERROR.code);
        expect(c.error?.message).toContain('Maude does not offer file or terminal access');
      }
      expect(existsSync(join(repo, 'a.txt'))).toBe(false);
    } finally {
      acp.stopAll();
    }
  }, 20000);

  test('rule 12: a completed read outside the roots ends the session and marks the agent unavailable', async () => {
    setScript([
      {
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tw1',
          kind: 'read',
          title: 'read',
          status: 'completed',
          locations: [{ path: join(outside, 'secret.txt') }],
        },
      },
    ]);
    const acp = makeAcp();
    const a = fakeWs('w-trip');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', chat: 'g6', text: 'go', agent: 'codex' }));
      const violated = await until(() =>
        errors(a.frames).find((f) => f.code === 'agent-policy-violated')
      );
      expect(violated.agent).toEqual({
        id: 'codex',
        label: 'Codex',
        vendor: 'OpenAI',
        statusUrl: 'https://status.openai.com',
      });
      expect(agentHealth('codex').available).toBe(false);
      // the session ended: no generic error on top, and the chat's bridge is gone
      await new Promise((r) => setTimeout(r, 200));
      expect(errors(a.frames)).toHaveLength(1);
      expect(acp.size()).toBe(0);
      // and no chat may start it again this run
      acp.onMessage(a.ws, JSON.stringify({ t: 'attach', chat: 'g7', agent: 'codex' }));
      const unavailable = await until(() =>
        errors(a.frames).find((f) => f.code === 'agent-unavailable')
      );
      expect(unavailable.chat).toBe('g7');
    } finally {
      acp.stopAll();
    }
  }, 20000);

  test('an agent error frame carries the attribution', async () => {
    setScript([], { MAUDE_TEST_STOP: 'not-a-stop-reason' });
    const acp = createAcp(ctxFor(), undefined, {
      permissionTimeoutMs: 4000,
      agents: { byId: (id) => AGENTS[id], resolveBin: () => null, consentFile },
    });
    const a = fakeWs('w-attr');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', chat: 'g8', text: 'go', agent: 'codex' }));
      const err = await until(() => errors(a.frames)[0]);
      expect(err.agent).toMatchObject({ id: 'codex', label: 'Codex', vendor: 'OpenAI' });
      expect(err.chat).toBe('g8');
      expect(String(err.message)).toContain('Codex');
    } finally {
      acp.stopAll();
    }
  }, 20000);
});

describe('"AI may" switches restart a non-Claude agent', () => {
  async function twoTurns(extra: Record<string, string>) {
    setScript([], extra);
    const acp = makeAcp();
    const a = fakeWs(`w-may-${n}`);
    try {
      acp.onOpen(a.ws);
      const send = (may: Record<string, boolean>) =>
        acp.onMessage(
          a.ws,
          JSON.stringify({ t: 'prompt', chat: `m${n}`, text: 'go', agent: 'codex', may })
        );
      send({ assets: true, web: true });
      await until(() => turnEnds(a.frames).length >= 1);
      send({ assets: true, web: false });
      await until(() => turnEnds(a.frames).length >= 2);
      send({ assets: true, web: false });
      await until(() => turnEnds(a.frames).length >= 3);
    } finally {
      acp.stopAll();
    }
    return { log: readLog(), frames: a.frames };
  }

  test('a changed switch respawns with the new launch policy and loads the same session', async () => {
    const { log, frames } = await twoTurns({});
    const spawns = log.filter((l) => l.m === 'spawn');
    expect(spawns).toHaveLength(2); // the unchanged third turn does not restart
    expect(spawns[0]?.env?.FAKE_POLICY_WEB).toBe('true');
    expect(spawns[0]?.env?.MAUDE_NO_EGRESS).toBeUndefined();
    expect(spawns[1]?.env?.FAKE_POLICY_WEB).toBe('false');
    expect(spawns[1]?.env?.MAUDE_NO_EGRESS).toBe('1');
    expect(spawns[1]?.pid).not.toBe(spawns[0]?.pid);
    const first = log.find((l) => l.m === 'new');
    const loaded = log.find((l) => l.m === 'load');
    expect(loaded?.pid).toBe(spawns[1]?.pid);
    expect(loaded?.sessionId).toBe(first?.sessionId);
    expect(frames.find((f) => f.t === 'agent-note')).toBeUndefined();
  }, 30000);

  test('without loadSession: a new session and one note frame', async () => {
    const { log, frames } = await twoTurns({ MAUDE_TEST_LOAD_SESSION: '0' });
    expect(log.filter((l) => l.m === 'spawn')).toHaveLength(2);
    expect(log.some((l) => l.m === 'load')).toBe(false);
    expect(log.filter((l) => l.m === 'new')).toHaveLength(2);
    const notes = frames.filter((f) => f.t === 'agent-note');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.kind).toBe('may-restart-new-session');
  }, 30000);
});

describe('B4: the studio brief reaches a non-Claude agent once', () => {
  test('no systemPrompt capability → the first prompt of the session carries a preamble block, once', async () => {
    setScript();
    const acp = makeAcp();
    const a = fakeWs('w-brief');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(
        a.ws,
        JSON.stringify({ t: 'prompt', chat: 'b1', text: 'first', agent: 'codex' })
      );
      await until(() => turnEnds(a.frames).length >= 1);
      acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', chat: 'b1', text: 'second' }));
      await until(() => turnEnds(a.frames).length >= 2);
    } finally {
      acp.stopAll();
    }
    const prompts = readLog().filter((l) => l.m === 'prompt');
    expect(prompts).toHaveLength(2);
    expect(prompts[0]?.prompt).toHaveLength(2);
    expect(prompts[0]?.prompt?.[0]?.text).toContain('<maude-studio-brief>');
    expect(prompts[0]?.prompt?.[0]?.text).toContain('`maude design <verb>` CLI');
    expect(prompts[0]?.prompt?.[1]?.text).toBe('first');
    expect(prompts[1]?.prompt).toEqual([{ type: 'text', text: 'second' }]);
    // the transcript keeps the person's own words; the brief is its bootstrap line
    const lines = readFileSync(join(repo, '.design', '_chat', 'b1.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(lines.filter((l) => l.role === 'user').map((l) => l.text)).toEqual(['first', 'second']);
    expect(lines.filter((l) => l.role === 'bootstrap' && typeof l.text === 'string')).toHaveLength(
      1
    );
  }, 20000);

  test('systemPrompt advertised → the brief rides session/new, never the prompt', async () => {
    setScript([], { MAUDE_TEST_SYSTEM_PROMPT: '1' });
    const acp = makeAcp();
    const a = fakeWs('w-sys');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(
        a.ws,
        JSON.stringify({ t: 'prompt', chat: 'b2', text: 'first', agent: 'codex' })
      );
      await until(() => turnEnds(a.frames).length >= 1);
    } finally {
      acp.stopAll();
    }
    const log = readLog();
    const created = log.find((l) => l.m === 'raw' && l.method === 'session/new');
    const sys = created?.params?.systemPrompt as
      | { mode: string; content: Array<{ text: string }> }
      | undefined;
    expect(sys?.mode).toBe('append');
    expect(sys?.content[0]?.text).toContain('`maude design <verb>` CLI');
    expect(log.find((l) => l.m === 'prompt')?.prompt).toEqual([{ type: 'text', text: 'first' }]);
  }, 20000);
});
