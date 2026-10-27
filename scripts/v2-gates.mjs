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
).filter((k) => /^e2e(:|$)/.test(k) && k !== 'e2e:build' && !/:(all|wdio|test)$/.test(k));
// (`…:all` runs lanes already listed; `share-roles:wdio` is the bare wdio half its runner calls; `…:test` is a node test)
// Single-quoted for bash, so `$l`-style variables expand in the INNER shell, not the outer one.
const lane = (cmd) =>
  `scripts/v2-test-lane.sh --wait 3600 -- bash -c '${cmd.replace(/'/g, `'\\''`)}'`;
/** The same hold, for a run longer than the lane's 45-min default (the desktop e2e ×3). */
const laneLong = (cmd, max = 9000) =>
  `scripts/v2-test-lane.sh --wait 3600 --max ${max} -- bash -c '${cmd.replace(/'/g, `'\\''`)}'`;

// ── live checks ───────────────────────────────────────────────────────────────────────
function cleanupCheck() {
  const problems = [];
  const leftovers = [
    'apps/studio/client/styles.css',
    'apps/studio/client/styles/1-tokens.css',
    'apps/studio/client/styles/1-tokens-maude.css',
    // generated from the shell ladder's gaps (gen-tokens.mjs 1b); goes when the shell is v2-scoped
    'apps/studio/client/styles/1-tokens-maude-v2-shell.css',
    'apps/studio/client/styles/3-shell-maude.css',
    'apps/studio/client/styles/4-components-maude.css',
    'apps/studio/client/styles/5-maude-overrides.css',
  ].filter((p) => existsSync(join(ROOT, p)));
  if (leftovers.length) problems.push(`old token layers still present: ${leftovers.join(', ')}`);
  const legacy = sh(
    // the v1 ledgers keep v1 names on purpose (decision v2-p8-ledger-reads-through-rename): the testid
    // contract's history rows, the nothing-deleted map and the reachability evidence record what v1 had
    "git grep -l -E '\\.st-[a-z]|--u-[a-z]' -- apps/studio/client ':!apps/studio/client/v2/contracts' ':!apps/studio/client/v2/v1-manifest.json' ':!apps/studio/client/v2/nothing-deleted.json' ':!apps/studio/client/v2/reachability.json' ':!apps/studio/client/TESTIDS.md' ':!apps/studio/client/testids.json'"
  ).stdout.trim();
  if (legacy)
    problems.push(`.st-* / --u-* still used in ${legacy.split('\n').length} client file(s)`);
  const base = existsSync(BASELINES) ? JSON.parse(readFileSync(BASELINES, 'utf8')) : null;
  const css = join(ROOT, 'apps/studio/dist/styles.css');
  // Michal 2026-10-26 (decision v2-michal-css-bar-phase8-start): the bar is "smaller than at the start of
  // phase 8" — v2's own component CSS (~433 KB) can't fit under the pre-v2 301 KB, so that stays a reference
  if (!base?.phase8StartStylesCssBytes) problems.push('no phase-8 start CSS baseline recorded');
  else if (existsSync(css) && statSync(css).size >= base.phase8StartStylesCssBytes)
    problems.push(
      `CSS bundle ${statSync(css).size} B is not smaller than at the start of phase 8 (${base.phase8StartStylesCssBytes} B)`
    );
  const idx = join(ROOT, 'apps/studio/client/styles/_index.css');
  const bundled = existsSync(idx)
    ? [...readFileSync(idx, 'utf8').matchAll(/@import url\("([^"]+)"\)/g)]
        .map((m) => join('apps/studio/client/styles', m[1]))
        .join(',')
    : '';
  if (bundled && sh(`node scripts/v2-css-inventory.mjs --check '${bundled}'`).status !== 0)
    problems.push('dead CSS rules left in the bundle (scripts/v2-css-inventory.mjs --report)');
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
]
  // each gate in its own subshell from the repo root: quality.tests ends with `cd apps/studio`, which leaked into the next step
  .map((c) => `(${c})`)
  .join(' && ');

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
    // ONE lane hold (p8-e2e-fix-r6): the studio client release build first — the app's sidecar and the
    // share-roles people's studios serve apps/studio/dist from source (decision
    // v2-p8-e2e-fix-r5-share-roles-fresh-dist) — then the debug app, then every lane three times over with the
    // window on top. The lane wrapper reverts dist/ afterwards. No `pnpm`: in a worktree whose node_modules are
    // links it tries an install first; the package's own scripts run through `npm run`. Three full runs take
    // ~1h40 (r5: one run ≈ 31 min), past the lane's 45-min default, hence --max.
    cmd: laneLong(
      [
        'set -e -o pipefail',
        // the evidence keeps only the tail of the output, so every lane's FULL output is teed into a per-run,
        // per-lane file (p8-e2e-fix-r8: a run-1 red near the end of the default lane lost its spec name)
        'D="${TMPDIR:-/tmp}"; D="${D%/}/maude-v2-8.3/$(date +%Y%m%dT%H%M%S)"; mkdir -p "$D"',
        'echo "== lane logs: $D"; trap \'echo "== lane logs: $D"\' EXIT',
        // a stub `claude` first on PATH: no real claude, no keychain dialog from a throwaway HOME
        'STUB="$(mktemp -d)/bin"; mkdir -p "$STUB"',
        `printf '#!/bin/sh\\necho {\\\\"loggedIn\\\\":false}\\n' > "$STUB/claude"; chmod +x "$STUB/claude"`,
        'export PATH="$STUB:$HOME/.cargo/bin:$PATH" MAUDE_CLAUDE_BIN= MAUDE_E2E_ON_TOP=1 MAUDE_E2E_KEEP_FRONT=1',
        '(cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release) > "$D/build-studio.log" 2>&1 || { tail -40 "$D/build-studio.log"; exit 1; }',
        // the release build compiles the sidecar into dist/; the app build's sync-sidecar needs it
        '(cd apps/desktop && MAUDE_SKIP_RUNTIME_BUILD=1 npx --no-install tauri build --debug --config src-tauri/tauri.e2e.conf.json) > "$D/build-app.log" 2>&1 || { tail -40 "$D/build-app.log"; exit 1; }',
        'cd apps/desktop/e2e',
        // one hold, 3 runs, stop at the first red lane — its full log is named on the way out
        `for i in 1 2 3; do for l in ${E2E_LANES.join(' ')}; do f="$D/run$i-\${l//:/-}.log"; echo "== run $i lane $l"; npm run --silent "$l" 2>&1 | tee "$f" || { echo "== RED run $i lane $l — full log $f"; exit 1; }; done; done`,
      ].join('\n')
    ),
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
