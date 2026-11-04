// mem-probe.ts — a diagnostic --preload for the studio server (issue #204), never shipped.
//
//   bun --preload scripts/lib/mem-probe.ts apps/studio/server.ts …
//   (or: node scripts/bench-first-sync-mem.mjs … --preload scripts/lib/mem-probe.ts)
//
// Every MAUDE_PROBE_INTERVAL_MS (default 5000) it appends one JSON line to MAUDE_PROBE_OUT
// (default: stderr) with what `process.memoryUsage()` and `bun:jsc` `heapStats()` see: rss, the
// JSC heap, the off-heap "extra memory" JSC accounts for (ArrayBuffer backing stores, strings) and
// the ten most numerous object types. MAUDE_PROBE_SNAPSHOT_AT="60,300" also takes a heap snapshot
// (`Bun.generateHeapSnapshot`) at those seconds and writes `<MAUDE_PROBE_OUT>.<s>s.summary.json`:
// bytes per class and the largest objects with the owner chain that keeps each alive
// (MAUDE_PROBE_RAW=1 keeps the raw snapshot too).
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
      if (!out) continue;
      const snap = Bun.generateHeapSnapshot() as unknown as Snapshot;
      writeFileSync(`${out}.${at}s.summary.json`, JSON.stringify(summarizeSnapshot(snap), null, 1));
      if (process.env.MAUDE_PROBE_RAW === '1')
        writeFileSync(`${out}.${at}s.heapsnapshot`, JSON.stringify(snap));
    }
  }
}

/** SIGUSR2: snapshot now (the bench sends it once the sync has settled, before it stops the
 *  server) → `<MAUDE_PROBE_OUT>.final.summary.json`. */
process.on('SIGUSR2', () => {
  if (!out) return;
  const snap = Bun.generateHeapSnapshot() as unknown as Snapshot;
  writeFileSync(`${out}.final.summary.json`, JSON.stringify(summarizeSnapshot(snap), null, 1));
});

const timer = setInterval(sample, every);
(timer as unknown as { unref?: () => void }).unref?.();

interface Snapshot {
  nodes: number[];
  nodeClassNames: string[];
  edges: number[];
  edgeTypes: string[];
  edgeNames: string[];
}

/**
 * What holds the heap, from a JSC snapshot (`Bun.generateHeapSnapshot`, Inspector v3: nodes are
 * [id, size, classIndex, flags], edges [from, to, typeIndex, nameOrIndex]): the bytes per class,
 * and the largest objects with the chain of owners that keeps each alive (first owner per level).
 * Sizes are JSC's own (a string counts its length, not its 16-bit backing).
 */
export function summarizeSnapshot(s: Snapshot, topN = 25, depth = 6) {
  const n = s.nodes;
  const byClass = new Map<string, { bytes: number; count: number }>();
  const sizeOf = new Map<number, number>();
  const classOf = new Map<number, string>();
  const big: [number, number][] = [];
  for (let i = 0; i < n.length; i += 4) {
    const id = n[i] as number;
    const size = n[i + 1] as number;
    const cls = s.nodeClassNames[n[i + 2] as number] ?? '?';
    sizeOf.set(id, size);
    classOf.set(id, cls);
    const row = byClass.get(cls) ?? { bytes: 0, count: 0 };
    row.bytes += size;
    row.count += 1;
    byClass.set(cls, row);
    big.push([size, id]);
  }
  big.sort((a, b) => b[0] - a[0]);
  const owner = new Map<number, [number, string]>();
  const e = s.edges;
  for (let i = 0; i < e.length; i += 4) {
    const to = e[i + 1] as number;
    if (owner.has(to)) continue;
    const type = s.edgeTypes[e[i + 2] as number] ?? '';
    const raw = e[i + 3] as number;
    const name =
      type === 'Index'
        ? `[${raw}]`
        : type === 'Internal'
          ? '(internal)'
          : (s.edgeNames[raw] ?? '?');
    owner.set(to, [e[i] as number, name]);
  }
  const chainOf = (id: number) => {
    const chain: string[] = [];
    let cur = id;
    for (let d = 0; d < depth; d++) {
      const o = owner.get(cur);
      if (!o) break;
      chain.push(`${o[1]} ← ${classOf.get(o[0])}`);
      cur = o[0];
    }
    return chain;
  };
  return {
    totalMB: Math.round([...byClass.values()].reduce((a, r) => a + r.bytes, 0) / 1048576),
    byClass: [...byClass.entries()]
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .slice(0, 15)
      .map(([cls, r]) => ({ cls, mb: +(r.bytes / 1048576).toFixed(1), count: r.count })),
    largest: big.slice(0, topN).map(([size, id]) => ({
      kb: Math.round(size / 1024),
      cls: classOf.get(id),
      chain: chainOf(id),
    })),
  };
}
