// Internal shim behind ds-check.sh (`maude design ds-check`). See ds-check.sh for usage.
import { runDsCheck } from '../ds/cli.ts';

const argv = process.argv.slice(2);
const hook = argv.includes('--hook');
if (hook) {
  // PostToolUse mode never blocks the agent: whatever happens, exit 0 within 8 s.
  setTimeout(() => process.exit(0), 8000).unref();
  process.on('uncaughtException', () => process.exit(0));
}
let hookInput = null;
if (hook && !argv.includes('--canvas') && !process.stdin.isTTY) {
  try {
    hookInput = await Promise.race([
      Bun.stdin.text(),
      new Promise((res) => setTimeout(() => res(null), 1000)),
    ]);
  } catch {
    hookInput = null;
  }
}
const r = runDsCheck(argv, process.env, hookInput);
// await the write: a large --json report piped to another process is truncated by an early exit
if (r.stdout) await new Promise((res) => process.stdout.write(r.stdout, res));
if (r.stderr && !hook) process.stderr.write(r.stderr);
process.exit(hook ? 0 : r.code);
