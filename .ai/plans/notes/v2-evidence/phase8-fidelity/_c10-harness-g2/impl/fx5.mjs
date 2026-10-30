// Fixtures for the G5 impl shots: two designer's projects on the maude-v2 system, as the boards tell them —
// "Studio site" (Homepage) and "Alligators brand" (Combine-kampan), plus a long club page.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './lib.mjs';

const CACHE = join(REPO, '.scr/fx-cache');
const CANV = join(import.meta.dirname, 'fx5-canvases');

const FILE = { Landing: 'Landing', Pricing: 'Pricing', Homepage: 'Homepage', 'Combine-kampan': 'Alligators', 'Klub-web': 'ClubPage' };

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
  for (const s of systems) cpSync(join(REPO, '.design/system', s), join(d, '.design/system', s), { recursive: true });
  for (const c of canvases) cpSync(join(CANV, FILE[c] + '.tsx'), join(d, '.design/ui', c + '.tsx'));
  return d;
}

export const studioSite = async () => makeSite({ key: 'studio', canvases: ['Homepage'], name: 'Studio site' });
export const gators = async () => makeSite({ key: 'gators', canvases: ['Combine-kampan', 'Klub-web'], name: 'Alligators brand' });
