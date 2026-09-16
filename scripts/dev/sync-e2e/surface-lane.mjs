// One lane's verdict out of a surface run — plan T31.
//
// The spec asks for a `web-desktop` runner and a `native-macos` runner. There
// is ONE rig: `surface-run.mjs` brings up the cell browser, the bundled
// WKWebView app and a second desktop together, because the thing under test is
// what travels BETWEEN them — a "native-only" run would have nobody to send to.
// So the two runners are two gates over the same real run rather than two
// backends, and this script is the gate: it reads a run's
// `surface-results.json` and answers for one lane only.
//
// A row belongs to a lane by its `direction`. `native-to-peers` is the native
// app as the author; `hub-to-peers` and `peer-to-peers` are the browser and the
// second desktop. Rows with no direction, or `all`, are the rig's own
// bootstrap/teardown observations and count for every lane — a broken rig is
// not a passing lane.
//
// Usage: node surface-lane.mjs <run-dir> native|web-desktop
// Exits non-zero when the lane has a failure, or when the run has no rows for
// it (a lane that did not execute is not a lane that passed).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LANES = {
  native: new Set(['native-to-peers', 'native']),
  'web-desktop': new Set(['hub-to-peers', 'peer-to-peers', 'hub', 'peer']),
};
const SHARED = new Set([undefined, null, '', 'all']);

const [dir, lane] = process.argv.slice(2);
if (!dir || !LANES[lane]) {
  console.error('usage: surface-lane.mjs <run-dir> native|web-desktop');
  process.exit(2);
}
const path = join(dir, 'surface-results.json');
if (!existsSync(path)) {
  console.error(`no surface-results.json in ${dir} — the run did not get far enough to judge`);
  process.exit(2);
}

const rows = JSON.parse(readFileSync(path, 'utf8'));
const all = Array.isArray(rows) ? rows : (rows.rows ?? rows.results ?? []);
const own = all.filter((r) => LANES[lane].has(r.direction));
const shared = all.filter((r) => SHARED.has(r.direction));
const mine = [...own, ...shared];

const tally = { pass: 0, fail: 0, unsupported: 0, 'not-run': 0, other: 0 };
for (const r of mine) {
  const k = String(r.status ?? 'other');
  if (k in tally) tally[k] += 1;
  else tally.other += 1;
}

console.log(
  `lane ${lane}: ${tally.pass} pass / ${tally.fail} fail / ${tally.unsupported} unsupported / ` +
    `${tally['not-run']} not-run${tally.other ? ` / ${tally.other} other` : ''} ` +
    `(${own.length} of its own, ${shared.length} shared with every lane)`
);
// A failing row carries its reason on the RECEIVER that did not see the change,
// not on the row — printing the row alone gave a line of ids and no cause.
const reasonFor = (r) => {
  const bad = (r.observations ?? []).find((o) => o.status !== 'pass');
  const reason = r.error ?? bad?.visibleError ?? bad?.error ?? bad?.why ?? '';
  const where = bad?.receiver ? `${bad.receiver}: ` : '';
  return `${where}${String(reason).split('\n')[0].slice(0, 160)}`;
};
for (const r of mine.filter((x) => x.status === 'fail').slice(0, 20)) {
  console.log(`  FAIL ${r.id}${r.direction ? ` · ${r.direction}` : ''} — ${reasonFor(r)}`);
}

if (own.length === 0) {
  console.error(`lane ${lane} executed no rows of its own — that is not a pass`);
  process.exit(1);
}
process.exit(tally.fail > 0 ? 1 : 0);
