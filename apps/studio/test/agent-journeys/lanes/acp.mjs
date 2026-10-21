// agent-journeys/lanes/acp.mjs — the AI chat lane: the trial's studio hosts the chat exactly as for
// the AI chat panel. The lane is the panel's client: it opens the studio's `/_ws/acp` socket and
// sends the panel's frames (`attach`, `prompt`, `permission-response`, `elicitation-response`,
// `cancel`) for one chat, every turn of the journey. So each prompt goes through acp/index.ts —
// the run registry's ask (V2-1.15), its stage and the chat's activity tracker — and an AI chat
// edit lands in Version history the way the panel's does (S12.16 fix: the lane used to host its own
// `AcpBridge`, which opens no studio run, so every chat edit read as `outside`).
//
// The studio's bridge builds the session ONLY through the public functions S12.3 owns; `planAcp`
// records the same inputs for `--dry` (the studio's own differ only in the project label):
//   - `buildStudioBrief({ designRel, projectLabel, commandsAvailable: true })` (acp/bootstrap-brief.ts)
//   - `computeSessionPlugins({ native: true, designDir: <this worktree's plugins/design>, flowDir: null,
//     kgaiDir: null })` (acp/plugin-bootstrap.ts) — a studio booted from this tree injects its own
//     plugins/design; flow is off in the chat (D10); kgai is staged only in the .app
//   - `newSessionParams(project, brief, plugins)` (acp/bridge.ts)
// The studio's PATH carries the trial's `maude` shim (run.mjs), so the agent's verbs run this tree.
// Nobody answers a permission card, except for a prompt-tier verb the journey JSON names in `allow`
// (decision v2-S12.16-lanes-allow-named-prompt-verbs): that one card gets the one-time allow option.
// Every other card is refused and every question declined at once — with a socket attached the
// studio would otherwise wait for the person (S5.6 D7).

import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildStudioBrief } from '../../../acp/bootstrap-brief.ts';
import { MAUDE_DEFAULT_ALLOWED_TOOLS, newSessionParams } from '../../../acp/bridge.ts';
import { computeSessionPlugins } from '../../../acp/plugin-bootstrap.ts';
import { logDenyIfAny, logTool, REPO } from './common.mjs';
import { allowOf, answerCard } from './consent.mjs';

export const CHAT_ID = 'journey';

/** The session inputs this lane would use — pure; `--dry` checks it. */
export function planAcp(journey, { project, projectLabel = `journey ${journey.id}` }) {
  const brief = buildStudioBrief({ designRel: '.design', projectLabel, commandsAvailable: true });
  const plugins = computeSessionPlugins({
    native: true,
    designDir: join(REPO, 'plugins', 'design'),
    flowDir: null,
    kgaiDir: null,
  });
  return {
    lane: 'acp',
    chatId: CHAT_ID,
    brief,
    plugins,
    allowedTools: [...MAUDE_DEFAULT_ALLOWED_TOOLS],
    allow: allowOf(journey),
    session: newSessionParams(project, brief, plugins),
    turns: journey.turns.map((t) => ({ say: t.say })),
  };
}

const textOf = (content) =>
  (Array.isArray(content) ? content : [])
    .map((c) => c?.content?.text ?? c?.text ?? '')
    .filter(Boolean)
    .join('\n');

/**
 * Log each tool call once, with its input. The adapter announces a call (`tool_call`) with an EMPTY
 * rawInput and sends the real input (the command, the path) in the first `tool_call_update` after
 * it: logging at the announcement writes `{}` and hides every command from the tool-used / no-tool
 * graders. `see(update)` per ACP update; `flush()` at the end logs the calls that never showed an input.
 */
export function toolLog(trialDir) {
  const names = new Map();
  const pending = new Set();
  return {
    names,
    see(u) {
      if (u?.sessionUpdate === 'tool_call') {
        names.set(u.toolCallId, u._meta?.claudeCode?.toolName ?? u.kind ?? u.title ?? '?');
        pending.add(u.toolCallId);
      }
      if (
        (u?.sessionUpdate === 'tool_call' || u?.sessionUpdate === 'tool_call_update') &&
        pending.has(u.toolCallId) &&
        u.rawInput &&
        Object.keys(u.rawInput).length
      ) {
        pending.delete(u.toolCallId);
        logTool(trialDir, 'acp', names.get(u.toolCallId) ?? '?', u.rawInput);
      }
    },
    flush() {
      for (const id of pending) logTool(trialDir, 'acp', names.get(id) ?? '?', {});
      pending.clear();
    },
  };
}

