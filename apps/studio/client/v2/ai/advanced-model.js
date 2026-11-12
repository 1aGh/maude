// client/v2/ai/advanced-model.js — S5.12 (03 `ai-advanced`, `ai-adv-edges`): the AI chat panel's Advanced fold
// as data. "Nothing removed, only hidden": the model, effort, mode, transcript view, context meter, raw tool
// log, session and Open in terminal that used to sit on screen live here, one row each, findable in ⌘K as
// "AI chat panel › Advanced …".
//
// PURE (no DOM, no React, no fetch). Words are CONTRACT §3–§4: modes read as what AI may do, the agent's own
// names stay in grey for people who know them.

import { NO_EDIT_MODE_IDS } from '../../panels/acp-capabilities.js';

/** This panel's fold key in prefs.json `fold` (per Mac, the same in every project — V2-4.10). */
export const AI_FOLD_PANEL = 'ai.chat';

/** The path ⌘K shows beside an Advanced row. */
export const ADVANCED_WHERE = 'AI chat panel › Advanced';

/**
 * The rows ⌘K finds. `action` is the registry id (actions/defs/chat.ts); `row` is the DOM id the fold scrolls
 * to and focuses. Open in terminal and Copy transcript are registry actions that already existed (S5.7).
 */
export const ADVANCED_ROWS = Object.freeze([
  { row: 'ask-before', action: 'chat.advanced.ask-before', label: 'Permissions' },
  { row: 'model', action: 'chat.advanced.model', label: 'Model' },
  { row: 'effort', action: 'chat.advanced.effort', label: 'Effort' },
  { row: 'fast', action: 'chat.advanced.fast-mode', label: 'Fast mode' },
  { row: 'show-in-chat', action: 'chat.advanced.show-in-chat', label: 'Show in chat' },
  { row: 'suggestions', action: 'chat.advanced.suggestions', label: 'Suggestions' },
  { row: 'raw-log', action: 'chat.advanced.raw-log', label: 'Raw log' },
  { row: 'terminal', action: 'chat.open-in-terminal', label: 'Open in terminal' },
]);

export const rowForAction = (actionId) => ADVANCED_ROWS.find((r) => r.action === actionId) ?? null;

/** The id the DOM carries for a row (`data-adv-row`, and the control's `id`). */
export const rowDomId = (row) => `ai-adv-${row}`;

// ── modes in plain words ─────────────────────────────────────────────────────────────────────────

/**
 * Claude Code's mode ids → what AI may do (03 `ai-adv-edges`; rc3-g, issue #181 C). Order = the order the menu
 * lists them. Each entry: id · label · group · hint · risky.
 *  - The LABEL reads alone — it is all the closed row shows ("Permissions: Edit freely, ask before commands"),
 *    so it never leans on a heading or on the row's name.
 *  - The HINT is one line under the closed row: what AI may do WITHOUT asking, and what it still asks.
 *  - RISKY marks the one mode with no checks at all; it says so in its label, its group and its hint.
 */
const MODE_WORDS = [
  [
    'default',
    'Ask before every change',
    'asks',
    'AI asks before it changes a canvas, replaces or deletes a file, or runs a command.',
    false,
  ],
  [
    'auto',
    'Ask only when unsure',
    'asks',
    'AI decides what is safe to do and asks when it is unsure.',
    false,
  ],
  [
    'acceptEdits',
    'Edit freely, ask before commands',
    'asks',
    'AI changes canvases and files in this project without asking. It still asks before running a command.',
    false,
  ],
  [
    'plan',
    'Suggest only',
    'nochange',
    'AI changes nothing. It only suggests what it would do.',
    false,
  ],
  [
    'dontAsk',
    'Skip what needs asking',
    'nochange',
    'AI never asks. Anything that would need a yes is skipped.',
    false,
  ],
  [
    'bypassPermissions',
    'Skip every check — risky',
    'free',
    'No checks at all. AI runs commands and changes files, also outside this project, without asking.',
    true,
  ],
];
const WORDS = new Map(
  MODE_WORDS.map(([id, label, group, hint, risky], i) => [
    id,
    { label, group, hint, risky, order: i },
  ])
);

export const MODE_GROUP_LABEL = Object.freeze({
  asks: 'AI asks first',
  nochange: 'AI changes nothing',
  free: 'No safety net',
});

/** Universal ACP B6: the words above are Claude Code's mode ids, so they are Claude's labels only. */
const isClaude = (agent) => !agent || agent === 'claude' || agent?.id === 'claude';

/**
 * The modes the SESSION offers, in plain words. The agent decides which it offers; the rest stay hidden
 * ("Skip every check" shows only where the agent allows it). An id Maude has no words for keeps the agent's
 * own name (and its own description as the hint) rather than vanishing.
 *
 * B6 — `agent` is the chat's agent (`{ id }`, an id, or none for Claude). The plain words above are Claude's;
 * any other agent's modes keep their own names and descriptions, in the agent's own order. `allowed` is the
 * list the server sends in `caps` (`allowedModes`): a mode the bridge refuses is never listed.
 */
export function modeOptions(modes, { agent = null, allowed = null } = {}) {
  const claude = isClaude(agent);
  const ok = Array.isArray(allowed) ? new Set(allowed) : null;
  const list = (modes?.availableModes ?? []).filter((m) => !ok || ok.has(m.id));
  return list
    .map((m, i) => {
      const w = claude ? WORDS.get(m.id) : undefined;
      return {
        id: m.id,
        label: w?.label ?? m.name ?? m.id,
        note: m.id,
        group: w?.group ?? 'asks',
        order: w?.order ?? (claude ? 100 : i),
        description: m.description ?? '',
        hint: w?.hint ?? m.description ?? '',
        risky: w?.risky ?? false,
      };
    })
    .sort((a, b) => a.order - b.order);
}

