import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE } from './fx.mjs';

import { HARNESS, REPO } from './lib.mjs';
const CACHE = join(REPO, '.scr/c10-g3/fx-cache');

/** Base + 18 photos in assets/ + a canvas that places one (so a photo can be selected). */
export async function photos() {
  const d = join(CACHE, 'photos');
  if (existsSync(join(d, '.design/ui/Photos.tsx'))) return d;
  rmSync(d, { recursive: true, force: true });
  cpSync(BASE, d, { recursive: true });
  const as = join(d, '.design/assets');
  mkdirSync(as, { recursive: true });
  const names = ['IMG_2231', 'IMG_2232', 'IMG_2240', 'Matchday-01', 'Matchday-02', 'Matchday-03', 'Team-photo', 'Stadium', 'Logo-draft', 'Banner-wide', 'Fans-left', 'Fans-right', 'Goal', 'Trophy', 'Kit-front', 'Kit-back', 'Pitch', 'Tunnel'];
  names.forEach((n, i) => {
    execFileSync('convert', ['-size', i % 3 === 0 ? '640x480' : i % 3 === 1 ? '480x640' : '640x360', 'plasma:fractal', join(as, `${n}.jpg`)]);
  });
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
