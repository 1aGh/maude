// S12.16 live: a `claude -p` that refuses to start (not signed in) is a lane failure, not a grade.
// The first live run graded 11 journeys of "0 tool calls" because the refusal carried no `error`.
import { expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error - plain .mjs
import { runTerminal } from './lanes/terminal.mjs';

test('a not-signed-in claude is reported as a lane error and ends the journey', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maude-auth-refusal-'));
  const stub = join(dir, 'claude');
  const result = {
    type: 'result',
    subtype: 'success',
    is_error: true,
    result: 'Not logged in · Please run /login',
    total_cost_usd: 0,
    num_turns: 1,
  };
  writeFileSync(stub, `#!/bin/sh\necho '${JSON.stringify(result)}'\n`);
  chmodSync(stub, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}:${oldPath}`;
  try {
    const plan = {
      env: { ...process.env },
      turns: [
        { args: ['-p', 'one'], cwd: dir },
        { args: ['-p', 'two'], cwd: dir },
      ],
    };
    const turns = await runTerminal(plan, dir, { timeoutMin: 1 });
    expect(turns).toHaveLength(1); // the second turn never ran
    expect(turns[0].ok).toBe(false);
    expect(turns[0].error).toMatch(/Not logged in/);
  } finally {
    process.env.PATH = oldPath;
  }
});
