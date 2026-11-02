// S10.14 test fixture: the ds-engine scratch project (system `acme`, level 11, three canvases with no
// `designSystem`) plus two conformant systems — `alpha` (4 display steps, 5 palette colours) and `beta` (3 and 2) —
// and canvases on alpha: Home, Pairs (uses display-4 + palette-5, left out at an old revision), Pinned, Blocked
// (an undefined name), Pin (a `data-ds-rev` pin) and ui/combine/{One,Two}. Never this repo's `.design`.
import type { DsKernelPort } from '../ds/engine.ts';
import { makeProject, type Project } from './_ds-engine-fixture.ts';
import { conformantFiles, fixtureConfig } from './_ds-fixture.ts';

const sys = (name: string, extra: string) => {
  const cfg = fixtureConfig({
    name,
    path: `system/${name}`,
    tokensCssRel: `system/${name}/colors_and_type.css`,
    rootClass: name,
  });
  const files = conformantFiles(cfg);
  files[cfg.tokensCssRel] += `\n:root {\n${extra}}\n`;
  return { cfg, files };
};
const ramp = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `  --${prefix}-${i + 1}: ${i + 1}px;\n`).join('');

export const canvas = (body = '') =>
  `export default () => <section className="ds"><button className="btn">Go</button>${body}</section>;\n`;
export const pairsCanvas = canvas(
  '<h1 style={{ fontSize: "var(--display-4)", color: "var(--palette-5)" }}>Hi</h1>'
);

/** acme (level 11) + alpha (4 display, 5 palette) + beta (3 display, 2 palette), and canvases on alpha */
export async function switchProject(o: { kernel?: DsKernelPort | null } = {}): Promise<Project> {
  const p = await makeProject(o.kernel === undefined ? {} : { kernel: o.kernel });
  const alpha = sys('alpha', ramp('display', 4) + ramp('palette', 5));
  const beta = sys('beta', ramp('display', 3) + ramp('palette', 2));
  for (const s of [alpha, beta])
    for (const [rel, text] of Object.entries(s.files)) p.write(rel, text);
  const cfg = JSON.parse(p.read('config.json') as string);
  for (const s of [alpha, beta])
    cfg.designSystems.push({
      name: s.cfg.name,
      path: s.cfg.path,
      themes: ['light', 'dark'],
      themeDefault: 'light',
      rootClass: s.cfg.name,
    });
  p.write('config.json', `${JSON.stringify(cfg, null, 2)}\n`);
  const seen: string[] = [];
  const follow = (rel: string, tsx: string, meta: Record<string, unknown> = {}) => {
    const metaRel = rel.replace(/\.tsx$/, '.meta.json');
    p.write(rel, tsx);
    p.write(
      metaRel,
      `${JSON.stringify({ title: rel, designSystem: 'alpha', ...meta }, null, 2)}\n`
    );
    seen.push(rel, metaRel);
  };
  follow('ui/Home.tsx', canvas());
  follow('ui/Pairs.tsx', pairsCanvas, { dsRev: 'f'.repeat(64) });
  follow('ui/Pinned.tsx', canvas(), { dsPinned: true });
  follow('ui/Blocked.tsx', canvas('<i style={{ color: "var(--nope-undefined)" }} />'));
  follow('ui/Pin.tsx', canvas('<b data-ds-rev="head">x</b>'));
  follow('ui/combine/One.tsx', canvas());
  follow('ui/combine/Two.tsx', canvas());
  // the project's home learns the new files (the way its watcher would)
  for (const rel of seen) p.home.observe(rel);
  await p.home.flush();
  return p;
}
