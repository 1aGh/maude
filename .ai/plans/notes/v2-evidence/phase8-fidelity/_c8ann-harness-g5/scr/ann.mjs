// Seed a project's whiteboard through the real verb: `maude design annotate`.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './lib.mjs';

export function annotate(project, rel, ops, extra = []) {
  const f = join(project, '.design', '_ops-' + Date.now() + '.json');
  writeFileSync(f, JSON.stringify({ ops }));
  const r = spawnSync('node', [join(REPO, 'cli/bin/maude.mjs'), 'design', 'annotate', rel, '--ops', f, '--root', project, ...extra], {
    encoding: 'utf8',
    env: { ...process.env, NO_OPEN: '1' },
  });
  if (r.status !== 0) console.log('annotate failed', rel, r.status, (r.stdout || '').slice(0, 600), (r.stderr || '').slice(0, 600));
  return r;
}