/**
 * Run the plan against the trial's studio on `port`: one `/_ws/acp` socket, one chat. Resolves to
 * one `{ turn, ok, stopReason | error }` per turn; after the last turn it waits (≤ `settleMs`) for the
 * chat's runs to end, so their one action is in Version history before the studio stops.
 */
export async function runAcp(
  plan,
  project,
  trialDir,
  { port, timeoutMin = 20, settleMs = 30_000, WebSocketImpl = globalThis.WebSocket } = {}
) {
  void project;
  if (!port) throw new Error('acp lane: no studio port');
  const tools = toolLog(trialDir);
  const names = tools.names;
  const log = (v) => appendFileSync(join(trialDir, 'transcript.jsonl'), `${JSON.stringify(v)}\n`);
  const chat = plan.chatId;
  const ws = new WebSocketImpl(`ws://127.0.0.1:${port}/_ws/acp`);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('acp lane: the studio refused /_ws/acp'));
  });
  const send = (frame) => ws.send(JSON.stringify({ chat, ...frame }));
  const runs = new Map(); // runId → state
  let turn = null; // { resolve } while a prompt is out
  let closed = false;
  const settle = (r) => {
    const t = turn;
    turn = null;
    t?.resolve(r);
  };
  ws.onclose = () => {
    closed = true;
    settle({ error: 'the studio closed the chat socket' });
  };
  ws.onmessage = (ev) => {
    let m;
    try {
      m = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'update') {
      const u = m.update;
      log({ t: 'update', u });
      tools.see(u);
      if (u?.sessionUpdate === 'tool_call_update' && u.status === 'failed')
        logDenyIfAny(
          trialDir,
          'acp',
          names.get(u.toolCallId) ?? '?',
          `${textOf(u.content)}\n${JSON.stringify(u.rawOutput ?? '')}`
        );
    } else if (m.t === 'permission-request') {
      const a = answerCard(plan.allow ?? [], { toolCall: m.toolCall, options: m.options });
      log({
        t: 'permission',
        id: m.id,
        title: m.toolCall?.title ?? null,
        allowed: a.allow,
        why: a.why,
      });
      send({ t: 'permission-response', id: m.id, decision: a.optionId ?? 'cancelled' });
    } else if (m.t === 'elicitation-request') {
      log({ t: 'elicitation', id: m.id, declined: true });
      send({ t: 'elicitation-response', id: m.id, action: 'decline' });
    } else if (m.t === 'run' && m.run?.runId) {
      runs.set(m.run.runId, m.run.state);
      log({ t: 'run', runId: m.run.runId, state: m.run.state });
    } else if (m.t === 'turn-end') {
      log({ t: 'turn-end', stopReason: m.stopReason ?? null });
      settle({ stopReason: m.stopReason ?? null });
    } else if (m.t === 'error') {
      log({ t: 'error', code: m.code ?? null, message: m.message ?? null });
      settle({ error: `${m.code ? `${m.code}: ` : ''}${m.message ?? 'error'}` });
    } else if (m.t === 'queued') {
      log({ t: 'queued', words: m.words ?? null, gates: m.gates ?? null });
    }
  };
  send({ t: 'attach', seq: 0 });
  const turns = [];
  try {
    for (const [i, t] of plan.turns.entries()) {
      if (closed) {
        turns.push({ turn: i + 1, ok: false, error: 'the studio closed the chat socket' });
        break;
      }
      const own = {};
      const done = new Promise((resolve) => {
        own.resolve = resolve;
        turn = own;
      });
      let cancelled = false;
      let hard = null;
      const timer = setTimeout(() => {
        cancelled = true;
        send({ t: 'cancel' });
        // a cancel that never answers still ends THIS turn
        hard = setTimeout(() => {
          if (turn === own) settle({ error: `no turn end ${timeoutMin} min after the prompt` });
        }, 60_000);
      }, timeoutMin * 60_000);
      send({ t: 'prompt', text: t.say });
      const r = await done;
      clearTimeout(timer);
      if (hard) clearTimeout(hard);
      if (r.error) {
        turns.push({ turn: i + 1, ok: false, error: r.error });
        break;
      }
      turns.push({
        turn: i + 1,
        ok: !cancelled && r.stopReason === 'end_turn',
        stopReason: r.stopReason,
      });
    }
    // the registry publishes a turn's stage after turn-end: wait for the chat's runs to end
    const until = Date.now() + settleMs;
    while (!closed && Date.now() < until && [...runs.values()].some((s) => s !== 'ended'))
      await new Promise((r) => setTimeout(r, 250));
  } finally {
    tools.flush();
    if (!closed) ws.close();
  }
  return turns;
}
