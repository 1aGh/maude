#!/usr/bin/env bun
// P8 test round, group G3 (AI-run states) - a SCRIPTED fake ACP agent that runs the design plugin's REAL hook code.
// Never a provider. Same idea as the fidelity harness (decision maude/v2-8.5-g2-fake-acp-hook-agent): the edits go
// through `runHook` (prompt / pre-edit / post-edit) the way Claude Code's own do, so the studio's run registry,
// leases, rings, holds, "Made by AI" marks and results are the REAL ones; only the model is missing.
//
// What a prompt does is decided by a one-shot script file, `$HOOK_AGENT_SCRIPT` (JSON `{ steps: [...] }`, deleted
// when read; with no file the turn says "ok." and ends). The test writes it before it sends the prompt. A step is:
//   { op: 'say',   text }                         an agent_message_chunk
//   { op: 'tool',  id, title, kind?, path? }      a tool_call (in_progress) - `title` is what the working line shows
//   { op: 'done',  id, path? }                    its tool_call_update (completed)
//   { op: 'edit',  path, content }                pre-edit hook, write the file, post-edit hook (project-relative path)
//   { op: 'replace', path, from, to }             the same, as a string replace in the file's current text
//   { op: 'gate',  name }                         block until `$HOOK_AGENT_GATES/<name>` exists (or the turn is cancelled):
//                                                  the test asserts the mid-run state, then touches the file. No timers.
//   { op: 'sleep', ms }                           wake on cancel
//   { op: 'usage', used, size, five }             the adapter's usage_update (context window + 5-hour limit)
//   { op: 'ask',   title }                        a real session/request_permission (Needs you)
//   { op: 'fail',  message }                      the turn errors out
//   { op: 'write', path, content }                a plain write with NO hook (a file the run did not lease)
//   { op: 'maude', args, stdin? }                 the REAL `maude` verb (node cli/bin/maude.mjs <args>) in the project root
// Boot (helpers in ../ai-lane.mjs): MAUDE_ACP_ADAPTER_ENTRY=<this file> MAUDE_ACP_RUNTIME=$(which bun)
//   MAUDE_CLAUDE_BIN=<signed-in claude stub> FAKE_ACP_SDK=<abs path of @agentclientprotocol/sdk/dist/acp.js>
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const { runHook } = await import(join(HERE, '../../../../../cli/lib/design-hook.mjs'));
const MAUDE_CLI = join(HERE, '../../../../../cli/bin/maude.mjs');
const acp = await import(process.env.FAKE_ACP_SDK);
const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GATES = process.env.HOOK_AGENT_GATES || '';
const abs = (p) => (isAbsolute(p) ? p : join(process.cwd(), p));
const sessions = new Map();
let n = 0;

const note = (ctx, u) =>
  ctx.client.notify('session/update', { sessionId: ctx.params.sessionId, update: u });
const hookIn = (ctx, extra) =>
  JSON.stringify({ session_id: ctx.params.sessionId, cwd: process.cwd(), ...extra });

function takeScript() {
  const f = process.env.HOOK_AGENT_SCRIPT;
  if (!f || !existsSync(f)) return null;
  try {
    const s = JSON.parse(readFileSync(f, 'utf8'));
    unlinkSync(f);
    return s;
  } catch {
    return null;
  }
}

/** The edit the way Claude Code does it: pre-edit hook (the lease), the write, post-edit hook (touched). */
async function hooked(ctx, path, next, part = null) {
  const p = abs(path);
  const old = existsSync(p) ? readFileSync(p, 'utf8') : '';
  const input = {
    hook_event_name: 'PreToolUse',
    tool_use_id: 'tu' + Math.random().toString(36).slice(2, 8),
    tool_name: old ? 'Edit' : 'Write',
    tool_input: part
      ? { file_path: p, old_string: part.old, new_string: part.new, replace_all: false }
      : old
        ? { file_path: p, old_string: old, new_string: next, replace_all: false }
        : { file_path: p, content: next },
  };
  const pre = await runHook({ event: 'pre-edit', stdinText: hookIn(ctx, input) });
  if (pre && /"deny"|"block"/.test(pre)) return pre;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, next);
  await runHook({
    event: 'post-edit',
    stdinText: hookIn(ctx, { ...input, hook_event_name: 'PostToolUse', tool_response: {} }),
  });
  return null;
}

async function waitGate(name, s) {
  const f = join(GATES, name);
  while (!existsSync(f) && !s.cancelled) await sleep(80);
}

