#!/usr/bin/env node
// Maude v2 — the Phase 8 gates as one runner (plan V2-2.0b; called by scripts/v2-done.sh).
//
//   node scripts/v2-gates.mjs                  check: every gate green (live checks run, recorded ones verified)
//   node scripts/v2-gates.mjs --list           print the gates and how each is proven
//   node scripts/v2-gates.mjs --record <id>    run a command gate now and write its evidence
//   node scripts/v2-gates.mjs --attest <id> --report <path>[,<path>…] [--note "<text>"]
//                                              record an agent/human gate (critic, auditor, manual smoke)
//                                              after its reports exist and say pass
//
// Three kinds of gate:
//   live     cheap — run on every check (greps, sizes, file presence)
//   command  heavy — `--record` runs it (quality gates, cargo, desktop e2e ×3, perf) and writes
//            .ai/scenarios/maude-v2/gates/<id>.json { pass, head, ts, log }
//   attest   needs an agent or a person — `--attest` writes the same file, pointing at the reports
// Recorded evidence counts only while it is FRESH: nothing outside `.ai/` changed between the
// evidence's commit and HEAD (committing the evidence itself does not stale it).
// Exit 0 = every gate green; 1 = at least one red (printed); 2 = usage error.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = process.env.V2_GATES_EVIDENCE_DIR ?? join(ROOT, '.ai/scenarios/maude-v2/gates');
const BASELINES = join(ROOT, '.ai/scenarios/maude-v2/baselines.json');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const sh = (cmd, { quiet = true } = {}) =>
  spawnSync('bash', ['-c', cmd], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: quiet ? 'pipe' : 'inherit',
    maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, NO_OPEN: '1', MAUDE_NO_AUTOBUILD: '1' },
  });
