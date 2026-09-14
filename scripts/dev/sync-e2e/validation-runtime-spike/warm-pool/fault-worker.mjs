// Fixture-only fault injection wrapper; production pool worker has no source-triggered fault path.
process.prependListener('message', (job) => {
  if (job.body?.includes('__SPIKE_HANG__')) while (true) {}
  if (job.body?.includes('__SPIKE_CRASH__')) process.exit(23);
  if (job.body?.includes('__SPIKE_WRONG_ID__'))
    process.send({
      type: 'result',
      id: 'another-job',
      hash: job.hash,
      validatorHash: job.validatorHash,
      generation: job.generation,
      valid: true,
      error: null,
      executed: false,
    });
  if (job.body?.includes('__SPIKE_WRONG_HASH__'))
    process.send({
      type: 'result',
      id: job.id,
      hash: '0'.repeat(64),
      validatorHash: job.validatorHash,
      generation: job.generation,
      valid: true,
      error: null,
      executed: false,
    });
});
await import('./worker.mjs');
