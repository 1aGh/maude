#!/usr/bin/env node
// Collect the cloud's v1 → v2 conversion counts after a rollout (cells-deploy.yml, p8-v1-drop-cloud).
//
//   node scripts/collect-v2-convert.mjs <health-url> [<health-url>…]
//
// Each cell converts its project on its first start under a stable 2.x image and reports the
// counts on `/health` as `v2Convert` (apps/hub/src/v2-convert.mjs). This polls each URL until its
// cell says `state: "done"`, prints one line per cell and one total in the cell's own report
// format, and appends them to $GITHUB_STEP_SUMMARY when set:
//
//   [v2-convert] fleet converted=N skipped=N failed=N cells=M unreported=K
//
// It NEVER fails the deploy for a failed count (exit 0): a failed project is left as it was and
// is surfaced (a `::warning::`), not rolled back. Exit 2 is a usage error only.
//
// Env: V2_CONVERT_ATTEMPTS (default 30), V2_CONVERT_SLEEP seconds (default 10),
//      V2_CONVERT_TIMEOUT seconds per request (default 20).

import { appendFileSync } from 'node:fs';

const urls = process.argv.slice(2).filter(Boolean);
if (urls.length === 0) {
  console.error('usage: collect-v2-convert.mjs <health-url> [<health-url>…]');
  process.exit(2);
}
const attempts = Number(process.env.V2_CONVERT_ATTEMPTS ?? 30);
const sleepMs = Number(process.env.V2_CONVERT_SLEEP ?? 10) * 1000;
const timeoutMs = Number(process.env.V2_CONVERT_TIMEOUT ?? 20) * 1000;

const line = (c, extra = '') =>
  `[v2-convert]${extra} converted=${c.converted} skipped=${c.skipped} failed=${c.failed}`;

async function readCell(url) {
  let last = 'no response';
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      const body = await res.json().catch(() => null);
      const v = body?.v2Convert;
      if (!v) last = 'no v2Convert on /health (an image without the conversion)';
      else if (v.state === 'gated') return { url, gated: v.reason ?? 'unknown' };
      else if (v.state === 'disabled') return { url, disabled: v.by ?? 'CELL_V2_CONVERT' };
      else if (v.state === 'done') return { url, counts: v };
      else last = `state ${v.state}`;
    } catch (err) {
      last = err?.message ?? String(err);
    }
    if (i < attempts) await new Promise((r) => setTimeout(r, sleepMs));
  }
  return { url, unreported: last };
}

const total = { converted: 0, skipped: 0, failed: 0 };
const out = [];
let reported = 0;
let unreported = 0;
let disabled = 0;
for (const r of await Promise.all(urls.map(readCell))) {
  if (r.counts) {
    reported += 1;
    for (const k of Object.keys(total)) total[k] += Number(r.counts[k]) || 0;
    out.push(`${line(r.counts, ` ${r.url}`)}`);
  } else if (r.disabled) {
    disabled += 1;
    out.push(`[v2-convert] ${r.url} disabled (${r.disabled}) — the kill switch was honoured`);
  } else if (r.gated) {
    unreported += 1;
    out.push(`[v2-convert] ${r.url} gated (${r.gated}) — this image does not convert`);
  } else {
    unreported += 1;
    out.push(`[v2-convert] ${r.url} unreported: ${r.unreported}`);
  }
}
out.push(`${line(total, ' fleet')} cells=${reported} unreported=${unreported} disabled=${disabled}`);
for (const l of out) console.log(l);
if (total.failed > 0)
  console.log(
    `::warning::${total.failed} cloud project(s) did not convert to Maude 2 — they were left as they were. See .ai/release-guide.md § "Verify the cloud converted every project".`
  );
if (unreported > 0)
  console.log(
    `::warning::${unreported} cell(s) did not report a conversion (see the lines above).`
  );
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Maude 2 cloud conversion\n\n\`\`\`\n${out.join('\n')}\n\`\`\`\n`
  );
}
