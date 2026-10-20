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
// Nobody answers a permission card: every request is refused (the chat's own timeout default),
// exactly as the terminal lane's "nobody answers" rule.

import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildStudioBrief } from '../../../acp/bootstrap-brief.ts';
import { AcpBridge, MAUDE_DEFAULT_ALLOWED_TOOLS, newSessionParams } from '../../../acp/bridge.ts';
import { computeSessionPlugins } from '../../../acp/plugin-bootstrap.ts';
import { logDenyIfAny, logTool, REPO } from './common.mjs';

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
    session: newSessionParams(project, brief, plugins),
    turns: journey.turns.map((t) => ({ say: t.say })),
  };
}

const textOf = (content) =>
  (Array.isArray(content) ? content : [])
    .map((c) => c?.content?.text ?? c?.text ?? '')
    .filter(Boolean)
    .join('\n');

/** Run the plan. `process.env` must already carry the harness env (PATH shim, NO_OPEN, …). */
export async function runAcp(plan, project, trialDir, { timeoutMin = 20 } = {}) {
  const names = new Map();
  const log = (v) => appendFileSync(join(trialDir, 'transcript.jsonl'), `${JSON.stringify(v)}\n`);
  let bridge = null;
  bridge = new AcpBridge({
    repoRoot: project,
    chatId: plan.chatId,
    studioBrief: plan.brief,
    plugins: plan.plugins,
    onUpdate: (u) => {
      log({ t: 'update', u });
      if (u?.sessionUpdate === 'tool_call') {
        const name = u._meta?.claudeCode?.toolName ?? u.kind ?? u.title ?? '?';
        names.set(u.toolCallId, name);
        logTool(trialDir, 'acp', name, u.rawInput ?? {});
      }
      if (u?.sessionUpdate === 'tool_call_update' && u.status === 'failed')
        logDenyIfAny(
          trialDir,
          'acp',
          names.get(u.toolCallId) ?? '?',
          `${textOf(u.content)}\n${JSON.stringify(u.rawOutput ?? '')}`
        );
    },
    onPermissionRequest: (id, req) => {
      log({ t: 'permission', id, title: req.toolCall?.title ?? null });
      const reject = (req.options ?? []).find((o) => String(o.kind).startsWith('reject'));
      bridge.resolvePermission(id, reject?.optionId ?? 'cancelled');
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
    await bridge.stop();
  }
  return turns;
}
