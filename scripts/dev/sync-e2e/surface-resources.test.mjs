import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ownedProcesses } from './surface-resources.mjs';

test('resource evidence includes transitive children but excludes unrelated native apps', () => {
  const rows = ` PID PPID %CPU RSS COMM
  22 21 2.5 200 /Applications/Test Browser
  99 1 80.0 9999 /Applications/User App
  20 1 0.1 100 /bin/node
  21 20 4.5 150 /bin/runner
  23 22 1.0 300 /bin/renderer`;
  const owned = ownedProcesses(rows, 20);
  assert.deepEqual(owned.map((p) => p.pid).sort(), [20, 21, 22, 23]);
  assert.equal(owned[0].executable, 'Test Browser');
  assert.equal(
    owned.some((p) => p.pid === 99),
    false
  );
});
