// The V2-8.4 scenario canvas: a real DesignCanvas (selection, inspector, comments and export all
// need one — a bare page canvas rests on the live "browse" posture by design, DDR-223) with one
// artboard holding a heading, a line of text and a button. Written identically into the plain
// browser project and the cell's checkout, so the three shells open the same thing.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SCENARIO_CANVAS = `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Board() {
  return (
    <DesignCanvas>
      <DCSection id="cards" title="Cards">
        <DCArtboard id="card" label="Card" width={420} height={280}>
          <div style={{ padding: 28, fontFamily: "system-ui", background: "#ffffff", height: "100%" }}>
            <h1 style={{ margin: 0, fontSize: 30, color: "#111111" }}>Cross-shell card</h1>
            <p style={{ margin: "12px 0 20px", fontSize: 15, color: "#444444" }}>
              One canvas, three shells.
            </p>
            <button type="button" style={{ padding: "10px 18px", fontSize: 15, borderRadius: 8, border: 0, background: "#2563eb", color: "#ffffff" }}>
              Primary action
            </button>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

export const SCENARIO_META = {
  title: 'Scenario board',
  layout: { artboards: [{ id: 'card', x: 200, y: 160 }] },
};

/** Write the scenario canvas into `<root>/.design/ui/board.{tsx,meta.json}`. */
export function seedScenarioCanvas(root) {
  const dir = join(root, '.design', 'ui');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'board.tsx'), SCENARIO_CANVAS);
  writeFileSync(join(dir, 'board.meta.json'), `${JSON.stringify(SCENARIO_META, null, 2)}\n`);
}
