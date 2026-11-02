#!/usr/bin/env bun
// P8 e2e live lanes — a SCRIPTED fake ACP agent: what a signed-in Claude does, without a model.
//
// The desktop e2e specs that used to need a real `claude` (acp-capability-picker, acp-write-scope, ai-quit) test
// MAUDE's side of the conversation: the live mode roster, the bridge's write-path gate, the permission card, the
// run registry, the quit dialog. None of that depends on what a model would say — only on the wire the adapter
// speaks. So this agent speaks that wire (shapes recorded in apps/studio/test/fixtures/mock-acp-agent-write.mjs and
// mock-acp-agent-caps.mjs) and does a fixed thing per prompt. A lane that must judge REAL model output is not a
// candidate for this file; it belongs to the V2-8.16 live journeys.
//
// Which script runs is decided by what the prompt SAYS (the specs' prompts carry the marker):
//
//   write-scope-probe.txt            Write `<cwd>/write-scope-probe.txt` ("ok"): asks the bridge to approve it as the
//                                    adapter does in Manual mode (the bridge answers an in-project write itself).
//   ~/.maude-e2e-write-scope-probe*  Write that path (outside the project): the bridge raises the card. Nothing is
//                                    EVER written outside the project, whatever the answer.
//   Bash tool … `date`               A shell call that waits for the person (Needs you).
//   "Step 1" … "Step 40"             Forty slow edits to the first canvas under .design (partial work to publish).
//   "from 1 to 4000"                 A long streamed reply, until the person stops it.
//   "Take N seconds"                 A quiet turn that works N seconds (N ≤ 600) and ends `done` with no write: a live
//                                    run the shell can watch (03 ai-other-tab: the tab's spark, then its done dot).
//   "Keep going from where you …"    (a resumed run) the forty slow edits again.
//   anything else                    "ok."
//
// The session mode is real state here: `session/set_mode` changes it and answers with the same `config_option_update`
// the real adapter emits (and no `current_mode_update` — the bridge cross-derives it). Mode `plan` edits nothing;
// `acceptEdits` / `bypassPermissions` ask for nothing; `default` asks for writes and the shell, like Claude Code.
//
// Boot (apps/desktop/e2e/helpers/fake-ai.ts):  MAUDE_ACP_ADAPTER_ENTRY=<this file>  MAUDE_ACP_RUNTIME=$(which bun)
//   MAUDE_CLAUDE_BIN=<signed-in claude stub>  FAKE_ACP_SDK=<abs path of @agentclientprotocol/sdk/dist/acp.js>
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';

const acp = await import(process.env.FAKE_ACP_SDK);
const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Sleep `ms`, but wake within 100 ms of a cancel so Stop is felt at once. */
async function nap(s, ms) {
  for (let left = ms; left > 0 && !s.cancelled; left -= 100) await sleep(Math.min(100, left));
}
const MODES = [
  {
    id: 'default',
    name: 'Default',
    description: 'Standard behavior, prompts for dangerous operations',
  },
  { id: 'acceptEdits', name: 'Accept Edits', description: 'Auto-accept file edit operations' },
  { id: 'plan', name: 'Plan Mode', description: 'Planning mode, no actual tool execution' },
];
const MODE_OPTIONS = MODES.map((m) => ({ value: m.id, name: m.name }));
const sessions = new Map(); // sessionId -> { mode, cancelled }
let n = 0;

const modeConfig = (s) => [
  {
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    type: 'select',
    currentValue: s.mode,
    options: MODE_OPTIONS,
  },
];
// The connection's client handle (every request context carries the same one).
let client = null;
const note = (sessionId, update) => client.notify('session/update', { sessionId, update });
const say = (sessionId, text) =>
  note(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });

function state(sessionId) {
  let s = sessions.get(sessionId);
  if (!s) {
    s = { mode: 'default', cancelled: false };
    sessions.set(sessionId, s);
  }
  return s;
}

function newSession() {
  const sessionId = `fake-${process.pid}-${++n}`;
  const s = state(sessionId);
  return {
    sessionId,
    modes: { currentModeId: s.mode, availableModes: MODES },
    configOptions: modeConfig(s),
  };
}

/** The first canvas under <cwd>/.design (skipping runtime/system dirs), newest first. */
function firstCanvas(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('_') || name === 'system' || name === 'node_modules') continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.tsx')) out.push({ path: p, mtime: st.mtimeMs });
    }
  };
  try {
    walk(join(root, '.design'));
  } catch {
    return null;
  }
  return out.sort((a, b) => b.mtime - a.mtime)[0]?.path ?? null;
}

