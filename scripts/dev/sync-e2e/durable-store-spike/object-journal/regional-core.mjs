import assert from 'node:assert/strict';
import { proposal } from './fixture-proposal.mjs';
import { ObjectJournal } from './journal.mjs';

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    minMs: sorted[0],
    medianMs: sorted[Math.floor(sorted.length / 2)],
    sampleP95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
  };
}
export async function regionalProbe({ cfg, prefix, samples = 20, sizes = [1024, 65536] }) {
  assert.match(prefix, /^maude-sync-conformance\/[a-f0-9-]{36}$/);
  assert.ok(Number.isInteger(samples) && samples >= 2 && samples <= 20);
  assert.ok(
    Array.isArray(sizes) && sizes.length <= 2 && sizes.every((n) => n === 1024 || n === 65536)
  );
  const results = [];
  for (const size of sizes) {
    const project = `regional-${size}`;
    const journal = new ObjectJournal({ cfg, prefix, project, maxEntries: 8 });
    await journal.initialize();
    let head = (await journal.read()).head;
    const requests = [];
    for (const method of ['get', 'put']) {
      const call = journal[method].bind(journal);
      journal[method] = async (...args) => {
        const started = performance.now();
        try {
          return await call(...args);
        } finally {
          requests.push({ method, ms: performance.now() - started });
        }
      };
    }
    const records = [],
      measurements = [],
      snapshots = [];
    for (let i = 0; i < samples; i++) {
      const raw = proposal(project, `tx-${i}`, {
        revision: head.revision,
        manifest: head.manifest,
        value: 'x'.repeat(size),
      });
      requests.length = 0;
      const started = performance.now();
      const accepted = await journal.append('regional-actor', raw);
      const ms = performance.now() - started;
      assert.equal(accepted.status, 'accepted');
      assert.equal(accepted.revision, i + 1);
      assert.equal(requests.filter((r) => r.method === 'put').length, 2);
      assert.ok(requests.filter((r) => r.method === 'get').length <= 2);
      measurements.push({
        ms,
        get: requests.filter((r) => r.method === 'get').length,
        put: requests.filter((r) => r.method === 'put').length,
        ioMs: requests.reduce((n, r) => n + r.ms, 0),
      });
      records.push({ raw, result: accepted });
      head = { ...head, revision: accepted.revision, manifest: accepted.manifestHash };
      if (i % 5 === 4 || i === samples - 1) {
        requests.length = 0;
        const started = performance.now();
        assert.equal((await journal.snapshot()).status, 'snapshot');
        snapshots.push({
          ms: performance.now() - started,
          gets: requests.filter((r) => r.method === 'get').length,
          puts: requests.filter((r) => r.method === 'put').length,
        });
      }
    }
    const cold = new ObjectJournal({ cfg, prefix, project, maxEntries: 8 });
    let started = performance.now();
    const restored = await cold.read();
    const coldMs = performance.now() - started;
    assert.equal(restored.head.revision, samples);
    assert.equal(restored.documents.get('["doc-1",1]'), 'x'.repeat(size));
    started = performance.now();
    assert.deepEqual(await cold.append('regional-actor', records[0].raw), records[0].result);
    const retainedMs = performance.now() - started;
    results.push({
      size,
      samples: measurements,
      summary: summary(measurements.map((m) => m.ms)),
      snapshots,
      coldStateMs: coldMs,
      retainedResultMs: retainedMs,
      revision: restored.head.revision,
      cacheBytes: journal.cacheSize,
    });
  }
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    status: 'passed',
    results,
    rssBytes: process.memoryUsage().rss,
    scope:
      'Synthetic source-text storage coordinator. Includes strict wire/schema, receipt/index/cache and S3 commit; excludes TSX parser, client RTT, publication and peer render. Sample percentiles are descriptive, not qualified product SLO.',
  };
}
