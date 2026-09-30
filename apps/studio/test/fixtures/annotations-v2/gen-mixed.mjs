#!/usr/bin/env bun
// gen-mixed.mjs — regenerate the committed mixed legacy-v1 annotation fixture.
//
//   bun apps/studio/test/fixtures/annotations-v2/gen-mixed.mjs          # write
//   bun apps/studio/test/fixtures/annotations-v2/gen-mixed.mjs --check  # exit 1 on drift
//
// Writes `mixed-200.v1.svg` next to this script: 200 elements from
// `perf-annotations-mixed.mjs` (all v1 kinds, anchored labels, bound arrows,
// nested sections, groups), serialized by the canonical `strokesToSvg`. It is
// the v1 input for the annotations-v2 migration / round-trip tests. Only the
// 200 board is committed; the 1000 / 5000 boards are generated on demand by
// `perf.sh --fixture --mix --annotations N` (the 5000 board exceeds the 1 MB v1
// cap — the largest mixed board that fits is ~3750 elements).
//
// Deterministic (seeded), origin (0, 0), so a regeneration is byte-identical
// unless the generator or the v1 serializer changed — which `--check` reports.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMixedAnnotations } from '../perf-annotations-mixed.mjs';

const COUNT = 200;
const out = join(dirname(fileURLToPath(import.meta.url)), `mixed-${COUNT}.v1.svg`);
const svg = `${renderMixedAnnotations(COUNT)}\n`;

if (process.argv.includes('--check')) {
  let cur = '';
  try {
    cur = readFileSync(out, 'utf8');
  } catch {
    /* missing → drift */
  }
  if (cur !== svg) {
    console.error(`gen-mixed: ${out} is stale — rerun without --check`);
    process.exit(1);
  }
  console.error(`gen-mixed: ${out} up to date (${Buffer.byteLength(svg)} bytes)`);
} else {
  writeFileSync(out, svg, 'utf8');
  console.error(`gen-mixed: wrote ${out} (${Buffer.byteLength(svg)} bytes, ${COUNT} elements)`);
}
