#!/usr/bin/env node
// Maude v2 coverage ledger — `.ai/scenarios/maude-v2/ledger.json` (plan V2-0.0).
//
// The ledger is the run's master list of everything that must end `verified`:
//   task      every `V2-x.y` id in the plan's phase tables
//   package   the work packages S1–S12 (closed at their wave gate)
//   artboard  every DCArtboard id in `.design/ui/v2/01 … 15`
//   rule      every rule on `00 Index` › "The rules every canvas follows"
//   home      every G0-D row (homes for today's features no canvas places)
//   owner     every G0-E owner-run step (counted `built` until Michal confirms)
//
// Usage:
//   node scripts/v2-ledger.mjs gen     regenerate from the sources, keeping every row's status/evidence/commit
//   node scripts/v2-ledger.mjs stats   counts per kind × status
//   node scripts/v2-ledger.mjs check   exit 1 unless the ledger is complete (no open rows, evidence hash-pinned)
//   node scripts/v2-ledger.mjs set <rowId> <status> [--evidence <path>] [--commit <sha>]
//
// Rows are never deleted: a row whose source disappeared is kept with `orphaned: true`
// (nothing-deleted applies to the ledger itself). One row per line keeps diffs per row.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLAN = join(ROOT, '.ai/plans/feature-maude-v2-redesign.md');
const CANVAS_DIR = join(ROOT, '.design/ui/v2');
export const LEDGER = join(ROOT, '.ai/scenarios/maude-v2/ledger.json');

const STATUSES = ['open', 'built', 'verified'];

// Coverage matrix: canvas number → work package(s) that own it.
const PACKAGES = {
  '01': 'S6, S1, S5',
  '02': 'S6, S9',
  '03': 'S5',
  '04': 'S3 (+P4)',
  '05': 'S11 (+ owners)',
  '06': 'S11 (+P4)',
  '07': 'S7',
  '08': 'S7',
  '09': 'S8',
  10: 'S9',
  11: 'S1 (+P3)',
  12: 'S8',
  13: 'S10',
  14: 'S2',
  15: 'S4',
};

const sha256 = (buf) => `sha256:${createHash('sha256').update(buf).digest('hex')}`;
const slug = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[“”"']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function canvasFiles() {
  return readdirSync(CANVAS_DIR)
    .filter((f) => /^\d\d .+\.tsx$/.test(f))
    .sort()
    .map((f) => ({ num: f.slice(0, 2), file: join(CANVAS_DIR, f) }));
}

// `@artboards a | b |` header (may wrap over several ` * ` lines).
function headerIds(src) {
  const m = src.match(/@artboards\s+([\s\S]*?)\n \* @(?!artboards)/);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s*/, ''))
    .join(' ')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Real `<DCArtboard id="…">` tags (skips code samples inside template strings).
function jsxArtboards(src) {
  const out = [];
  const lines = src.split('\n');
  let section = null;
  for (const line of lines) {
    const sec = line.match(/<DCSection\s+id="([^"]+)"(?:\s+title="([^"]*)")?/);
    if (sec) section = { id: sec[1], title: sec[2] ?? null };
    const idx = line.indexOf('<DCArtboard ');
    if (idx < 0) continue;
    if (line.slice(0, idx).includes('`') || line.slice(0, idx).includes('{"')) continue;
    const id = line.slice(idx).match(/^<DCArtboard\s+id="([^"]+)"/);
    if (!id) continue;
    const label = line.slice(idx).match(/\blabel="([^"]*)"/);
    out.push({ id: id[1], label: label ? label[1] : null, section });
  }
  return out;
}