/** The agent's own name for the current mode, shown in grey beside the plain words. */
export function currentModeNote(modes) {
  return modes?.currentModeId ?? '';
}

/**
 * The suggest-only banner (03 `ai-adv-edges` ②): said up front when the mode lets AI change nothing, with
 * ONE verb to undo it — "Allow changes". The target is the least-privilege mode that can edit (v1 DDR-184
 * #3: Accept edits if offered, else the asking default). `null` when the mode can edit.
 */
export function modeBanner(modes, agent = null) {
  const id = modes?.currentModeId;
  // B6: `plan` / `dontAsk` are Claude Code's ids; another agent's mode of the same name means something else
  if (!isClaude(agent)) return null;
  if (!id || !NO_EDIT_MODE_IDS.has(id)) return null;
  const ids = new Set((modes.availableModes ?? []).map((m) => m.id));
  const target = ids.has('acceptEdits') ? 'acceptEdits' : ids.has('default') ? 'default' : null;
  const plan = id === 'plan';
  return {
    mode: id,
    title: plan ? 'AI is set to suggest only.' : 'AI is set to skip what needs asking.',
    body: plan
      ? "The canvas won't change."
      : 'Anything that needs a yes is skipped — nothing will change.',
    action: target ? 'Allow changes' : null,
    target,
  };
}

// ── meters ───────────────────────────────────────────────────────────────────────────────────────

/** "Context used": a percent that is exactly used / size (clamped 0–100), plus the tokens for the ⓘ. */
export function contextMeter(usage) {
  const c = usage?.context;
  if (!c || !(c.size > 0) || typeof c.used !== 'number') return null;
  const pct = Math.max(0, Math.min(100, Math.round((c.used / c.size) * 100)));
  return { pct, label: `${pct}%`, used: c.used, size: c.size };
}

/** The one rate-limit window the adapter reports ("5-hour limit 64% · resets 18:40"), or null. */
export function limitMeter(usage, formatReset) {
  const r = usage?.rateLimit;
  if (!r) return null;
  const resets = formatReset && r.resetsAt ? formatReset(r.resetsAt) : null;
  const pct = r.pct;
  return {
    name: r.label,
    pct,
    label: `${pct != null ? `${pct}%` : '—'}${resets ? ` · resets ${resets}` : ''}`,
  };
}

// ── transcript view ("Show in chat") ─────────────────────────────────────────────────────────────

const VIEW_LABEL = {
  normal: 'Normal',
  thinking: 'With thinking',
  verbose: 'Verbose',
  summary: 'Summary',
};
export const viewLabel = (v) => VIEW_LABEL[v] ?? (v ? v[0].toUpperCase() + v.slice(1) : '');

// ── the raw tool log ─────────────────────────────────────────────────────────────────────────────

const LOG_CAP = 200;
const PATH_KEYS = ['file_path', 'path', 'filePath', 'file', 'notebook_path'];
const TEXT_KEYS = ['command', 'pattern', 'url', 'query', 'description', 'prompt'];

/** `mcp__server__tool` → `tool`; a plain name stays. */
const shortTool = (name) => {
  const s = String(name ?? 'tool');
  return s.startsWith('mcp__') ? s.split('__').pop() || s : s;
};

function argLine(args) {
  if (!args || typeof args !== 'object') return '';
  for (const k of PATH_KEYS) if (typeof args[k] === 'string' && args[k]) return args[k];
  for (const k of TEXT_KEYS)
    if (typeof args[k] === 'string' && args[k]) return args[k].replace(/\s+/g, ' ').slice(0, 160);
  return '';
}

/**
 * assistant-ui thread messages → the raw log: one line per tool call, in order, with its state. A closing
 * line counts the calls. `lines` is capped (the newest are kept) so a runaway chat cannot grow the island.
 */
export function rawLogLines(messages) {
  const lines = [];
  for (const m of messages ?? []) {
    if (m?.role !== 'assistant') continue;
    for (const p of m.content ?? []) {
      if (p?.type !== 'tool-call') continue;
      const failed = p.isError === true;
      lines.push({
        verb: shortTool(p.toolName),
        text: argLine(p.args),
        state: p.result === undefined ? 'running' : failed ? 'failed' : 'done',
      });
    }
  }
  const total = lines.length;
  const kept = total > LOG_CAP ? lines.slice(total - LOG_CAP) : lines;
  const running = kept.some((l) => l.state === 'running');
  return {
    lines: kept,
    total,
    truncated: total > LOG_CAP,
    summary: running
      ? `${total} tool ${total === 1 ? 'call' : 'calls'} so far`
      : `${total} tool ${total === 1 ? 'call' : 'calls'}`,
  };
}

/** The log as plain text, for Copy. */
export function rawLogText(log) {
  return log.lines
    .map(
      (l) => `${l.verb}${l.text ? ` ${l.text}` : ''}${l.state === 'done' ? '' : ` [${l.state}]`}`
    )
    .join('\n');
}

/** S5.17b — "1 · Combine 2026 fotky": how many folders AI may read, and (for a few) which. */
export function foldersLine(folders) {
  const list = Array.isArray(folders) ? folders : [];
  if (!list.length) return 'None';
  const names = list
    .map(
      (f) =>
        f?.name ||
        String(f?.root ?? '')
          .split('/')
          .pop()
    )
    .filter(Boolean);
  const shown = names.slice(0, 2).join(', ');
  const more = names.length > 2 ? ` and ${names.length - 2} more` : '';
  return `${list.length} · ${shown}${more}`;
}
