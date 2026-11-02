import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { makeImages } from './img.mjs';
import { join } from 'node:path';
import { REPO } from './lib.mjs';

export const BASE = join(REPO, 'apps/desktop/e2e/fixtures/project');
const CACHE = join(REPO, '.scr/fx-cache');

export async function base() {
  return BASE;
}

/** Base + 18 photos in assets/ + a canvas that places one (so a photo can be selected). */
export async function photos() {
  const d = join(CACHE, 'photos');
  if (existsSync(join(d, '.design/ui/Photos.tsx'))) return d;
  rmSync(d, { recursive: true, force: true });
  cpSync(BASE, d, { recursive: true });
  const as = join(d, '.design/assets');
  mkdirSync(as, { recursive: true });
  const names = ['IMG_2231', 'IMG_2232', 'IMG_2240', 'Matchday-01', 'Matchday-02', 'Matchday-03', 'Team-photo', 'Stadium', 'Logo-draft', 'Banner-wide', 'Fans-left', 'Fans-right', 'Goal', 'Trophy', 'Kit-front', 'Kit-back', 'Pitch', 'Tunnel'];
  await makeImages(names.map((n, i) => ({ path: join(as, `${n}.jpg`), w: i % 3 === 0 ? 640 : i % 3 === 1 ? 480 : 640, h: i % 3 === 0 ? 480 : i % 3 === 1 ? 640 : 360, kind: 'plasma', seed: i + 1 })));
  writeFileSync(
    join(d, '.design/ui/Photos.tsx'),
    `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";
export default function P() {
  return (
    <DesignCanvas>
      <DCSection id="p" title="Photos">
        <DCArtboard id="p1" label="Hero" width={480} height={320}>
          <img data-cd-id="photo" src="assets/Matchday-01.jpg" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`
  );
  return d;
}
