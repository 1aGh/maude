/**
 * @canvas   print · an A6 leták, front and back, for the desktop export E2E (S8.7).
 * @platform desktop
 * @stack    React 19 · TSX
 *
 * Two print artboards of the same size whose names pair them (the front "přední", the back "zadní"), so the
 * Export sheet's Print section offers `Add “B · zadní (FLAG)”`. The front's QR box sits 2 mm inside the cut,
 * past the 5 mm safe margin, so the preflight has something to say. Slug `ui/Print.tsx` →
 * `data-testid="canvas-row-ui-print"`.
 */
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

// A6 105 × 148 mm + 3 mm bleed on every side at 96 dpi: 111 × 154 mm = 420 × 582 px
const W = 420, H = 582;
const MM = 96 / 25.4;
const PRINT = { paper: "a6", orientation: "portrait", bleedMm: 3 };

export default function PrintFixture() {
  return (
    <DesignCanvas>
      <DCSection id="p" title="Print E2E">
        <DCArtboard id="a-flag" kind="print" print={PRINT} label="A · přední (FLAG)" width={W} height={H}>
          <div style={{ position: "relative", width: "100%", height: "100%", background: "#1f6f3a", color: "#fff" }}>
            <h1 style={{ margin: 0, position: "absolute", left: 3 * MM + 20, top: 3 * MM + 30, fontSize: 28 }}>VYZKOUŠEJ FLAG</h1>
            <div
              data-cd-id="qr"
              style={{
                position: "absolute",
                width: 22 * MM,
                height: 22 * MM,
                right: (3 + 2) * MM,
                bottom: (3 + 40) * MM,
                background: "#fff",
              }}
            />
          </div>
        </DCArtboard>
        <DCArtboard id="b-flag" kind="print" print={PRINT} label="B · zadní (FLAG)" width={W} height={H}>
          <div style={{ width: "100%", height: "100%", background: "#f2efe6", color: "#132038", padding: 3 * MM + 24 }}>
            Hraj s námi flag
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
