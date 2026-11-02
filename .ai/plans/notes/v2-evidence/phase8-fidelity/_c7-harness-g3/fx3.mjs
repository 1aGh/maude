import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO } from './lib.mjs';
import { BASE } from './fx.mjs';

const CACHE = join(REPO, '.scr/fx-cache');

/** The e2e fixture + the Alligators assets / trailer canvases from this repo's own .design + the Matchday mixed-kind canvas. APFS clones (cp -c) so it is cheap. */
export async function alli() {
  const d = join(CACHE, 'alli');
  if (existsSync(join(d, '.design/ui/Matchday.tsx'))) return d;
  rmSync(d, { recursive: true, force: true });
  mkdirSync(CACHE, { recursive: true });
  execFileSync('cp', ['-Rc', BASE, d]);
  const src = join(REPO, '.design');
  mkdirSync(join(d, '.design/assets'), { recursive: true });
  execFileSync('/bin/sh', ['-c', `cp -Rc "${src}/assets/." "${d}/.design/assets/"`]);
  for (const f of ['Alligators Recruiting Trailer.tsx', 'Alligators Recruiting Trailer.meta.json', 'Alligators Cinematic Cut.tsx', 'Alligators Cinematic Cut.meta.json'])
    if (existsSync(join(src, 'ui', f))) cpSync(join(src, 'ui', f), join(d, '.design/ui', f));
  cpSync(join(src, 'alligators-reel.edl.json'), join(d, '.design/alligators-reel.edl.json'));
  cpSync(join(REPO, '.scr/Matchday.tsx'), join(d, '.design/ui/Matchday.tsx'));
  writeFileSync(join(d, '.design/ui/Matchday.meta.json'), JSON.stringify({ designSystem: 'Alligators' }, null, 2));
  return d;
}
