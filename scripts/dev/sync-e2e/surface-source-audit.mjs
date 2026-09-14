// Run under Bun after the UI driver exits. Parsing is independent of TSX byte
// equality: valid old source is still a lost edit, not a syntax success for sync.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = (b) => createHash('sha256').update(b).digest('hex');
export function auditSources(out, roots = {}) {
  const Transpiler = globalThis.Bun?.Transpiler;
  if (!Transpiler) throw new Error('Source syntax audit must run under Bun');
  const parser = new Transpiler({ loader: 'tsx' });
  const files = [];
  for (const name of readdirSync(out)) if (name.endsWith('.tsx')) files.push(join(out, name));
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith('_') || entry.name.startsWith('.'))
        continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.tsx')) files.push(path);
    }
  };
  for (const root of Object.values(roots)) walk(join(root, '.design'));
  const syntax = files.sort().map((path) => {
    const bytes = readFileSync(path);
    try {
      parser.transformSync(bytes.toString('utf8'));
      return { path, sha256: sha(bytes), status: 'pass' };
    } catch (error) {
      return { path, sha256: sha(bytes), status: 'fail', error: String(error) };
    }
  });
  const comparisons = [];
  for (const expected of readdirSync(out)
    .filter((name) => name.endsWith('-expected.tsx'))
    .sort()) {
    const prefix = expected.replace(/-expected\.tsx$/, '');
    const expectedSha256 = sha(readFileSync(join(out, expected)));
    for (const receiver of ['hub', 'native', 'peer']) {
      const path = join(out, `${prefix}-${receiver}.tsx`);
      const actualSha256 = existsSync(path) ? sha(readFileSync(path)) : null;
      comparisons.push({
        step: prefix,
        receiver,
        expectedSha256,
        actualSha256,
        status:
          actualSha256 === null
            ? 'missing'
            : actualSha256 === expectedSha256
              ? 'match'
              : 'mismatch',
      });
    }
  }
  return {
    version: 1,
    baselineComplete: false,
    note: 'Bun TSX parse and exact final snapshot comparison only. Does not certify imports, runtime rendering, history, or fresh-client recovery.',
    bunVersion: globalThis.Bun.version,
    syntax,
    comparisons,
    counts: {
      parsed: syntax.length,
      syntaxFailures: syntax.filter((r) => r.status === 'fail').length,
      compared: comparisons.length,
      mismatched: comparisons.filter((r) => r.status === 'mismatch').length,
      missing: comparisons.filter((r) => r.status === 'missing').length,
    },
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2]);
  const config = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : {};
  const report = auditSources(out, config.roots);
  writeFileSync(join(out, 'source-audit.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.counts));
  if (report.counts.syntaxFailures) process.exitCode = 1;
}
