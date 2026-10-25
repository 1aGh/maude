#!/usr/bin/env node
// scripts/v2-perf-summary.mjs — turn the JSON of one or more `v2-perf-bench.sh` batches into the
// V2-8.8 table and the V2-1.8 M7 verdict.
//
//   node scripts/v2-perf-summary.mjs <batch-dir> [<batch-dir>…]
//
// Per lane (studio / bare), per batch: the arm's median p95, its spread across kept passes, the
// median long frames (≥ 50 ms) and their range. M7 (V2-1.8 §5.2): v2 median p95 ≤ pre-v2 median p95
// + the pre-v2 spread, AND v2 median long frames ≤ pre-v2 median + its range. With several batches
// the pooled row takes the median of the batch medians and the widest spread/range seen (in a
// batch or between batches) — the honest reading of "within the pre-v2 spread".
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error('usage: v2-perf-summary.mjs <batch-dir>…');
  process.exit(2);
}
const med = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
};
const rng = (xs) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);
const r1 = (x) => (x == null ? '—' : Math.round(x * 10) / 10);

function load(dir, arm, lane) {
  const f = join(dir, `${arm}-${lane}.json`);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8')).current;
  } catch {
    return null;
  }
}

const out = [];
const verdicts = [];
const LANE_TITLE = {
  studio: 'Chromium, studio shell, dpr 2',
  bare: 'Chromium, bare canvas page',
  webkit: 'WebKit (Safari), studio shell',
  lod: 'Chromium, studio shell, dpr 2, mixed annotation board (1,500 elements, 64 boards) at a fit-all zoom below 25 %',
};
const lanes = ['studio', 'webkit', 'bare', 'lod'].filter((l) =>
  dirs.some((d) => existsSync(join(d, `v2-${l}.json`)))
);
for (const lane of lanes) {
  const pooled = { base: [], v2: [] };
  out.push(`\n## ${lane} lane — ${LANE_TITLE[lane]}, fit-all`);
  out.push(
    '| batch | arm | p50 | p95 | p95 spread | zoom p95 | long frames (range) | jank ≥25 | artboard renders | boards | kept |'
  );
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const dir of dirs) {
    for (const arm of ['base', 'v2']) {
      const r = load(dir, arm, lane);
      if (!r) {
        out.push(`| ${dir.split('/').pop()} | ${arm} | missing | | | | | | | | |`);
        continue;
      }
      pooled[arm].push(r);
      out.push(
        `| ${dir.split('/').pop()} | ${arm} | ${r1(r.p50FrameMs)} | ${r1(r.p95FrameMs)} | ${r1(r.p95SpreadMs)} | ${r1(r.zoomP95Ms)} | ${r1(r.longFrames)} (${r1(r.longFramesRange)}) | ${r1(r.jankFrames)} | ${r1(r.artboardRenders)} | ${r.boardsOnScreen} | ${r.kept}${r.worldScale != null ? `, scale ${r.worldScale}` : ''} |`
      );
    }
  }
  const b = pooled.base;
  const v = pooled.v2;
  if (!b.length || !v.length) continue;
  const bP95 = med(b.map((r) => r.p95FrameMs));
  const vP95 = med(v.map((r) => r.p95FrameMs));
  const spread = Math.max(...b.map((r) => r.p95SpreadMs ?? 0), rng(b.map((r) => r.p95FrameMs)));
  const bLong = med(b.map((r) => r.longFrames));
  const vLong = med(v.map((r) => r.longFrames));
  const lrange = Math.max(...b.map((r) => r.longFramesRange ?? 0), rng(b.map((r) => r.longFrames)));
  const okP95 = vP95 <= bP95 + spread;
  const okLong = vLong <= bLong + lrange;
  out.push(
    `\npooled (${b.length} batch${b.length > 1 ? 'es' : ''}): p95 v2 ${r1(vP95)} vs pre-v2 ${r1(bP95)} + spread ${r1(spread)} → ${okP95 ? 'PASS' : 'FAIL'}; ` +
      `long frames v2 ${r1(vLong)} vs ${r1(bLong)} + range ${r1(lrange)} → ${okLong ? 'PASS' : 'FAIL'}`
  );
  verdicts.push({ lane, okP95, okLong });
}
// peers: the same shell with and without eleven simulated people (twelve with the measuring tab)
if (dirs.some((d) => existsSync(join(d, 'v2-peers.json')))) {
  out.push(
    '\n## peers lane — v2 studio shell, 12 people (11 simulated at 15 Hz) against none, fit-all'
  );
  out.push(
    '| batch | peers | p50 | p95 | p95 spread | zoom p95 | long frames (range) | jank ≥25 |'
  );
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  const w = [];
  const wo = [];
  for (const dir of dirs) {
    for (const [arm, lane, label, bucket] of [
      ['v2', 'studio', '0', wo],
      ['v2', 'peers', '12', w],
    ]) {
      const r = load(dir, arm, lane);
      if (!r) continue;
      bucket.push(r);
      out.push(
        `| ${dir.split('/').pop()} | ${label} | ${r1(r.p50FrameMs)} | ${r1(r.p95FrameMs)} | ${r1(r.p95SpreadMs)} | ${r1(r.zoomP95Ms)} | ${r1(r.longFrames)} (${r1(r.longFramesRange)}) | ${r1(r.jankFrames)} |`
      );
    }
  }
  if (w.length && wo.length) {
    const spread = Math.max(...wo.map((r) => r.p95SpreadMs ?? 0), rng(wo.map((r) => r.p95FrameMs)));
    const lr = Math.max(...wo.map((r) => r.longFramesRange ?? 0));
    const okP = med(w.map((r) => r.p95FrameMs)) <= med(wo.map((r) => r.p95FrameMs)) + spread;
    const okL = med(w.map((r) => r.longFrames)) <= med(wo.map((r) => r.longFrames)) + lr;
    out.push(
      `\npooled: p95 with people ${r1(med(w.map((r) => r.p95FrameMs)))} vs alone ${r1(med(wo.map((r) => r.p95FrameMs)))} + spread ${r1(spread)} → ${okP ? 'PASS' : 'FAIL'}; long frames ${r1(med(w.map((r) => r.longFrames)))} vs ${r1(med(wo.map((r) => r.longFrames)))} + range ${r1(lr)} → ${okL ? 'PASS' : 'FAIL'}`
    );
    verdicts.push({ lane: 'peers', okP95: okP, okLong: okL });
  }
}
// panel: the 93-canvas Canvases panel
if (dirs.some((d) => existsSync(join(d, 'v2-panel.json')))) {
  out.push('\n## panel — the 93-canvas Canvases panel in the studio shell (median of kept runs)');
  out.push(
    '| batch | arm | first row ms | rows mounted | scroll p95 / max / long | flat list rows (of 93) | flat scroll p95 / max / long | search p95 / max ms | open canvas ms |'
  );
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const dir of dirs) {
    for (const arm of ['base', 'v2']) {
      const f = join(dir, `${arm}-panel.json`);
      if (!existsSync(f)) continue;
      let r;
      try {
        r = JSON.parse(readFileSync(f, 'utf8'));
      } catch {
        continue;
      }
      out.push(
        `| ${dir.split('/').pop()} | ${arm} | ${r.firstRowMs} (max ${r.firstRowMax}) | ${r.rowsInDom} | ${r.scrollP95} / ${r.scrollMax} / ${r.scrollLong} | ${r.rowsFlat} | ${r.scrollFlatP95} / ${r.scrollFlatMax} / ${r.scrollFlatLong} | ${r.searchP95} / ${r.searchMax} | ${r.openMs} |`
      );
    }
  }
}
console.log(out.join('\n'));
process.exit(verdicts.every((v) => v.okP95 && v.okLong) ? 0 : 1);
