// agent-evals/lib/realcheck.mjs — the `check` invariant runs the SHIPPED verb, `maude design check`
// (V2-2.4b), the same one the design plugin's PostToolUse / Stop hooks call. Strict, stop tier (the
// superset of the fast tier); `--against` is the run's base — the bytes before the run first touched
// the file (`_runs/<session>/base/…`, written by the hook) — else the fixture's git baseline.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CLI } from '../../agent-journeys/lanes/common.mjs';

/** → { ok, errors: [{code, where?, what?}], warnings } for one designRoot file. */
export function checkFile(project, abs, { against = null } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'agent-eval-check-'));
  try {
    const args = [
      CLI,
      'design',
      'check',
      abs,
      '--strict',
      '--tier',
      'stop',
      '--json',
      '--root',
      project,
    ];
    if (against !== null && against !== undefined) {
      const snap = join(tmp, 'against');
      writeFileSync(snap, against);
      args.push('--against', snap);
    }
    const r = spawnSync('node', args, {
      env: { ...process.env, NO_OPEN: '1', MAUDE_NO_UPDATE_CHECK: '1' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    let rows = null;
    try {
      rows = JSON.parse(r.stdout);
    } catch {}
    if (!Array.isArray(rows) || !rows.length)
      return {
        ok: false,
        errors: [{ code: 'check-did-not-run', what: String(r.stderr || r.stdout).slice(0, 200) }],
        warnings: [],
      };
    const row = rows[0];
    return { ok: !!row.ok, errors: row.errors ?? [], warnings: row.warnings ?? [] };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
