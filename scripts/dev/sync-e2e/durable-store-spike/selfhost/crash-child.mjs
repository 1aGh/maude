import { Store } from './sqlite-store.mjs';

const [directory, stage, operationJson] = process.argv.slice(2);
const operation = JSON.parse(operationJson);
operation.payload = Buffer.from(operation.payload);
const store = new Store(directory);

// Block synchronously only AFTER a synchronous marker write to inherited fd 4.
import { writeSync } from 'node:fs';

function stopAt(name) {
  if (name !== stage) return;
  writeSync(4, JSON.stringify({ checkpoint: name }) + '\n');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
const result = store.append(operation, stopAt);
if (stage === 'after-ack') {
  writeSync(4, JSON.stringify({ ack: result }) + '\n');
  stopAt('after-ack');
}
store.close();
