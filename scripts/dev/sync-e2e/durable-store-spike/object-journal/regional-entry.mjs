// Standalone diagnostic: input credentials are consumed only from stdin.
import { regionalProbe } from './regional-core.mjs';

const timer = setTimeout(() => process.exit(124), 120000);
try {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 16384) throw new Error('input-too-large');
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const report = await regionalProbe(input);
  process.stdout.write(JSON.stringify(report) + '\n');
} catch (error) {
  // Do not print input/config objects or child-process errors with credential stdout.
  process.stderr.write(`Regional probe failed: ${error.name}\n`);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
