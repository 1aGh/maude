// Universal-ACP desktop lane (wdio.agents.conf.ts) — a FAKE `opencode` that Maude finds on PATH, version-probes,
// holds to its launch policy in the REAL connect conformance probe, and then chats with.
//
// It is never run directly: the lane compiles it (`bun build --compile`, helpers/fake-agents.ts) into a standalone
// `opencode` executable — what a real opencode is too — with the ACP SDK bundled in. That binary is what discovery
// resolves and version-probes and what the bridge spawns as `opencode acp`. A compiled binary also keeps its argv0
// `opencode`: a `bun <script>` would look like a studio to the lane's prefs guard (helpers/prefs-guard.ts) while the
// conformance probe runs it with the probe world's own XDG_CONFIG_HOME.
//
// Two worlds, told apart by the launch policy env the spawn hands it:
//
//   PROBE  OPENCODE_CONFIG_CONTENT names the probe's loopback provider (`maude_probe`): behave like
//          apps/studio/test/fixtures/acp-conformance/fake-agent.mjs in 'obey' mode — call the model over the
//          chat-completions wire, run the read / write / bash / task calls it hands back, read only inside the
//          project and the `external_directory` roots the policy re-allows (never a denied credential path), ask
//          before every write and shell call, never start an MCP server or a hook, offer no web tool. The probe is
//          never bypassed: this agent passes it by obeying, exactly as the unit fixture does.
//   CHAT   anything else (a Studio chat): no model; the prompt picks a fixed script
//            E2E_OUTSIDE_WRITE <abs path>  announce a write to that path and ask for it (allow-once, allow-always,
//                                          reject-once on offer); write only on an allow — the lane always rejects
//            E2E_AGENT_ERROR               fail the turn with an agent error ("the e2e quota is used up")
//            anything else                 "Hello from the fake opencode."
//
// `--version` prints an in-range opencode version (catalog: 1.18.30 – 1.18.99).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';

export const FAKE_OPENCODE_VERSION = '1.18.40';

if (process.argv.includes('--version')) {
  process.stdout.write(`${FAKE_OPENCODE_VERSION}\n`);
  process.exit(0);
}
if (process.argv[2] !== 'acp') {
  process.stderr.write(
    `fake opencode: unsupported arguments ${JSON.stringify(process.argv.slice(2))}\n`
  );
  process.exit(2);
}

const acp = globalThis.__FAKE_ACP_SDK ?? (await import(process.env.FAKE_ACP_SDK));

const config = (() => {
  try {
    return JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? '{}');
  } catch {
    return {};
  }
})();
const probeUrl = (() => {
  const base = config?.provider?.maude_probe?.options?.baseURL;
  return typeof base === 'string' ? base.replace(/\/v1\/?$/, '') : null;
})();

// ---------------------------------------------------------------- the launch policy, obeyed

