// The project menu as the action registry declares it (apps/studio/actions/menu.ts), so the report can
// say which registry rows the crawl reached and which it never saw (hidden by `when` in the fixture's
// state, or missing from the DOM).
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { STUDIO } from './rig.mjs';

export function registryMenu() {
  // Absolute specifiers: the snippet runs under `bun -e`, and a relative `from './…'` here reads to
  // scripts/check-import-coherence.sh as an import of THIS file (a missing scripts/…/actions/menu.ts).
  const src = `import { ACTIONS_BY_ID } from '${join(STUDIO, 'actions/index.ts')}';
import { menuPaths } from '${join(STUDIO, 'actions/menu.ts')}';
const out = [];
for (const [id, paths] of menuPaths(ACTIONS_BY_ID)) out.push({ id, path: paths[0].path, advanced: paths[0].advanced });
console.log(JSON.stringify(out));`;
  const r = spawnSync('bun', ['-e', src], {
    cwd: STUDIO,
    encoding: 'utf8',
    env: { ...process.env, NO_OPEN: '1' },
  });
  try {
    return JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    return [];
  }
}
