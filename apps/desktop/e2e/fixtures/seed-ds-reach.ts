// Seed a project for ds-reach.e2e.ts (S10.9): ds-review's world (system `acme`, converted, three canvases, the
// Accent change waiting) where two canvases really USE the Accent — an artboard each, with elements that read
// `var(--accent)` and carry authored ids, so the usage index has places to ring.
//
// Run with bun: `bun fixtures/seed-ds-reach.ts`. Prints the project root on its last stdout line.

import { ACCENT, DS, makeProject, PERSON } from '../../../studio/test/_ds-engine-fixture.ts';
import { buildUsageIndex, installRealDsCanvas, labelDsGroup } from './real-ds-canvas.ts';

const canvas = (
  title: string,
  ids: string[]
) => `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

export default function ${title}() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="${title}">
        <DCArtboard id="desktop" label="Desktop" width={600} height={375}>
          <div style={{ padding: 24, display: "flex", gap: 16 }}>
${ids
  .map(
    (id) =>
      `            <button data-cd-id="${id}" style={{ background: "var(--accent)", color: "#fff", padding: "8px 16px", border: 0 }}>${id}</button>`
  )
  .join('\n')}
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

const p = await makeProject();
labelDsGroup(p.root);
p.write('ui/Home.tsx', canvas('Home', ['cta', 'nav']));
p.write('ui/Pricing.tsx', canvas('Pricing', ['buy']));
buildUsageIndex(p);
await p.engine.mergePending(DS, {
  tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
  by: PERSON,
});
// last, after anything the engine records: the swap is a plain disk write, and the engine's own proposals
// (a waiting change is a `dsPending` entry in the canvas meta) are written through the kernel — the meta kept here
// is read AFTER them, so the disk copy the server finds at boot already holds the pending change
installRealDsCanvas(p.root, 'acme');
// the app opens its own home on this project; ours must not hold the database
p.home.close();
console.log(p.root);
process.exit(0);