// ── one tool call, the way the adapter puts it on the wire ────────────────────────────────────────────
let callN = 0;
/** `tool_call` (the tool NAME's only carrier) then — when the mode asks — the permission request. */
async function toolCall(sessionId, tool, rawInput, { ask }) {
  const toolCallId = `tc-${process.pid}-${++callN}`;
  const file = rawInput.file_path;
  const info = file
    ? { title: `${tool} ${file}`, kind: 'edit', content: [], locations: [{ path: file }] }
    : { title: `${tool} ${rawInput.command ?? ''}`.trim(), kind: 'execute', content: [] };
  await note(sessionId, {
    _meta: { claudeCode: { toolName: tool } },
    toolCallId,
    sessionUpdate: 'tool_call',
    rawInput,
    status: 'pending',
    ...info,
  });
  let allowed = true;
  if (ask) {
    const res = await client.request(acp.methods.client.session.requestPermission, {
      sessionId,
      toolCall: { toolCallId, rawInput, ...info },
      options: [
        { optionId: 'allow_always', name: 'Always Allow', kind: 'allow_always' },
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    });
    const picked = res?.outcome?.outcome === 'selected' ? res.outcome.optionId : null;
    allowed = picked === 'allow' || picked === 'allow_always';
  }
  await note(sessionId, {
    toolCallId,
    sessionUpdate: 'tool_call_update',
    status: allowed ? 'completed' : 'failed',
    rawInput,
  });
  return allowed;
}

const promptText = (params) =>
  (params.prompt ?? []).map((b) => (b?.type === 'text' ? b.text : '')).join('\n');

async function run(ctx) {
  const { sessionId } = ctx.params;
  const s = state(sessionId);
  s.cancelled = false;
  const text = promptText(ctx.params);
  const root = process.cwd();
  const cancelled = () => ({ stopReason: 'cancelled' });

  // ── the write-scope probes ──
  const outside = text.match(/~\/\.maude-e2e-write-scope-probe[\w.-]*\.txt/);
  if (outside || /write-scope-probe\.txt/.test(text)) {
    if (s.mode === 'plan') {
      await say(sessionId, 'Plan mode: nothing was written.');
      return { stopReason: 'end_turn' };
    }
    const file = outside ? outside[0] : join(root, 'write-scope-probe.txt');
    const allowed = await toolCall(
      sessionId,
      'Write',
      { file_path: file, content: 'ok' },
      { ask: s.mode === 'default' }
    );
    // Only ever inside the project: a stand-in for a model must not be the thing that writes outside it.
    if (allowed && !outside) writeFileSync(file, 'ok');
    await say(sessionId, allowed ? 'Written.' : 'Rejected - I stopped.');
    return { stopReason: 'end_turn' };
  }

  // ── a shell call that needs the person ──
  if (/Bash tool/i.test(text)) {
    if (s.mode === 'plan') {
      await say(sessionId, 'Plan mode: no commands run.');
      return { stopReason: 'end_turn' };
    }
    const ran = await toolCall(sessionId, 'Bash', { command: 'date' }, { ask: true });
    await say(sessionId, ran ? 'It ran.' : 'Skipped.');
    return { stopReason: s.cancelled ? 'cancelled' : 'end_turn' };
  }

  // ── forty slow edits: partial work for a stop to keep ──
  // Keep going (acp/index.ts KEEP_GOING_TEXT, the prompt of a resumed run) carries on with them: the run a relaunch
  // resumes is live again until it is stopped, as a real resumed edit run is (ai-quit step 5 quits over it)
  if (/Step 1\b[\s\S]*Step 40/.test(text) || /Keep going from where you stopped\./.test(text)) {
    const target = firstCanvas(root);
    for (let i = 1; i <= 40; i++) {
      if (s.cancelled) return cancelled();
      if (target) {
        const src = readFileSync(target, 'utf8').replace(/\n?\/\/ Step \d+\n?$/, '');
        const ok = await toolCall(
          sessionId,
          'Edit',
          { file_path: target, old_string: 'a', new_string: `Step ${i}` },
          { ask: s.mode === 'default' }
        );
        if (ok) writeFileSync(target, `${src}\n// Step ${i}\n`);
      }
      await nap(s, 6000);
    }
    await say(sessionId, 'All forty steps are done.');
    return { stopReason: 'end_turn' };
  }

  // ── a quiet turn of N seconds (03 ai-other-tab, 01 cf-busy) ──
  const slow = /Take (\d{1,3}) seconds/.exec(text);
  if (slow) {
    await say(sessionId, 'Working on it.');
    await nap(s, Math.min(600, Number(slow[1])) * 1000);
    if (s.cancelled) return cancelled();
    await say(sessionId, 'Done.');
    return { stopReason: 'end_turn' };
  }

  // ── a long streamed reply ──
  if (/1 to 4000/.test(text)) {
    for (let from = 1; from <= 4000; from += 5) {
      if (s.cancelled) return cancelled();
      const nums = Array.from({ length: 5 }, (_, k) => from + k).join(', ');
      await say(sessionId, `${nums}, `);
      await nap(s, 400);
    }
    return { stopReason: 'end_turn' };
  }

  await say(sessionId, 'ok.');
  return { stopReason: 'end_turn' };
}

acp
  .agent({ name: 'fake-scripted-agent' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true },
  }))
  .onRequest('session/new', (ctx) => {
    client = ctx.client;
    return newSession();
  })
  // A relaunched app resumes the chat's persisted session: any id is "known" (the state is per process).
  .onRequest('session/load', (ctx) => {
    client = ctx.client;
    const s = state(ctx.params.sessionId);
    return {
      modes: { currentModeId: s.mode, availableModes: MODES },
      configOptions: modeConfig(s),
    };
  })
  .onRequest('session/set_mode', async (ctx) => {
    const s = state(ctx.params.sessionId);
    if (!MODES.some((m) => m.id === ctx.params.modeId))
      throw new Error(`unknown mode: ${ctx.params.modeId}`);
    client = ctx.client;
    s.mode = ctx.params.modeId;
    // The real adapter's setSessionMode emits ONLY config_option_update; the bridge cross-derives the mode.
    await note(ctx.params.sessionId, {
      sessionUpdate: 'config_option_update',
      configOptions: modeConfig(s),
    });
    return {};
  })
  .onRequest('session/prompt', (ctx) => {
    client = ctx.client;
    return run(ctx);
  })
  .onNotification('session/cancel', (ctx) => {
    state(ctx.params.sessionId).cancelled = true;
  })
  .connect(stream);
