// Fixtures for the G5 impl shots: two designer's projects on the maude-v2 system, as the boards tell them —
// "Studio site" (Homepage) and "Alligators brand" (Combine-kampan), plus a long club page.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './lib.mjs';

const CACHE = join(REPO, '.scr/fx-cache');
const CANV = join(REPO, '.scr/fx5/canvases');

const FILE = { Landing: 'Landing', Pricing: 'Pricing', Homepage: 'Homepage', 'Combine-kampan': 'Alligators', 'Klub-web': 'ClubPage' };

// R11: this repo's own .design/system/{maude,maude-v2} are Design system canvases since 88d671dee (`ds convert`), and
// makeSite copies them. The convert / bring-it-up sheets (ds-multi-migrate, ds-edge-migrate, ds-multi-schema) need the
// PRE-convert folder, so strip exactly what that commit added: design-system.{tsx,meta.json}, revisions/, tokens.json
// "source": "canvas" -> "css". (Verified byte for byte against git 88d671dee^ by the R11 builder.)
export function unconvert(systemDir) {
  rmSync(join(systemDir, 'design-system.tsx'), { force: true });
  rmSync(join(systemDir, 'design-system.meta.json'), { force: true });
  rmSync(join(systemDir, 'revisions'), { recursive: true, force: true });
  const tj = join(systemDir, 'tokens.json');
  if (existsSync(tj)) writeFileSync(tj, readFileSync(tj, 'utf8').replace(/"source": "canvas"/g, '"source": "css"'));
}

export function makeSite({ key = 'x', systems = ['maude-v2'], canvases = ['Homepage'], name = 'Studio site' } = {}) {
  const d = join(CACHE, 'site-' + key + '-' + process.pid);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(join(d, '.design/ui'), { recursive: true });
  mkdirSync(join(d, '.design/system'), { recursive: true });
  const cfg = JSON.parse(readFileSync(join(REPO, '.design/config.json'), 'utf8'));
  delete cfg.linkedHub;
  cfg.name = name;
  cfg.designSystems = cfg.designSystems.filter((s) => systems.includes(s.name));
  cfg.defaultDesignSystem = systems[0];
  cfg.canvasGroups = [
    { label: 'Design system', path: 'system' },
    { label: 'UI kit', path: 'ui' },
  ];
  writeFileSync(join(d, '.design/config.json'), JSON.stringify(cfg, null, 2));
  for (const s of systems) {
    cpSync(join(REPO, '.design/system', s), join(d, '.design/system', s), { recursive: true });
    unconvert(join(d, '.design/system', s));
  }
  for (const c of canvases) cpSync(join(CANV, FILE[c] + '.tsx'), join(d, '.design/ui', c + '.tsx'));
  return d;
}

export const studioSite = async () => makeSite({ key: 'studio', canvases: ['Homepage'], name: 'Studio site' });
export const gators = async () => makeSite({ key: 'gators', canvases: ['Combine-kampan', 'Klub-web'], name: 'Alligators brand' });
