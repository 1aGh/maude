import { createHash } from 'node:crypto';
import { sourceError } from './dist/source-validator.mjs';

process.once('message', ({ file, body }) => {
  try {
    const start = performance.now();
    const error = sourceError(file, body);
    process.send(
      {
        valid: error === null,
        error,
        sha256: createHash('sha256').update(body).digest('hex'),
        validationMs: performance.now() - start,
        cwd: process.cwd(),
        executed: !!globalThis.__T8_EXECUTED,
      },
      () => process.exit(0)
    );
  } catch {
    process.send({ valid: false, error: 'validator-error' }, () => process.exit(1));
  }
});
