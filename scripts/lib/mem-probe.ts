// mem-probe.ts — a diagnostic --preload for the studio server (issue #204), never shipped.
//
//   bun --preload scripts/lib/mem-probe.ts apps/studio/server.ts …
//   (or: node scripts/bench-first-sync-mem.mjs … --preload scripts/lib/mem-probe.ts)
//
// Every MAUDE_PROBE_INTERVAL_MS (default 5000) it appends one JSON line to MAUDE_PROBE_OUT
// (default: stderr) with what `process.memoryUsage()` and `bun:jsc` `heapStats()` see: rss, the
// JSC heap, the off-heap "extra memory" JSC accounts for (ArrayBuffer backing stores, strings) and
// the ten most numerous object types. MAUDE_PROBE_SNAPSHOT_AT="60,300" also writes a heap snapshot
// (`Bun.generateHeapSnapshot`) at those seconds, next to MAUDE_PROBE_OUT.
//
// rss − (heapSize + extraMemorySize) is the part JSC does not know about: native allocations
// (sqlite, zlib, Bun's own buffers) and allocator pages it has not returned.

import { heapStats } from 'bun:jsc';
import { appendFileSync, writeFileSync } from 'node:fs';

const out = process.env.MAUDE_PROBE_OUT;
const every = Number(process.env.MAUDE_PROBE_INTERVAL_MS) || 5000;
const snapAt = new Set(
  (process.env.MAUDE_PROBE_SNAPSHOT_AT ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
);
const t0 = Date.now();
const mb = (n: number) => Math.round(n / 1048576);

function sample(): void {
  const u = process.memoryUsage();
  const h = heapStats();
  const top = Object.entries(h.objectTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const line = JSON.stringify({
    t: Math.round((Date.now() - t0) / 1000),
    rss: mb(u.rss),
    heapUsed: mb(u.heapUsed),
    external: mb(u.external),
    arrayBuffers: mb(u.arrayBuffers),
    jscHeap: mb(h.heapSize),
    jscCapacity: mb(h.heapCapacity),
    jscExtra: mb(h.extraMemorySize),
    objects: h.objectCount,
    top,
  });
  if (out) appendFileSync(out, `${line}\n`);
  else process.stderr.write(`[mem-probe] ${line}\n`);
  const s = Math.round((Date.now() - t0) / 1000);
  for (const at of snapAt) {
    if (s >= at) {
      snapAt.delete(at);
      if (out)
        writeFileSync(`${out}.${at}s.heapsnapshot`, JSON.stringify(Bun.generateHeapSnapshot()));
    }
  }
}

const timer = setInterval(sample, every);
(timer as unknown as { unref?: () => void }).unref?.();
