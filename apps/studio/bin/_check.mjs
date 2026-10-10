// Internal shim behind check.sh (`maude design check`). See check.sh for usage.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { checkFile, formatFindings } from '../check/index.ts';

const argv = process.argv.slice(2);
const files = [];
let json = false;
let strict = false;
let tier = 'fast';
let against;
let rootArg;
const usage = (msg) => {
  process.stderr.write(
    `maude design check: ${msg}\nusage: maude design check <file…> [--json] [--strict] [--tier fast|stop] [--against <snapshot>]\n`
  );
  process.exit(2);
};
for (let i = 0; i < argv.length; i++) {
  const w = argv[i];
  const [flag, inline] = w.startsWith('--') ? w.split(/=(.*)/s) : [w];
  const value = () => (inline !== undefined ? inline : argv[++i]);
  if (flag === '--json') json = true;
  else if (flag === '--strict') strict = true;
  else if (flag === '--tier') tier = value();
  else if (flag === '--against') against = value();
  else if (flag === '--root') rootArg = value();
  else if (flag.startsWith('--')) usage(`unknown flag ${flag}`);
  else files.push(w);
}
if (!files.length) usage('name at least one file');
if (tier !== 'fast' && tier !== 'stop') usage('--tier is fast or stop');
if (against !== undefined && files.length !== 1) usage('--against goes with one file');

function projectRoot(start) {
  let cur = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(cur, '.design', 'config.json'))) return cur;
    const up = path.dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}
const root = rootArg
  ? path.resolve(rootArg)
  : projectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const designRoot = root ? path.join(root, '.design') : null;

/** designRoot-relative POSIX, or null when outside it (not checked). */
function relOf(f) {
  if (!designRoot) return null;
  const abs = path.isAbsolute(f)
    ? f
    : f.startsWith('.design/')
      ? path.join(root, f)
      : existsSync(path.resolve(f)) && path.resolve(f).startsWith(designRoot + path.sep)
        ? path.resolve(f)
        : path.join(designRoot, f);
  const rel = path.relative(designRoot, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return { rel: rel.split(path.sep).join('/'), abs };
}

let againstText = null;
if (against !== undefined) {
  try {
    againstText = readFileSync(against, 'utf8');
  } catch {
    usage(`cannot read --against ${against}`);
  }
}

const results = [];
for (const f of files) {
  const r = relOf(f);
  if (!r) {
    results.push({ file: f, kind: 'skip', ok: true, ms: 0, errors: [], warnings: [], infos: [] });
    continue;
  }
  let text;
  try {
    text = readFileSync(r.abs, 'utf8');
  } catch {
    usage(`cannot read ${f}`);
  }
  results.push(checkFile(r.rel, text, { against: againstText, tier, strict }));
}

const bad = results.some((r) => !r.ok);
if (json) process.stdout.write(`${JSON.stringify(results)}\n`);
else {
  const lines = formatFindings(results);
  if (lines) process.stdout.write(`${lines}\n`);
  const checked = results.filter((r) => r.kind !== 'skip').length;
  process.stdout.write(
    bad
      ? `✗ ${results.filter((r) => !r.ok).length} of ${checked} file(s) have errors\n`
      : `✓ ${checked} file(s) ok\n`
  );
}
process.exit(bad ? 1 : 0);
