import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { join } from 'node:path';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const denied = /(^|\/)(?:\.env(?:\.[^/]*)?|secrets)(\/|$)|\.(?:key|pem)$/;
const version = (command) => {
  try {
    return execFileSync(command, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    return null;
  }
};
export function sourceManifest(root) {
  const relevant =
    /^(apps\/(studio|hub|cells|cloud|desktop)\/|scripts\/dev\/|cli\/|plugins\/design\/templates\/|package\.json$|pnpm-(lock\.yaml|workspace\.yaml)$)/;
  const paths = [
    ...new Set(
      execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: root,
        encoding: 'utf8',
      })
        .split('\0')
        .filter((p) => relevant.test(p) && !denied.test(p))
    ),
  ].sort();
  const files = paths.map((path) => ({
    path,
    sha256:
      existsSync(join(root, path)) && lstatSync(join(root, path)).isFile()
        ? sha(readFileSync(join(root, path)))
        : null,
  }));
  return {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceManifestSha256: sha(JSON.stringify(files)),
    files,
    host: { platform: platform(), release: release(), cpu: cpus()[0]?.model, cores: cpus().length },
    runtime: { node: process.version, bun: version('bun'), pnpm: version('pnpm') },
    collectedAt: new Date().toISOString(),
  };
}
export function treeManifest(root, { skipRuntime = false } = {}) {
  const files = [];
  function walk(dir, prefix = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || denied.test(rel) || (skipRuntime && entry.name.startsWith('_')))
        continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, rel);
      else if (entry.isFile())
        files.push({ path: rel, bytes: lstatSync(path).size, sha256: sha(readFileSync(path)) });
    }
  }
  walk(root);
  return { sha256: sha(JSON.stringify(files)), files };
}
