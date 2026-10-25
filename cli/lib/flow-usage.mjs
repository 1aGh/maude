// `maude flow usage` — token spend per agent of one Claude Code session (generalised from the Maude
// v2 run's scripts/v2-hooks/v2-usage.mjs). Reads the lead's transcript plus its subagents/ folder
// and reports, per agent: model, turns, peak context, cache read / write. Read-only; the numbers
// are the API usage blocks Claude Code already stores. Codex keeps no such transcript, so a missing
// transcript is reported as "unavailable" and never fails a gate.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const BUDGET_PRESETS = {
  small: { agentTurns: 80, agentContextK: 150, handbackLines: 40, leadCheckpointPct: 60 },
  default: { agentTurns: 150, agentContextK: 300, handbackLines: 60, leadCheckpointPct: 60 },
  monorepo: { agentTurns: 150, agentContextK: 300, handbackLines: 60, leadCheckpointPct: 50 },
};

/** run.budget from a workflows config object → resolved numbers (preset + overrides). */
export function resolveBudget(config) {
  const b = config?.run?.budget ?? {};
  const base = BUDGET_PRESETS[b.preset] ?? BUDGET_PRESETS.default;
  const out = { ...base };
  for (const k of Object.keys(base)) if (Number.isFinite(b[k])) out[k] = b[k];
  if (Number.isFinite(b.maxRunTokens)) out.maxRunTokens = b.maxRunTokens;
  return out;
}

/** The /flow:run record of a project — mirrors recordPath() in plugins/flow/hooks/run-hook.mjs. */
export function runRecordPath(root, env = process.env) {
  let real = root;
  try {
    real = realpathSync(root);
  } catch {}
  const dir = env.FLOW_RUN_HOME || join(homedir(), '.claude', 'flow-runs');
  return join(dir, `${createHash('sha256').update(real).digest('hex').slice(0, 24)}.json`);
}

export const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/;

/** Claude Code's project folder name for a cwd. */
export const projectSlug = (dir) => dir.replace(/[^A-Za-z0-9]/g, '-');

/** Per-transcript totals. Assistant messages repeat per content block — count each id once. */
export function scanTranscript(text) {
  const seen = new Set();
  const s = { model: '?', turns: 0, peak: 0, read: 0, write: 0, out: 0 };
  for (const line of text.split('\n')) {
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const m = d.message;
    if (d.type !== 'assistant' || !m?.usage || seen.has(m.id)) continue;
    seen.add(m.id);
    const u = m.usage;
    if (m.model && m.model !== '<synthetic>') s.model = m.model;
    s.turns++;
    s.read += u.cache_read_input_tokens ?? 0;
    s.write += u.cache_creation_input_tokens ?? 0;
    s.out += u.output_tokens ?? 0;
    s.peak = Math.max(
      s.peak,
      (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0) +
        (u.input_tokens ?? 0)
    );
  }
  return s;
}

/** The lead transcript for `sid`: the project folder of `root` first, then every project folder. */
export function findTranscript(
  sid,
  { root, home = homedir(), configDir = process.env.CLAUDE_CONFIG_DIR } = {}
) {
  if (!SESSION_ID.test(sid ?? '')) return null; // a session id is a path segment — no `../`
  const bases = [configDir, join(home, '.claude')].filter(Boolean).map((b) => join(b, 'projects'));
  for (const base of bases) {
    if (!existsSync(base)) continue;
    if (root) {
      const p = join(base, projectSlug(root), `${sid}.jsonl`);
      if (existsSync(p)) return p;
    }
    for (const d of readdirSync(base)) {
      const p = join(base, d, `${sid}.jsonl`);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** Lead + per-agent rows for one session, agents sorted by read+write. */
export function sessionUsage(leadPath) {
  const lead = scanTranscript(readFileSync(leadPath, 'utf8'));
  const sub = join(leadPath.replace(/\.jsonl$/, ''), 'subagents');
  const agents = [];
  if (existsSync(sub)) {
    for (const f of readdirSync(sub).filter((f) => f.endsWith('.jsonl'))) {
      let meta = {};
      try {
        meta = JSON.parse(readFileSync(join(sub, f.replace(/\.jsonl$/, '.meta.json')), 'utf8'));
      } catch {}
      agents.push({
        ...scanTranscript(readFileSync(join(sub, f), 'utf8')),
        type: meta.agentType ?? '?',
        desc: meta.description ?? '',
      });
    }
  }
  agents.sort((a, b) => b.read + b.write - (a.read + a.write));
  return { lead, agents };
}

const M = (n) => `${(n / 1e6).toFixed(1)}M`;
const K = (n) => `${Math.round(n / 1e3)}k`;

/** Text report in the v2-usage layout; agents whose peak passed the budget are flagged. */
export function formatUsage({ lead, agents }, { top = 25, contextK = 300 } = {}) {
  const lines = [
    `lead  ${lead.model}  turns=${lead.turns}  peak=${K(lead.peak)}  read=${M(lead.read)}  write=${M(lead.write)}`,
  ];
  const tot = agents.reduce((t, r) => t + r.read + r.write, 0);
  const all = tot + lead.read + lead.write;
  const share = all ? Math.round((tot / all) * 100) : 0;
  lines.push(
    `subagents ${agents.length}  read+write=${M(tot)}  (lead ${M(lead.read + lead.write)}, agents ${share} %)`,
    ''
  );
  for (const r of agents.slice(0, top)) {
    const flag = r.peak > contextK * 1000 ? `  ! peak>${contextK}k` : '';
    lines.push(
      `${M(r.read + r.write).padStart(7)}  ${String(r.turns).padStart(4)}t  peak ${K(r.peak).padStart(5)}  ${r.model.padEnd(16)} ${r.type.padEnd(16)} ${r.desc.slice(0, 50)}${flag}`
    );
  }
  return lines.join('\n');
}
