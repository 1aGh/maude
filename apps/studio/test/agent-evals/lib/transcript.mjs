// agent-evals/lib/transcript.mjs — read a `claude -p --output-format stream-json --verbose` transcript.

import { readFileSync } from 'node:fs';

const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);

/** → { init, result, toolUses: [{name, input, id, parent}], agents: [{type, id, background}], finalText, metrics } */
export function readTranscript(path) {
  let lines = [];
  try {
    lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  } catch {
    return {
      ok: false,
      init: null,
      result: null,
      toolUses: [],
      agents: [],
      finalText: '',
      metrics: null,
      events: 0,
    };
  }
  let init = null;
  let result = null;
  const toolUses = [];
  const hookEvents = [];
  let lastAssistantText = '';
  for (const l of lines) {
    let ev;
    try {
      ev = JSON.parse(l);
    } catch {
      continue;
    }
    if (ev.type === 'system' && ev.subtype === 'init') init = ev;
    else if (ev.type === 'result') result = ev;
    else if (ev.type === 'system' && /^hook_/.test(ev.subtype ?? '')) hookEvents.push(ev);
    else if (ev.type === 'assistant') {
      const parent = ev.parent_tool_use_id ?? null;
      for (const c of ev.message?.content ?? []) {
        if (c.type === 'tool_use')
          toolUses.push({ name: c.name, input: c.input ?? {}, id: c.id, parent });
        if (c.type === 'text' && !parent) lastAssistantText = c.text;
      }
    }
  }
  const agents = toolUses
    .filter((t) => SUBAGENT_TOOLS.has(t.name) && !t.parent)
    .map((t) => ({
      type: t.input.subagent_type ?? 'general-purpose',
      id: t.id,
      background: !!t.input.run_in_background,
      promptChars: String(t.input.prompt ?? '').length,
    }));
  const mu = result?.modelUsage ?? {};
  let tokens = 0;
  let inTok = 0;
  let outTok = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  for (const m of Object.values(mu)) {
    inTok += m.inputTokens ?? 0;
    outTok += m.outputTokens ?? 0;
    cacheRead += m.cacheReadInputTokens ?? 0;
    cacheWrite += m.cacheCreationInputTokens ?? 0;
  }
  tokens = inTok + outTok + cacheRead + cacheWrite;
  const metrics = result
    ? {
        subtype: result.subtype,
        isError: !!result.is_error,
        costUsd: result.total_cost_usd ?? null,
        durationMs: result.duration_ms ?? null,
        apiMs: result.duration_api_ms ?? null,
        turns: result.num_turns ?? null,
        tokens,
        inTok,
        outTok,
        cacheRead,
        cacheWrite,
        // "fresh" tokens = everything except cache reads — a view less dominated by context re-reads
        freshTokens: inTok + outTok + cacheWrite,
        models: Object.keys(mu),
        permissionDenials: (result.permission_denials ?? []).map((d) => ({
          tool: d.tool_name,
          input: JSON.stringify(d.tool_input ?? {}).slice(0, 200),
        })),
        subagents: agents.length,
        subagentTypes: agents.map((a) => a.type),
        mainToolUses: toolUses.filter((t) => !t.parent).length,
        subToolUses: toolUses.filter((t) => t.parent).length,
      }
    : null;
  return {
    ok: !!result,
    init,
    result,
    toolUses,
    agents,
    hookEvents,
    finalText: String(result?.result ?? lastAssistantText ?? ''),
    metrics,
    events: lines.length,
  };
}

/** Every Bash command the session (main + sub-agents) ran or tried. */
export function bashCommands(tr) {
  return tr.toolUses
    .filter((t) => t.name === 'Bash')
    .map((t) => ({ cmd: String(t.input.command ?? ''), parent: t.parent }));
}
