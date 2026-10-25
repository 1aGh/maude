#!/usr/bin/env bun
// D4 evidence agent for 14 ed-edge-ai — a FAKE ACP agent (never a provider). It edits the Homepage footer through the design
// plugin's hook code (like Claude Code's own edit), so the studio's run registry holds the footer, then keeps the run open.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { runHook } from '../../../cli/lib/design-hook.mjs';

const acp = await import(process.env.FAKE_ACP_SDK);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
let n = 0;
const hookIn = (ctx, extra) => JSON.stringify({ session_id: ctx.params.sessionId, cwd: process.cwd(), ...extra });
const begin = (ctx) => runHook({ event: 'prompt', stdinText: hookIn(ctx, { hook_event_name: 'UserPromptSubmit', prompt: 'x' }) });
async function hooked(ctx, path, write, old, neu) {
  const s = readFileSync(path, 'utf8');
  const input = { hook_event_name: 'PreToolUse', tool_use_id: 'tu' + Math.random().toString(36).slice(2, 8), tool_name: 'Edit', tool_input: { file_path: path, old_string: old, new_string: neu } };
  await runHook({ event: 'pre-edit', stdinText: hookIn(ctx, input) });
  write(s);
  await runHook({ event: 'post-edit', stdinText: hookIn(ctx, { ...input, hook_event_name: 'PostToolUse', tool_response: {} }) });
}
const note = (ctx, u) => ctx.client.notify('session/update', { sessionId: ctx.params.sessionId, update: u });
const say = (ctx, text) => note(ctx, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });

function canvases(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('_') || name === 'system' || name === 'node_modules') continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.tsx$/.test(name)) out.push({ path: p, mtime: st.mtimeMs });
    }
  };
  walk(join(root, '.design'));
  return out.sort((a, b) => b.mtime - a.mtime);
}

acp
  .agent({ name: 'g14-fake' })
  .onRequest('initialize', () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: true } }))
  .onRequest('session/new', () => ({ sessionId: `g14-${++n}`, modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Manual' }] }, configOptions: [] }))
  .onRequest('session/load', () => ({}))
  .onRequest('session/prompt', async (ctx) => {
    const target = canvases(process.cwd()).find((c) => /data-cd-id="footer"/.test(readFileSync(c.path, 'utf8')));
    if (!target) { await say(ctx, 'There is no page with a footer.'); return { stopReason: 'end_turn' }; }
    await say(ctx, 'Adding the footer links now.');
    await begin(ctx);
    await note(ctx, { sessionUpdate: 'tool_call', toolCallId: 'e1', title: 'Edit the canvas', kind: 'edit', status: 'in_progress', locations: [{ path: target.path }], rawInput: { file_path: target.path } });
    await sleep(1500);
    await hooked(ctx, target.path, (s) => writeFileSync(target.path, s.replace('<span>Pricing</span>', '<span>Pricing</span><span>Contact</span>')), '<span>Pricing</span>', '<span>Pricing</span><span>Contact</span>');
    await sleep(Number(process.env.G14_HOLD_MS || 120000));
    await note(ctx, { sessionUpdate: 'tool_call_update', toolCallId: 'e1', status: 'completed', locations: [{ path: target.path }], rawInput: { file_path: target.path } });
    await say(ctx, 'Done.');
    return { stopReason: 'end_turn' };
  })
  .connect(stream);