function indexRules(src) {
  const start = src.indexOf('const RULES');
  const end = src.indexOf('\n];', start);
  const block = src.slice(start, end);
  return [...block.matchAll(/\{ t: "([^"]+)", src: "([^"]*)"/g)].map((m) => ({
    title: m[1],
    src: m[2],
  }));
}

function planRows(plan) {
  const tasks = [];
  const seen = new Set();
  for (const m of plan.matchAll(/^\| (V2-\d+\.\d+[a-z]?) \| (.+?) \|/gm)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const phase = Number(m[1].match(/^V2-(\d+)/)[1]);
    tasks.push({ id: m[1], phase, title: m[2].replace(/\*\*/g, '').slice(0, 160) });
  }
  const homes = [...plan.matchAll(/^\| (D\d+) \| (.+?) \| (.+?) \|/gm)].map((m) => ({
    id: m[1],
    today: m[2].slice(0, 200),
    home: m[3].slice(0, 300),
  }));
  const owners = [...plan.matchAll(/^\| (E\d) \| (.+?) \| (.+?) \|/gm)].map((m) => ({
    id: m[1],
    step: m[2].slice(0, 200),
  }));
  const packages = [...plan.matchAll(/^\| \*\*(S\d+) ([^*]+)\*\* \|/gm)].map((m) => ({
    id: m[1],
    title: m[2].trim(),
  }));
  return { tasks, homes, owners, packages };
}

export function loadLedger() {
  if (!existsSync(LEDGER)) return null;
  return JSON.parse(readFileSync(LEDGER, 'utf8'));
}

function serialize(ledger) {
  // Canonical layout: header fields pretty, one row per line.
  const { rows, canvases, ...head } = ledger;
  const lines = ['{'];
  for (const [k, v] of Object.entries(head))
    lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  lines.push('  "canvases": {');
  const cv = Object.entries(canvases).sort(([a], [b]) => a.localeCompare(b));
  for (const [i, [k, v]] of cv.entries()) {
    lines.push(`    ${JSON.stringify(k)}: ${JSON.stringify(v)}${i < cv.length - 1 ? ',' : ''}`);
  }
  lines.push('  },');
  lines.push('  "rows": [');
  for (const [i, r] of rows.entries()) {
    lines.push(`    ${JSON.stringify(r)}${i < rows.length - 1 ? ',' : ''}`);
  }
  lines.push('  ]');
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

export function saveLedger(ledger) {
  mkdirSync(dirname(LEDGER), { recursive: true });
  writeFileSync(LEDGER, serialize(ledger));
}

export function generate() {
  const plan = readFileSync(PLAN, 'utf8');
  const fresh = [];
  const canvases = {};
  const problems = [];

  const { tasks, homes, owners, packages } = planRows(plan);
  for (const t of tasks) fresh.push({ id: t.id, kind: 'task', phase: t.phase, title: t.title });
  for (const p of packages) fresh.push({ id: p.id, kind: 'package', title: p.title });

  for (const { num, file } of canvasFiles()) {
    const buf = readFileSync(file);
    const src = buf.toString('utf8');
    canvases[num] = { file: relative(ROOT, file), sha256: sha256(buf) };
    if (num === '00') {
      for (const r of indexRules(src)) {
        fresh.push({
          id: `00/rule/${slug(r.title)}`,
          kind: 'rule',
          canvas: '00',
          title: r.title,
          src: r.src,
        });
      }
      continue;
    }
    const jsx = jsxArtboards(src);
    const head = headerIds(src);
    const jsxIds = new Set(jsx.map((a) => a.id));
    for (const h of head)
      if (!jsxIds.has(h))
        problems.push(`${num}: @artboards lists "${h}" but no DCArtboard has that id`);
    for (const a of jsx)
      if (head.length && !head.includes(a.id))
        problems.push(`${num}: DCArtboard "${a.id}" missing from the @artboards header`);
    for (const a of jsx) {
      fresh.push({
        id: `${num}/${a.id}`,
        kind: 'artboard',
        canvas: num,
        artboard: a.id,
        section: a.section?.id ?? null,
        label: a.label,
        package: PACKAGES[num] ?? null,
      });
    }
  }
  for (const h of homes)
    fresh.push({ id: `G0-D/${h.id}`, kind: 'home', title: h.today, home: h.home });
  for (const o of owners) fresh.push({ id: `G0-E/${o.id}`, kind: 'owner', title: o.step });

  const prev = loadLedger();
  const prevRows = new Map((prev?.rows ?? []).map((r) => [r.id, r]));
  const rows = fresh.map((r) => {
    const old = prevRows.get(r.id);
    prevRows.delete(r.id);
    return {
      ...r,
      status: old?.status ?? 'open',
      evidence: old?.evidence ?? null,
      evidenceHash: old?.evidenceHash ?? null,
      commit: old?.commit ?? null,
    };
  });
  for (const old of prevRows.values()) rows.push({ ...old, orphaned: true });

  const ledger = {
    format: 'maude.v2-ledger',
    v: 1,
    plan: relative(ROOT, PLAN),
    note: 'Generated by scripts/v2-ledger.mjs gen; statuses are edited by `set`, never by hand-deleting rows.',
    canvases,
    rows,
  };
  saveLedger(ledger);
  return { ledger, problems };
}

export function stats(ledger) {
  const out = {};
  for (const r of ledger.rows) {
    out[r.kind] ??= { open: 0, built: 0, verified: 0 };
    out[r.kind][r.status] = (out[r.kind][r.status] ?? 0) + 1;
  }
  return out;
}

// Completeness: no open rows; task/package/artboard/rule/home rows verified; owner rows at least built;
// every verified artboard row's evidence exists and is hash-pinned to the canvas file it was taken against.
export function checkComplete(ledger) {
  const errors = [];
  for (const r of ledger.rows) {
    if (r.orphaned) continue;
    if (r.status === 'open') {
      errors.push(`${r.id}: open`);
      continue;
    }
    if (r.kind !== 'owner' && r.status !== 'verified')
      errors.push(`${r.id}: ${r.status}, not verified`);
    if (r.kind === 'artboard' && r.status === 'verified') {
      if (!r.evidence || !existsSync(join(ROOT, r.evidence)))
        errors.push(`${r.id}: evidence missing (${r.evidence})`);
      const cur = ledger.canvases[r.canvas]?.sha256;
      if (r.evidenceHash && cur && r.evidenceHash !== cur)
        errors.push(`${r.id}: evidence is stale — canvas changed since`);
      if (!r.evidenceHash) errors.push(`${r.id}: evidence not hash-pinned`);
    }
    if ((r.kind === 'task' || r.kind === 'artboard') && r.status === 'verified' && !r.commit) {
      errors.push(`${r.id}: verified without a commit`);
    }
  }
  return errors;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'gen') {
    const { ledger, problems } = generate();
    for (const p of problems) console.error(`warn: ${p}`);
    console.log(JSON.stringify(stats(ledger)));
    console.log(`${ledger.rows.length} rows → ${relative(ROOT, LEDGER)}`);
    return 0;
  }
  const ledger = loadLedger();
  if (!ledger) {
    console.error(`no ledger at ${relative(ROOT, LEDGER)} — run: node scripts/v2-ledger.mjs gen`);
    return 1;
  }
  if (cmd === 'stats') {
    console.log(JSON.stringify(stats(ledger), null, 2));
    return 0;
  }
  if (cmd === 'check') {
    const errors = checkComplete(ledger);
    const open = ledger.rows.filter((r) => r.status === 'open').length;
    if (errors.length) {
      console.error(`ledger incomplete: ${errors.length} problems (${open} open rows)`);
      for (const e of errors.slice(0, 20)) console.error(`  ${e}`);
      if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
      return 1;
    }
    console.log('ledger complete');
    return 0;
  }
  if (cmd === 'set') {
    const [rowId, status] = rest;
    if (!rowId || !STATUSES.includes(status)) {
      console.error(
        'usage: set <rowId> <open|built|verified> [--evidence <path>] [--commit <sha>]'
      );
      return 2;
    }
    const row = ledger.rows.find((r) => r.id === rowId);
    if (!row) {
      console.error(`no row ${rowId}`);
      return 1;
    }
    const opt = (name) => {
      const i = rest.indexOf(name);
      return i >= 0 ? rest[i + 1] : undefined;
    };
    row.status = status;
    const ev = opt('--evidence');
    if (ev) {
      row.evidence = ev;
      if (row.kind === 'artboard') row.evidenceHash = ledger.canvases[row.canvas]?.sha256 ?? null;
    }
    const sha = opt('--commit');
    if (sha) row.commit = sha;
    saveLedger(ledger);
    console.log(JSON.stringify(row));
    return 0;
  }
  console.error(
    'usage: v2-ledger.mjs gen | stats | check | set <rowId> <status> [--evidence p] [--commit sha]'
  );
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
