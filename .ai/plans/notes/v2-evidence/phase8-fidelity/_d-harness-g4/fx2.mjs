import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './lib.mjs';
import { photos } from './fx.mjs';

const CACHE = join(REPO, '.scr/fx-cache');

/** photos() with content-addressed names (assets/<sha8>.jpg, what a real import stores) + a Spread canvas of six empty frames. */
export async function photos2() {
  const d = join(CACHE, 'photos2');
  if (existsSync(join(d, '.design/ui/Spread.tsx'))) return d;
  const src = await photos();
  rmSync(d, { recursive: true, force: true });
  cpSync(src, d, { recursive: true });
  const as = join(d, '.design/assets');
  const hex = ['3f9a1c2e', '8b27d40a', 'c41e90f7', '52d8ab13', 'e07f6b94', '19ac3d58'];
  ['IMG_2231', 'IMG_2232', 'IMG_2240', 'Matchday-01', 'Matchday-02', 'Matchday-03'].forEach((n, i) => {
    cpSync(join(as, `${n}.jpg`), join(as, `${hex[i]}.jpg`));
  });
  writeFileSync(
    join(d, '.design/ui/Photos.tsx'),
    `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";
export default function P() {
  return (
    <DesignCanvas>
      <DCSection id="p" title="Photos">
        <DCArtboard id="p1" label="Hero" width={480} height={320}>
          <img data-cd-id="photo" src="assets/${hex[3]}.jpg" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`
  );
  writeFileSync(
    join(d, '.design/ui/Spread.tsx'),
    `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";
export default function S() {
  const f = { width: 140, height: 100, objectFit: "cover" as const, background: "#e6e8ee" };
  return (
    <DesignCanvas>
      <DCSection id="s" title="Spread">
        <DCArtboard id="s1" label="MVP zápasu" width={480} height={320}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 140px)", gap: 12, padding: 20 }}>
            <img data-cd-id="f1" alt="" style={f} />
            <img data-cd-id="f2" alt="" style={f} />
            <img data-cd-id="f3" alt="" style={f} />
            <img data-cd-id="f4" alt="" style={f} />
            <img data-cd-id="f5" alt="" style={f} />
            <img data-cd-id="f6" alt="" style={f} />
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`
  );
  return d;
}