const git = (cmd) => sh(`git ${cmd}`).stdout.trim();
const quality = JSON.parse(readFileSync(join(ROOT, '.ai/workflows.config.json'), 'utf8')).quality;
// Every desktop e2e lane the package declares (old ones rewritten + the v2 ones as they land).
const E2E_LANES = Object.keys(
  JSON.parse(readFileSync(join(ROOT, 'apps/desktop/e2e/package.json'), 'utf8')).scripts
).filter((k) => /^e2e(:|$)/.test(k) && k !== 'e2e:build');
// Single-quoted for bash, so `$l`-style variables expand in the INNER shell, not the outer one.
const lane = (cmd) =>
  `scripts/v2-test-lane.sh --wait 3600 -- bash -c '${cmd.replace(/'/g, `'\\''`)}'`;

// ── live checks ───────────────────────────────────────────────────────────────────────
function cleanupCheck() {
  const problems = [];
  const leftovers = [
    'apps/studio/client/styles.css',
    'apps/studio/client/styles/1-tokens.css',
    'apps/studio/client/styles/1-tokens-maude.css',
    'apps/studio/client/styles/3-shell-maude.css',
    'apps/studio/client/styles/4-components-maude.css',
    'apps/studio/client/styles/5-maude-overrides.css',
  ].filter((p) => existsSync(join(ROOT, p)));
  if (leftovers.length) problems.push(`old token layers still present: ${leftovers.join(', ')}`);
  const legacy = sh(
    "git grep -l -E '\\.st-[a-z]|--u-[a-z]' -- apps/studio/client ':!apps/studio/client/v2/contracts' ':!apps/studio/client/v2/v1-manifest.json'"
  ).stdout.trim();
  if (legacy)
    problems.push(`.st-* / --u-* still used in ${legacy.split('\n').length} client file(s)`);
  const base = existsSync(BASELINES) ? JSON.parse(readFileSync(BASELINES, 'utf8')) : null;
  const css = join(ROOT, 'apps/studio/dist/styles.css');
  if (!base?.stylesCssBytes) problems.push('no pre-v2 CSS baseline recorded');
  else if (existsSync(css) && statSync(css).size >= base.stylesCssBytes)
    problems.push(
      `CSS bundle ${statSync(css).size} B is not smaller than pre-v2 ${base.stylesCssBytes} B`
    );
  if (!existsSync(join(ROOT, 'scripts/check-v2-dead-modules.mjs')))
    problems.push('dead-module check not built yet (scripts/check-v2-dead-modules.mjs)');
  else if (sh('node scripts/check-v2-dead-modules.mjs').status !== 0)
    problems.push('dead modules left');
  const nd = join(ROOT, 'scripts/check-v2-nothing-deleted.mjs');
  if (!existsSync(nd)) problems.push('nothing-deleted audit not built yet (V2-2.0c)');
  else if (sh('node scripts/check-v2-nothing-deleted.mjs').status !== 0)
    problems.push('nothing-deleted audit below 100 %');
  return problems;
}

function nothingDeletedCheck() {
  const nd = join(ROOT, 'scripts/check-v2-nothing-deleted.mjs');
  if (!existsSync(nd)) return ['nothing-deleted audit not built yet (V2-2.0c)'];
  return sh('node scripts/check-v2-nothing-deleted.mjs').status === 0
    ? []
    : ['nothing-deleted audit below 100 %'];
}

function aiParityCoverageCheck() {
  const p = join(ROOT, 'scripts/check-v2-ai-parity.mjs');
  if (!existsSync(p)) return ['AI parity coverage check not built yet (V2-2.4b)'];
  return sh('node scripts/check-v2-ai-parity.mjs').status === 0
    ? []
    : ['AI parity coverage below 100 %'];
}

// ── the gates ─────────────────────────────────────────────────────────────────────────
const qualityChain = [
  'npx biome format .',
  quality.lint,
  quality.typecheck,
  quality.tests,
  quality.build,
  quality.parity,
  quality.tarball,
  quality.tokens,
  quality['site-content'],
  'bash scripts/check-import-coherence.sh',
].join(' && ');

const GATES = [
  { id: 'V2-8.0', title: 'Cleanup', kind: 'live', check: cleanupCheck },
  { id: 'V2-8.1', title: 'Quality gates', kind: 'command', cmd: lane(qualityChain) },
  {
    id: 'V2-8.2',
    title: 'Rust',
    kind: 'command',
    cmd: 'cd apps/desktop/src-tauri && PATH="$HOME/.cargo/bin:$PATH" cargo test && PATH="$HOME/.cargo/bin:$PATH" cargo clippy --all-targets -- -D warnings',
  },
  {
    id: 'V2-8.3',
    title: 'Desktop e2e — every lane, 3 consecutive runs (debug build)',
    kind: 'command',
    cmd: `pnpm test:e2e:desktop:build && ${lane(`for i in 1 2 3; do for l in ${E2E_LANES.join(' ')}; do pnpm --filter @maude/desktop-e2e "$l" || exit 1; done; done`)}`,
  },
  { id: 'V2-8.4', title: 'Cross-shell scenarios (scenario-runner)', kind: 'attest' },
  { id: 'V2-8.5', title: 'Design fidelity (critics ≥ 4.0, copy 0 blockers)', kind: 'attest' },
  { id: 'V2-8.6', title: 'Nothing-deleted audit 100 %', kind: 'live', check: nothingDeletedCheck },
  { id: 'V2-8.7', title: 'A11y (a11y-auditor, keyboard-only, VoiceOver)', kind: 'attest' },
  {
    id: 'V2-8.8',
    title: 'Performance pan/zoom (Chromium + WebKit, Alligators-scale)',
    kind: 'attest',
  },
  { id: 'V2-8.9', title: 'Security (security-auditor + ethical-hacker)', kind: 'attest' },
  {
    id: 'V2-8.10',
    title: 'Packaged app (bundle completeness --smoke, client boots, clean-user smoke)',
    kind: 'attest',
  },
  { id: 'V2-8.14', title: 'Performance beyond pan/zoom (budgets)', kind: 'attest' },
  { id: 'V2-8.15', title: 'Docs for people and agents', kind: 'attest' },
  {
    id: 'V2-8.16',
    title: 'AI parity (coverage 100 %, agent e2e, 30-task eval ≥ baseline)',
    kind: 'attest',
    check: aiParityCoverageCheck,
  },
];

// ── evidence ──────────────────────────────────────────────────────────────────────────
const evidencePath = (id) => join(EVIDENCE, `${id}.json`);
function readEvidence(id) {
  try {
    return JSON.parse(readFileSync(evidencePath(id), 'utf8'));
  } catch {
    return null;
  }
}
// Evidence is a file anyone with write access to the tree can author (a lane agent, a Syncthing
// peer), so nothing in it is ever interpolated into a shell, and every claim it makes is re-checked
// against the repository (security review, Phase 1 gate).
const gitArgs = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
const QUALITY_HASH = createHash('sha256').update(JSON.stringify(quality)).digest('hex');
const fileHash = (p) =>
  createHash('sha256')
    .update(readFileSync(join(ROOT, p)))
    .digest('hex');
function fresh(ev, g) {
  if (!/^[0-9a-f]{40}$/.test(ev?.head ?? '')) return 'head is not a full commit sha';
  if (gitArgs('merge-base', '--is-ancestor', ev.head, 'HEAD').status !== 0)
    return 'head is not an ancestor of HEAD';
  // stale when anything outside .ai/ changed since — and the quality gate definitions, which live in .ai/
  if (gitArgs('diff', '--quiet', ev.head, 'HEAD', '--', '.', ':!.ai').status !== 0)
    return `product files changed since ${ev.head.slice(0, 8)}`;
  if (ev.qualityHash !== QUALITY_HASH) return 'the quality gate definitions changed';
  if (g?.kind === 'command' && ev.cmd !== g.cmd) return 'recorded for a different command';
  if (g?.kind === 'attest') {
    const hashes = ev.reportHashes ?? {};
    for (const r of ev.reports ?? []) {
      if (!existsSync(join(ROOT, r))) return `report ${r} is gone`;
      if (hashes[r] !== fileHash(r)) return `report ${r} changed after it was attested`;
    }
    if (!(ev.reports ?? []).length) return 'no reports';
  }
  return null;
}
// A report's own verdict, when it carries one: the last ```json block with blockers / pass.
function reportVerdict(p) {
  const text = readFileSync(join(ROOT, p), 'utf8');
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  for (const m of blocks.reverse()) {
    try {
      const v = JSON.parse(m[1]);
      if (typeof v.blockers === 'number' && v.blockers > 0) return `${v.blockers} blocker(s)`;
      if (v.pass === false || v.verdict === 'fail') return 'verdict fail';
      if ('blockers' in v || 'pass' in v || 'verdict' in v) return null;
    } catch {}
  }
  return null;
}
function writeEvidence(id, data) {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(evidencePath(id), `${JSON.stringify(data, null, 2)}\n`);
}
const productDirty = () => sh("git diff --quiet HEAD -- . ':!.ai'").status !== 0;

