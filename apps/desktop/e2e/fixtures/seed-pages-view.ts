// Seed a project for pages-view.e2e.ts (2.0.7 B2 + polish): a six-artboard canvas `ui/Pages.tsx` with a Present
// order, and the `acme` design system converted, with its real Design system canvas (ds-bar + seven sections) — the
// polish steps turn Pages on there too and check the left panel follows the page.
//
// Run with bun: `bun fixtures/seed-pages-view.ts`. Prints the project root on its last stdout line.

import { makeProject } from '../../../studio/test/_ds-engine-fixture.ts';
import { installRealDsCanvas, labelDsGroup } from './real-ds-canvas.ts';

export const PAGES_IDS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
/** The Present order the canvas sets: p4 first, then p2; the rest follow in layout order. */
export const PAGES_META = `${JSON.stringify({ title: 'Pages', present: { order: ['p4', 'p2'] } }, null, 2)}\n`;

export function pagesCanvas(): string {
  const boards = PAGES_IDS.map(
    (id, i) =>
      `      <DCArtboard id="${id}" label="Page ${i + 1}" width={640} height={400}>\n` +
      `        <div style={{ padding: 32, fontSize: 48, fontFamily: 'system-ui' }}>Page ${i + 1}</div>\n` +
      '      </DCArtboard>'
  ).join('\n');
  return `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';\n\nexport default function Pages() {\n  return (\n    <DesignCanvas>\n${boards}\n    </DesignCanvas>\n  );\n}\n`;
}

if (import.meta.main) {
  const p = await makeProject();
  labelDsGroup(p.root);
  p.write('ui/Pages.tsx', pagesCanvas());
  p.write('ui/Pages.meta.json', PAGES_META);
  installRealDsCanvas(p.root, 'acme');
  // the app opens its own home on this project; ours must not hold the database
  p.home.close();
  console.log(p.root);
  process.exit(0);
}
