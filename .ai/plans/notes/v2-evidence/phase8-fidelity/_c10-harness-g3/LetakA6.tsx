/**
 * @canvas   LetakA6 · an A6 flyer whose QR code sits 2 mm inside the cut and whose headline face will not embed
 *           (09 ex-print-warn — the preflight says both in the sheet).
 */
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

const MM = 96 / 25.4;
const PRINT = { paper: "a6", orientation: "portrait", bleedMm: 3 };
const GREEN = "#1f6f3a";

export default function LetakA6() {
  return (
    <DesignCanvas>
      <DCSection id="print" title="LetakA6 · print">
        <DCArtboard id="a-tackle" kind="print" print={PRINT} label="A · přední (TACKLE)" width={419} height={581}>
          <div style={{ position: "relative", width: 419, height: 581, background: GREEN, color: "#fff", fontFamily: "system-ui" }}>
            <h1 style={{ margin: 0, position: "absolute", left: 3 * MM + 20, top: 3 * MM + 30, fontSize: 40, fontFamily: '"Avenir Next Condensed Heavy", system-ui', fontWeight: 800 }}>TACKLE</h1>
            <p style={{ margin: 0, position: "absolute", left: 3 * MM + 20, top: 3 * MM + 90, fontSize: 16 }}>Nábor 8–14 let · Út a Čt 17:00</p>
            <svg data-cd-id="qr-code" aria-label="QR code" viewBox="0 0 10 10" style={{ position: "absolute", width: 22 * MM, height: 22 * MM, right: (3 + 2) * MM, bottom: (3 + 20) * MM, background: "#fff" }}>
              <rect x="1" y="1" width="3" height="3" fill="#111" /><rect x="6" y="1" width="3" height="3" fill="#111" /><rect x="1" y="6" width="3" height="3" fill="#111" /><rect x="6" y="6" width="1" height="1" fill="#111" /><rect x="8" y="8" width="1" height="1" fill="#111" />
            </svg>
          </div>
        </DCArtboard>
        <DCArtboard id="b-back" kind="print" print={PRINT} label="B · zadní (TACKLE)" width={419} height={581}>
          <div style={{ width: 419, height: 581, boxSizing: "border-box", background: "#f2efe6", color: "#132038", padding: 3 * MM + 24, fontFamily: "system-ui" }}>Jak se přihlásit · alligators.cz/flag</div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