function judge(g) {
  const problems = g.check ? g.check() : [];
  if (g.kind !== 'live') {
    const ev = readEvidence(g.id);
    if (!ev)
      problems.push(`no evidence (${g.kind === 'command' ? '--record' : '--attest'} ${g.id})`);
    else if (ev.pass !== true) problems.push(`evidence says fail (${ev.ts})`);
    else {
      const why = fresh(ev, g);
      if (why) problems.push(`evidence stale — ${why}`);
    }
  }
  return problems;
}

// ── modes ─────────────────────────────────────────────────────────────────────────────
if (args.includes('--list')) {
  for (const g of GATES) console.log(`${g.id.padEnd(8)} ${g.kind.padEnd(8)} ${g.title}`);
  process.exit(0);
}

if (opt('--record')) {
  const g = GATES.find((x) => x.id === opt('--record'));
  if (!g || g.kind !== 'command') {
    console.error(
      `--record takes a command gate: ${GATES.filter((x) => x.kind === 'command')
        .map((x) => x.id)
        .join(', ')}`
    );
    process.exit(2);
  }
  if (productDirty()) {
    console.error('uncommitted product changes — commit first, evidence is tied to a commit');
    process.exit(2);
  }
  const t0 = Date.now();
  const r = sh(g.cmd);
  const log = `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-20000);
  writeEvidence(g.id, {
    gate: g.id,
    pass: r.status === 0,
    head: git('rev-parse HEAD'),
    ts: new Date().toISOString(),
    seconds: Math.round((Date.now() - t0) / 1000),
    cmd: g.cmd,
    qualityHash: QUALITY_HASH,
    log,
  });
  console.log(`${r.status === 0 ? 'PASS' : 'FAIL'}  ${g.id} recorded → ${evidencePath(g.id)}`);
  process.exit(r.status === 0 ? 0 : 1);
}

if (opt('--attest')) {
  const g = GATES.find((x) => x.id === opt('--attest'));
  const reports = (opt('--report') ?? '').split(',').filter(Boolean);
  if (!g || g.kind !== 'attest' || !reports.length) {
    console.error(
      `--attest <${GATES.filter((x) => x.kind === 'attest')
        .map((x) => x.id)
        .join('|')}> --report <path>[,…]`
    );
    process.exit(2);
  }
  const missing = reports.filter((p) => !existsSync(join(ROOT, p)));
  if (missing.length) {
    console.error(`reports not found: ${missing.join(', ')}`);
    process.exit(2);
  }
  const failing = reports.map((p) => [p, reportVerdict(p)]).filter(([, v]) => v);
  if (failing.length) {
    console.error(`reports do not say pass: ${failing.map(([p, v]) => `${p} (${v})`).join(', ')}`);
    process.exit(1);
  }
  if (productDirty()) {
    console.error('uncommitted product changes — commit first, evidence is tied to a commit');
    process.exit(2);
  }
  writeEvidence(g.id, {
    gate: g.id,
    pass: true,
    qualityHash: QUALITY_HASH,
    reportHashes: Object.fromEntries(reports.map((p) => [p, fileHash(p)])),
    head: git('rev-parse HEAD'),
    ts: new Date().toISOString(),
    reports,
    note: opt('--note') ?? '',
  });
  console.log(`PASS  ${g.id} attested → ${evidencePath(g.id)}`);
  process.exit(0);
}

let red = 0;
for (const g of GATES) {
  const problems = judge(g);
  if (problems.length) red++;
  console.log(
    `${problems.length ? 'FAIL' : 'PASS'}  ${g.id} ${g.title}${problems.length ? ` — ${problems.join('; ')}` : ''}`
  );
}
console.log(
  red ? `phase 8 gates: ${red} of ${GATES.length} red` : `phase 8 gates: all ${GATES.length} green`
);
process.exit(red ? 1 : 0);