const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
const within = (p, root) => {
  const rel = relative(real(root), real(p));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const ext = config?.permission?.external_directory;
const allowRoots = [process.cwd()];
const denyRoots = [];
if (ext && typeof ext === 'object') {
  for (const [k, v] of Object.entries(ext)) {
    if (k === '*') continue;
    const root = k.replace(/\/\*\*$/, '');
    if (v === 'allow') allowRoots.push(root);
    else if (v === 'deny') denyRoots.push(root);
  }
}
const mayRead = (p) => !denyRoots.some((r) => within(p, r)) && allowRoots.some((r) => within(p, r));

// ---------------------------------------------------------------- ACP plumbing

let client = null;
const say = (sessionId, text) =>
  client.notify('session/update', {
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  });

async function allowed(sessionId, toolCall) {
  const r = await client.request('session/request_permission', {
    sessionId,
    toolCall,
    options: [
      { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
      { optionId: 'allow-always', name: 'Always', kind: 'allow_always' },
      { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
    ],
  });
  return r?.outcome?.outcome === 'selected' && String(r.outcome.optionId).startsWith('allow');
}

let seq = 0;

// ---------------------------------------------------------------- PROBE world

const TOOLS = ['read', 'write', 'bash', 'task'];

async function callModel(messages) {
  const res = await fetch(`${probeUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'mock-model',
      stream: true,
      messages,
      tools: TOOLS.map((name) => ({
        type: 'function',
        function: { name, parameters: { type: 'object' } },
      })),
    }),
  });
  let content = '';
  let call = null;
  for (const line of (await res.text()).split('\n')) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
    const j = JSON.parse(line.slice(6));
    for (const c of j.choices ?? []) {
      if (c.delta?.content) content += c.delta.content;
      for (const tc of c.delta?.tool_calls ?? []) {
        call = { id: tc.id, name: tc.function.name, args: JSON.parse(tc.function.arguments) };
      }
    }
  }
  return { content, call };
}

async function runTool(sessionId, call) {
  const { name, args } = call;
  const id = `fake-oc-${++seq}`;
  if (name === 'read') {
    if (!mayRead(args.filePath)) return 'refused: outside the allowed directories';
    try {
      return readFileSync(args.filePath, 'utf8');
    } catch (e) {
      return `error: ${e.message}`;
    }
  }
  if (name === 'write') {
    const ok = await allowed(sessionId, {
      toolCallId: id,
      title: 'write',
      kind: 'edit',
      locations: [{ path: args.filePath }],
      rawInput: { filePath: args.filePath },
    });
    if (!ok) return 'refused by the client';
    mkdirSync(dirname(args.filePath), { recursive: true });
    writeFileSync(args.filePath, String(args.content));
    return 'Wrote file successfully.';
  }
  if (name === 'bash') {
    const ok = await allowed(sessionId, {
      toolCallId: id,
      title: args.command,
      kind: 'execute',
      rawInput: { command: args.command },
    });
    if (!ok) return 'refused by the client';
    const r = spawnSync('/bin/sh', ['-c', args.command], { encoding: 'utf8', timeout: 8000 });
    return `${r.stdout ?? ''}${r.stderr ?? ''}`;
  }
  if (name === 'task') return loop(sessionId, String(args.prompt));
  return `unknown tool ${name}`;
}

async function loop(sessionId, prompt) {
  const messages = [{ role: 'user', content: prompt }];
  for (let i = 0; i < 6; i++) {
    const { content, call } = await callModel(messages);
    if (!call) return content;
    messages.push({
      role: 'assistant',
      tool_calls: [
        {
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        },
      ],
    });
    messages.push({ role: 'tool', tool_call_id: call.id, content: await runTool(sessionId, call) });
  }
  return '';
}

// ---------------------------------------------------------------- CHAT world

async function chat(sessionId, text) {
  const outside = /E2E_OUTSIDE_WRITE\s+(\S+)/.exec(text);
  if (outside) {
    const path = outside[1];
    const toolCallId = `fake-oc-${++seq}`;
    await client.notify('session/update', {
      sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId,
        title: `write ${path}`,
        kind: 'edit',
        status: 'pending',
        locations: [{ path }],
        rawInput: { filePath: path, content: 'ok' },
      },
    });
    const ok = await allowed(sessionId, {
      toolCallId,
      title: `write ${path}`,
      kind: 'edit',
      locations: [{ path }],
      rawInput: { filePath: path, content: 'ok' },
    });
    if (ok) {
      writeFileSync(path, 'ok');
      await say(sessionId, 'Wrote the file.');
    } else {
      await client.notify('session/update', {
        sessionId,
        update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'failed' },
      });
      await say(sessionId, 'The write was refused, so nothing was written.');
    }
    return;
  }
  if (text.includes('E2E_AGENT_ERROR')) {
    throw new acp.RequestError(-32603, 'the e2e quota is used up');
  }
  await say(sessionId, 'Hello from the fake opencode.');
}

// ---------------------------------------------------------------- the agent

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
let n = 0;
acp
  .agent({ name: 'fake-opencode' })
  .onRequest('initialize', (ctx) => {
    client = ctx.client;
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      agentInfo: { name: 'opencode', version: FAKE_OPENCODE_VERSION },
    };
  })
  .onRequest('session/new', (ctx) => {
    client = ctx.client;
    return { sessionId: `fake-oc-session-${++n}` };
  })
  .onRequest('session/prompt', async (ctx) => {
    client = ctx.client;
    const text = (ctx.params.prompt ?? []).map((b) => b.text ?? '').join('');
    if (probeUrl) await loop(ctx.params.sessionId, text);
    else await chat(ctx.params.sessionId, text);
    return { stopReason: 'end_turn' };
  })
  .onNotification('session/cancel', () => {})
  .connect(stream);
