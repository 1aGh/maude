import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

// Execute the actual exit handler, not a second implementation of its policy.
// Keep the scratch directory, and replace only process exit + log sinks.
const source = readFileSync(new URL('./local-cell.mjs', import.meta.url), 'utf8');
const start = source.indexOf("  hub.on('exit',");
const end = source.indexOf('\n  });', start);
assert.ok(start >= 0 && end > start, 'local-cell exit handler must be found');
const handler = source.slice(start, end + '\n  });'.length);
for (const [code, signal, expected] of [
  [0, null, 0],
  [7, null, 7],
  [null, 'SIGKILL', 1],
]) {
  test(`hub exit code=${code} signal=${signal} is reported honestly`, () => {
    const hub = new EventEmitter();
    const lines = [];
    let status;
    runInNewContext(handler, {
      hub,
      keep: true,
      line: (text) => lines.push(text),
      process: {
        exit: (value) => {
          status = value;
        },
      },
    });
    hub.emit('exit', code, signal);
    assert.equal(status, expected);
    assert.match(lines[0], new RegExp(`code=${code} signal=${signal ?? 'none'}`));
  });
}
