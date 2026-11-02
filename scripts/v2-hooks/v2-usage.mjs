#!/usr/bin/env node
// Maude v2 run — token spend per sub-agent (input for .ai/scenarios/maude-v2/agent-routing.md).
//
//   node scripts/v2-hooks/v2-usage.mjs [sessionId] [--top N]
//
// Reads the lead's transcript + its subagents/ folder under ~/.claude/projects/<slug>/ and prints,
// per agent: model, turns, peak context, cache-read / cache-write tokens. sessionId defaults to the
// run marker's. Read-only; numbers come from the API usage blocks Claude Code already stores.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const topIdx = args.indexOf('--top');
const top = topIdx >= 0 ? Number(args[topIdx + 1]) : 25;
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
let sid = args.find((a, i) => !a.startsWith('--') && i !== topIdx + 1);
if (!sid) {
  try {
    sid = JSON.parse(readFileSync(join(root, '.ai/state/v2-run.json'), 'utf8')).sessionId;
  } catch {
    console.error('no sessionId given and no .ai/state/v2-run.json marker');
    process.exit(1);
  }
}
const dir = join(homedir(), '.claude/projects', root.replace(/[^A-Za-z0-9]/g, '-'));

function scan(file) {
  const seen = new Set();
  const s = { model: '?', turns: 0, peak: 0, read: 0, write: 0, out: 0 };
  for (const line of readFileSync(file, 'utf8').split('\n')) {
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
    if (m.model !== '<synthetic>') s.model = m.model;
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

const M = (n) => `${(n / 1e6).toFixed(1)}M`;
const K = (n) => `${Math.round(n / 1e3)}k`;
const lead = join(dir, `${sid}.jsonl`);
if (!existsSync(lead)) {
  console.error(`transcript not found: ${lead}`);
  process.exit(1);
}
const l = scan(lead);
console.log(
  `lead  ${l.model}  turns=${l.turns}  peak=${K(l.peak)}  read=${M(l.read)}  write=${M(l.write)}`
);

const sub = join(dir, sid, 'subagents');
const rows = [];
if (existsSync(sub)) {
  for (const f of readdirSync(sub).filter((f) => f.endsWith('.jsonl'))) {
    let meta = {};
    try {
      meta = JSON.parse(readFileSync(join(sub, f.replace('.jsonl', '.meta.json')), 'utf8'));
    } catch {}
    rows.push({ ...scan(join(sub, f)), type: meta.agentType ?? '?', desc: meta.description ?? '' });
  }
}
rows.sort((a, b) => b.read + b.write - (a.read + a.write));
const tot = rows.reduce((t, r) => t + r.read + r.write, 0);
console.log(`subagents ${rows.length}  read+write=${M(tot)}  (lead ${M(l.read + l.write)})\n`);
for (const r of rows.slice(0, top)) {
  const flag = r.peak > 300_000 ? '  ⚠ peak>300k' : '';
  console.log(
    `${M(r.read + r.write).padStart(7)}  ${String(r.turns).padStart(4)}t  peak ${K(r.peak).padStart(5)}  ${r.model.padEnd(16)} ${r.type.padEnd(16)} ${r.desc.slice(0, 50)}${flag}`
  );
}
