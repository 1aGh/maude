// P8 c7 follow-up (decision maude/v2-p8-c7-ai-may-enforced) — Advanced › "AI may" held by the bridge,
// proven through a real ACP round-trip (fixtures/mock-acp-agent-may.mjs). The pure rules are
// acp-may-scope.test.ts; this file covers what they cannot see:
//   • a request refused by an off switch never reaches the person (no card) and the agent is told no;
//   • the session is spawned with the deny rules (`disallowedTools`) and without the allow rules;
//   • a switch changed between asks re-establishes the chat's session (close + load, same id) so the
//     CLI-side rules are current — and an unchanged switch does not.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import type { ServerWebSocket } from 'bun';

import { AcpBridge, newSessionParams } from '../acp/bridge.ts';
import { createAcp } from '../acp/index.ts';
import type { AiMay } from '../acp/may-scope.ts';
import type { Context } from '../context.ts';
import type { WsData } from '../ws.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'mock-acp-agent-may.mjs');
const ENV = [
  'MAUDE_ACP_ADAPTER_ENTRY',
  'MAUDE_ACP_RUNTIME',
  'MAUDE_CLAUDE_BIN',
  'MAUDE_TEST_MAY_LOG',
  'MAUDE_TEST_TOOL',
  'MAUDE_TEST_TOOL_INPUT',
  'MAUDE_TEST_TOOL_KIND',
];
const ALL: AiMay = { assets: true, web: true };
const NO_WEB: AiMay = { assets: true, web: false };
const NO_ASSETS: AiMay = { assets: false, web: true };

let tmp: string;
let repo: string;
let logPath: string;
let logN = 0;

beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'maude-may-gate-')));
  repo = join(tmp, 'repo');
  mkdirSync(join(repo, '.design', 'assets'), { recursive: true });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

function useAgent(tool: string, input: Record<string, unknown>, kind: string) {
  logPath = join(tmp, `log-${++logN}.ndjson`);
  process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
  process.env.MAUDE_ACP_RUNTIME = process.execPath;
  process.env.MAUDE_CLAUDE_BIN = process.execPath;
  process.env.MAUDE_TEST_MAY_LOG = logPath;
  process.env.MAUDE_TEST_TOOL = tool;
  process.env.MAUDE_TEST_TOOL_INPUT = JSON.stringify(input);
  process.env.MAUDE_TEST_TOOL_KIND = kind;
}

