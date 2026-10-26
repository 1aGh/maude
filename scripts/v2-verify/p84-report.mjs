#!/usr/bin/env node
// V2-8.4 — turn results.json (p84-scenarios.mjs) into the mechanical half of report.md:
// TL;DR table, per-step pivot (rows = steps, columns = shells, with the screenshot), the parity
// verdict across the shells, notes per step. The prose (what surprised us, follow-ups) is authored
// by hand under the two marked headings — re-running this keeps them (it only rewrites the part
// above `<!-- AUTHORED -->`).
//
//   node scripts/v2-verify/p84-report.mjs <out-dir>   (out-dir holds results.json and shots/)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
const shells = Object.keys(results);
const LABEL = {
  browser: 'Plain browser (local studio)',
  owner: 'Cloud tab (local cell, owner)',
  viewer: 'Cloud tab (viewer — Can comment)',
};
const steps = results[shells[0]].steps.map((s) => ({ id: s.id, title: s.title }));
const cell = (shell, id) => results[shell].steps.find((s) => s.id === id);
const mark = (r) =>
  r?.status === 'pass' ? (r.gaps?.length ? 'PASS · GAP' : 'PASS') : r ? 'FAIL' : '—';

const lines = [];
const out = (s = '') => lines.push(s);
out('# V2-8.4 — cross-shell scenarios');
out();
out(
  'Web-desktop lane of the flow `scenario-runner` approach, run through `scripts/v2-verify/p84-up.mjs` (rig) and'
);
out(
  '`scripts/v2-verify/p84-scenarios.mjs` (driver, headless Chromium 1600×1000). Three shells, the same six steps, one'
);
out(
  'canvas (`ui/board.tsx`, a real `DesignCanvas` with one artboard). The cloud tab is a LOCAL cell (`scripts/dev/local-cell.mjs`:'
);
out(
  'hub in workspace mode + its studio child, served at `studio.cell.localhost`); the viewer is a `viewer`-role session'
);
out(
  "minted into that cell's own token store, the way the studio door mints one. Nothing production, no real hub / render /"
);
out('Stripe / Cloudflare; throwaway HOME, stub `claude`.');
out();
const failed = shells.flatMap((sh) =>
  results[sh].steps.filter((s) => s.status !== 'pass').map((s) => `${sh}/${s.id}`)
);
out('## TL;DR');
out();
out(
  `**${failed.length === 0 ? '0 blockers' : `${failed.length} failing step(s): ${failed.join(', ')}`}** · ${shells.length} shells × ${steps.length} steps.`
);
out();
out(`| Step | ${shells.map((s) => LABEL[s] ?? s).join(' | ')} |`);
out(`| --- |${shells.map(() => ' --- |').join('')}`);
for (const st of steps)
  out(`| ${st.title} | ${shells.map((sh) => mark(cell(sh, st.id))).join(' | ')} |`);
out();
const gaps = shells.flatMap((sh) =>
  results[sh].steps.flatMap((s) => (s.gaps ?? []).map((g) => `${sh}/${s.id}: ${g}`))
);
out(
  '**Known gaps** (the step did what a person can see it do; the stand-in cannot reach the rest):'
);
out();
if (gaps.length) for (const g of gaps) out(`- ${g}`);
else out('- none');
out();
out('## Parity');
out();
out(
  'What each shell showed at each step (from the live page; the open-project row is checked against'
);
out('`apps/studio/client/v2/shell/shell-parity.json`, the table the shell is pinned to).');
out();
out(`| Step | ${shells.map((s) => LABEL[s] ?? s).join(' | ')} |`);
out(`| --- |${shells.map(() => ' --- |').join('')}`);
for (const st of steps) {
  out(
    `| ${st.title} | ${shells
      .map((sh) => {
        const r = cell(sh, st.id);
        if (!r) return '—';
        const n = (r.status === 'pass' ? r.notes : [r.error, ...r.notes])
          .filter(Boolean)
          .slice(0, 3)
          .join(' · ');
        return n.replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 260);
      })
      .join(' | ')} |`
  );
}
out();
out('## Per-step screenshots');
out();
for (const st of steps) {
  out(`### ${st.title}`);
  out();
  for (const sh of shells) {
    const r = cell(sh, st.id);
    if (!r) continue;
    out(`**${LABEL[sh] ?? sh}** — ${mark(r)}${r.error ? `: ${r.error}` : ''}`);
    out();
    for (const n of r.notes) out(`- ${n}`);
    out();
    for (const f of [...(r.extra ?? []), r.shot].filter(Boolean)) {
      if (existsSync(join(dir, f))) out(`![${sh} ${st.id}](${f})`);
    }
    out();
  }
}
const errs = shells.filter((sh) => results[sh].errors?.length);
out('## Page errors');
out();
if (!errs.length) out('None (no uncaught page error, no `console.error`) in any shell.');
for (const sh of errs) {
  out(`**${sh}**`);
  for (const e of results[sh].errors) out(`- \`${e.replace(/`/g, "'")}\``);
}
out();

const head = `${lines.join('\n')}\n`;
const reportPath = join(dir, 'report.md');
let authored =
  '<!-- AUTHORED -->\n\n## What surprised us\n\n_TBD_\n\n## Recommended follow-ups\n\n_TBD_\n';
if (existsSync(reportPath)) {
  const old = readFileSync(reportPath, 'utf8');
  const i = old.indexOf('<!-- AUTHORED -->');
  if (i !== -1) authored = old.slice(i);
}
writeFileSync(reportPath, `${head}${authored}`);
console.log(`wrote ${reportPath}`);
