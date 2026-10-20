// Seed a project for ds-edges.e2e.ts (S10.17): system `acme`, converted, with a Light text colour (`--fg-2`) that falls
// short of 4.5:1 on the page colour (`--bg-0`), a line colour (`--x-line-fine`) two canvases use, and the two canvases
// (an artboard each, elements read the tokens so the usage index has places).
//
// Run with bun: `bun fixtures/seed-ds-edges.ts`. Prints the project root on its last stdout line.

import { makeProject } from '../../../studio/test/_ds-engine-fixture.ts';

const CSS = `/* acme tokens */
:root,
.acme[data-theme="light"],
.ds[data-theme="light"] {
  --accent: oklch(0.55 0.2 255);
  --bg-0: #fbfbf8;
  --fg-0: #111111;
  --fg-2: #9aa89f;
  --x-line-fine: #dddddd;
  --x-line-mid: #bbbbbb;
}

.acme[data-theme="dark"],
.ds[data-theme="dark"] {
  --accent: oklch(0.65 0.2 255);
  --bg-0: #141815;
  --fg-0: #eeeeee;
  --fg-2: #c8d4cc;
  --x-line-fine: #333333;
  --x-line-mid: #555555;
}
`;

const canvas = (
  title: string
) => `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

export default function ${title}() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="${title}">
        <DCArtboard id="desktop" label="Desktop" width={600} height={375}>
          <div style={{ padding: 24, background: "var(--bg-0)", borderBottom: "1px solid var(--x-line-fine)" }}>
            <p data-cd-id="hint" style={{ color: "var(--fg-2)" }}>Hint</p>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

const p = await makeProject({ tokensCss: CSS });
p.write('ui/Home.tsx', canvas('Home'));
p.write('ui/Pricing.tsx', canvas('Pricing'));
// the app opens its own home on this project; ours must not hold the database
p.home.close();
console.log(p.root);
process.exit(0);
