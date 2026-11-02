// Internal shim behind ds.sh (`maude design ds`). See ds/ds-verb.ts.
import {
  CHECK_USAGE,
  CheckUsageError,
  checkText,
  execCheckPlan,
  planCheckVerb,
} from '../ds/check-system-verb.ts';
import { DS_USAGE, DsUsageError, execDsPlan, planDsVerb } from '../ds/ds-verb.ts';
import { projectRoot, studioFor, untrustedJson, writeUntrusted } from './_studio-verb.mjs';

const words = process.argv.slice(2);
if (words.includes('--help') || words.includes('-h')) {
  process.stdout.write(
    DS_USAGE.replace(/\nLabels, value names/, `\n${CHECK_USAGE}Labels, value names`)
  );
  process.exit(0);
}
// S10.19 — `check-system` is its own small verb (ds/check-system-verb.ts): the same answer by the route or in-process
if (words.find((w) => !w.startsWith('--')) === 'check-system') {
  let cp;
  try {
    cp = planCheckVerb(words);
  } catch (e) {
    if (e instanceof CheckUsageError) {
      process.stderr.write(`maude design ds: ${e.message}\n${DS_USAGE}${CHECK_USAGE}`);
      process.exit(2);
    }
    throw e;
  }
  const croot = projectRoot(cp.root);
  if (!croot) {
    process.stderr.write(
      'maude design ds: no .design/config.json here or above — run it inside a Maude project\n'
    );
    process.exit(2);
  }
  const ans = await execCheckPlan(cp, { root: croot, studio: await studioFor(croot) });
  const out = (s) => new Promise((res) => process.stdout.write(s, res));
  if (ans.status !== 200) {
    const b = ans.body ?? {};
    if (cp.json) await out(`${JSON.stringify(b, null, 2)}\n`);
    process.stderr.write(`maude design ds: ${b.error ?? 'refused'} (${b.code ?? ans.status})\n`);
    process.exit(1);
  }
  // labels in the lines are other people's text
  if (cp.json) await out(`${JSON.stringify(untrustedJson(ans.body), null, 2)}\n`);
  else writeUntrusted(checkText(ans.body));
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
