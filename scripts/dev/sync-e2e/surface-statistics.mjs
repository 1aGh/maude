// Statistics for one run/profile. Missing/failed/duplicate samples never
// disappear into an optimistic percentile of only the successful observations.
export function surfaceStatistics(
  rows,
  { expectedSamples, driverFailed = false, invalidatedSamples = [] } = {}
) {
  const invalid = new Set(
    invalidatedSamples.map((s) => [s.id, s.direction, s.receiver, s.sample].join(':'))
  );
  const receivers = Object.keys(rows.find((r) => r.id === 'bootstrap.participants')?.roots ?? {});
  const groups = new Map();
  for (const row of rows) {
    if (!Number.isInteger(row.sample) || row.status === 'not-run') continue;
    const observations = receivers.length
      ? receivers.map(
          (receiver) =>
            row.observations?.find((o) => o.receiver === receiver) ?? { receiver, status: 'fail' }
        )
      : (row.observations ?? []);
    for (const observation of observations) {
      const key = [row.id, row.direction, observation.receiver].join(':');
      const group = groups.get(key) ?? {
        id: row.id,
        direction: row.direction,
        receiver: observation.receiver,
        samples: [],
        seen: new Set(),
        duplicates: 0,
      };
      if (group.seen.has(row.sample)) group.duplicates++;
      group.seen.add(row.sample);
      group.samples.push(
        invalid.has(`${key}:${row.sample}`)
          ? { ...observation, status: 'fail', finalSourceMismatch: true }
          : observation
      );
      groups.set(key, group);
    }
  }
  const summarize = (group, field) => {
    const complete =
      !driverFailed &&
      (!expectedSamples ||
        (group.seen.size === expectedSamples &&
          Array.from({ length: expectedSamples }, (_, i) => i + 1).every((n) =>
            group.seen.has(n)
          ))) &&
      group.duplicates === 0 &&
      group.samples.every((s) => s.status === 'pass' && Number.isFinite(s[field]) && s[field] >= 0);
    const values = group.samples
      .map((s) => s[field])
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const quantile = (q) => values[Math.ceil(q * values.length) - 1] ?? null;
    return {
      measured: values.length,
      complete,
      p50Ms: complete ? quantile(0.5) : null,
      p95Ms: complete && values.length >= 100 ? quantile(0.95) : null,
      p99Ms: complete && values.length >= 1000 ? quantile(0.99) : null,
      minMs: complete ? (values[0] ?? null) : null,
      maxMs: complete ? (values.at(-1) ?? null) : null,
    };
  };
  return {
    version: 1,
    baselineComplete: false,
    observerCalibrated: false,
    expectedSamples: expectedSamples ?? null,
    driverFailed,
    note: 'One profile/run only. Three matched passes, observer calibration and all other surface gates remain required.',
    groups: [...groups.values()].map((g) => ({
      id: g.id,
      direction: g.direction,
      receiver: g.receiver,
      count: g.samples.length,
      uniqueSamples: g.seen.size,
      duplicateSamples: g.duplicates,
      missingSamples: expectedSamples
        ? Array.from({ length: expectedSamples }, (_, i) => i + 1).filter((n) => !g.seen.has(n))
        : null,
      failures: g.samples.filter((s) => s.status !== 'pass').length,
      finalSourceMismatches: g.samples.filter((s) => s.finalSourceMismatch).length,
      rendered: summarize(g, 'observedMs'),
      persisted: summarize(g, 'persistedMs'),
    })),
  };
}
