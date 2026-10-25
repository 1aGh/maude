// agent-evals/lib/fake-agent.mjs — a SCRIPTED stand-in for `claude -p`, for the dry run (no model, no
// network, no spend). It does what Claude Code does around a tool call and nothing else:
//
//   SessionStart → UserPromptSubmit → [PreToolUse hook → the tool → PostToolUse hook]* → Stop (re-run
//   while it blocks)
//
// with the RELEASED design plugin's own hooks (`plugins/design/hooks/hooks.json`, each command run
// through `sh -c` exactly as Claude Code runs it), against the trial's real studio. It writes the same
// stream-json transcript a live trial leaves (`transcript.jsonl`), so the graders read the real run
// folder, the real registry and a real transcript — only the choices of the "model" are scripted.
//
// A step is one of:
//   { tool: 'Edit',  file, old, new, all? }       file: project-relative (`.design/ui/X.tsx`)
//   { tool: 'Write', file, content }
//   { tool: 'Bash',  command }
//   { tool: 'Read',  file }                       no hook matches Read; here for readable scripts
//   { raw: 'edit',   file, old, new }             a write that BYPASSES the hooks (a planted fault)
//   { raw: 'rm',     file }                       same, a delete
// A script is { steps, final, afterBlock? } — `afterBlock` runs when the Stop hook blocks.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

import { DESIGN_PLUGIN } from './paths.mjs';