async function runSteps(ctx, steps, s) {
  await runHook({
    event: 'prompt',
    stdinText: hookIn(ctx, {
      hook_event_name: 'UserPromptSubmit',
      prompt: (ctx.params.prompt ?? []).map((b) => (b?.type === 'text' ? b.text : '')).join('\n'),
    }),
  });
  for (const st of steps) {
    if (s.cancelled) return { stopReason: 'cancelled' };
    switch (st.op) {
      case 'say':
        await note(ctx, {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: st.text },
        });
        break;
      case 'tool':
        await note(ctx, {
          sessionUpdate: 'tool_call',
          toolCallId: st.id,
          title: st.title,
          kind: st.kind ?? 'edit',
          status: 'in_progress',
          locations: st.path ? [{ path: abs(st.path) }] : [],
          rawInput: st.path ? { file_path: abs(st.path) } : {},
        });
        break;
      case 'done':
        await note(ctx, {
          sessionUpdate: 'tool_call_update',
          toolCallId: st.id,
          status: 'completed',
          locations: st.path ? [{ path: abs(st.path) }] : [],
          rawInput: st.path ? { file_path: abs(st.path) } : {},
        });
        break;
      case 'edit':
        await hooked(ctx, st.path, st.content);
        break;
      case 'replace': {
        const cur = readFileSync(abs(st.path), 'utf8');
        if (!cur.includes(st.from))
          throw new Error(`replace: ${st.from.slice(0, 40)} not in ${st.path}`);
        await hooked(ctx, st.path, cur.replace(st.from, st.to));
        break;
      }
      // a small Edit, the way a model does it: `before` (an anchor that is in the file) becomes `text` + `before`.
      // The lease then covers only the artboard the anchor sits in - a NEW artboard is not leased, it just lands.
      case 'insert': {
        const cur = readFileSync(abs(st.path), 'utf8');
        if (!cur.includes(st.before))
          throw new Error(`insert: anchor ${st.before.slice(0, 40)} not in ${st.path}`);
        await hooked(ctx, st.path, cur.replace(st.before, st.text + st.before), {
          old: st.before,
          new: st.text + st.before,
        });
        break;
      }
      // replace `from` with `to` as ONE small Edit (old_string = from): leases the artboard `from` sits in
      case 'subst': {
        const cur = readFileSync(abs(st.path), 'utf8');
        if (!cur.includes(st.from))
          throw new Error(`subst: ${st.from.slice(0, 40)} not in ${st.path}`);
        await hooked(ctx, st.path, cur.replace(st.from, st.to), { old: st.from, new: st.to });
        break;
      }
      case 'write':
        mkdirSync(dirname(abs(st.path)), { recursive: true });
        writeFileSync(abs(st.path), st.content);
        break;
      // the REAL verb, the way the model runs it through Bash: `maude design annotate ui/X.tsx --ops -` with the ops on
      // stdin, in the project root. Exit != 0 fails the turn (the run reads as failed).
      case 'maude': {
        const r = spawnSync('node', [MAUDE_CLI, ...st.args], {
          cwd: process.cwd(),
          input: st.stdin ?? '',
          encoding: 'utf8',
          env: { ...process.env, MAUDE_AGENT_ACTOR: 'maude-chat' },
        });
        // the verb's own words, where a failing scenario can read them (the bridge only says "Internal error")
        if (GATES)
          writeFileSync(
            join(GATES, `maude-${Date.now()}.log`),
            `$ maude ${st.args.join(' ')}\nexit ${r.status}\n${r.stdout}\n${r.stderr}\n`
          );
        if (r.status !== 0)
          throw new Error(`maude ${st.args.join(' ')} exited ${r.status}: ${r.stderr || r.stdout}`);
        break;
      }
      case 'gate':
        await waitGate(st.name, s);
        break;
      case 'sleep':
        for (let left = st.ms; left > 0 && !s.cancelled; left -= 100)
          await sleep(Math.min(100, left));
        break;
      case 'usage':
        await note(ctx, {
          sessionUpdate: 'usage_update',
          used: st.used,
          size: st.size,
          _meta: {
            '_claude/rateLimit': {
              status: 'allowed',
              rateLimitType: 'five_hour',
              utilization: st.five ?? 0,
              resetsAt: Math.floor(Date.now() / 1000) + 3 * 3600,
            },
          },
        });
        break;
      case 'ask':
        await ctx.client.request(acp.methods.client.session.requestPermission, {
          sessionId: ctx.params.sessionId,
          toolCall: { toolCallId: 'ask1', title: st.title, kind: 'other', rawInput: {} },
          options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'reject', name: 'Not now', kind: 'reject_once' },
          ],
        });
        break;
      case 'fail':
        throw new acp.RequestError(-32603, st.message);
      default:
        throw new Error(`unknown step ${st.op}`);
    }
  }
  return { stopReason: s.cancelled ? 'cancelled' : 'end_turn' };
}

const state = (id) => {
  let s = sessions.get(id);
  if (!s) {
    s = { cancelled: false };
    sessions.set(id, s);
  }
  return s;
};

acp
  .agent({ name: 'hook-agent' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true },
  }))
  .onRequest('session/new', () => {
    const id = `ha-${process.pid}-${++n}`;
    state(id);
    return {
      sessionId: id,
      modes: {
        currentModeId: 'default',
        availableModes: [
          { id: 'default', name: 'Ask before' },
          { id: 'acceptEdits', name: 'Accept edits' },
          { id: 'plan', name: 'Plan' },
        ],
      },
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          type: 'select',
          currentValue: 'opus',
          options: [
            { value: 'opus', name: 'Opus' },
            { value: 'sonnet', name: 'Sonnet' },
          ],
        },
        {
          id: 'effort',
          name: 'Effort',
          type: 'select',
          currentValue: 'medium',
          options: [
            { value: 'low', name: 'Low' },
            { value: 'medium', name: 'Medium' },
            { value: 'high', name: 'High' },
          ],
        },
        {
          id: 'fast',
          name: 'Fast mode',
          type: 'select',
          currentValue: 'off',
          options: [
            { value: 'off', name: 'Off' },
            { value: 'on', name: 'On' },
          ],
        },
      ],
    };
  })
  .onRequest('session/load', () => ({}))
  .onNotification('session/cancel', (ctx) => {
    state(ctx.params.sessionId).cancelled = true;
  })
  .onRequest('session/prompt', async (ctx) => {
    const s = state(ctx.params.sessionId);
    s.cancelled = false;
    const script = takeScript();
    if (!script) {
      await note(ctx, {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'ok.' },
      });
      return { stopReason: 'end_turn' };
    }
    return runSteps(ctx, script.steps, s);
  })
  .connect(stream);
