import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url));
const out = join(own, 'dist');
mkdirSync(out, { recursive: true });
const result = await Bun.build({
  entrypoints: [join(own, 'regional-entry.mjs')],
  outdir: out,
  naming: 'regional-probe.mjs',
  target: 'node',
  format: 'esm',
  minify: true,
});
if (!result.success) throw new Error(result.logs.map(String).join('\n'));
const bytes = readFileSync(join(out, 'regional-probe.mjs'));
if (bytes.length > 1024 * 1024) throw new Error('probe artifact exceeds 1 MiB');
const manifest = {
  bun: Bun.version,
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
writeFileSync(join(out, 'regional-build.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));
