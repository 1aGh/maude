#!/usr/bin/env bun
// Phase-8 fidelity (G2) — a scripted FAKE ACP agent. Never a provider. The prompt text picks the behaviour:
//   "…hang…"        a tool call on the canvas, a few words, then nothing (until cancelled)       → "AI works" states
//   "…permission…"  a real requestPermission before the edit                                    → ai-permission
//   "…question…"    a real elicitation/create (three options)                                   → ai-question / ai-choice
//   "…fail…"        the turn errors out                                                         → ai-choice-fail (failure half)
//   anything else   edits the canvas (swaps the green in Combine-kampan.tsx's Post), says "Done — …"
// It calls the design plugin's hook code (`runHook`) the way Claude Code would, so the studio attributes the edit to the run.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { runHook as rh } from '../../cli/lib/design-hook.mjs';
import { appendFileSync } from 'node:fs';
const LOG = join(import.meta.dirname, '../agent.log');
const runHook = async (a) => { const r = await rh(a); appendFileSync(LOG, a.event + ' => ' + String(r).slice(0, 300) + ' chat=' + process.env.MAUDE_CHAT_ID + ' cwd=' + process.cwd() + '\n'); return r; };

const acp = await import(process.env.FAKE_ACP_SDK);
const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
let n = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const note = (ctx, u) => ctx.client.notify('session/update', { sessionId: ctx.params.sessionId, update: u });
const say = (ctx, text) => note(ctx, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
const cancels = new Map();
const CANVAS = () => join(process.cwd(), '.design/ui/Combine-kampan.tsx');
const promptText = (ctx) => (ctx.params.prompt || []).map((b) => b.text || '').join(' ');
// FINAL (D2): the scenario picks the behaviour through a one-shot file next to the project (<scratch>/next-mode: JSON {mode, text?, poster?}),
// so the prompts the chat shows are the board's own words, not trigger words. Falls back to the prompt-text triggers.
function nextMode() {
  const f = join(dirname(process.cwd()), 'next-mode');
  if (!existsSync(f)) return null;
  try { const m = JSON.parse(readFileSync(f, 'utf8')); unlinkSync(f); return m; } catch { return null; }
}

const hookIn = (ctx, extra) => JSON.stringify({ session_id: ctx.params.sessionId, cwd: process.cwd(), ...extra });
async function begin(ctx) {
  await runHook({ event: 'prompt', stdinText: hookIn(ctx, { hook_event_name: 'UserPromptSubmit', prompt: 'x' }) });
}
/** The edit the way Claude Code does it: pre-edit hook (lease), the write, post-edit hook (touched). */
async function edit(ctx, write = true, poster = false, target = null) {
  const p = CANVAS();
  const whole = readFileSync(p, 'utf8');
  // target 'copy': only the copy artboard's own block changes (a run on a copy leases ONLY the copy); the Edit's
  // old_string is that whole block, so it is unique in the file
  let block = null;
  if (target) {
    const m = (target === 'copy' ? /<DCArtboard id="post-copy[^"]*"/ : new RegExp(`<DCArtboard id="${target}"`)).exec(whole);
    if (m) block = whole.slice(m.index, whole.indexOf('</DCArtboard>', m.index));
  }
  const s = block ?? whole;
  const A = poster ? '#2c7a4c' : '#2f7d4f', B = poster ? '#52c97c' : '#52c97d';
  const from = s.includes(A) ? A : B;
  const to = from === A ? B : A;
  const next = s.replaceAll(from, to);
  const input = {
    hook_event_name: 'PreToolUse',
    tool_use_id: 'tu' + Math.random().toString(36).slice(2, 8),
    tool_name: 'Edit',
    tool_input: block
      ? { file_path: p, old_string: block, new_string: next, replace_all: false }
      : { file_path: p, old_string: from, new_string: to, replace_all: true },
  };
  const pre = await runHook({ event: 'pre-edit', stdinText: hookIn(ctx, input) });
  if (pre && /deny|block/.test(pre)) return pre;
  if (!write) return null;
  writeFileSync(p, block ? whole.replace(block, next) : whole.replaceAll(from, to));
  await runHook({ event: 'post-edit', stdinText: hookIn(ctx, { ...input, hook_event_name: 'PostToolUse', tool_response: {} }) });
  return null;
}
const toolStart = (ctx, id, path, title = 'Background done · badge next') =>
  note(ctx, { sessionUpdate: 'tool_call', toolCallId: id, title, kind: 'edit', status: 'in_progress', locations: [{ path }], rawInput: { file_path: path } });
const toolEnd = (ctx, id, path) =>
  note(ctx, { sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', locations: [{ path }], rawInput: { file_path: path } });

const agent = acp.agent({ name: 'fake-g2' });
agent
  .onRequest('initialize', () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: true } }))
  .onRequest('session/new', () => ({
    sessionId: `g2-${++n}`,
    modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Ask before' }, { id: 'acceptEdits', name: 'Accept edits' }, { id: 'plan', name: 'Plan' }] },
    configOptions: [
      { id: 'model', name: 'Model', type: 'select', currentValue: 'opus', options: [{ value: 'opus', name: 'Opus' }, { value: 'sonnet', name: 'Sonnet' }] },
      { id: 'effort', name: 'Effort', type: 'select', currentValue: 'medium', options: [{ value: 'low', name: 'Low' }, { value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }] },
      { id: 'fast', name: 'Fast mode', type: 'select', currentValue: 'off', options: [{ value: 'off', name: 'Off' }, { value: 'on', name: 'On' }] },
      { id: 'persona', name: 'Agent persona', type: 'select', currentValue: 'default', options: [{ value: 'default', name: 'Default' }, { value: 'terse', name: 'Terse' }] },
    ],
  }))
  .onRequest('session/load', () => ({}))
  .onNotification('session/cancel', (ctx) => cancels.get(ctx.params.sessionId)?.())
  .onRequest('session/prompt', async (ctx) => {
    let t = promptText(ctx).toLowerCase();
    const nm = nextMode();
    if (nm) t = nm.mode;
    const poster = nm ? !!nm.poster : /translate|poster/.test(t);
    const path = CANVAS();
    await begin(ctx);
    if (t.includes('hang')) {
      await say(ctx, nm?.text ?? 'Making it greener — ');
      await toolStart(ctx, 'h1', path, nm?.title);
      await edit(ctx, false, poster);
      await new Promise((res) => cancels.set(ctx.params.sessionId, res));
      return { stopReason: 'cancelled' };
    }
    if (t.includes('permission')) {
      const out = await ctx.client.request(acp.methods.client.session.requestPermission, {
        sessionId: ctx.params.sessionId,
        toolCall: { toolCallId: 'p1', title: 'Replace 4 team photos in Uniformy-2027', kind: 'other', rawInput: { assets: 4 } },
        options: [
          { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
          { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
          { optionId: 'reject-once', name: 'Not now', kind: 'reject_once' },
        ],
      });
      await say(ctx, `outcome ${out.outcome?.outcome ?? ''}`);
      return { stopReason: 'end_turn' };
    }
    if (t.includes('question')) {
      const r = await ctx.client.request(acp.methods.client.elicitation.create, {
        mode: 'form', sessionId: ctx.params.sessionId, toolCallId: 'q1', message: 'Which green?',
        requestedSchema: { type: 'object', properties: {
          question_0: { type: 'string', oneOf: [
            { const: 'Club green', title: 'Club green' }, { const: 'Lighter green', title: 'Lighter green' }, { const: 'Darker green', title: 'Darker green' } ] },
          question_0_custom: { type: 'string', title: 'Other', description: 'Type your own answer instead (optional).' } } },
      });
      await say(ctx, `Got it — ${JSON.stringify(r.content ?? r)}`);
      return { stopReason: 'end_turn' };
    }
    if (t.includes('tell')) {
      await say(ctx, nm?.text ?? 'Mostly the greens: the Post and the Story share one background, the poster has its own. The date line is 9 pt and fades past two metres. The canvas did not change.');
      return { stopReason: 'end_turn' };
    }
    if (t.includes('fail')) {
      throw new acp.RequestError(-32603, "ENOENT: no such file or directory, open '/Assets/Footage/trenink-0412.mov'");
    }
    await toolStart(ctx, 'e1', path, nm?.title);
    await sleep(nm?.ms ?? 1200);
    await edit(ctx, true, poster, nm?.target);
    await toolEnd(ctx, 'e1', path);
    await say(ctx, nm?.text ?? 'Done — Post 1:1 is greener: background, badge and button. The logo stays white.');
    return { stopReason: 'end_turn' };
  });
agent.connect(stream);
