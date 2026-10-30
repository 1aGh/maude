// Wave B integration guard — an unbound name in app.jsx passes tsc (the file is not type-checked as TS),
// the pin tests and the empty-project boot check, and only throws when its code path runs: ⌘⇧E crashed the
// whole shell on `printGuidesVisible`, and `ds.go-to` on an unconverted system would have on `openSystem`.
// Biome's noUndeclaredVariables sees both statically, so it is the gate for the shell files.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const FILES = ['client/app.jsx'];

describe('app.jsx names every variable it uses', () => {
  test('biome noUndeclaredVariables finds nothing', () => {
    const r = Bun.spawnSync(
      [
        'bunx',
        'biome',
        'lint',
        '--only=correctness/noUndeclaredVariables',
        '--max-diagnostics=50',
        ...FILES,
      ],
      { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' }
    );
    const out = `${r.stdout.toString()}\n${r.stderr.toString()}`;
    const hits = out.match(/The \S+ variable is undeclared/g) ?? [];
    expect(hits).toEqual([]);
    expect(r.exitCode).toBe(0);
  });
});
