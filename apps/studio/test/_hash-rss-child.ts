// Child process for sync-file-plane-responsive.test.ts: hash one file the way the file plane does and report how far
// THIS process's RSS rose while it did. A fresh process so the figure is the hashing's alone - inside the suite's
// process, RSS also moves with every other test's garbage and the allocator's page returns, which made the same
// assertion fail once under full-suite load (mini, 2026-11) while it passed alone.
import { hashFileStreamed } from '../sync/file-plane.ts';

const abs = process.argv[2];
if (!abs) throw new Error('usage: _hash-rss-child.ts <file>');

Bun.gc(true);
const before = process.memoryUsage().rss;
let peak = before;
const tick = setInterval(() => {
  peak = Math.max(peak, process.memoryUsage().rss);
}, 2);
const sha = await hashFileStreamed(abs);
clearInterval(tick);
peak = Math.max(peak, process.memoryUsage().rss);
console.log(JSON.stringify({ sha, riseBytes: peak - before }));
