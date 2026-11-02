// node mkdesigncopy.mjs → .scr/design-copy1/.design = this repo's maude-v2 system + ui/v2 boards + config.json with ONE design system
// (s11ds7: the board's project has one system). A COPY — the shooting never boots the repo's own .design.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './lib.mjs';

const src = join(REPO, '.design');
const dst = join(REPO, '.scr/design-copy1/.design');
rmSync(join(REPO, '.scr/design-copy1'), { recursive: true, force: true });
mkdirSync(join(dst, 'system'), { recursive: true });
mkdirSync(join(dst, 'ui'), { recursive: true });
cpSync(join(src, 'system/maude-v2'), join(dst, 'system/maude-v2'), { recursive: true });
cpSync(join(src, 'ui/v2'), join(dst, 'ui/v2'), { recursive: true });
const cfg = JSON.parse(readFileSync(join(src, 'config.json'), 'utf8'));
cfg.designSystems = cfg.designSystems.filter((d) => d.name === 'maude-v2');
cfg.defaultDesignSystem = 'maude-v2';
writeFileSync(join(dst, 'config.json'), JSON.stringify(cfg, null, 2));
console.log('design-copy1 ready');
