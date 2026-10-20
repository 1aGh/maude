// Internal shim behind ds-upgrade.sh (`maude design ds-upgrade`). See ds-upgrade.sh for usage.
import { runDsUpgradeAsync } from '../ds/upgrade-cli.ts';
import { projectRoot, studioFor } from './_studio-verb.mjs';

const argv = process.argv.slice(2);
// --apply is one action in the project's studio; every other step runs here
const rootAt = argv.indexOf('--root');
const root = argv.includes('--apply') ? projectRoot(rootAt >= 0 ? argv[rootAt + 1] : null) : null;
const studio = root ? await studioFor(root) : null;
const r = await runDsUpgradeAsync(argv, process.env, { studio });
// await the write: a large --json report piped to another process is truncated by an early exit
if (r.stdout) await new Promise((res) => process.stdout.write(r.stdout, res));
if (r.stderr) process.stderr.write(r.stderr);
process.exit(r.code);
