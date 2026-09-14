import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
function findRepo(start) {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'apps/hub/package.json'))) return dir;
    if (dirname(dir) === dir) return null;
  }
}
export const repo = process.env.MAUDE_REPO
  ? resolve(process.env.MAUDE_REPO)
  : findRepo(dirname(fileURLToPath(import.meta.url))) || findRepo(process.cwd());
if (!repo) throw new Error('Set MAUDE_REPO to the Maude checkout root');
if (process.versions.node.split('.')[0] !== '24')
  throw new Error('T7 spike requires explicit Node 24; set MAUDE_NODE24 for run.sh');
const hub = createRequire(join(repo, 'apps/hub/package.json'));
const server = createRequire(hub.resolve('@hocuspocus/server'));
export const Y = hub('yjs');
export const { Server } = hub('@hocuspocus/server');
export const { HocuspocusProvider } = hub('@hocuspocus/provider');
export const encoding = server('lib0/encoding');
export const decoding = server('lib0/decoding');
export const { sourceError } = await import(
  pathToFileURL(join(repo, 'apps/studio/sync/source-validation.ts'))
);
export const versions = Object.fromEntries(
  ['@hocuspocus/server', '@hocuspocus/provider', 'yjs'].map((name) => {
    const entry = hub.resolve(name);
    let dir = join(entry, '..');
    for (let i = 0; i < 5; i++, dir = join(dir, '..')) {
      try {
        const p = hub(join(dir, 'package.json'));
        if (p.name === name) return [name, p.version];
      } catch {}
    }
    throw new Error(`Missing version for ${name}`);
  })
);
