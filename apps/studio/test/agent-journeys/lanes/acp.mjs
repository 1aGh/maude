// agent-journeys/lanes/acp.mjs — the AI chat lane: the same adapter the AI chat panel runs, driven
// through acp/bridge.ts's `AcpBridge`, with the panel's session shape — `newSessionParams` (allow
// list `MAUDE_DEFAULT_ALLOWED_TOOLS`, settingSources user, the studio brief appended, the injected
// plugins + their native-copy suppression) — and one chat for every turn of the journey.
//
// It builds the session inputs ONLY through the public functions S12.3 owns, so S12.3's v2 brief and
// `suppressionFor(plugins)` drop in with no edit here:
//   - `buildStudioBrief({ designRel, projectLabel, commandsAvailable: true })` (acp/bootstrap-brief.ts)
//   - `computeSessionPlugins({ native: true, designDir: <this worktree's plugins/design>, flowDir: null,
//     kgaiDir: null })` (acp/plugin-bootstrap.ts) — flow is off in the chat (D10); kgai is not staged
//     outside the .app and its SessionStart would install over the network
//   - `newSessionParams(project, brief, plugins)` (acp/bridge.ts) — recorded in plan.json, and the
//     bridge builds the same object itself on `session/new`.
// Nobody answers a permission card, except for a prompt-tier verb the journey JSON names in `allow`
// (decision v2-S12.16-lanes-allow-named-prompt-verbs): that one card gets the one-time allow option.
// Every other request is refused (the chat's own timeout default), as in the terminal lane.

import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildStudioBrief } from '../../../acp/bootstrap-brief.ts';
import { AcpBridge, MAUDE_DEFAULT_ALLOWED_TOOLS, newSessionParams } from '../../../acp/bridge.ts';
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

/** Run the plan. `process.env` must already carry the harness env (PATH shim, NO_OPEN, …). */
export async function runAcp(plan, project, trialDir, { timeoutMin = 20 } = {}) {
  const tools = toolLog(trialDir);
  const names = tools.names;
  const log = (v) => appendFileSync(join(trialDir, 'transcript.jsonl'), `${JSON.stringify(v)}\n`);
  let bridge = null;
  bridge = new AcpBridge({
    repoRoot: project,
    chatId: plan.chatId,
    studioBrief: plan.brief,
    plugins: plan.plugins,
    onUpdate: (u) => {
      log({ t: 'update', u });
      tools.see(u);
      if (u?.sessionUpdate === 'tool_call_update' && u.status === 'failed')
        logDenyIfAny(
          trialDir,
          'acp',
          names.get(u.toolCallId) ?? '?',
          `${textOf(u.content)}\n${JSON.stringify(u.rawOutput ?? '')}`
        );
    },
    onPermissionRequest: (id, req) => {
      const a = answerCard(plan.allow ?? [], req);
      log({
        t: 'permission',
        id,
        title: req.toolCall?.title ?? null,
        allowed: a.allow,
        why: a.why,
      });
      bridge.resolvePermission(id, a.optionId);
    },
  });
  const turns = [];
  try {
    for (const [i, t] of plan.turns.entries()) {
      const timer = setTimeout(() => void bridge.cancel(), timeoutMin * 60_000);
      try {
        const r = await bridge.prompt(t.say, plan.chatId);
        turns.push({ turn: i + 1, ok: r.stopReason === 'end_turn', stopReason: r.stopReason });
      } catch (e) {
        turns.push({ turn: i + 1, ok: false, error: String(e?.message ?? e) });
        break;
      } finally {
        clearTimeout(timer);
      }
    }
  } finally {
    tools.flush();
    await bridge.stop();
  }
  return turns;
}