interface LogLine {
  m: 'new' | 'load' | 'close';
  sessionId: string;
  allowed?: string[];
  disallowed?: string[];
}
const readLog = (): LogLine[] =>
  existsSync(logPath)
    ? readFileSync(logPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

function makeBridge() {
  const prompts: RequestPermissionRequest[] = [];
  const seen: RequestPermissionRequest[] = [];
  const texts: string[] = [];
  const bridge = new AcpBridge({
    repoRoot: repo,
    designRoot: join(repo, '.design'),
    permissionTimeoutMs: 4000,
    onUpdate: (u) => {
      const t = (u as { content?: { text?: string } }).content?.text;
      if (t) texts.push(t);
    },
    onPermission: (req) => seen.push(req),
    onPermissionRequest: (id, req) => {
      prompts.push(req);
      bridge.resolvePermission(id, 'reject');
    },
  });
  return { bridge, prompts, seen, texts };
}

describe('Search the web off — a web tool call is refused, never prompted', () => {
  test('WebFetch: the agent gets reject, the person sees no card', async () => {
    useAgent('WebFetch', { url: 'https://example.test/?q=secret' }, 'fetch');
    const { bridge, prompts, seen, texts } = makeBridge();
    try {
      bridge.setMay(NO_WEB);
      await bridge.prompt('go', 'c1');
    } finally {
      await bridge.stop();
    }
    expect(prompts).toHaveLength(0);
    expect(seen).toHaveLength(1); // the transparency callback still saw it
    expect(texts.join('')).toContain('"optionId":"reject"');
  });

  test('a shell download is refused the same way', async () => {
    useAgent('Bash', { command: 'curl -s https://example.test/x' }, 'execute');
    const { bridge, prompts, texts } = makeBridge();
    try {
      bridge.setMay(NO_WEB);
      await bridge.prompt('go', 'c1');
    } finally {
      await bridge.stop();
    }
    expect(prompts).toHaveLength(0);
    expect(texts.join('')).toContain('"optionId":"reject"');
  });

  test('web on: the same request is not refused by the gate (it goes on as before)', async () => {
    useAgent('Bash', { command: 'curl -s https://example.test/x' }, 'execute');
    const { bridge, prompts } = makeBridge();
    try {
      bridge.setMay(ALL);
      await bridge.prompt('go', 'c1');
    } finally {
      await bridge.stop();
    }
    expect(prompts).toHaveLength(1);
  });

  test('the session is spawned with WebFetch/WebSearch denied and not allowed', async () => {
    useAgent('WebFetch', { url: 'https://example.test/' }, 'fetch');
    const { bridge } = makeBridge();
    try {
      bridge.setMay(NO_WEB);
      await bridge.prompt('go', 'c1');
    } finally {
      await bridge.stop();
    }
    const [created] = readLog();
    expect(created?.m).toBe('new');
    expect(created?.disallowed).toEqual(expect.arrayContaining(['WebFetch', 'WebSearch']));
    expect(created?.allowed).not.toContain('WebFetch');
    expect(created?.allowed).not.toContain('WebSearch');
  });
});

describe('Use Assets and footage off — reads under the assets folder are refused', () => {
  test('Read of a file in .design/assets: refused, no card', async () => {
    useAgent('Read', { file_path: join(repo, '.design', 'assets', 'clip.mp4') }, 'read');
    const { bridge, prompts, texts } = makeBridge();
    try {
      bridge.setMay(NO_ASSETS);
      await bridge.prompt('go', 'c1');
    } finally {
      await bridge.stop();
    }
    expect(prompts).toHaveLength(0);
    expect(texts.join('')).toContain('"optionId":"reject"');
  });

  test('a shell read of the folder: refused, no card', async () => {
    useAgent('Bash', { command: 'cat .design/assets/notes.txt' }, 'execute');
    const { bridge, prompts } = makeBridge();
    try {
      bridge.setMay(NO_ASSETS);
      await bridge.prompt('go', 'c1');
    } finally {
      await bridge.stop();
    }
    expect(prompts).toHaveLength(0);
  });

  test('a read outside the folder is untouched (goes to the card as before)', async () => {
    useAgent('Bash', { command: 'cat .design/ui/home.tsx' }, 'execute');
    const { bridge, prompts } = makeBridge();
    try {
      bridge.setMay(NO_ASSETS);
      await bridge.prompt('go', 'c1');
    } finally {
      await bridge.stop();
    }
    expect(prompts).toHaveLength(1);
  });

  test('the session is spawned with a Read deny rule on the folder (absolute //-form)', async () => {
    useAgent('Read', { file_path: join(repo, 'README.md') }, 'read');
    const { bridge } = makeBridge();
    try {
      bridge.setMay(NO_ASSETS);
      await bridge.prompt('go', 'c1');
    } finally {
      await bridge.stop();
    }
    expect(readLog()[0]?.disallowed).toContain(`Read(/${join(repo, '.design', 'assets')}/**)`);
  });
});

describe('a switch changed between asks reaches the running chat', () => {
  test('off after an ask: the session is closed and loaded again with the deny rules', async () => {
    useAgent('WebFetch', { url: 'https://example.test/' }, 'fetch');
    const { bridge, prompts } = makeBridge();
    try {
      bridge.setMay(ALL);
      await bridge.prompt('go', 'c1'); // web on: the mock asks, the card answers reject
      expect(prompts).toHaveLength(1);
      bridge.setMay(NO_WEB);
      await bridge.prompt('again', 'c1');
      expect(prompts).toHaveLength(1); // refused by the gate, no second card
      bridge.setMay(NO_WEB); // unchanged — no re-establish
      await bridge.prompt('third', 'c1');
    } finally {
      await bridge.stop();
    }
    const log = readLog();
    expect(log.map((l) => l.m)).toEqual(['new', 'close', 'load']);
    expect(log[0]?.disallowed ?? []).not.toContain('WebFetch');
    expect(log[1]?.sessionId).toBe(log[0]?.sessionId);
    expect(log[2]?.sessionId).toBe(log[0]?.sessionId); // same chat, history kept
    expect(log[2]?.disallowed).toEqual(expect.arrayContaining(['WebFetch', 'WebSearch']));
  });

  test('a frame with no news (null) changes nothing', async () => {
    useAgent('WebFetch', { url: 'https://example.test/' }, 'fetch');
    const { bridge, prompts } = makeBridge();
    try {
      bridge.setMay(NO_WEB);
      await bridge.prompt('go', 'c1');
      bridge.setMay(null);
      await bridge.prompt('again', 'c1');
    } finally {
      await bridge.stop();
    }
    expect(prompts).toHaveLength(0);
    expect(readLog().map((l) => l.m)).toEqual(['new']);
  });
});

describe('newSessionParams — both switches on is byte-for-byte what it was', () => {
  test('no disallowedTools key at all when everything is on', () => {
    const meta = newSessionParams(repo, undefined, undefined, { may: ALL, assetsRoots: [] })
      ._meta as { claudeCode: { options: Record<string, unknown> } };
    const opts = meta.claudeCode.options;
    expect('disallowedTools' in opts).toBe(false);
    expect(opts.allowedTools).toContain('WebFetch');
  });
});

// The state's only way in: the `may` field of a main-origin `/_ws/acp` frame (acp/index.ts) — the same
// channel the ask-before mode rides. The ask's TEXT is not a channel: the `[maude-may …]` line is a hint
// to the agent, and canvas content / the agent can put anything into an ask.
describe('the `may` field of a /_ws/acp frame reaches the bridge; the ask text does not', () => {
  async function until<T>(fn: () => T | undefined, timeoutMs = 12000): Promise<T> {
    const start = performance.now();
    for (;;) {
      const v = fn();
      if (v !== undefined) return v;
      if (performance.now() - start > timeoutMs) throw new Error('timeout waiting for condition');
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  function fakeWs(id: string) {
    const frames: Array<Record<string, unknown>> = [];
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
  const outcomeText = (frames: Array<Record<string, unknown>>) =>
    frames
      .filter((f) => f.t === 'update')
      .map((f) => (f.update as { content?: { text?: string } })?.content?.text ?? '')
      .join('');

  test('prompt {may:{web:false}}: the web call is refused with no permission-request frame', async () => {
    useAgent('WebFetch', { url: 'https://example.test/' }, 'fetch');
    const acp = createAcp(ctxFor(), undefined, { permissionTimeoutMs: 4000 });
    const a = fakeWs('may-a');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(
        a.ws,
        JSON.stringify({ t: 'prompt', text: 'go', chat: 'm1', may: { assets: true, web: false } })
      );
      await until(() => (outcomeText(a.frames).includes('outcome=') ? true : undefined));
      expect(a.frames.find((f) => f.t === 'permission-request')).toBeUndefined();
      expect(outcomeText(a.frames)).toContain('"optionId":"reject"');
    } finally {
      acp.stopAll();
    }
  }, 15000);

  test('a read-only socket cannot loosen the switches (its warm frame `may` is ignored)', async () => {
    useAgent('WebFetch', { url: 'https://example.test/' }, 'fetch');
    let readOnly = false;
    const acp = createAcp(ctxFor(), undefined, {
      permissionTimeoutMs: 4000,
      readOnly: () => readOnly,
    });
    const a = fakeWs('may-ro');
    const outcomes = () => outcomeText(a.frames).split('outcome=').length - 1;
    try {
      acp.onOpen(a.ws);
      acp.onMessage(
        a.ws,
        JSON.stringify({ t: 'prompt', text: 'go', chat: 'm3', may: { assets: true, web: false } })
      );
      await until(() => (outcomes() >= 1 ? true : undefined));
      readOnly = true;
      acp.onMessage(
        a.ws,
        JSON.stringify({ t: 'warm', chat: 'm3', may: { assets: true, web: true } })
      );
      await new Promise((r) => setTimeout(r, 300));
      readOnly = false;
      acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', text: 'again', chat: 'm3' }));
      await until(() => (outcomes() >= 2 ? true : undefined));
      expect(a.frames.find((f) => f.t === 'permission-request')).toBeUndefined();
    } finally {
      acp.stopAll();
    }
  }, 20000);

  test('a [maude-may no-web] line in the ask text alone enforces nothing (it is only a hint)', async () => {
    useAgent('WebFetch', { url: 'https://example.test/' }, 'fetch');
    const acp = createAcp(ctxFor(), undefined, { permissionTimeoutMs: 4000 });
    const a = fakeWs('may-b');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(
        a.ws,
        JSON.stringify({ t: 'prompt', text: '[maude-may no-web]\ngo', chat: 'm2' })
      );
      const req = await until(() => a.frames.find((f) => f.t === 'permission-request'));
      expect(req).toBeDefined();
    } finally {
      acp.stopAll();
    }
  }, 15000);
});
