// Internal shim behind ds-upgrade.sh (`maude design ds-upgrade`). See ds-upgrade.sh for usage.
import { runDsUpgrade } from '../ds/upgrade-cli.ts';

const r = runDsUpgrade(process.argv.slice(2));
// await the write: a large --json report piped to another process is truncated by an early exit
if (r.stdout) await new Promise((res) => process.stdout.write(r.stdout, res));
if (r.stderr) process.stderr.write(r.stderr);
process.exit(r.code);
