import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HARNESS, REPO } from './lib.mjs';

export const BASE = join(REPO, 'apps/desktop/e2e/fixtures/project');
const CACHE = join(REPO, '.scr/c8m2-g3/fx-cache');

const canvas = (title, n = 1, kind = '') => `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";
export default function C() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="${title}">
${Array.from({ length: n }, (_, i) => `        <DCArtboard id="a${i}" label="${title} ${i + 1}" width={320} height={220}>
          <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", color: "#111", background: "#fff", height: "100%" }}>
            <h2 style={{ margin: 0 }}>${title}</h2><p>Artboard ${i + 1} of ${n}</p>
          </div>
        </DCArtboard>`).join('\n')}
      </DCSection>
    </DesignCanvas>
  );
}
`;

function fresh(name) {
  const d = join(CACHE, name);
  rmSync(d, { recursive: true, force: true });
  cpSync(BASE, d, { recursive: true });
  return d;
}

/** 93 canvases in folders + a 21-artboard canvas + a canvas that will not render. */
export async function big() {
  const d = join(CACHE, 'big');
  if (existsSync(join(d, '.design/ui/Wide.tsx'))) return d;
  fresh('big');
  const ui = join(d, '.design/ui');
  const folders = ['brand', 'campaign', 'matchday', 'web', 'print', 'social'];
  let n = 0;
  for (const f of folders) {
    mkdirSync(join(ui, f), { recursive: true });
    for (let i = 1; i <= 15 && n < 81; i++, n++) {
      const name = `${f[0].toUpperCase()}${f.slice(1)} ${String(i).padStart(2, '0')}`;
      const slug = name.replace(/ /g, '');
      writeFileSync(join(ui, f, `${slug}.tsx`), canvas(name));
    }
  }
  writeFileSync(join(ui, 'Wide.tsx'), canvas('Combine campaign', 21));
  writeFileSync(
    join(ui, 'Broken.tsx'),
    `import { DesignCanvas } from "@maude/canvas-lib";\nexport default function B() {\n  const x = ;\n  return <DesignCanvas>{x}</DesignCanvas>;\n}\n`
  );
  return d;
}

export async function empty() {
  const d = join(CACHE, 'empty');
  rmSync(d, { recursive: true, force: true });
  mkdirSync(join(d, '.design/ui'), { recursive: true });
  const cfg = JSON.parse(readFileSync(join(BASE, '.design/config.json'), 'utf8'));
  cfg.name = 'Studio site';
  writeFileSync(join(d, '.design/config.json'), JSON.stringify(cfg, null, 2));
  return d;
}

export async function base() {
  return BASE;
}
