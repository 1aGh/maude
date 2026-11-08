// #168 E3 — a `maude design screenshot` capture is recorded in the design hooks' state OUTSIDE the
// project (cli/lib/hook-state.mjs `shotsPath`), not in `_runs/<session>/shots.jsonl`. The eval harness
// reads (and archives, because the Stop hook deletes the record) the shots from there.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { shotsPath } from '../../../../cli/lib/hook-state.mjs';
import { readRunState } from './lib/runstate.mjs';
import { snapshotRuns } from './lib/trial.mjs';

let tmp = '';
let env: Record<string, string>;
let project = '';

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'runstate-shots-'));
  env = { ...(process.env as Record<string, string>), MAUDE_HOOK_STATE_HOME: join(tmp, 'state') };
  project = join(tmp, 'project');
  mkdirSync(join(project, '.design', '_runs', 's1'), { recursive: true });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const line = { at: 5, canvas: 'ui/C.tsx', artboard: 'hero', all: false, session: 's1' };

test('shots are read from the hook state, not from the project run folder', () => {
  // a planted shots.jsonl in the project is not evidence
  writeFileSync(
    join(project, '.design', '_runs', 's1', 'shots.jsonl'),
    `${JSON.stringify({ ...line, artboard: 'planted' })}\n`
  );
  const p = shotsPath(project, 's1', env) as string;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(line)}\n`);
  const s = readRunState(project, null, env).sessions.find((x: any) => x.name === 's1');
  expect(s.shots.map((x: any) => x.artboard)).toEqual(['hero']);
});

test('snapshotRuns archives the hook-state shots, which outlive the Stop hook', () => {
  const dest = join(tmp, 'runlog');
  snapshotRuns(project, dest, env);
  expect(readFileSync(join(dest, 's1', 'shots.jsonl'), 'utf8').trim()).toBe(JSON.stringify(line));
  // the Stop hook removes both the run folder and the state record; the archive is what is left
  rmSync(join(project, '.design', '_runs', 's1'), { recursive: true });
  rmSync(shotsPath(project, 's1', env) as string);
  const s = readRunState(project, dest, env).sessions.find((x: any) => x.name === 's1');
  expect(s.shots.map((x: any) => x.artboard)).toEqual(['hero']);
});
