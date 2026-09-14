import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [validatorFile, generation] = process.argv.slice(2);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const validatorHash = sha(readFileSync(validatorFile));
const { sourceError } = await import(pathToFileURL(validatorFile));
// Ready means actual production parser succeeded and rejected invalid TSX.
if (
  sourceError('canvas.tsx', 'export default ()=> <div/>') !== null ||
  sourceError('canvas.tsx', 'export default ()=> <div>') === null
)
  process.exit(30);
process.on('message', (job) => {
  if (job.type !== 'job') return;
  try {
    const hash = sha(job.body);
    if (job.generation !== generation || job.hash !== hash || job.validatorHash !== validatorHash)
      process.exit(31);
    const started = performance.now();
    const error = sourceError('canvas.tsx', job.body);
    process.send({
      type: 'result',
      id: job.id,
      hash,
      validatorHash,
      generation,
      valid: error === null,
      error,
      parseMs: performance.now() - started,
      executed: !!globalThis.__T8_EXECUTED,
    });
  } catch {
    process.exit(32);
  }
});
process.send({ type: 'ready', generation, validatorHash, pid: process.pid });
