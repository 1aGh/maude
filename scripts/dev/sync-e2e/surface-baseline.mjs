// Candidate against baseline — plan T31's comparison, and the thing T1's
// preserved evidence exists FOR.
//
// T1 captures a run of the unchanged product; every later run is a candidate
// that must not have taken anything away. Until now the two were only ever
// read by a person: nothing in the harness put a baseline's rows beside a
// candidate's and said which cells went backwards. That missing compare is
// also why T1's evidence could never do its job — evidence nobody compares
// against is a folder of screenshots.
//
// THE RULE, and it is deliberately one-directional:
//
//   • a cell that PASSED in the baseline and does not pass now is a
//     REGRESSION. That includes going to `not-run` or vanishing: "we stopped
//     running it" is exactly how a regression hides.
//   • a cell that did not pass before and passes now is a repair — reported,
//     never required.
//   • a cell absent from the baseline is NEW — reported, never a regression
//     (a candidate is allowed to test more than the baseline did).
//
// Cells are keyed by id + direction + sample, because the same id is asserted
// in three directions and the latency lane repeats one id many times.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The stable identity of one asserted cell. */
export function cellKey(row) {
  // JSON, not a joined string with a separator character: a separator has to
  // be one an id can never contain, and picking an exotic one put a literal
  // control byte in this file and made git call the source binary.
  return JSON.stringify([row.id ?? '', row.direction ?? '', row.sample ?? null]);
}

export function readRows(dir) {
  const path = join(dir, 'surface-results.json');
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const rows = Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
  return Array.isArray(rows) ? rows : null;
}

/**
 * @param {object[]} baseline rows of the preserved run
 * @param {object[]} candidate rows of the run under judgement
 * @returns {{regressions: object[], repairs: object[], added: object[], held: number}}
 */
export function compareToBaseline(baseline, candidate) {
  const now = new Map();
  for (const row of candidate) now.set(cellKey(row), row);
  const regressions = [];
  const repairs = [];
  let held = 0;
  const seen = new Set();
  for (const before of baseline) {
    const key = cellKey(before);
    seen.add(key);
    const after = now.get(key);
    const wasPass = before.status === 'pass';
    const isPass = after?.status === 'pass';
    if (wasPass && !isPass) {
      regressions.push({
        id: before.id,
        direction: before.direction ?? null,
        sample: before.sample ?? null,
        // A cell that is simply gone is the worst shape of this, so say so
        // rather than printing `undefined`.
        now: after ? (after.status ?? 'unknown') : 'absent',
        why: after?.error ?? after?.why ?? null,
      });
    } else if (!wasPass && isPass) {
      repairs.push({
        id: before.id,
        direction: before.direction ?? null,
        sample: before.sample ?? null,
        was: before.status ?? 'unknown',
      });
    } else if (wasPass && isPass) held += 1;
  }
  const added = candidate
    .filter((row) => !seen.has(cellKey(row)))
    .map((row) => ({
      id: row.id,
      direction: row.direction ?? null,
      sample: row.sample ?? null,
      status: row.status ?? 'unknown',
    }));
  return { regressions, repairs, added, held };
}

export function summarise(result) {
  return (
    `baseline compare: ${result.held} held · ${result.regressions.length} regressed · ` +
    `${result.repairs.length} repaired · ${result.added.length} new`
  );
}

if (process.argv[1] && process.argv[1].endsWith('surface-baseline.mjs')) {
  const [baselineDir, candidateDir] = process.argv.slice(2);
  if (!baselineDir || !candidateDir) {
    console.error('usage: surface-baseline.mjs <baseline-run-dir> <candidate-run-dir>');
    process.exit(2);
  }
  const before = readRows(baselineDir);
  const after = readRows(candidateDir);
  if (!before) {
    console.error(`no surface-results.json in the baseline ${baselineDir}`);
    process.exit(2);
  }
  if (!after) {
    console.error(`no surface-results.json in the candidate ${candidateDir}`);
    process.exit(2);
  }
  const result = compareToBaseline(before, after);
  console.log(summarise(result));
  for (const r of result.regressions.slice(0, 40))
    console.log(`  REGRESSED ${r.id}${r.direction ? ` · ${r.direction}` : ''} → ${r.now}`);
  process.exit(result.regressions.length > 0 ? 1 : 0);
}
