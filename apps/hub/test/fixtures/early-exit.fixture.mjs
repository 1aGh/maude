// A test file that exits with code 0 part-way through — the shape that once
// hid six hub tests from the totals. Run only by early-exit-guard.test.mjs.
import { describe, it } from 'node:test';

describe('before the exit', () => {
  it('runs', () => {});
  it('ends the process quietly', () => {
    setTimeout(() => process.exit(0), 0);
  });
});
describe('after the exit', () => {
  it('never reports', async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
});