const HOOKS = JSON.parse(readFileSync(join(DESIGN_PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks;

const parse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** Run every command the plugin registers for `event` whose matcher fits `tool`. → [{ status, json, text }] */
export function runHooks(event, tool, input, { env, cwd }) {
  const out = [];
  for (const entry of HOOKS[event] ?? []) {
    if (entry.matcher && !new RegExp(`^(?:${entry.matcher})$`).test(tool ?? '')) continue;
    for (const h of entry.hooks) {
      const r = spawnSync('sh', ['-c', h.command], {
        input: JSON.stringify(input),
        cwd,
        env: { ...env, CLAUDE_PLUGIN_ROOT: DESIGN_PLUGIN, CLAUDE_PROJECT_DIR: cwd },
        encoding: 'utf8',
        timeout: (h.timeout ?? 60) * 1000,
      });
      out.push({ status: r.status, json: parse(r.stdout), text: String(r.stdout ?? '') });
    }
  }
  return out;
}

const denyOf = (outs) =>
  outs.map((o) => o.json?.hookSpecificOutput).find((h) => h?.permissionDecision === 'deny')
    ?.permissionDecisionReason ?? null;
const blockOf = (outs) =>
  outs.map((o) => o.json).find((j) => j?.decision === 'block')?.reason ?? null;
const contextOf = (outs) =>
  outs
    .map((o) => o.json?.hookSpecificOutput?.additionalContext)
    .filter(Boolean)
    .join('\n');

export async function runFakeAgent({ script, prompt, project, trialDir, env }) {
  const t0 = Date.now();
  const session = randomUUID();
  const tx = join(trialDir, 'transcript.jsonl');
  writeFileSync(tx, '');
  const emit = (o) => appendFileSync(tx, `${JSON.stringify(o)}\n`);
  const hookBase = { session_id: session, cwd: project, transcript_path: tx };
  const bashEnv = { ...env };
  const envFile = join(mkdtempSync(join(tmpdir(), 'agent-eval-envfile-')), 'env.sh');
  writeFileSync(envFile, '');
  let toolN = 0;
  let turns = 0;

  emit({ type: 'system', subtype: 'init', session_id: session, model: 'dry-run', cwd: project });
  // SessionStart exports MAUDE_HOOK_SESSION to Bash through CLAUDE_ENV_FILE (the Stop screenshot gate's key)
  runHooks(
    'SessionStart',
    null,
    { ...hookBase, hook_event_name: 'SessionStart', source: 'startup' },
    { env: { ...env, CLAUDE_ENV_FILE: envFile }, cwd: project }
  );
  for (const m of readFileSync(envFile, 'utf8').matchAll(/^export (\w+)=(.*)$/gm))
    bashEnv[m[1]] = m[2].replace(/^'|'$/g, '');
  runHooks(
    'UserPromptSubmit',
    null,
    { ...hookBase, hook_event_name: 'UserPromptSubmit', prompt },
    { env, cwd: project }
  );

  const abs = (f) => (isAbsolute(f) ? f : join(project, f));
  const call = (name, input) => {
    const id = `toolu_dry${++toolN}`;
    emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
    return id;
  };
  const result = (id, text, isError = false) =>
    emit({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: id,
            is_error: isError,
            content: [{ type: 'text', text }],
          },
        ],
      },
    });

  async function step(s) {
    turns++;
    if (s.raw) {
      const p = abs(s.file);
      if (s.raw === 'rm') rmSync(p, { force: true });
      else
        writeFileSync(
          p,
          readFileSync(p, 'utf8').replace(s.old, () => s.new)
        );
      return;
    }
    if (s.tool === 'Read') {
      const id = call('Read', { file_path: abs(s.file) });
      result(
        id,
        existsSync(abs(s.file)) ? readFileSync(abs(s.file), 'utf8').slice(0, 2000) : 'not found'
      );
      return;
    }
    const input =
      s.tool === 'Bash'
        ? { command: s.command }
        : s.tool === 'Write'
          ? { file_path: abs(s.file), content: s.content }
          : { file_path: abs(s.file), old_string: s.old, new_string: s.new, replace_all: !!s.all };
    const id = call(s.tool, input);
    const base = { ...hookBase, tool_name: s.tool, tool_input: input, tool_use_id: id };
    const pre = runHooks(
      'PreToolUse',
      s.tool,
      { ...base, hook_event_name: 'PreToolUse' },
      { env, cwd: project }
    );
    const denied = denyOf(pre);
    if (denied) return result(id, denied, true);
    let text = '';
    let failed = false;
    if (s.tool === 'Bash') {
      const r = spawnSync('bash', ['-c', s.command], {
        cwd: project,
        env: bashEnv,
        encoding: 'utf8',
        timeout: 120_000,
      });
      text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      if (r.status !== 0) text += `\n(exit ${r.status})`;
      failed = r.status !== 0;
    } else if (s.tool === 'Write') {
      mkdirSync(dirname(input.file_path), { recursive: true });
      writeFileSync(input.file_path, s.content);
      text = `wrote ${s.file}`;
    } else {
      const cur = existsSync(input.file_path) ? readFileSync(input.file_path, 'utf8') : null;
      const n = cur === null ? 0 : cur.split(s.old).length - 1;
      if (cur === null || n === 0 || (n > 1 && !s.all)) {
        return result(id, n > 1 ? 'old_string is not unique' : 'old_string not found', true);
      }
      writeFileSync(
        input.file_path,
        s.all ? cur.split(s.old).join(s.new) : cur.replace(s.old, () => s.new)
      );
      text = `edited ${s.file}`;
    }
    const post = runHooks(
      'PostToolUse',
      s.tool,
      { ...base, hook_event_name: 'PostToolUse', tool_response: { output: text } },
      { env, cwd: project }
    );
    const blocked = blockOf(post);
    const note = [blocked && `PostToolUse hook: ${blocked}`, contextOf(post)]
      .filter(Boolean)
      .join('\n');
    result(id, note ? `${text}\n${note}` : text, !!failed);
  }

  for (const s of script.steps) await step(s);
  let stopped = null;
  for (let n = 0; n < 3; n++) {
    const outs = runHooks(
      'Stop',
      null,
      { ...hookBase, hook_event_name: 'Stop', stop_hook_active: n > 0 },
      { env, cwd: project }
    );
    stopped = blockOf(outs);
    if (!stopped) break;
    emit({
      type: 'system',
      subtype: 'hook_response',
      hook_event: 'Stop',
      stdout: JSON.stringify({ decision: 'block', reason: stopped }),
    });
    if (n === 0) for (const s of script.afterBlock ?? []) await step(s);
  }
  emit({
    type: 'assistant',
    message: { content: [{ type: 'text', text: script.final ?? 'Done.' }] },
  });
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: script.final ?? 'Done.',
    num_turns: turns,
    duration_ms: Date.now() - t0,
    total_cost_usd: 0,
    modelUsage: {},
    permission_denials: [],
  });
  rmSync(dirname(envFile), { recursive: true, force: true });
  return { code: 0, killed: false, wallMs: Date.now() - t0, session };
}
