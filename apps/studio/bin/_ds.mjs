// Internal shim behind ds.sh (`maude design ds`). See ds/ds-verb.ts.
import { DS_USAGE, DsUsageError, execDsPlan, planDsVerb } from '../ds/ds-verb.ts';
import { projectRoot, studioFor, untrustedJson, writeUntrusted } from './_studio-verb.mjs';

const words = process.argv.slice(2);
if (words.includes('--help') || words.includes('-h')) {
  process.stdout.write(DS_USAGE);
  process.exit(0);
}
let plan;
try {
  plan = planDsVerb(words);
} catch (e) {
  if (e instanceof DsUsageError) {
    process.stderr.write(`maude design ds: ${e.message}\n${DS_USAGE}`);
    process.exit(2);
  }
  throw e;
}
const root = projectRoot(plan.root);
if (!root) {
  process.stderr.write(
    'maude design ds: no .design/config.json here or above — run it inside a Maude project\n'
  );
  process.exit(2);
}
const studio = await studioFor(root);
const a = await execDsPlan(plan, { root, studio });
const write = (s) => new Promise((res) => process.stdout.write(s, res));
if (a.text !== undefined) await write(a.text.endsWith('\n') ? a.text : `${a.text}\n`);
else if (a.status !== 200) {
  const b = a.body ?? {};
  if (plan.json) await write(`${JSON.stringify(b, null, 2)}\n`);
  process.stderr.write(`maude design ds: ${b.error ?? 'refused'} (${b.code ?? a.status})\n`);
  process.exit(b.code === 'ds-kernel-unavailable' && !studio ? 3 : 1);
} else if (plan.read) {
  // labels, value names and people's names are other people's text
  if (plan.json) await write(`${JSON.stringify(untrustedJson(a.body), null, 2)}\n`);
  else writeUntrusted(JSON.stringify(a.body, null, 2));
} else await write(`${JSON.stringify(a.body, null, plan.json ? 2 : 0)}\n`);
process.exit(0);
