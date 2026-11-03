import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";


export default function PrintE2E() {
  return (
    <DesignCanvas>
      <DCSection id="p" title="Print E2E">
        <DCArtboard id="flyer" label="Flyer · A6 print" kind="print" print={{ paper: "a6", bleedMm: 3 }} width={397} height={559}>
          <div style={{ padding: 16, background: "#fff", color: "#111", height: "100%" }}>
            <h2 style={{ margin: 0 }}>Print flyer</h2>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
